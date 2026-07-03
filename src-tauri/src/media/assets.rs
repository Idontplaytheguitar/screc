use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::ffmpeg::{run_ffmpeg, run_ffprobe};

/// Generate a single thumbnail JPEG from a video at a given time offset.
pub async fn generate_thumbnail(path: &Path, time_sec: f64, out: &Path) -> AppResult<()> {
    if let Some(p) = out.parent() { std::fs::create_dir_all(p)?; }
    let args = vec![
        "-ss".into(), format!("{:.3}", time_sec),
        "-i".into(), path.to_string_lossy().into(),
        "-frames:v".into(), "1".into(),
        "-vf".into(), "scale=320:-1".into(),
        "-q:v".into(), "3".into(),
        "-y".into(),
        out.to_string_lossy().into(),
    ];
    run_ffmpeg(&args.iter().map(|s: &String| s.as_str()).collect::<Vec<_>>()).await?;
    if !out.exists() {
        return Err(AppError::Other("thumbnail not produced".into()));
    }
    Ok(())
}

/// Generate multiple thumbnails spread across the video, returns their paths.
pub async fn generate_thumbnails(path: &Path, count: u32, dir: &Path) -> AppResult<Vec<PathBuf>> {
    std::fs::create_dir_all(dir)?;
    let dur = media_duration(path).await?;
    if dur <= 0.0 { return Ok(Vec::new()); }
    let mut out = Vec::new();
    for i in 0..count {
        let t = dur * (i as f64 + 0.5) / count as f64;
        let p = dir.join(format!("thumb_{:03}.jpg", i));
        if generate_thumbnail(path, t, &p).await.is_ok() {
            out.push(p);
        }
    }
    Ok(out)
}

/// Generate a waveform PNG for an audio file.
pub async fn generate_waveform(path: &Path, out: &Path) -> AppResult<()> {
    if let Some(p) = out.parent() { std::fs::create_dir_all(p)?; }
    let args = vec![
        "-i".into(), path.to_string_lossy().into(),
        "-filter_complex".into(), "showwavespic=s=1200x80:colors=#22c55e|#3b82f6".into(),
        "-frames:v".into(), "1".into(),
        "-y".into(),
        out.to_string_lossy().into(),
    ];
    run_ffmpeg(&args.iter().map(|s: &String| s.as_str()).collect::<Vec<_>>()).await?;
    Ok(())
}

/// Extract a segment [start, end) of a media file into a new file (used for split/cut preview proxies).
pub async fn extract_clip_segment(path: &Path, start: f64, end: f64, out: &Path) -> AppResult<()> {
    if let Some(p) = out.parent() { std::fs::create_dir_all(p)?; }
    let dur = (end - start).max(0.0);
    let args = vec![
        "-ss".into(), format!("{:.3}", start),
        "-i".into(), path.to_string_lossy().into(),
        "-t".into(), format!("{:.3}", dur),
        "-c".into(), "copy".into(),
        "-y".into(),
        out.to_string_lossy().into(),
    ];
    run_ffmpeg(&args.iter().map(|s: &String| s.as_str()).collect::<Vec<_>>()).await?;
    Ok(())
}

/// Capture a single full-screen frame to an image, used as the frozen backdrop
/// for the region selector (works regardless of compositor transparency support).
pub async fn grab_screen_frame(screen_id: &str, x: i32, y: i32, width: u32, height: u32, out: &Path) -> AppResult<()> {
    if let Some(p) = out.parent() { std::fs::create_dir_all(p)?; }
    let mut args: Vec<String> = Vec::new();
    #[cfg(target_os = "linux")]
    {
        let _ = screen_id;
        if crate::recording::capture::is_wayland() {
            return wayland_screenshot(x, y, width, height, out).await;
        }
        let display = std::env::var("DISPLAY").unwrap_or_else(|_| ":0".into());
        args.extend([
            "-f".into(), "x11grab".into(),
            "-video_size".into(), format!("{}x{}", width, height),
            "-i".into(), format!("{}+{},{}", display, x, y),
        ]);
    }
    #[cfg(target_os = "macos")]
    {
        let _ = (x, y, width, height);
        args.extend([
            "-f".into(), "avfoundation".into(),
            "-framerate".into(), "30".into(),
            "-i".into(), format!("{}:none", screen_id),
        ]);
    }
    #[cfg(target_os = "windows")]
    {
        let _ = screen_id;
        args.extend([
            "-f".into(), "gdigrab".into(),
            "-offset_x".into(), format!("{}", x),
            "-offset_y".into(), format!("{}", y),
            "-video_size".into(), format!("{}x{}", width, height),
            "-i".into(), "desktop".into(),
        ]);
    }
    args.extend(["-frames:v".into(), "1".into(), "-update".into(), "1".into(), "-y".into(), out.to_string_lossy().into()]);
    run_ffmpeg(&args.iter().map(|s: &String| s.as_str()).collect::<Vec<_>>()).await?;
    if !out.exists() {
        return Err(AppError::Other("screen frame not produced".into()));
    }
    Ok(())
}

/// Wayland screenshot: try the common compositor tools (x11grab only sees black),
/// then crop the full-desktop image to the requested screen with ffmpeg.
#[cfg(target_os = "linux")]
async fn wayland_screenshot(x: i32, y: i32, width: u32, height: u32, out: &Path) -> AppResult<()> {
    use tokio::process::Command;
    let full = out.with_extension("full.png");
    let _ = std::fs::remove_file(&full);

    let mut captured = false;
    let candidates: Vec<(&str, Vec<String>)> = vec![
        ("grim", vec![full.to_string_lossy().into()]),
        ("gnome-screenshot", vec!["-f".into(), full.to_string_lossy().into()]),
        ("spectacle", vec!["-b".into(), "-n".into(), "-o".into(), full.to_string_lossy().into()]),
    ];
    for (bin, args) in candidates {
        if crate::recording::capture::find_bin(bin).is_none() { continue; }
        let ok = Command::new(bin).args(&args).output().await.map(|o| o.status.success()).unwrap_or(false);
        if ok && full.exists() { captured = true; break; }
    }
    if !captured {
        if let Some(bin) = crate::recording::capture::find_bin("cosmic-screenshot") {
            let dir = full.parent().unwrap_or(Path::new("."));
            if let Ok(o) = Command::new(bin)
                .args(["--interactive=false", "--notify=false", "--save-dir", &dir.to_string_lossy()])
                .output()
                .await
            {
                let saved = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if o.status.success() && !saved.is_empty() && Path::new(&saved).exists() {
                    std::fs::rename(&saved, &full).or_else(|_| std::fs::copy(&saved, &full).map(|_| ()))?;
                    captured = full.exists();
                }
            }
        }
    }
    if !captured {
        return Err(AppError::Platform(
            "No Wayland screenshot tool found — install grim, gnome-screenshot, or spectacle.".into(),
        ));
    }

    let crop = format!("crop={}:{}:{}:{}", width, height, x.max(0), y.max(0));
    run_ffmpeg(&[
        "-i", &full.to_string_lossy(),
        "-vf", &crop,
        "-frames:v", "1", "-update", "1", "-y",
        &out.to_string_lossy(),
    ]).await?;
    let _ = std::fs::remove_file(&full);
    if !out.exists() {
        return Err(AppError::Other("screen frame not produced".into()));
    }
    Ok(())
}

pub async fn media_duration(path: &Path) -> AppResult<f64> {
    let s = run_ffprobe(&[
        "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        &path.to_string_lossy(),
    ]).await?;
    s.trim().parse::<f64>().map_err(|e| AppError::Ffmpeg(e.to_string()))
}
