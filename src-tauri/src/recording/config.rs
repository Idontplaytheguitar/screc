use serde::{Deserialize, Serialize};

use crate::devices::AudioKind;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingConfig {
    pub screen: ScreenCapture,
    pub webcam: Option<WebcamCapture>,
    pub audio: Vec<AudioInput>,
    pub video: VideoOptions,
    /// Recommended container for the raw capture (mkv is fault-tolerant).
    pub container: String,
    pub output_dir: String,
    pub countdown_secs: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenCapture {
    pub screen_id: String,
    /// Full dimensions of the chosen screen (for capture video_size + multi-monitor offset).
    pub width: u32,
    pub height: u32,
    pub origin_x: i32,
    pub origin_y: i32,
    /// None = full screen; Some = sub-region (in absolute screen coordinates for x11grab/desktop).
    pub region: Option<Region>,
    pub capture_cursor: bool,
    /// showkey=true to capture keypresses (linux x11grab).
    pub show_keys: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Region {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebcamCapture {
    pub device_id: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioInput {
    pub device_id: String,
    pub kind: AudioKind,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoOptions {
    pub fps: u32,
    pub codec: String,
    /// CRF value for quality-based encoding (used when bitrate is None).
    pub crf: u32,
    /// Optional target bitrate in bits/sec (e.g. 8_000_000). If None, uses CRF.
    pub bitrate: Option<u64>,
    /// None = original; Some((w,h)) = scale.
    pub scale: Option<(u32, u32)>,
    /// Use hardware acceleration preset name (e.g. "nvenc", "qsv", "videotoolbox", "vaapi").
    pub hwaccel: Option<String>,
}

impl Default for RecordingConfig {
    fn default() -> Self {
        Self {
            screen: ScreenCapture { screen_id: "0".into(), width: 1920, height: 1080, origin_x: 0, origin_y: 0, region: None, capture_cursor: true, show_keys: false },
            webcam: None,
            audio: Vec::new(),
            video: VideoOptions { fps: 30, codec: "libx264".into(), crf: 20, bitrate: None, scale: None, hwaccel: None },
            container: "mkv".into(),
            output_dir: String::new(),
            countdown_secs: 3,
        }
    }
}
