import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, Download, Film, Type, Loader2, Undo2, Redo2, FilePlus2,
  FolderOpen, Play, Clock, Monitor, Video, Music, Plus, Circle,
} from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useEditor, emptyProject, makeClip } from "@/shared/editorStore";
import { loadSessionAsProject } from "@/shared/sessionLoader";
import { ipc, onOpenSession, openWidgetWindow } from "@/shared/ipc";
import { formatDate, formatTime, fileUrl, uid } from "@/shared/utils";
import type { SessionManifest } from "@/shared/types";
import { PreviewPlayer } from "./editor/PreviewPlayer";
import { Timeline } from "./editor/Timeline";
import { Inspector } from "./editor/Inspector";
import { ExportDialog } from "./editor/ExportDialog";

const MEDIA_EXTENSIONS = ["mp4", "mkv", "webm", "mov", "avi", "gif", "mp3", "wav", "flac", "ogg", "opus", "aac", "m4a"];

function folderFromHash(): string | null {
  const hash = window.location.hash;
  const q = hash.indexOf("?");
  if (q < 0) return null;
  return new URLSearchParams(hash.slice(q + 1)).get("folder");
}

type Mode = { kind: "library" } | { kind: "edit"; folder: string | null };

export function Editor() {
  const [mode, setMode] = useState<Mode>(() => {
    const folder = folderFromHash();
    return folder ? { kind: "edit", folder } : { kind: "library" };
  });

  useEffect(() => {
    const un = onOpenSession(({ folder }) => setMode({ kind: "edit", folder }));
    return () => { un.then((f) => f()); };
  }, []);

  if (mode.kind === "library") {
    return <Library onOpen={(folder) => setMode({ kind: "edit", folder })} onBlank={() => setMode({ kind: "edit", folder: null })} />;
  }
  return <EditView folder={mode.folder} onBack={() => setMode({ kind: "library" })} />;
}

function EditView({ folder, onBack }: { folder: string | null; onBack: () => void }) {
  const setProject = useEditor((s) => s.setProject);
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const setPlaying = useEditor((s) => s.setPlaying);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const addTrack = useEditor((s) => s.addTrack);
  const addClip = useEditor((s) => s.addClip);
  const splitAtPlayhead = useEditor((s) => s.splitAtPlayhead);
  const rippleDelete = useEditor((s) => s.rippleDelete);
  const duplicateClip = useEditor((s) => s.duplicateClip);
  const selectClip = useEditor((s) => s.selectClip);
  const [exportOpen, setExportOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const handleAddText = () => {
    addTrack("text");
    const st = useEditor.getState();
    const tr = st.project.tracks[st.project.tracks.length - 1];
    if (tr) addClip(tr.id, makeClip({ text: "Text", timeline_start: st.playhead, timeline_duration: 3, source_in: 0, source_out: 3, x: 0.3, y: 0.4 }));
  };

  const handleImport = useCallback(async () => {
    const picked = await openFileDialog({
      multiple: true,
      filters: [{ name: "Media", extensions: MEDIA_EXTENSIONS }],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    for (const path of paths) {
      try {
        const info = await ipc.probeMedia(path);
        const hasVideo = info.streams.some((s) => s.codec_type === "video" && s.codec_name !== "mjpeg" && s.codec_name !== "png");
        const dur = info.duration || 5;
        const st = useEditor.getState();
        const name = path.split(/[\\/]/).pop() ?? path;
        const kind = hasVideo ? "video" as const : "audio" as const;
        useEditor.getState().addTrack(kind, name.length > 24 ? name.slice(0, 24) + "…" : name);
        const tracks = useEditor.getState().project.tracks;
        const tr = tracks[tracks.length - 1];
        if (tr) {
          useEditor.getState().addClip(tr.id, makeClip({
            id: uid(), source_path: path, source_in: 0, source_out: dur,
            timeline_start: st.playhead, timeline_duration: dur,
          }));
        }
        useEditor.getState().recomputeDuration();
      } catch (e) {
        setErr(`Could not import ${path}: ${e}`);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    if (!folder) {
      setProject(emptyProject());
      setLoading(false);
      return;
    }
    loadSessionAsProject(folder)
      .then(({ project: p }) => { if (!cancelled) { setProject(p); } })
      .catch((e) => { if (!cancelled) setErr(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [folder, setProject]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const st = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
      if (mod) return;
      switch (e.key) {
        case " ":
          e.preventDefault(); setPlaying(!st.playing); break;
        case "j": setPlaying(false); setPlayhead(Math.max(0, st.playhead - 5)); break;
        case "l": setPlaying(false); setPlayhead(st.playhead + 5); break;
        case "k": setPlaying(false); break;
        case "Home": setPlayhead(0); break;
        case "End": setPlayhead(st.project.duration); break;
        case "ArrowLeft": setPlayhead(Math.max(0, st.playhead - (e.shiftKey ? 1 : 0.1))); break;
        case "ArrowRight": setPlayhead(st.playhead + (e.shiftKey ? 1 : 0.1)); break;
        case "Escape": selectClip(null); break;
        case "s": case "S": {
          const sel = st.selectedClipId; const tr = st.project.tracks.find((t) => t.clips.some((c) => c.id === sel));
          if (tr) splitAtPlayhead(tr.id); break;
        }
        case "d": case "D": {
          const sel = st.selectedClipId; const tr = st.project.tracks.find((t) => t.clips.some((c) => c.id === sel));
          if (tr && sel) duplicateClip(tr.id, sel); break;
        }
        case "Delete": case "Backspace": {
          const sel = st.selectedClipId; const tr = st.project.tracks.find((t) => t.clips.some((c) => c.id === sel));
          if (tr && sel) rippleDelete(tr.id, sel); break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPlaying, setPlayhead, splitAtPlayhead, duplicateClip, rippleDelete, undo, redo, selectClip]);

  return (
    <div className="h-full w-full flex flex-col">
      <header className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center gap-3">
          <button className="icon-btn" onClick={onBack} title="Back to library"><ArrowLeft className="w-4 h-4" /></button>
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-[var(--color-accent-hover)]" />
            <span className="text-sm font-semibold">{folder ? folder.split(/[\\/]/).pop() : "New project"}</span>
          </div>
          <div className="text-xs text-[var(--color-text-faint)] font-mono ml-2">
            {formatTime(playhead, true)} / {formatTime(project.duration, true)}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button className="icon-btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)"><Undo2 className={`w-4 h-4 ${canUndo ? "" : "opacity-30"}`} /></button>
          <button className="icon-btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)"><Redo2 className={`w-4 h-4 ${canRedo ? "" : "opacity-30"}`} /></button>
          <div className="w-px h-5 bg-[var(--color-border)] mx-1" />
          <button className="btn btn-ghost text-xs" onClick={handleImport} title="Add video or audio files to the timeline"><FilePlus2 className="w-3.5 h-3.5" /> Import</button>
          <button className="btn btn-ghost text-xs" onClick={handleAddText}><Type className="w-3.5 h-3.5" /> Text</button>
          <button className="btn btn-primary text-xs ml-1" onClick={() => setExportOpen(true)}><Download className="w-3.5 h-3.5" /> Export</button>
        </div>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-[var(--color-text-faint)] gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading session…
        </div>
      ) : err ? (
        <div className="flex-1 flex items-center justify-center text-[var(--color-danger)] text-sm p-8 text-center">{err}</div>
      ) : (
        <>
          <div className="flex-1 min-h-0 flex">
            <PreviewPlayer />
            <Inspector />
          </div>
          <div className="h-[300px] shrink-0">
            <Timeline />
          </div>
        </>
      )}

      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </div>
  );
}

function Library({ onOpen, onBlank }: { onOpen: (folder: string) => void; onBlank: () => void }) {
  const [sessions, setSessions] = useState<SessionManifest[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    ipc.listRecentSessions().then(setSessions).catch(() => setSessions([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="h-full w-full flex flex-col">
      <header className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-track-webcam)] flex items-center justify-center">
            <Film className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-semibold tracking-tight text-sm">Library</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost text-xs" onClick={onBlank}><Plus className="w-3.5 h-3.5" /> Blank project</button>
          <button className="btn btn-primary text-xs" onClick={() => void openWidgetWindow()}><Circle className="w-3.5 h-3.5 fill-current" /> New recording</button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-5xl mx-auto flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider">Recent recordings</h2>
            <button className="btn btn-ghost text-xs" onClick={refresh}>Refresh</button>
          </div>

          {loading ? (
            <div className="card p-8 text-center text-sm text-[var(--color-text-faint)]">Loading…</div>
          ) : sessions.length === 0 ? (
            <div className="card p-10 flex flex-col items-center gap-3 text-center">
              <FolderOpen className="w-8 h-8 text-[var(--color-text-faint)]" />
              <p className="text-sm text-[var(--color-text-dim)]">No recordings yet</p>
              <p className="text-xs text-[var(--color-text-faint)] max-w-sm">
                Use the recorder widget to capture your screen, or start a blank project and import media files.
              </p>
              <button className="btn btn-primary mt-1" onClick={() => void openWidgetWindow()}>
                <Circle className="w-3.5 h-3.5 fill-current" /> Open recorder
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {sessions.map((s) => (
                <SessionCard key={s.session_id} session={s} onOpen={() => onOpen(s.folder)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SessionCard({ session, onOpen }: { session: SessionManifest; onOpen: () => void }) {
  const screen = session.sources.find((s) => s.kind === "screen");
  const audios = session.sources.filter((s) => s.kind === "mic" || s.kind === "system");
  const webcam = session.sources.find((s) => s.kind === "webcam");
  const durMs = (session.ended_at_ms - session.created_at_ms) / 1000;
  const dur = session.sources.find((s) => s.duration_ms)?.duration_ms ?? durMs;

  return (
    <div className="card overflow-hidden flex group">
      <button onClick={onOpen} className="flex-1 flex text-left">
        <div className="w-32 shrink-0 bg-black relative">
          {screen ? (
            <Thumb path={screen.path} />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Film className="w-6 h-6 text-[var(--color-text-faint)]" />
            </div>
          )}
        </div>
        <div className="flex-1 p-3 flex flex-col gap-1.5 min-w-0">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-[var(--color-text-faint)]" />
            <span className="text-xs text-[var(--color-text-faint)]">{formatDate(session.created_at_ms)}</span>
          </div>
          <div className="flex flex-wrap gap-1 mt-0.5">
            <span className="chip"><Monitor className="w-2.5 h-2.5" /> screen</span>
            {webcam && <span className="chip"><Video className="w-2.5 h-2.5" /> webcam</span>}
            {audios.map((a, i) => (
              <span key={i} className="chip"><Music className="w-2.5 h-2.5" /> {a.kind}</span>
            ))}
          </div>
          <div className="text-xs text-[var(--color-text-dim)] mt-auto">
            {Math.floor(dur / 60)}:{String(Math.floor(dur % 60)).padStart(2, "0")} duration
          </div>
        </div>
      </button>
      <div className="flex flex-col border-l border-[var(--color-border)]">
        <button onClick={onOpen} className="icon-btn flex-1 rounded-none" title="Open in editor">
          <Play className="w-4 h-4" />
        </button>
        <button
          className="icon-btn flex-1 rounded-none"
          title="Reveal files"
          onClick={() => ipc.openInFileManager(session.folder)}
        >
          <FolderOpen className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function Thumb({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const cache = path + ".poster.jpg";
    ipc.genThumbnail(path, 1, cache).then(() => setSrc(fileUrl(cache))).catch(() => setSrc(null));
  }, [path]);
  if (!src) return <div className="w-full h-full bg-black" />;
  return <img src={src} className="w-full h-full object-cover" alt="" />;
}
