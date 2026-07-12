use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, LazyLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::recording::config::{AudioInput, RecordingConfig, Region, ScreenCapture, WebcamCapture};

/// A running recording session.
pub struct RecordingHandle {
    pub session_id: String,
    pub folder: PathBuf,
    pub started_at: Instant,
    pub wall_start_ms: u64,
    children: Vec<(tokio::process::Child, crate::recording::capture::StopMode)>,
}

static SESSIONS: LazyLock<Mutex<HashMap<String, RecordingHandle>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// Spawns the per-source ffmpeg processes and registers the session.
pub async fn start_session(app: &AppHandle, mut config: RecordingConfig) -> AppResult<String> {
    let session_id = Uuid::new_v4().to_string();
    let base = if config.output_dir.is_empty() {
        app.path().app_data_dir().map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?.join("recordings")
    } else {
        PathBuf::from(&config.output_dir)
    };
    let folder = base.join(&session_id);
    std::fs::create_dir_all(&folder)?;

    // Record the wall-clock start used for alignment across sources.
    let wall_start_ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);

    let mut children: Vec<(tokio::process::Child, crate::recording::capture::StopMode)> = Vec::new();
    let mut sources: Vec<SessionSource> = Vec::new();

    // Screen
    let screen_path = folder.join(format!("screen.{}", ext_for_container(&config.container)));
    let (cmd, _kind) = crate::recording::capture::screen_cmd(&config.screen, &config.video, &config.container, &screen_path)?;
    if !cmd.args.is_empty() {
        let stop = cmd.stop;
        let child = spawn_capture(cmd).await?;
        children.push((child, stop));
        sources.push(SessionSource {
            kind: "screen".into(),
            label: config.screen.screen_id.clone(),
            path: screen_path.to_string_lossy().into(),
            stream_index: 0,
            start_offset_ms: 0,
            duration_ms: None,
        });
    }

    // Webcam
    if let Some(wc) = &config.webcam {
        let wc_path = folder.join(format!("webcam.{}", ext_for_container(&config.container)));
        let (mut args, _) = crate::recording::capture::webcam_args(wc, &config.video, &config.container, &wc_path)?;
        if !args.is_empty() {
            let child = spawn_ffmpeg(&mut args).await?;
            children.push((child, crate::recording::capture::StopMode::Quit));
            sources.push(SessionSource {
                kind: "webcam".into(),
                label: wc.device_id.clone(),
                path: wc_path.to_string_lossy().into(),
                stream_index: 0,
                start_offset_ms: 0,
                duration_ms: None,
            });
        }
    }

    // Audio sources (one file each, wav for exact sample alignment)
    for (i, ai) in config.audio.iter().enumerate() {
        let safe = sanitize(&ai.name);
        let au_path = folder.join(format!("audio-{}-{}.wav", i, safe));
        let (mut args, _) = crate::recording::capture::audio_args(ai, &au_path)?;
        if !args.is_empty() {
            let child = spawn_ffmpeg(&mut args).await?;
            children.push((child, crate::recording::capture::StopMode::Quit));
            let kind_label = match ai.kind { crate::devices::AudioKind::Mic => "mic", crate::devices::AudioKind::SystemLoopback => "system" };
            sources.push(SessionSource {
                kind: kind_label.into(),
                label: ai.name.clone(),
                path: au_path.to_string_lossy().into(),
                stream_index: 0,
                start_offset_ms: 0,
                duration_ms: None,
            });
        }
    }

    // Early failure detection: give processes a brief window to crash (bad
    // device, missing codec, permission denied). ffmpeg prints errors to
    // stderr very quickly in that case. Any child that has already exited
    // before it could capture a frame is treated as a fatal error so the
    // frontend knows the recording never started.
    let early_check = tokio::time::Instant::now() + std::time::Duration::from_millis(400);
    loop {
        let mut all_alive = true;
        for (child, _stop) in children.iter_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let stderr = child.stderr.take();
                    let detail = match stderr {
                        Some(mut s) => {
                            use tokio::io::AsyncReadExt;
                            let mut buf = Vec::with_capacity(4096);
                            let _ = tokio::time::timeout(
                                std::time::Duration::from_millis(150),
                                s.read_to_end(&mut buf),
                            ).await;
                            String::from_utf8_lossy(&buf).to_string()
                        }
                        None => String::new(),
                    };
                    let msg = if detail.is_empty() {
                        format!("capture process exited with {status} before producing output")
                    } else {
                        detail.lines().take(20).collect::<Vec<_>>().join("\n")
                    };
                    // Tear down siblings.
                    for (other, _s) in children.iter_mut() { let _ = other.start_kill(); }
                    let _ = std::fs::remove_dir_all(&folder);
                    return Err(AppError::Recording(msg));
                }
                Ok(None) => {}
                Err(_) => { all_alive = false; }
            }
        }
        if all_alive && tokio::time::Instant::now() >= early_check {
            break;
        }
        if !all_alive || tokio::time::Instant::now() >= early_check {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    }

    let handle = RecordingHandle {
        session_id: session_id.clone(),
        folder: folder.clone(),
        started_at: Instant::now(),
        wall_start_ms,
        children,
    };
    SESSIONS.lock().unwrap().insert(session_id.clone(), handle);

    let _ = app.emit("recording://started", &serde_json::json!({ "session_id": session_id, "folder": folder.to_string_lossy() }));
    Ok(session_id)
}

/// Pause a running session: suspend all capture processes so no frames are
/// captured. On Unix uses SIGSTOP; on Windows this is currently a no-op
/// (the UI still toggles, but capture continues — to be wired later).
pub async fn pause_session(_app: &AppHandle, session_id: &str) -> AppResult<()> {
    let g = SESSIONS.lock().unwrap();
    let handle = g.get(session_id).ok_or_else(|| AppError::Recording("session not found".into()))?;
    for (child, _stop) in handle.children.iter() {
        if let Some(pid) = child.id() {
            #[cfg(unix)]
            { let _ = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(pid as i32),
                nix::sys::signal::Signal::SIGSTOP,
            ); }
            #[cfg(not(unix))]
            { let _ = pid; }
        }
    }
    Ok(())
}

/// Resume a paused session.
pub async fn resume_session(_app: &AppHandle, session_id: &str) -> AppResult<()> {
    let g = SESSIONS.lock().unwrap();
    let handle = g.get(session_id).ok_or_else(|| AppError::Recording("session not found".into()))?;
    for (child, _stop) in handle.children.iter() {
        if let Some(pid) = child.id() {
            #[cfg(unix)]
            { let _ = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(pid as i32),
                nix::sys::signal::Signal::SIGCONT,
            ); }
            #[cfg(not(unix))]
            { let _ = pid; }
        }
    }
    Ok(())
}

/// Save a finished session to a user-chosen directory, copying each source
/// file into the destination. Returns the list of written paths.
pub fn save_session_to(handle_folder: &std::path::Path, dest: &std::path::Path) -> AppResult<Vec<PathBuf>> {
    std::fs::create_dir_all(dest)?;
    let manifest_path = handle_folder.join("session.json");
    let mut written = Vec::new();
    let mut entries: Vec<PathBuf> = std::fs::read_dir(handle_folder)?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.file_name().map(|n| n != "session.json").unwrap_or(true))
        .collect();
    entries.sort();
    for src in entries {
        let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "asset".into());
        let dst = dest.join(&name);
        std::fs::copy(&src, &dst)?;
        written.push(dst);
    }
    if manifest_path.exists() {
        let dst = dest.join("session.json");
        // Rewrite the manifest so paths point at the new location, otherwise
        // re-opening the saved session would probe the original (now moved) files.
        if let Ok(data) = std::fs::read(&manifest_path) {
            if let Ok(mut manifest) = serde_json::from_slice::<SessionManifest>(&data) {
                manifest.folder = dest.to_string_lossy().into();
                for source in manifest.sources.iter_mut() {
                    if let Some(file_name) = std::path::Path::new(&source.path).file_name() {
                        source.path = dest.join(file_name).to_string_lossy().into();
                    }
                }
                if let Ok(bytes) = serde_json::to_vec_pretty(&manifest) {
                    std::fs::write(&dst, bytes)?;
                    written.push(dst);
                    return Ok(written);
                }
            }
        }
        std::fs::copy(&manifest_path, &dst)?;
        written.push(dst);
    }
    Ok(written)
}

/// Stop a running session: send 'q' to each ffmpeg (graceful), wait, write manifest.
pub async fn stop_session(app: &AppHandle, session_id: &str) -> AppResult<SessionManifest> {
    let handle_opt = { SESSIONS.lock().unwrap().remove(session_id) };
    let mut handle = handle_opt.ok_or_else(|| AppError::Recording("session not found".into()))?;

    // Resume any paused children first so they can drain stdin and finalize
    // (a SIGSTOP'd ffmpeg won't process the 'q' and would be killed mid-mux).
    #[cfg(unix)]
    for (child, _) in handle.children.iter() {
        if let Some(pid) = child.id() {
            let _ = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(pid as i32),
                nix::sys::signal::Signal::SIGCONT,
            );
        }
    }

    // Graceful stop: 'q' on stdin for ffmpeg, SIGINT for external recorders — both
    // flush the muxer. Kill only if a process ignores the request.
    for (child, stop) in handle.children.iter_mut() {
        match stop {
            crate::recording::capture::StopMode::Quit => {
                if let Some(mut stdin) = child.stdin.take() {
                    use tokio::io::AsyncWriteExt;
                    let _ = stdin.write_all(b"q").await;
                    let _ = stdin.flush().await;
                    // stdin dropped here → closes the pipe, prompting ffmpeg to finalize.
                }
            }
            crate::recording::capture::StopMode::Interrupt => {
                #[cfg(unix)]
                if let Some(pid) = child.id() {
                    let _ = std::process::Command::new("kill").args(["-INT", &pid.to_string()]).status();
                }
            }
        }
    }
    for (child, _) in handle.children.iter_mut() {
        let _ = tokio::time::timeout(std::time::Duration::from_secs(8), child.wait()).await;
        // If still running, kill.
        let _ = child.start_kill();
    }

    finish_session(app, &handle).await
}

pub async fn finish_session(app: &AppHandle, handle: &RecordingHandle) -> AppResult<SessionManifest> {
    let wall_end_ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);

    // Probe each source for duration/stream info.
    let mut sources: Vec<SessionSource> = Vec::new();
    // Re-read folder contents to find produced files.
    let mut source_files: Vec<(String, String, PathBuf)> = Vec::new();
    for entry in std::fs::read_dir(&handle.folder).map_err(AppError::from)? {
        let entry = entry?;
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let (kind, label) = if name.starts_with("screen") {
            ("screen", name.clone())
        } else if name.starts_with("webcam") {
            ("webcam", name.clone())
        } else if name.starts_with("audio") {
            if name.contains("-system-") { ("system", name.clone()) } else { ("mic", name.clone()) }
        } else { continue; };
        source_files.push((kind.to_string(), label, path));
    }

    for (kind, label, path) in source_files {
        let duration = probe_duration(&path).await.ok();
        sources.push(SessionSource {
            kind,
            label,
            path: path.to_string_lossy().into(),
            stream_index: 0,
            start_offset_ms: 0,
            duration_ms: duration,
        });
    }

    let manifest = SessionManifest {
        session_id: handle.session_id.clone(),
        created_at_ms: handle.wall_start_ms,
        ended_at_ms: wall_end_ms,
        folder: handle.folder.to_string_lossy().into(),
        sources,
    };
    let manifest_path = handle.folder.join("session.json");
    std::fs::write(&manifest_path, serde_json::to_vec_pretty(&manifest)?)?;

    let _ = app.emit("recording://stopped", &serde_json::json!({ "session_id": handle.session_id, "folder": handle.folder.to_string_lossy() }));
    Ok(manifest)
}

async fn spawn_ffmpeg(args: &mut [String]) -> AppResult<tokio::process::Child> {
    use std::process::Stdio;
    let paths = crate::ffmpeg::resolver::get()?;
    let child = tokio::process::Command::new(&paths.ffmpeg)
        .args(args.iter().map(String::as_str))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Ffmpeg(e.to_string()))?;
    Ok(child)
}

async fn spawn_capture(cmd: crate::recording::capture::CaptureCmd) -> AppResult<tokio::process::Child> {
    use std::process::Stdio;
    let program = match &cmd.program {
        Some(p) => p.clone(),
        None => crate::ffmpeg::resolver::get()?.ffmpeg.clone(),
    };
    let child = tokio::process::Command::new(&program)
        .args(cmd.args.iter().map(String::as_str))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Recording(format!("failed to start {}: {}", program.display(), e)))?;
    Ok(child)
}

async fn probe_duration(path: &std::path::Path) -> AppResult<f64> {
    let s = crate::ffmpeg::run_ffprobe(&[
        "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        &path.to_string_lossy(),
    ]).await?;
    s.trim().parse::<f64>().map_err(|e| AppError::Ffmpeg(e.to_string()))
}

fn ext_for_container(container: &str) -> &str {
    match container {
        "mp4" => "mp4",
        "mov" => "mov",
        "webm" => "webm",
        "avi" => "avi",
        _ => "mkv",
    }
}

fn sanitize(s: &str) -> String {
    s.chars().map(|c| if c.is_alphanumeric() || c == '-' { c } else { '_' }).collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionManifest {
    pub session_id: String,
    pub created_at_ms: u64,
    pub ended_at_ms: u64,
    pub folder: String,
    pub sources: Vec<SessionSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSource {
    pub kind: String,
    pub label: String,
    pub path: String,
    pub stream_index: u32,
    /// offset from session start, in ms (0 for concurrently-launched sources)
    pub start_offset_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<f64>,
}

// Re-export types used in signatures are handled by `recording::config::*` in mod.rs.

pub async fn list_recent_sessions(app: &AppHandle) -> AppResult<Vec<SessionManifest>> {
    let base = app.path().app_data_dir().map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?.join("recordings");
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&base) {
        for entry in rd.flatten() {
            let p = entry.path();
            let m = p.join("session.json");
            if m.exists() {
                if let Ok(data) = std::fs::read(&m) {
                    if let Ok(manifest) = serde_json::from_slice::<SessionManifest>(&data) {
                        out.push(manifest);
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
    Ok(out)
}
