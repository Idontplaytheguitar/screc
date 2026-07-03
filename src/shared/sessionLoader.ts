import { ipc } from "./ipc";
import { makeClip } from "./editorStore";
import { uid } from "./utils";
import type { ExportProject, SessionManifest, Track } from "./types";

/** Load a session manifest and probe sources to build an initial editor project. */
export async function loadSessionAsProject(folder: string): Promise<{ project: ExportProject; manifest: SessionManifest }> {
  const manifest = await ipc.loadSession(folder);
  const project = await manifestToProject(manifest);
  return { project, manifest };
}

async function manifestToProject(manifest: SessionManifest): Promise<ExportProject> {
  const tracks: Track[] = [];
  let width = 1920;
  let height = 1080;
  let fps = 30;
  let duration = 0;

  // Screen -> primary video track.
  const screen = manifest.sources.find((s) => s.kind === "screen");
  if (screen) {
    const info = await safeProbe(screen.path);
    const v = info?.streams.find((s) => s.codec_type === "video");
    if (v?.width && v?.height) { width = v.width; height = v.height; }
    if (v?.fps) fps = Math.round(v.fps);
    const dur = info?.duration ?? screen.duration_ms ?? 0;
    duration = Math.max(duration, dur);
    tracks.push({
      id: uid(), kind: "video", name: "Screen", muted: false,
      clips: [makeClip({ source_path: screen.path, source_in: 0, source_out: dur, timeline_start: 0, timeline_duration: dur })],
    });
  }

  // Webcam -> overlay video track (positioned bottom-right by default).
  const webcam = manifest.sources.find((s) => s.kind === "webcam");
  if (webcam) {
    const info = await safeProbe(webcam.path);
    const dur = info?.duration ?? webcam.duration_ms ?? 0;
    duration = Math.max(duration, dur);
    tracks.push({
      id: uid(), kind: "video", name: "Webcam", muted: false,
      clips: [makeClip({
        source_path: webcam.path, source_in: 0, source_out: dur, timeline_start: 0, timeline_duration: dur,
        x: 0.7, y: 0.7, scale: 0.25, opacity: 1,
      })],
    });
  }

  // Audio sources -> audio tracks.
  let micIdx = 0;
  let sysIdx = 0;
  for (const src of manifest.sources.filter((s) => s.kind === "mic" || s.kind === "system")) {
    const info = await safeProbe(src.path);
    const dur = info?.duration ?? src.duration_ms ?? 0;
    duration = Math.max(duration, dur);
    const isSystem = src.kind === "system";
    tracks.push({
      id: uid(), kind: "audio", name: isSystem ? `System ${++sysIdx}` : `Mic ${++micIdx}`, muted: false,
      clips: [makeClip({ source_path: src.path, source_in: 0, source_out: dur, timeline_start: 0, timeline_duration: dur, volume: isSystem ? 0.8 : 1 })],
    });
  }

  return { tracks, width, height, fps, duration };
}

async function safeProbe(path: string) {
  try { return await ipc.probeMedia(path); } catch { return null; }
}
