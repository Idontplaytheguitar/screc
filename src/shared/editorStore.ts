import { create } from "zustand";
import type { Clip, ExportProject, TrackKind } from "./types";
import { uid } from "./utils";

interface EditorState {
  project: ExportProject;
  past: ExportProject[];
  future: ExportProject[];
  selectedClipId: string | null;
  playhead: number;
  playing: boolean;
  zoom: number; // pixels per second
  snap: boolean;
  setProject: (p: ExportProject) => void;
  selectClip: (id: string | null) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setZoom: (z: number) => void;
  toggleSnap: () => void;
  undo: () => void;
  redo: () => void;

  addTrack: (kind: TrackKind, name?: string) => void;
  removeTrack: (trackId: string) => void;
  toggleTrackMute: (trackId: string) => void;
  renameTrack: (trackId: string, name: string) => void;

  addClip: (trackId: string, clip: Clip) => void;
  updateClip: (trackId: string, clipId: string, patch: Partial<Clip>) => void;
  removeClip: (trackId: string, clipId: string) => void;
  splitAtPlayhead: (trackId: string) => void;
  rippleDelete: (trackId: string, clipId: string) => void;
  duplicateClip: (trackId: string, clipId: string) => void;
  moveClip: (trackId: string, clipId: string, deltaStart: number) => void;

  recomputeDuration: () => void;
}

export function emptyProject(): ExportProject {
  return { tracks: [], width: 1920, height: 1080, fps: 30, duration: 0 };
}

export function makeClip(partial: Partial<Clip>): Clip {
  return {
    id: uid(),
    source_path: "",
    source_in: 0,
    source_out: 0,
    timeline_start: 0,
    timeline_duration: 0,
    volume: 1,
    opacity: 1,
    speed: 1,
    x: 0,
    y: 0,
    scale: 1,
    fade_in: 0,
    fade_out: 0,
    text: null,
    transition: null,
    ...partial,
  };
}

const HISTORY_LIMIT = 100;
// Rapid successive edits (drags, slider scrubs) coalesce into one undo step.
const COALESCE_MS = 500;
let lastEditAt = 0;

function edit(s: EditorState, project: ExportProject): Partial<EditorState> {
  const now = Date.now();
  const past = now - lastEditAt > COALESCE_MS ? [...s.past.slice(-(HISTORY_LIMIT - 1)), s.project] : s.past;
  lastEditAt = now;
  return { project, past, future: [] };
}

export const useEditor = create<EditorState>((set, get) => ({
  project: emptyProject(),
  past: [],
  future: [],
  selectedClipId: null,
  playhead: 0,
  playing: false,
  zoom: 80,
  snap: true,
  setProject: (project) => set({ project, past: [], future: [], playhead: 0, selectedClipId: null, playing: false }),
  selectClip: (selectedClipId) => set({ selectedClipId }),
  setPlayhead: (playhead) => set({ playhead: Math.max(0, playhead) }),
  setPlaying: (playing) => set({ playing }),
  setZoom: (zoom) => set({ zoom: Math.max(10, Math.min(400, zoom)) }),
  toggleSnap: () => set((s) => ({ snap: !s.snap })),

  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev) return {};
      lastEditAt = 0;
      return { project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future], selectedClipId: null };
    }),

  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return {};
      lastEditAt = 0;
      return { project: next, past: [...s.past, s.project], future: s.future.slice(1), selectedClipId: null };
    }),

  addTrack: (kind, name) =>
    set((s) =>
      edit(s, {
        ...s.project,
        tracks: [
          ...s.project.tracks,
          { id: uid(), kind, name: name ?? defaultTrackName(kind, s.project.tracks.filter((t) => t.kind === kind).length), clips: [], muted: false },
        ],
      })),

  removeTrack: (trackId) =>
    set((s) => edit(s, { ...s.project, tracks: s.project.tracks.filter((t) => t.id !== trackId) })),

  toggleTrackMute: (trackId) =>
    set((s) => edit(s, { ...s.project, tracks: s.project.tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)) })),

  renameTrack: (trackId, name) =>
    set((s) => edit(s, { ...s.project, tracks: s.project.tracks.map((t) => (t.id === trackId ? { ...t, name } : t)) })),

  addClip: (trackId, clip) => {
    set((s) => ({
      ...edit(s, {
        ...s.project,
        tracks: s.project.tracks.map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t)),
      }),
      selectedClipId: clip.id,
    }));
    get().recomputeDuration();
  },

  updateClip: (trackId, clipId, patch) => {
    set((s) =>
      edit(s, {
        ...s.project,
        tracks: s.project.tracks.map((t) =>
          t.id === trackId ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) } : t
        ),
      }));
    if (patch.timeline_start !== undefined || patch.timeline_duration !== undefined) get().recomputeDuration();
  },

  removeClip: (trackId, clipId) => {
    set((s) => ({
      ...edit(s, {
        ...s.project,
        tracks: s.project.tracks.map((t) =>
          t.id === trackId ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t
        ),
      }),
      selectedClipId: s.selectedClipId === clipId ? null : s.selectedClipId,
    }));
    get().recomputeDuration();
  },

  splitAtPlayhead: (trackId) =>
    set((s) => {
      const t = s.playhead;
      const track = s.project.tracks.find((tr) => tr.id === trackId);
      if (!track) return {};
      const target = track.clips.find((c) => t > c.timeline_start + 0.05 && t < c.timeline_start + c.timeline_duration - 0.05);
      if (!target) return {};
      const offset = t - target.timeline_start;
      const srcOffset = offset * target.speed;
      const left: Clip = { ...target, id: uid(), timeline_duration: offset, source_out: target.source_in + srcOffset, fade_out: 0 };
      const right: Clip = { ...target, id: uid(), timeline_start: t, timeline_duration: target.timeline_duration - offset, source_in: target.source_in + srcOffset, fade_in: 0 };
      return edit(s, {
        ...s.project,
        tracks: s.project.tracks.map((tr) =>
          tr.id === trackId ? { ...tr, clips: [...tr.clips.filter((c) => c.id !== target.id), left, right] } : tr
        ),
      });
    }),

  rippleDelete: (trackId, clipId) => {
    set((s) => {
      const track = s.project.tracks.find((t) => t.id === trackId);
      if (!track) return {};
      const clip = track.clips.find((c) => c.id === clipId);
      if (!clip) return {};
      const dur = clip.timeline_duration;
      return {
        ...edit(s, {
          ...s.project,
          tracks: s.project.tracks.map((t) =>
            t.id === trackId
              ? {
                  ...t,
                  clips: t.clips
                    .filter((c) => c.id !== clipId)
                    .map((c) => (c.timeline_start >= clip.timeline_start + dur ? { ...c, timeline_start: c.timeline_start - dur } : c)),
                }
              : t
          ),
        }),
        selectedClipId: s.selectedClipId === clipId ? null : s.selectedClipId,
      };
    });
    get().recomputeDuration();
  },

  duplicateClip: (trackId, clipId) => {
    set((s) => {
      const track = s.project.tracks.find((t) => t.id === trackId);
      if (!track) return {};
      const clip = track.clips.find((c) => c.id === clipId);
      if (!clip) return {};
      const copy: Clip = { ...clip, id: uid(), timeline_start: clip.timeline_start + clip.timeline_duration };
      return {
        ...edit(s, {
          ...s.project,
          tracks: s.project.tracks.map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, copy] } : t)),
        }),
        selectedClipId: copy.id,
      };
    });
    get().recomputeDuration();
  },

  moveClip: (trackId, clipId, deltaStart) => {
    set((s) =>
      edit(s, {
        ...s.project,
        tracks: s.project.tracks.map((t) =>
          t.id === trackId ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, timeline_start: Math.max(0, c.timeline_start + deltaStart) } : c)) } : t
        ),
      }));
    get().recomputeDuration();
  },

  recomputeDuration: () =>
    set((s) => {
      let max = 0;
      for (const t of s.project.tracks) for (const c of t.clips) max = Math.max(max, c.timeline_start + c.timeline_duration);
      return { project: { ...s.project, duration: max } };
    }),
}));

function defaultTrackName(kind: TrackKind, count: number): string {
  const base = kind === "video" ? "Video" : kind === "audio" ? "Audio" : "Text";
  return `${base} ${count + 1}`;
}
