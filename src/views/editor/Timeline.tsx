import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play, Pause, SkipBack, SkipForward, Scissors, Trash2, Copy, Magnet,
  ZoomIn, ZoomOut, Plus, Volume2, VolumeX, Video, Music, Type,
} from "lucide-react";
import { useEditor } from "@/shared/editorStore";
import { ipc } from "@/shared/ipc";
import { fileUrl, formatTime } from "@/shared/utils";
import type { Clip, Track, TrackKind } from "@/shared/types";

const TRACK_HEIGHT = 56;
const RULER_HEIGHT = 28;
const TRACK_HEADER = 128;

export function Timeline() {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const zoom = useEditor((s) => s.zoom);
  const snap = useEditor((s) => s.snap);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const setPlaying = useEditor((s) => s.setPlaying);
  const setZoom = useEditor((s) => s.setZoom);
  const toggleSnap = useEditor((s) => s.toggleSnap);
  const splitAtPlayhead = useEditor((s) => s.splitAtPlayhead);
  const rippleDelete = useEditor((s) => s.rippleDelete);
  const duplicateClip = useEditor((s) => s.duplicateClip);
  const removeTrack = useEditor((s) => s.removeTrack);
  const addTrack = useEditor((s) => s.addTrack);
  const toggleTrackMute = useEditor((s) => s.toggleTrackMute);

  const scrollRef = useRef<HTMLDivElement>(null);
  const duration = Math.max(project.duration, 10);
  const contentWidth = duration * zoom + 200;

  const seekToX = useCallback((clientX: number) => {
    const el = scrollRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left - TRACK_HEADER + el.scrollLeft;
    setPlayhead(Math.max(0, x / zoom));
  }, [zoom, setPlayhead]);

  const onRulerMouseDown = (e: React.MouseEvent) => {
    setPlaying(false);
    seekToX(e.clientX);
    const move = (ev: MouseEvent) => seekToX(ev.clientX);
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)] border-t border-[var(--color-border)]">
      <Toolbar
        playing={playing}
        playhead={playhead}
        duration={duration}
        zoom={zoom}
        snap={snap}
        onPlay={() => setPlaying(!playing)}
        onHome={() => setPlayhead(0)}
        onEnd={() => setPlayhead(duration)}
        onSplit={() => {
          const sel = useEditor.getState().selectedClipId;
          const tr = project.tracks.find((t) => t.clips.some((c) => c.id === sel));
          if (tr) splitAtPlayhead(tr.id);
        }}
        onDelete={() => {
          const sel = useEditor.getState().selectedClipId;
          const tr = project.tracks.find((t) => t.clips.some((c) => c.id === sel));
          if (tr && sel) rippleDelete(tr.id, sel);
        }}
        onDuplicate={() => {
          const sel = useEditor.getState().selectedClipId;
          const tr = project.tracks.find((t) => t.clips.some((c) => c.id === sel));
          if (tr && sel) duplicateClip(tr.id, sel);
        }}
        onZoomIn={() => setZoom(zoom * 1.3)}
        onZoomOut={() => setZoom(zoom / 1.3)}
        onToggleSnap={toggleSnap}
        onAddTrack={(k) => addTrack(k)}
      />

      <div className="flex-1 min-h-0 flex">
        {/* Track headers */}
        <div className="shrink-0 border-r border-[var(--color-border)] overflow-hidden" style={{ width: TRACK_HEADER }}>
          <div style={{ height: RULER_HEIGHT }} className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]" />
          <div className="overflow-y-auto" style={{ maxHeight: "100%" }}>
            {project.tracks.map((t) => (
              <TrackHeader key={t.id} track={t} onMute={() => toggleTrackMute(t.id)} onRemove={() => removeTrack(t.id)} />
            ))}
            <button className="w-full h-8 flex items-center justify-center text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]" onClick={() => addTrack("video")}>
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Scroll area */}
        <div ref={scrollRef} className="flex-1 overflow-auto relative" style={{ cursor: "grab" }}>
          <div style={{ width: contentWidth, position: "relative" }} onClick={(e) => { if (e.target === e.currentTarget) { setPlaying(false); seekToX(e.clientX); } }}>
            {/* Ruler */}
            <Ruler duration={duration} zoom={zoom} onMouseDown={onRulerMouseDown} />

            {/* Tracks */}
            <div className="relative">
              {project.tracks.map((t) => (
                <TrackRow key={t.id} track={t} zoom={zoom} duration={duration} snap={snap} />
              ))}
              {project.tracks.length === 0 && (
                <div className="flex items-center justify-center h-32 text-sm text-[var(--color-text-faint)]">
                  No tracks yet — add one or record a session.
                </div>
              )}
            </div>

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-px bg-[var(--color-accent)] pointer-events-none z-20"
              style={{ left: playhead * zoom, boxShadow: "0 0 8px 1px var(--color-accent)" }}
            >
              <div className="absolute -top-0 -left-1.5 w-3 h-3 bg-[var(--color-accent)] rotate-45 -translate-y-1.5 shadow-[0_0_8px_1px_var(--color-accent)]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Toolbar(props: {
  playing: boolean; playhead: number; duration: number; zoom: number; snap: boolean;
  onPlay: () => void; onHome: () => void; onEnd: () => void; onSplit: () => void; onDelete: () => void;
  onDuplicate: () => void; onZoomIn: () => void; onZoomOut: () => void; onToggleSnap: () => void;
  onAddTrack: (k: TrackKind) => void;
}) {
  return (
    <div className="h-12 shrink-0 flex items-center gap-1 px-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
      <button className="icon-btn" onClick={props.onHome} title="Go to start"><SkipBack className="w-4 h-4" /></button>
      <button className="icon-btn" onClick={props.onPlay} title="Play/Pause (Space)">
        {props.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <button className="icon-btn" onClick={props.onEnd} title="Go to end"><SkipForward className="w-4 h-4" /></button>

      <div className="font-mono text-xs tabular-nums text-[var(--color-text-dim)] px-3 min-w-[140px]">
        {formatTime(props.playhead, true)} <span className="text-[var(--color-text-faint)]">/ {formatTime(props.duration, true)}</span>
      </div>

      <div className="w-px h-5 bg-[var(--color-border)] mx-1" />

      <button className="icon-btn" onClick={props.onSplit} title="Split at playhead (S)"><Scissors className="w-4 h-4" /></button>
      <button className="icon-btn" onClick={props.onDuplicate} title="Duplicate (D)"><Copy className="w-4 h-4" /></button>
      <button className="icon-btn" onClick={props.onDelete} title="Ripple delete (Delete)"><Trash2 className="w-4 h-4" /></button>

      <div className="w-px h-5 bg-[var(--color-border)] mx-1" />

      <button className={`icon-btn ${props.snap ? "active" : ""}`} onClick={props.onToggleSnap} title="Snap"><Magnet className="w-4 h-4" /></button>

      <div className="ml-auto flex items-center gap-1">
        <button className="icon-btn" onClick={props.onZoomOut} title="Zoom out"><ZoomOut className="w-4 h-4" /></button>
        <button className="icon-btn" onClick={props.onZoomIn} title="Zoom in"><ZoomIn className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

function Ruler({ duration, zoom, onMouseDown }: { duration: number; zoom: number; onMouseDown: (e: React.MouseEvent) => void }) {
  const step = niceStep(zoom);
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += step) ticks.push(t);
  return (
    <div
      className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] select-none"
      style={{ height: RULER_HEIGHT, cursor: "pointer" }}
      onMouseDown={onMouseDown}
    >
      {ticks.map((t) => (
        <div key={t} className="absolute top-0 bottom-0" style={{ left: t * zoom }}>
          <div className="absolute bottom-0 w-px h-2 bg-[var(--color-border-strong)]" />
          <span className="absolute bottom-2.5 left-1 text-[10px] text-[var(--color-text-faint)] font-mono">{formatTime(t)}</span>
        </div>
      ))}
    </div>
  );
}

function niceStep(zoom: number): number {
  // Aim for ~80px between ticks.
  const target = 80 / zoom;
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  for (const s of steps) if (s >= target) return s;
  return 600;
}

function TrackHeader({ track, onMute, onRemove }: { track: Track; onMute: () => void; onRemove: () => void }) {
  const Icon = track.kind === "video" ? Video : track.kind === "audio" ? Music : Type;
  const color = track.kind === "video" ? "var(--color-track-video)" : track.kind === "audio" ? "var(--color-track-audio)" : "var(--color-track-text)";
  return (
    <div className="flex items-center gap-2 px-2.5 border-b border-[var(--color-border)]" style={{ height: TRACK_HEIGHT }}>
      <span className="w-1 h-7 rounded-full" style={{ background: color }} />
      <Icon className="w-3.5 h-3.5 text-[var(--color-text-dim)]" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{track.name}</div>
        <div className="text-[10px] text-[var(--color-text-faint)]">{track.clips.length} clip{track.clips.length !== 1 ? "s" : ""}</div>
      </div>
      <button className="icon-btn !w-6 !h-6" onClick={onMute} title={track.muted ? "Unmute" : "Mute"}>
        {track.muted ? <VolumeX className="w-3.5 h-3.5 text-[var(--color-danger)]" /> : <Volume2 className="w-3.5 h-3.5" />}
      </button>
      <button className="icon-btn !w-6 !h-6" onClick={onRemove} title="Remove track"><Trash2 className="w-3.5 h-3.5" /></button>
    </div>
  );
}

function TrackRow({ track, zoom, duration, snap }: { track: Track; zoom: number; duration: number; snap: boolean }) {
  const color = track.kind === "video" ? "var(--color-track-video)" : track.kind === "audio" ? "var(--color-track-audio)" : "var(--color-track-text)";
  const width = duration * zoom + 200;
  return (
    <div className="relative border-b border-[var(--color-border)]" style={{ height: TRACK_HEIGHT, width }}>
      <div className="absolute inset-0" style={{ backgroundImage: "linear-gradient(90deg, transparent 0, transparent calc(100% - 1px), var(--color-border) 100%)", backgroundSize: `${zoom}px 100%`, opacity: 0.25 }} />
      {track.clips.map((clip) => (
        <ClipView key={clip.id} clip={clip} track={track} zoom={zoom} color={color} snap={snap} />
      ))}
    </div>
  );
}

function ClipView({ clip, track, zoom, color, snap }: { clip: Clip; track: Track; zoom: number; color: string; snap: boolean }) {
  const selectClip = useEditor((s) => s.selectClip);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const updateClip = useEditor((s) => s.updateClip);
  const selected = selectedClipId === clip.id;

  const [thumbs, setThumbs] = useState<string[]>([]);
  const [waveform, setWaveform] = useState<string | null>(null);

  // Thumbnails for video, waveform for audio.
  useEffect(() => {
    if (track.kind === "video" && clip.source_path) {
      const cacheDir = clip.source_path.replace(/\.[^.]+$/, "") + ".thumbs";
      const n = Math.max(3, Math.min(12, Math.ceil(clip.timeline_duration * zoom / 90)));
      ipc.genThumbnails(clip.source_path, n, cacheDir).then((files) => setThumbs(files.map(fileUrl))).catch(() => setThumbs([]));
    } else if (track.kind === "audio" && clip.source_path) {
      const cache = clip.source_path + ".wave.png";
      ipc.genWaveform(clip.source_path, cache).then(() => setWaveform(fileUrl(cache))).catch(() => setWaveform(null));
    }
  }, [clip.source_path, clip.timeline_duration, track.kind]);

  const left = clip.timeline_start * zoom;
  const width = Math.max(8, clip.timeline_duration * zoom);

  const startDrag = (e: React.MouseEvent, mode: "move" | "trimL" | "trimR") => {
    e.stopPropagation();
    selectClip(clip.id);
    const startX = e.clientX;
    const orig = { start: clip.timeline_start, dur: clip.timeline_duration, sIn: clip.source_in, sOut: clip.source_out };
    const move = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / zoom;
      let newStart = orig.start;
      let newDur = orig.dur;
      let newSIn = orig.sIn;
      let newSOut = orig.sOut;
      if (mode === "move") {
        newStart = Math.max(0, orig.start + dx);
      } else if (mode === "trimL") {
        const d = Math.min(dx, orig.dur - 0.1);
        newStart = orig.start + d;
        newDur = orig.dur - d;
        newSIn = orig.sIn + d * clip.speed;
      } else if (mode === "trimR") {
        newDur = Math.max(0.1, orig.dur + dx);
        newSOut = orig.sIn + newDur * clip.speed;
      }
      if (snap) {
        // snap to playhead and 0 and other clip edges
        const snapPoints = [0, useEditor.getState().playhead];
        const threshold = 6 / zoom;
        const trySnap = (v: number) => {
          for (const p of snapPoints) if (Math.abs(v - p) < threshold) return p;
          return v;
        };
        if (mode === "move") newStart = trySnap(newStart);
        if (mode === "trimR") { const s = trySnap(newStart + newDur); newDur = s - newStart; newSOut = orig.sIn + newDur * clip.speed; }
        if (mode === "trimL") { const s = trySnap(newStart); const diff = s - newStart; newStart = s; newDur -= diff; newSIn += diff * clip.speed; }
      }
      updateClip(track.id, clip.id, { timeline_start: newStart, timeline_duration: newDur, source_in: newSIn, source_out: newSOut });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      useEditor.getState().recomputeDuration();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      className={`absolute top-1 bottom-1 rounded-md overflow-hidden border-2 fade-in ${selected ? "border-white/90 z-10 ring-2 ring-white/20" : "border-black/30 hover:border-white/40"} transition-[border-color,box-shadow] duration-150`}
      style={{ left, width, background: `linear-gradient(180deg, ${color}, ${color}cc)`, cursor: "grab" }}
      onMouseDown={(e) => startDrag(e, "move")}
      onMouseDownCapture={(e) => { if (e.button === 0) selectClip(clip.id); }}
    >
      {/* Thumbnails */}
      {track.kind === "video" && thumbs.length > 0 && (
        <div className="absolute inset-0 flex">
          {thumbs.map((src, i) => (
            <img key={i} src={src} className="flex-1 object-cover min-w-0 h-full opacity-90" alt="" draggable={false} />
          ))}
        </div>
      )}
      {track.kind === "audio" && waveform && (
        <img src={waveform} className="absolute inset-0 w-full h-full object-cover opacity-80" alt="" draggable={false} />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
      <div className="absolute top-0.5 left-1 right-1 flex items-center justify-between text-[10px] text-white/90 font-medium pointer-events-none">
        <span className="truncate">{track.kind === "text" ? (clip.text || "Text") : track.name}</span>
        <span className="font-mono opacity-80">{formatTime(clip.timeline_duration)}</span>
      </div>

      {/* Trim handles */}
      <div className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30 transition-colors" onMouseDown={(e) => startDrag(e, "trimL")} />
      <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30 transition-colors" onMouseDown={(e) => startDrag(e, "trimR")} />
    </div>
  );
}
