use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TrackKind {
    Video,
    Audio,
    Text,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: String,
    pub kind: TrackKind,
    pub name: String,
    pub clips: Vec<Clip>,
    /// video: muted/hidden; audio: muted
    #[serde(default)]
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Clip {
    pub id: String,
    pub source_path: String,
    /// seconds into the source file
    pub source_in: f64,
    pub source_out: f64,
    /// seconds on the timeline
    pub timeline_start: f64,
    pub timeline_duration: f64,
    #[serde(default = "default_one")]
    pub volume: f64,
    #[serde(default = "default_one")]
    pub opacity: f64,
    #[serde(default = "default_one")]
    pub speed: f64,
    /// normalized position (0..1) for overlay placement
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "default_one")]
    pub scale: f64,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
    /// For text clips
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub transition: Option<String>,
}

fn default_one() -> f64 { 1.0 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportProject {
    pub tracks: Vec<Track>,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSettings {
    pub format: String,
    pub video_codec: String,
    pub audio_codec: String,
    pub fps: f64,
    pub width: u32,
    pub height: u32,
    pub crf: Option<u32>,
    pub video_bitrate: Option<u64>,
    pub audio_bitrate: Option<u64>,
    pub audio_sample_rate: u32,
    pub audio_channels: u32,
    pub preset: String,
    pub output_path: String,
}
