use std::path::PathBuf;
use std::process::Stdio;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::error::{AppError, AppResult};
use crate::ffmpeg::resolver;

/// Streamed progress event from a long-running ffmpeg job.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum FFmpegEvent {
    Progress { percent: f64, fps: f64, frame: u64, total_frames: Option<u64>, speed: f64, time: String },
    Stderr { line: String },
    Finished { success: bool, message: String },
}

pub async fn probe_version(ffmpeg: &PathBuf) -> AppResult<String> {
    let out = Command::new(ffmpeg).arg("-version").output().await.map_err(|e| AppError::Ffmpeg(e.to_string()))?;
    if !out.status.success() {
        return Ok("unknown".into());
    }
    let s = String::from_utf8_lossy(&out.stdout);
    Ok(s.lines().next().unwrap_or("unknown").trim().to_string())
}

pub async fn run_ffmpeg(args: &[&str]) -> AppResult<String> {
    let paths = resolver::get()?;
    let out = Command::new(&paths.ffmpeg)
        .args(args)
        .stderr(Stdio::piped())
        .stdout(Stdio::piped())
        .output()
        .await
        .map_err(|e| AppError::Ffmpeg(e.to_string()))?;
    let s = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() {
        return Err(AppError::Ffmpeg(s.to_string()));
    }
    Ok(s.to_string())
}

pub async fn run_ffprobe(args: &[&str]) -> AppResult<String> {
    let paths = resolver::get()?;
    let out = Command::new(&paths.ffprobe)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| AppError::Ffmpeg(e.to_string()))?;
    let s = String::from_utf8_lossy(&out.stdout);
    if s.is_empty() && !out.status.success() {
        return Err(AppError::Ffmpeg(String::from_utf8_lossy(&out.stderr).to_string()));
    }
    Ok(s.to_string())
}

/// Spawn ffmpeg, parse progress from stderr, and emit events over Tauri.
pub async fn run_ffmpeg_with_events(
    app: &tauri::AppHandle,
    event_name: &str,
    total_frames: Option<u64>,
    args: Vec<String>,
) -> AppResult<()> {
    let paths = resolver::get()?;
    let mut cmd = Command::new(&paths.ffmpeg);
    cmd.args(args.iter().map(String::as_str))
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .stdin(Stdio::null());
    let mut child = cmd.spawn().map_err(|e| AppError::Ffmpeg(e.to_string()))?;
    let stderr = child.stderr.take().ok_or_else(|| AppError::Ffmpeg("no stderr".into()))?;
    let mut reader = BufReader::new(stderr).lines();

    while let Ok(Some(line)) = reader.next_line().await {
        let parsed = parse_progress_line(&line);
        if let Some((percent, fps, frame, speed, time)) = parsed {
            let _ = app.emit(
                event_name,
                &FFmpegEvent::Progress { percent, fps, frame, total_frames, speed, time },
            );
        } else {
            let _ = app.emit(event_name, &FFmpegEvent::Stderr { line });
        }
    }

    let status = child.wait().await.map_err(|e| AppError::Ffmpeg(e.to_string()))?;
    let success = status.success();
    let _ = app.emit(
        event_name,
        &FFmpegEvent::Finished {
            success,
            message: if success { "ok".into() } else { "ffmpeg exited with non-zero status".into() },
        },
    );
    if !success {
        return Err(AppError::Ffmpeg("ffmpeg failed".into()));
    }
    Ok(())
}

/// Parse an `out_time_ms`, `frame`, `fps`, `speed` style progress line.
/// ffmpeg writes these when `-progress pipe:2` is set.
fn parse_progress_line(line: &str) -> Option<(f64, f64, u64, f64, String)> {
    if !line.starts_with("frame=") && !line.contains("out_time_ms=") && !line.contains("progress=") {
        return None;
    }
    let mut frame = 0u64;
    let mut fps = 0.0;
    let mut speed = 0.0;
    let mut time = String::new();
    let mut out_us = 0u64;
    for tok in line.split_whitespace() {
        let (k, v) = tok.split_once('=')?;
        match k {
            "frame" => frame = v.parse().unwrap_or(0),
            "fps" => fps = v.parse().unwrap_or(0.0),
            "speed" => speed = v.trim_end_matches('x').parse().unwrap_or(0.0),
            "out_time_ms" => out_us = v.parse().unwrap_or(0),
            "out_time" => time = v.to_string(),
            _ => {}
        }
    }
    let _ = out_us;
    let percent = 0.0;
    Some((percent, fps, frame, speed, time))
}
