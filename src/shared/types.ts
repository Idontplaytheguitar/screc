// Shared types mirroring the Rust backend.

export type BinarySource = "system" | "bundled";

export interface FfmpegPaths {
  ffmpeg: string;
  ffprobe: string;
  source: BinarySource;
}

export type FfmpegStatus =
  | { kind: "resolved"; paths: FfmpegPaths; version: string }
  | { kind: "downloading"; progress: number; message: string }
  | { kind: "failed"; error: string };

export type AudioKind = "mic" | "system_loopback";

export interface AudioDevice {
  id: string;
  name: string;
  kind: AudioKind;
}

export interface Screen {
  id: string;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  primary: boolean;
}

export interface Webcam {
  id: string;
  name: string;
}

export interface WindowInfo {
  id: string;
  title: string;
  app: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DeviceList {
  screens: Screen[];
  webcams: Webcam[];
  audio: AudioDevice[];
  windows: WindowInfo[];
  supports_system_audio: boolean;
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenCapture {
  screen_id: string;
  width: number;
  height: number;
  origin_x: number;
  origin_y: number;
  region: Region | null;
  capture_cursor: boolean;
  show_keys: boolean;
}

export interface WebcamCapture {
  device_id: string;
  width: number;
  height: number;
  fps: number;
}

export interface AudioInput {
  device_id: string;
  kind: AudioKind;
  name: string;
}

export interface VideoOptions {
  fps: number;
  codec: string;
  crf: number;
  bitrate: number | null;
  scale: [number, number] | null;
  hwaccel: string | null;
}

export interface RecordingConfig {
  screen: ScreenCapture;
  webcam: WebcamCapture | null;
  audio: AudioInput[];
  video: VideoOptions;
  container: string;
  output_dir: string;
  countdown_secs: number;
}

export interface SessionSource {
  kind: string;
  label: string;
  path: string;
  stream_index: number;
  start_offset_ms: number;
  duration_ms?: number;
}

export interface SessionManifest {
  session_id: string;
  created_at_ms: number;
  ended_at_ms: number;
  folder: string;
  sources: SessionSource[];
}

export interface StreamInfo {
  index: number;
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
  fps?: number;
  sample_rate?: number;
  channels?: number;
  duration?: number;
  bit_rate?: number;
}

export interface MediaInfo {
  duration: number;
  streams: StreamInfo[];
}

// Editor model
export type TrackKind = "video" | "audio" | "text";

export interface Clip {
  id: string;
  source_path: string;
  source_in: number;
  source_out: number;
  timeline_start: number;
  timeline_duration: number;
  volume: number;
  opacity: number;
  speed: number;
  x: number;
  y: number;
  scale: number;
  fade_in: number;
  fade_out: number;
  text?: string | null;
  transition?: string | null;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  clips: Clip[];
  muted: boolean;
}

export interface ExportProject {
  tracks: Track[];
  width: number;
  height: number;
  fps: number;
  duration: number;
}

export interface ExportSettings {
  format: string;
  video_codec: string;
  audio_codec: string;
  fps: number;
  width: number;
  height: number;
  crf: number | null;
  video_bitrate: number | null;
  audio_bitrate: number | null;
  audio_sample_rate: number;
  audio_channels: number;
  preset: string;
  output_path: string;
}
