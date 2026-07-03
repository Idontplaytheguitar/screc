use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::ffmpeg::run_ffprobe;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaInfo {
    pub duration: f64,
    pub streams: Vec<StreamInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamInfo {
    pub index: u32,
    pub codec_type: String,
    pub codec_name: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
    pub duration: Option<f64>,
    pub bit_rate: Option<u64>,
}

pub async fn probe_file(path: &Path) -> AppResult<MediaInfo> {
    let json = run_ffprobe(&[
        "-v", "quiet",
        "-print_format", "json",
        "-show_format", "-show_streams",
        &path.to_string_lossy(),
    ]).await?;

    let parsed: FFprobeJson = serde_json::from_str(&json).unwrap_or(FFprobeJson::default());

    let duration = parsed.format.duration.parse::<f64>().unwrap_or(0.0);
    let streams = parsed.streams.into_iter().map(|s| StreamInfo {
        index: s.index,
        codec_type: s.codec_type.unwrap_or_default(),
        codec_name: s.codec_name.unwrap_or_default(),
        width: s.width,
        height: s.height,
        fps: s.avg_frame_rate.as_deref().and_then(parse_frac),
        sample_rate: s.sample_rate,
        channels: s.channels,
        duration: s.duration.and_then(|d| d.parse::<f64>().ok()),
        bit_rate: s.bit_rate.and_then(|b| b.parse::<u64>().ok()),
    }).collect();

    Ok(MediaInfo { duration, streams })
}

fn parse_frac(s: &str) -> Option<f64> {
    let (a, b) = s.split_once('/')?;
    let a: f64 = a.parse().ok()?;
    let b: f64 = b.parse().ok()?;
    if b == 0.0 { return None; }
    Some(a / b)
}

#[derive(Debug, Default, Deserialize)]
struct FFprobeJson {
    #[serde(default)]
    format: FFprobeFormat,
    #[serde(default)]
    streams: Vec<FFprobeStream>,
}

#[derive(Debug, Default, Deserialize)]
struct FFprobeFormat {
    #[serde(default)]
    duration: String,
}

#[derive(Debug, Default, Deserialize)]
struct FFprobeStream {
    index: u32,
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    avg_frame_rate: Option<String>,
    sample_rate: Option<u32>,
    channels: Option<u32>,
    duration: Option<String>,
    bit_rate: Option<String>,
}
