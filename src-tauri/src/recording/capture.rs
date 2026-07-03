use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::recording::config::{AudioInput, RecordingConfig, Region, ScreenCapture, VideoOptions, WebcamCapture};

/// How to ask the capture process to finish cleanly.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum StopMode {
    /// Write "q" to stdin (ffmpeg).
    Quit,
    /// Send SIGINT (wf-recorder / wl-screenrec).
    Interrupt,
}

/// A capture process to spawn. `program == None` means the resolved ffmpeg binary.
pub struct CaptureCmd {
    pub program: Option<PathBuf>,
    pub args: Vec<String>,
    pub stop: StopMode,
}

impl CaptureCmd {
    fn ffmpeg(args: Vec<String>) -> Self {
        CaptureCmd { program: None, args, stop: StopMode::Quit }
    }
}

/// Build the screen-capture command for this platform.
pub fn screen_cmd(
    screen: &ScreenCapture,
    video: &VideoOptions,
    container: &str,
    out_path: &Path,
) -> AppResult<(CaptureCmd, &'static str)> {
    #[cfg(target_os = "linux")]
    {
        if is_wayland() {
            return wayland_screen(screen, video, out_path);
        }
        return linux_screen(screen, video, container, out_path).map(|(a, k)| (CaptureCmd::ffmpeg(a), k));
    }
    #[cfg(target_os = "macos")]
    return macos_screen(screen, video, container, out_path).map(|(a, k)| (CaptureCmd::ffmpeg(a), k));
    #[cfg(target_os = "windows")]
    return windows_screen(screen, video, container, out_path).map(|(a, k)| (CaptureCmd::ffmpeg(a), k));
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = (screen, video, container, out_path);
        Err(AppError::Platform("unsupported".into()))
    }
}

pub fn find_bin(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let p = dir.join(name);
        if p.is_file() { return Some(p); }
    }
    None
}

#[cfg(target_os = "linux")]
pub fn is_wayland() -> bool {
    std::env::var_os("WAYLAND_DISPLAY").is_some()
}

/// Wayland compositors do not expose the screen to X11 tools (x11grab sees black),
/// so capture goes through a wlr-screencopy recorder when one is installed.
#[cfg(target_os = "linux")]
fn wayland_screen(screen: &ScreenCapture, video: &VideoOptions, out_path: &Path) -> AppResult<(CaptureCmd, &'static str)> {
    let (w, h, x, y) = if let Some(Region { x, y, width, height }) = screen.region {
        (width, height, x, y)
    } else {
        (screen.width, screen.height, screen.origin_x, screen.origin_y)
    };
    let geometry = format!("{},{} {}x{}", x, y, w, h);

    if let Some(bin) = find_bin("wf-recorder") {
        let mut a: Vec<String> = vec![
            "-f".into(), out_path.to_string_lossy().into(),
            "-g".into(), geometry,
            "-r".into(), format!("{}", video.fps),
            "-c".into(), resolve_video_codec(&video.codec, true),
            "-x".into(), "yuv420p".into(),
        ];
        if video.bitrate.is_none() {
            a.push("-p".into());
            a.push(format!("crf={}", video.crf));
        }
        return Ok((CaptureCmd { program: Some(bin), args: a, stop: StopMode::Interrupt }, "screen"));
    }
    if let Some(bin) = find_bin("wl-screenrec") {
        let a: Vec<String> = vec![
            "-f".into(), out_path.to_string_lossy().into(),
            "-g".into(), geometry,
        ];
        return Ok((CaptureCmd { program: Some(bin), args: a, stop: StopMode::Interrupt }, "screen"));
    }
    Err(AppError::Platform(
        "Wayland session: screen capture needs wf-recorder or wl-screenrec (e.g. `sudo apt install wf-recorder`), or log into an X11 session.".into(),
    ))
}

pub fn webcam_args(
    wc: &WebcamCapture,
    video: &VideoOptions,
    container: &str,
    out_path: &Path,
) -> AppResult<(Vec<String>, &'static str)> {
    #[cfg(target_os = "linux")]
    return linux_webcam(wc, video, container, out_path);
    #[cfg(target_os = "macos")]
    return macos_webcam(wc, video, container, out_path);
    #[cfg(target_os = "windows")]
    return windows_webcam(wc, video, container, out_path);
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = (wc, video, container, out_path);
        Ok((Vec::new(), "unsupported"))
    }
}

pub fn audio_args(ai: &AudioInput, out_path: &Path) -> AppResult<(Vec<String>, &'static str)> {
    #[cfg(target_os = "linux")]
    return linux_audio(ai, out_path);
    #[cfg(target_os = "macos")]
    return macos_audio(ai, out_path);
    #[cfg(target_os = "windows")]
    return windows_audio(ai, out_path);
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = (ai, out_path);
        Ok((Vec::new(), "unsupported"))
    }
}

// ----- shared helpers -------------------------------------------------------

fn video_encoder_args(video: &VideoOptions, is_screen: bool) -> Vec<String> {
    let mut a = Vec::new();
    let codec = resolve_video_codec(&video.codec, is_screen);
    a.push("-c:v".into());
    a.push(codec);
    if let Some(b) = video.bitrate {
        a.push("-b:v".into());
        a.push(format!("{}", b));
    } else {
        a.push("-crf".into());
        a.push(format!("{}", video.crf));
    }
    a.push("-preset".into());
    a.push("veryfast".into());
    a.push("-pix_fmt".into());
    a.push("yuv420p".into());
    if let Some((w, h)) = video.scale {
        a.push("-vf".into());
        a.push(format!("scale={}:{}", w, h));
    }
    a.push("-r".into());
    a.push(format!("{}", video.fps));
    a
}

fn resolve_video_codec(requested: &str, is_screen: bool) -> String {
    match requested {
        "h264" | "libx264" | "x264" => "libx264".into(),
        "h265" | "hevc" | "libx265" | "x265" => "libx265".into(),
        "av1" | "libaom" | "aom" => "libaom-av1".into(),
        "vp9" | "libvpx-vp9" => "libvpx-vp9".into(),
        "vp8" => "libvpx".into(),
        "gif" => "gif".into(),
        _ if is_screen => "libx264".into(),
        _ => requested.to_string(),
    }
}

fn common_output(out_path: &Path) -> Vec<String> {
    vec!["-y".into(), out_path.to_string_lossy().into()]
}

// ----- linux ----------------------------------------------------------------

#[cfg(target_os = "linux")]
fn linux_screen(screen: &ScreenCapture, video: &VideoOptions, container: &str, out_path: &Path) -> AppResult<(Vec<String>, &'static str)> {
    let mut a = Vec::new();
    a.push("-f".into()); a.push("x11grab".into());
    a.push("-framerate".into()); a.push(format!("{}", video.fps));
    // Region is absolute screen-space; convert to display+offset.
    let (w, h, off_x, off_y) = if let Some(Region { x, y, width, height }) = screen.region {
        (width, height, x, y)
    } else {
        (screen.width, screen.height, screen.origin_x, screen.origin_y)
    };
    let display = std::env::var("DISPLAY").unwrap_or_else(|_| ":0".into());
    a.push("-video_size".into()); a.push(format!("{}x{}", w, h));
    a.push("-i".into()); a.push(format!("{}+{},{}", display, off_x, off_y));
    if !screen.capture_cursor { a.push("-draw_mouse".into()); a.push("0".into()); }
    if screen.show_keys { a.push("-showkey".into()); a.push("1".into()); }

    a.extend(video_encoder_args(video, true));
    a.push("-f".into()); a.push(container_fmt(container).into());
    a.extend(common_output(out_path));
    Ok((a, "screen"))
}

#[cfg(target_os = "linux")]
fn linux_webcam(wc: &WebcamCapture, video: &VideoOptions, _container: &str, out_path: &Path) -> AppResult<(Vec<String>, &'static str)> {
    let mut a = Vec::new();
    a.push("-f".into()); a.push("v4l2".into());
    a.push("-framerate".into()); a.push(format!("{}", wc.fps));
    a.push("-video_size".into()); a.push(format!("{}x{}", wc.width, wc.height));
    a.push("-i".into()); a.push(wc.device_id.clone());
    a.extend(video_encoder_args(video, false));
    a.extend(common_output(out_path));
    Ok((a, "webcam"))
}

#[cfg(target_os = "linux")]
fn linux_audio(ai: &AudioInput, out_path: &Path) -> AppResult<(Vec<String>, &'static str)> {
    let mut a = Vec::new();
    a.push("-f".into()); a.push("pulse".into());
    a.push("-i".into()); a.push(ai.device_id.clone());
    a.push("-c:a".into()); a.push("pcm_s16le".into());
    a.push("-ar".into()); a.push("48000".into());
    a.push("-ac".into()); a.push("2".into());
    a.extend(common_output(out_path));
    Ok((a, match ai.kind { crate::devices::AudioKind::Mic => "mic", crate::devices::AudioKind::SystemLoopback => "system" }))
}

// ----- macos ----------------------------------------------------------------

#[cfg(target_os = "macos")]
fn macos_screen(screen: &ScreenCapture, video: &VideoOptions, container: &str, out_path: &Path) -> AppResult<(Vec<String>, &'static str)> {
    let mut a = Vec::new();
    a.push("-f".into()); a.push("avfoundation".into());
    a.push("-framerate".into()); a.push(format!("{}", video.fps));
    a.push("-i".into()); a.push(format!("{}:none", screen.screen_id));
    a.push("-capture_cursor".into()); a.push(if screen.capture_cursor { "1".into() } else { "0".into() });
    // Region is relative to the screen origin; avfoundation captures the screen, crop with vf.
    if let Some(Region { x, y, width, height }) = screen.region {
        let rx = x - screen.origin_x;
        let ry = y - screen.origin_y;
        a.push("-vf".into()); a.push(format!("crop={}:{}:{}:{}", width, height, rx, ry));
    }
    a.extend(video_encoder_args(video, true));
    a.push("-f".into()); a.push(container_fmt(container).into());
    a.extend(common_output(out_path));
    Ok((a, "screen"))
}

#[cfg(target_os = "macos")]
fn macos_webcam(wc: &WebcamCapture, video: &VideoOptions, _container: &str, out_path: &Path) -> AppResult<(Vec<String>, &'static str)> {
    let mut a = Vec::new();
    a.push("-f".into()); a.push("avfoundation".into());
    a.push("-framerate".into()); a.push(format!("{}", wc.fps));
    a.push("-video_size".into()); a.push(format!("{}x{}", wc.width, wc.height));
    a.push("-i".into()); a.push(format!("{}:none", wc.device_id));
    a.extend(video_encoder_args(video, false));
    a.extend(common_output(out_path));
    Ok((a, "webcam"))
}

#[cfg(target_os = "macos")]
fn macos_audio(ai: &AudioInput, out_path: &Path) -> AppResult<(Vec<String>, &'static str)> {
    let mut a = Vec::new();
    a.push("-f".into()); a.push("avfoundation".into());
    a.push("-i".into()); a.push(format!("none:{}", ai.device_id));
    a.push("-c:a".into()); a.push("pcm_s16le".into());
    a.push("-ar".into()); a.push("48000".into());
    a.push("-ac".into()); a.push("2".into());
    a.extend(common_output(out_path));
    Ok((a, match ai.kind { crate::devices::AudioKind::Mic => "mic", crate::devices::AudioKind::SystemLoopback => "system" }))
}

// ----- windows --------------------------------------------------------------

#[cfg(target_os = "windows")]
fn windows_screen(screen: &ScreenCapture, video: &VideoOptions, container: &str, out_path: &Path) -> AppResult<(Vec<String>, &'static str)> {
    let mut a = Vec::new();
    a.push("-f".into()); a.push("gdigrab".into());
    a.push("-framerate".into()); a.push(format!("{}", video.fps));
    let (w, h, off_x, off_y) = if let Some(Region { x, y, width, height }) = screen.region {
        (width, height, x, y)
    } else {
        (screen.width, screen.height, screen.origin_x, screen.origin_y)
    };
    a.push("-video_size".into()); a.push(format!("{}x{}", w, h));
    a.push("-i".into()); a.push("desktop".into());
    a.push("-offset_x".into()); a.push(format!("{}", off_x));
    a.push("-offset_y".into()); a.push(format!("{}", off_y));
    if !screen.capture_cursor { a.push("-draw_mouse".into()); a.push("0".into()); }
    a.extend(video_encoder_args(video, true));
    a.push("-f".into()); a.push(container_fmt(container).into());
    a.extend(common_output(out_path));
    Ok((a, "screen"))
}

#[cfg(target_os = "windows")]
fn windows_webcam(wc: &WebcamCapture, video: &VideoOptions, _container: &str, out_path: &Path) -> AppResult<(Vec<String>, &'static str)> {
    let mut a = Vec::new();
    a.push("-f".into()); a.push("dshow".into());
    a.push("-framerate".into()); a.push(format!("{}", wc.fps));
    a.push("-video_size".into()); a.push(format!("{}x{}", wc.width, wc.height));
    a.push("-i".into()); a.push(format!("video={}", wc.device_id));
    a.extend(video_encoder_args(video, false));
    a.extend(common_output(out_path));
    Ok((a, "webcam"))
}

#[cfg(target_os = "windows")]
fn windows_audio(ai: &AudioInput, out_path: &Path) -> AppResult<(Vec<String>, &'static str)> {
    let mut a = Vec::new();
    match ai.kind {
        crate::devices::AudioKind::Mic => {
            a.push("-f".into()); a.push("dshow".into());
            a.push("-i".into()); a.push(format!("audio={}", ai.device_id));
        }
        crate::devices::AudioKind::SystemLoopback => {
            // WASAPI loopback: capture the default render endpoint.
            a.push("-f".into()); a.push("dshow".into());
            a.push("-i".into()); a.push(format!("audio={}", ai.device_id));
        }
    }
    a.push("-c:a".into()); a.push("pcm_s16le".into());
    a.push("-ar".into()); a.push("48000".into());
    a.push("-ac".into()); a.push("2".into());
    a.extend(common_output(out_path));
    Ok((a, match ai.kind { crate::devices::AudioKind::Mic => "mic", crate::devices::AudioKind::SystemLoopback => "system" }))
}

fn container_fmt(container: &str) -> &str {
    match container {
        "mp4" => "mp4",
        "mov" => "mov",
        "webm" => "webm",
        "avi" => "avi",
        _ => "matroska",
    }
}

// Silence unused warnings for cross-platform builds.
#[allow(dead_code)]
fn _unused(_: &RecordingConfig) {}
