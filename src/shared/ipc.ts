import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";

import type {
  DeviceList,
  ExportProject,
  ExportSettings,
  FfmpegPaths,
  FfmpegStatus,
  MediaInfo,
  RecordingConfig,
  SessionManifest,
} from "./types";

export const ipc = {
  ffmpegStatus: () => invoke<FfmpegStatus>("ffmpeg_status"),
  ensureFfmpeg: () => invoke<FfmpegPaths>("ensure_ffmpeg"),
  listDevices: () => invoke<DeviceList>("list_devices"),
  startRecording: (config: RecordingConfig) => invoke<string>("start_recording", { config }),
  stopRecording: (session_id: string) => invoke<SessionManifest>("stop_recording", { session_id }),
  pauseRecording: (session_id: string) => invoke<void>("pause_recording", { session_id }),
  resumeRecording: (session_id: string) => invoke<void>("resume_recording", { session_id }),
  saveRecordingTo: (folder: string, dest: string) => invoke<string[]>("save_recording_to", { folder, dest }),
  listRecentSessions: () => invoke<SessionManifest[]>("list_recent_sessions"),
  loadSession: (folder: string) => invoke<SessionManifest>("load_session", { folder }),
  probeMedia: (path: string) => invoke<MediaInfo>("probe_media", { path }),
  genThumbnail: (path: string, time: number, out: string) => invoke<void>("gen_thumbnail", { path, time, out }),
  genThumbnails: (path: string, count: number, dir: string) => invoke<string[]>("gen_thumbnails", { path, count, dir }),
  genWaveform: (path: string, out: string) => invoke<void>("gen_waveform", { path, out }),
  exportProject: (project: ExportProject, settings: ExportSettings) =>
    invoke<void>("export_project", { project, settings }),
  grabScreenFrame: (screen: { id: string; x: number; y: number; width: number; height: number }) =>
    invoke<string>("grab_screen_frame", { screenId: screen.id, x: screen.x, y: screen.y, width: screen.width, height: screen.height }),
  pickOutputPath: (default_name: string) => invoke<string | null>("pick_output_path", { defaultName: default_name }),
  openInFileManager: (path: string) => invoke<void>("open_in_file_manager", { path }),
};

export function onFfmpegStatus(cb: (s: FfmpegStatus) => void): Promise<UnlistenFn> {
  return listen<FfmpegStatus>("ffmpeg://status", (e) => cb(e.payload));
}

export interface ExportProgress {
  kind: "progress" | "stderr" | "finished";
  percent?: number;
  fps?: number;
  frame?: number;
  total_frames?: number;
  speed?: number;
  time?: string;
  line?: string;
  success?: boolean;
  message?: string;
}

export function onExportProgress(cb: (p: ExportProgress) => void): Promise<UnlistenFn> {
  return listen<ExportProgress>("export://progress", (e) => cb(e.payload));
}

/** Sent to an already-open editor window to load a session. */
export function onOpenSession(cb: (p: { folder: string }) => void): Promise<UnlistenFn> {
  return listen("editor://open-session", (e) => cb(e.payload as never));
}

const WIDGET_WIDTH = 372;

/** Open (or focus) the recorder widget — it is the app's main window. */
export async function openWidgetWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel("main");
  if (existing) {
    await existing.show().catch(() => {});
    await existing.unminimize().catch(() => {});
    await existing.setFocus().catch(() => {});
    return;
  }
  new WebviewWindow("main", {
    url: "index.html",
    title: "screc",
    width: WIDGET_WIDTH,
    height: 224,
    minWidth: WIDGET_WIDTH,
    minHeight: 224,
    maxWidth: WIDGET_WIDTH,
    maxHeight: 224,
    decorations: false,
    resizable: true,
    alwaysOnTop: true,
    transparent: true,
    center: true,
    focus: true,
  });
}

/** Open (or focus) the recorder settings window (runtime window resizing is
 * unreliable on some Wayland compositors, so options live in their own window). */
export async function openSettingsWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel("settings");
  if (existing) {
    await existing.show().catch(() => {});
    await existing.setFocus().catch(() => {});
    return;
  }
  new WebviewWindow("settings", {
    url: "index.html#settings",
    title: "screc settings",
    width: 380,
    height: 620,
    decorations: false,
    resizable: false,
    alwaysOnTop: true,
    transparent: true,
    skipTaskbar: true,
    center: true,
    focus: true,
  });
}

/** Open (or focus) the editor window, optionally loading a session folder. */
export async function openEditorWindow(folder?: string): Promise<void> {
  const existing = await WebviewWindow.getByLabel("editor");
  if (existing) {
    await existing.show().catch(() => {});
    await existing.unminimize().catch(() => {});
    await existing.setFocus().catch(() => {});
    if (folder) await emit("editor://open-session", { folder });
    return;
  }
  const qs = folder ? `?folder=${encodeURIComponent(folder)}` : "";
  new WebviewWindow("editor", {
    url: `index.html#editor${qs}`,
    title: "screc editor",
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    decorations: true,
    resizable: true,
    center: true,
    focus: true,
  });
}

/**
 * Open the region selector on a given screen. A frozen screenshot of the screen
 * is captured first and shown fullscreen — no compositor transparency needed.
 */
export async function openRegionSelector(screen: { id: string; x: number; y: number; width: number; height: number }): Promise<void> {
  const existing = await WebviewWindow.getByLabel("region");
  if (existing) { await existing.close().catch(() => {}); }
  const shot = await ipc.grabScreenFrame(screen);
  const qs = new URLSearchParams({
    ox: String(screen.x),
    oy: String(screen.y),
    w: String(screen.width),
    h: String(screen.height),
    shot,
    t: String(Date.now()),
  });
  const win = new WebviewWindow("region", {
    url: `index.html#region?${qs.toString()}`,
    title: "screc region",
    x: screen.x,
    y: screen.y,
    width: screen.width,
    height: screen.height,
    decorations: false,
    resizable: false,
    fullscreen: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focus: true,
    shadow: false,
  });
  void win;
}

export function onRegionSelected(cb: (r: { x: number; y: number; width: number; height: number }) => void): Promise<UnlistenFn> {
  return listen("region://selected", (e) => cb(e.payload as never));
}

export function onRegionCancel(): Promise<UnlistenFn> {
  return listen("region://cancel", async () => {
    const w = await WebviewWindow.getByLabel("region");
    await w?.close().catch(() => {});
  });
}

export async function closeRegionSelector(): Promise<void> {
  const w = await WebviewWindow.getByLabel("region");
  await w?.close().catch(() => {});
}

/**
 * Resize the widget window (which the caller runs inside). Plain setSize is
 * unreliable for fixed-size windows on Wayland/GTK, so the window stays
 * resizable and is pinned to the target size via min == max constraints,
 * which the compositor must honor.
 */
export async function resizeWidget(height: number, width = WIDGET_WIDTH): Promise<void> {
  const w = getCurrentWindow();
  const size = new LogicalSize(width, height);
  try {
    // Keep min <= max at every step, or GTK ignores the whole request:
    // lift the max, raise the min (forces growth), resize, then pin the max
    // back down (forces shrink).
    await w.setMaxSize(undefined);
    await w.setMinSize(size);
    await w.setSize(size);
    await w.setMaxSize(size);
  } catch {
    /* ignore */
  }
}

export async function closeWidget(): Promise<void> {
  await getCurrentWindow().close().catch(() => {});
}

export { getCurrentWindow };
