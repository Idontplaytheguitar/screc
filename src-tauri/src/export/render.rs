use std::collections::HashMap;
use std::path::Path;

use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::export::model::{Clip, ExportProject, ExportSettings, TrackKind};
use crate::ffmpeg::run_ffmpeg_with_events;

/// Estimate total frames for progress reporting.
pub fn estimate_total_frames(project: &ExportProject, settings: &ExportSettings) -> u64 {
    let fps = if settings.fps > 0.0 { settings.fps } else { project.fps };
    (project.duration * fps).round() as u64
}

/// Build and run the export ffmpeg command, streaming progress over Tauri events.
pub async fn export_project(app: &AppHandle, project: &ExportProject, settings: &ExportSettings) -> AppResult<()> {
    let (inputs, filter) = build_filtergraph(project, settings)?;
    let total_frames = estimate_total_frames(project, settings);

    let mut args: Vec<String> = Vec::new();
    // Inputs first (each `-i path`).
    for inp in &inputs {
        args.push("-i".into());
        args.push(inp.clone());
    }
    if !filter.is_empty() {
        args.push("-filter_complex".into());
        args.push(filter);
    }
    args.push("-map".into()); args.push("[vout]".into());

    let is_gif = settings.format == "gif";
    if !is_gif {
        args.push("-map".into()); args.push("[aout]".into());
        // Encoder args
        args.push("-c:v".into()); args.push(resolve_codec(&settings.video_codec).into());
        if let Some(b) = settings.video_bitrate {
            args.push("-b:v".into()); args.push(format!("{}", b));
        } else if let Some(c) = settings.crf {
            args.push("-crf".into()); args.push(format!("{}", c));
        }
        args.push("-preset".into()); args.push(settings.preset.clone());
        args.push("-pix_fmt".into()); args.push("yuv420p".into());
        args.push("-r".into()); args.push(format!("{}", settings.fps));

        args.push("-c:a".into()); args.push(resolve_audio_codec(&settings.audio_codec, &settings.format).into());
        if let Some(b) = settings.audio_bitrate {
            args.push("-b:a".into()); args.push(format!("{}", b));
        }
        args.push("-ar".into()); args.push(format!("{}", settings.audio_sample_rate));
        args.push("-ac".into()); args.push(format!("{}", settings.audio_channels));
    } else {
        args.push("-c:v".into()); args.push("gif".into());
        args.push("-pix_fmt".into()); args.push("rgb8".into());
    }

    // Format
    args.push("-f".into()); args.push(container_fmt(&settings.format).into());
    if matches!(settings.format.as_str(), "mp4" | "mov") {
        args.push("-movflags".into()); args.push("+faststart".into());
    }
    args.push("-progress".into()); args.push("pipe:2".into());
    args.push("-y".into());
    args.push(settings.output_path.clone());

    if let Some(p) = Path::new(&settings.output_path).parent() {
        std::fs::create_dir_all(p)?;
    }

    run_ffmpeg_with_events(app, "export://progress", Some(total_frames), args).await?;
    Ok(())
}

fn resolve_codec(name: &str) -> &str {
    match name {
        "h264" | "x264" => "libx264",
        "h265" | "hevc" | "x265" => "libx265",
        "av1" | "aom" => "libaom-av1",
        "vp9" => "libvpx-vp9",
        "vp8" => "libvpx",
        "gif" => "gif",
        "prores" => "prores_ks",
        "nvenc_h264" => "h264_nvenc",
        "nvenc_hevc" => "hevc_nvenc",
        "qsv_h264" => "h264_qsv",
        "amf_h264" => "h264_amf",
        "videotoolbox_h264" => "h264_videotoolbox",
        other => other,
    }
}

fn resolve_audio_codec(name: &str, format: &str) -> &'static str {
    match name {
        "aac" => "aac",
        "mp3" => "libmp3lame",
        "opus" => "libopus",
        "vorbis" => "libvorbis",
        "pcm" => "pcm_s16le",
        "flac" => "flac",
        _ => match format { "webm" => "libopus", "mp4" | "mov" => "aac", _ => "aac" },
    }
}

fn container_fmt(format: &str) -> &str {
    match format {
        "mp4" => "mp4",
        "mov" => "mov",
        "webm" => "webm",
        "mkv" => "matroska",
        "avi" => "avi",
        "gif" => "gif",
        _ => "matroska",
    }
}

/// Build the filter_complex string and the ordered list of `-i` inputs.
/// Labels: [vout] = final composited video, [aout] = final mixed audio.
fn build_filtergraph(project: &ExportProject, settings: &ExportSettings) -> AppResult<(Vec<String>, String)> {
    // Dedupe source files → input index.
    let mut input_map: HashMap<String, usize> = HashMap::new();
    let mut inputs: Vec<String> = Vec::new();
    for tr in &project.tracks {
        for c in &tr.clips {
            if c.source_path.is_empty() && tr.kind != TrackKind::Text { continue; }
            if !input_map.contains_key(&c.source_path) {
                input_map.insert(c.source_path.clone(), inputs.len());
                inputs.push(c.source_path.clone());
            }
        }
    }

    let mut filters: Vec<String> = Vec::new();
    let out_w = settings.width;
    let out_h = settings.height;

    // --- VIDEO -------------------------------------------------------------
    // Build a transformed stream per clip, then overlay clips bottom->top in
    // track order. Each overlay is enabled only during its timeline window so
    // sequential clips on one track don't collide, and honors per-clip x/y/scale.
    let video_tracks: Vec<&crate::export::model::Track> = project.tracks.iter()
        .filter(|t| matches!(t.kind, TrackKind::Video))
        .collect();

    let mut clip_streams: Vec<(String, f64, f64, f64, f64)> = Vec::new(); // label, x, y, start, dur
    for (ti, track) in video_tracks.iter().enumerate() {
        if track.muted { continue; }
        for (ci, c) in track.clips.iter().enumerate() {
            if c.source_path.is_empty() { continue; }
            let in_idx = *input_map.get(&c.source_path).unwrap_or(&0);
            let label = format!("v{}_{}", ti, ci);
            let mut f = format!(
                "[{}:v]trim=start={:0.3}:end={:0.3},setpts=PTS-STARTPTS",
                in_idx, c.source_in, c.source_out
            );
            if c.speed != 1.0 {
                f.push_str(&format!(",setpts=PTS/{}", c.speed));
            }
            let sw = ((out_w as f64) * c.scale).round() as i32;
            let sh = ((out_h as f64) * c.scale).round() as i32;
            f.push_str(&format!(",scale={}:{}", sw.max(1), sh.max(1)));
            if c.opacity < 1.0 {
                f.push_str(&format!(",format=yuva420p,colorchannelmixer=aa={:0.3}", c.opacity));
            }
            if c.fade_in > 0.0 || c.fade_out > 0.0 {
                let fi = c.fade_in;
                let fo = c.fade_out;
                f.push_str(&format!(
                    ",fade=t=in:st=0:d={:0.3}:alpha=1,fade=t=out:st={:0.3}:d={:0.3}:alpha=1",
                    fi, (c.timeline_duration - fo).max(0.0), fo
                ));
            }
            filters.push(format!("{}[{}]", f, label));
            clip_streams.push((label, c.x, c.y, c.timeline_start, c.timeline_duration));
        }
    }

    // Composite: first clip is the base, subsequent clips overlay (with temporal enable).
    let mut video_final: String;
    if clip_streams.is_empty() {
        filters.push(format!("color=c=black:s={}x{}:d={:0.3}[vbase]", out_w, out_h, project.duration));
        video_final = "vbase".to_string();
    } else {
        video_final = clip_streams[0].0.clone();
        for (i, (label, x, y, start, dur)) in clip_streams.iter().enumerate().skip(1) {
            let px = (x * out_w as f64).round() as i32;
            let py = (y * out_h as f64).round() as i32;
            let next = format!("vcomp{}", i);
            let enable = format!("enable='between(t,{:0.3},{:0.3})'", start, start + dur);
            filters.push(format!(
                "[{}][{}]overlay={}:{}:eof_action=endall:{}[{}]",
                video_final, label, px, py, enable, next
            ));
            video_final = next;
        }
    }

    // Text tracks: drawtext over final video.
    let text_tracks: Vec<&crate::export::model::Track> = project.tracks.iter().filter(|t| matches!(t.kind, TrackKind::Text)).collect();
    for (i, track) in text_tracks.iter().enumerate() {
        for c in &track.clips {
            if let Some(text) = &c.text {
                let escaped = text.replace('\\', "\\\\").replace(':', "\\:").replace("'", "\u{2019}");
                let x = (c.x * out_w as f64).round() as i32;
                let y = (c.y * out_h as f64).round() as i32;
                let enable = format!("between(t,{:0.3},{:0.3})", c.timeline_start, c.timeline_start + c.timeline_duration);
                let next = format!("vtext{}_{}", i, c.id);
                filters.push(format!(
                    "[{}]drawtext=text='{}':x={}:y={}:fontcolor=white:fontsize={}:box=1:boxcolor=black@0.4:enable='{}'[{}]",
                    video_final, escaped, x, y, 48, enable, next
                ));
                video_final = next;
            }
        }
    }

    // --- AUDIO -------------------------------------------------------------
    let audio_tracks: Vec<&crate::export::model::Track> = project.tracks.iter()
        .filter(|t| matches!(t.kind, TrackKind::Audio))
        .collect();

    let mut audio_labels: Vec<String> = Vec::new();
    for (ti, track) in audio_tracks.iter().enumerate() {
        if track.muted { continue; }
        let clips: Vec<&Clip> = track.clips.iter().collect();
        if clips.is_empty() { continue; }
        let mut clip_labels: Vec<String> = Vec::new();
        for (ci, c) in clips.iter().enumerate() {
            let in_idx = *input_map.get(&c.source_path).unwrap_or(&0);
            let label = format!("a{}_{}", ti, ci);
            let mut f = format!(
                "[{}:a]atrim=start={:0.3}:end={:0.3},asetpts=PTS-STARTPTS",
                in_idx, c.source_in, c.source_out
            );
            if c.speed != 1.0 {
                f.push_str(&format!(",atempo={:0.4}", c.speed));
            }
            if c.volume != 1.0 {
                f.push_str(&format!(",volume={:0.4}", c.volume));
            }
            if c.fade_in > 0.0 {
                f.push_str(&format!(",afade=t=in:st=0:d={:0.3}", c.fade_in));
            }
            if c.fade_out > 0.0 {
                f.push_str(&format!(",afade=t=out:st={:0.3}:d={:0.3}", c.timeline_duration - c.fade_out, c.fade_out));
            }
            filters.push(format!("{}[{}]", f, label));
            clip_labels.push(label);
        }
        let concat_inputs = clip_labels.iter().map(|l| format!("[{}]", l)).collect::<Vec<_>>().join("");
        let track_label = format!("atrack{}", ti);
        filters.push(format!("{}concat=n={}:v=0:a=1[{}]", concat_inputs, clip_labels.len(), track_label));
        audio_labels.push(track_label);
    }

    // Mix all audio tracks.
    let audio_final: String;
    if audio_labels.is_empty() {
        // silent audio track so output has audio
        filters.push(format!("anullsrc=channel_layout=stereo:sample_rate={}[aout]", settings.audio_sample_rate));
        audio_final = "aout".to_string();
    } else if audio_labels.len() == 1 {
        // remap to aout with sample rate
        filters.push(format!("[{}]aresample={}[aout]", audio_labels[0], settings.audio_sample_rate));
        audio_final = "aout".to_string();
    } else {
        let inputs = audio_labels.iter().map(|l| format!("[{}]", l)).collect::<Vec<_>>().join("");
        filters.push(format!("{}amix=inputs={}:duration=longest:normalize=0[aout]", inputs, audio_labels.len()));
        audio_final = "aout".to_string();
    }
    let _ = audio_final;

    // Final: relabel video_final as vout.
    if video_final != "vout" {
        filters.push(format!("[{}]null[vout]", video_final));
    }

    let filter = filters.join(";");
    Ok((inputs, filter))
}
