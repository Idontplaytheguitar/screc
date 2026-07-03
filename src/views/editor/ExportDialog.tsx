import { useEffect, useState } from "react";
import { X, Download, Loader2, CheckCircle2, AlertTriangle, FolderOpen } from "lucide-react";
import { useEditor } from "@/shared/editorStore";
import { ipc, onExportProgress, type ExportProgress } from "@/shared/ipc";
import { formatTime } from "@/shared/utils";
import type { ExportSettings } from "@/shared/types";

const FORMATS = [
  { id: "mp4", label: "MP4", hint: "Most compatible" },
  { id: "webm", label: "WebM", hint: "Web royalty-free" },
  { id: "mkv", label: "MKV", hint: "Flexible container" },
  { id: "mov", label: "MOV", hint: "QuickTime / Apple" },
  { id: "avi", label: "AVI", hint: "Legacy" },
  { id: "gif", label: "GIF", hint: "Animated image" },
];

const VIDEO_CODECS: Record<string, { id: string; label: string }[]> = {
  mp4: [{ id: "libx264", label: "H.264" }, { id: "libx265", label: "H.265" }, { id: "libaom-av1", label: "AV1" }, { id: "h264_nvenc", label: "H.264 NVENC" }, { id: "h264_videotoolbox", label: "H.264 VideoToolbox" }],
  webm: [{ id: "libvpx-vp9", label: "VP9" }, { id: "libvpx", label: "VP8" }, { id: "libaom-av1", label: "AV1" }],
  mkv: [{ id: "libx264", label: "H.264" }, { id: "libx265", label: "H.265" }, { id: "libaom-av1", label: "AV1" }, { id: "prores", label: "ProRes" }],
  mov: [{ id: "libx264", label: "H.264" }, { id: "libx265", label: "H.265" }, { id: "prores", label: "ProRes" }],
  avi: [{ id: "libx264", label: "H.264" }, { id: "mpeg4", label: "MPEG-4" }],
  gif: [{ id: "gif", label: "GIF" }],
};

const AUDIO_CODECS = [
  { id: "aac", label: "AAC" },
  { id: "libmp3lame", label: "MP3" },
  { id: "libopus", label: "Opus" },
  { id: "libvorbis", label: "Vorbis" },
  { id: "flac", label: "FLAC" },
  { id: "pcm", label: "PCM (uncompressed)" },
];

const PRESETS = [
  { id: "web-1080", label: "Web · 1080p", fmt: "mp4", vcodec: "libx264", w: 1920, h: 1080, fps: 30, crf: 22, acodec: "aac", abr: 160 },
  { id: "web-720", label: "Web · 720p", fmt: "mp4", vcodec: "libx264", w: 1280, h: 720, fps: 30, crf: 23, acodec: "aac", abr: 128 },
  { id: "4k", label: "4K · 60fps", fmt: "mp4", vcodec: "libx265", w: 3840, h: 2160, fps: 60, crf: 22, acodec: "aac", abr: 192 },
  { id: "discord", label: "Discord · 720p", fmt: "mp4", vcodec: "libx264", w: 1280, h: 720, fps: 30, crf: 26, acodec: "aac", abr: 96 },
  { id: "prores", label: "ProRes · 1080p", fmt: "mov", vcodec: "prores", w: 1920, h: 1080, fps: 30, crf: null, acodec: "pcm", abr: null },
  { id: "gif", label: "GIF", fmt: "gif", vcodec: "gif", w: 800, h: 0, fps: 15, crf: null, acodec: "aac", abr: null },
  { id: "webm-vp9", label: "WebM · VP9", fmt: "webm", vcodec: "libvpx-vp9", w: 1920, h: 1080, fps: 30, crf: 30, acodec: "libopus", abr: 128 },
];

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const [preset, setPreset] = useState("web-1080");
  const [format, setFormat] = useState("mp4");
  const [vcodec, setVcodec] = useState("libx264");
  const [acodec, setAcodec] = useState("aac");
  const [fps, setFps] = useState(30);
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [useCrf, setUseCrf] = useState(true);
  const [crf, setCrf] = useState(22);
  const [vbitrate, setVbitrate] = useState(8); // Mbps
  const [abitrate, setAbitrate] = useState(160); // kbps
  const [sampleRate, setSampleRate] = useState(48000);
  const [presetEnc] = useState("veryfast");
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPreset(id);
    setFormat(p.fmt); setVcodec(p.vcodec); setAcodec(p.acodec);
    setFps(p.fps); setWidth(p.w); setHeight(p.h);
    setUseCrf(p.crf !== null); setCrf(p.crf ?? 22);
    setAbitrate(p.abr ?? 160);
  };

  const defaultName = `screc-export.${format}`;
  const pickPath = async () => {
    const p = await ipc.pickOutputPath(defaultName);
    if (p) setOutputPath(p);
  };

  const start = async () => {
    if (!outputPath) { await pickPath(); }
    const out = outputPath ?? defaultName;
    setPhase("running"); setProgress(null); setErr(null);
    const settings: ExportSettings = {
      format, video_codec: vcodec, audio_codec: acodec, fps,
      width: width || project.width, height: height || project.height,
      crf: useCrf ? crf : null,
      video_bitrate: useCrf ? null : vbitrate * 1_000_000,
      audio_bitrate: format === "gif" ? null : abitrate * 1000,
      audio_sample_rate: sampleRate, audio_channels: 2, preset: presetEnc,
      output_path: out,
    };
    try {
      await ipc.exportProject(project, settings);
      setPhase("done");
    } catch (e) {
      setErr(String(e));
      setPhase("error");
    }
  };

  useEffect(() => {
    if (phase !== "running") return;
    const un = onExportProgress((p) => setProgress(p));
    return () => { un.then((f) => f()); };
  }, [phase]);

  const pct = progress?.kind === "progress" && progress.total_frames && progress.frame
    ? Math.min(99, Math.round((progress.frame / progress.total_frames) * 100))
    : progress?.kind === "finished" && progress.success ? 100 : phase === "running" ? 0 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-[560px] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-[var(--color-accent-hover)]" />
            <h2 className="text-sm font-semibold">Export</h2>
          </div>
          <button className="icon-btn" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {/* Presets */}
          <div className="field">
            <label className="field-label">Preset</label>
            <div className="grid grid-cols-3 gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`px-2 py-2 rounded-lg text-xs border transition-colors ${preset === p.id ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text)]" : "border-[var(--color-border)] text-[var(--color-text-dim)] hover:border-[var(--color-border-strong)]"}`}
                  onClick={() => applyPreset(p.id)}
                  disabled={phase === "running"}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="field-label">Format</label>
              <select className="select" value={format} onChange={(e) => { setFormat(e.target.value); const cs = VIDEO_CODECS[e.target.value]; if (cs && !cs.find((c) => c.id === vcodec)) setVcodec(cs[0].id); }} disabled={phase === "running"}>
                {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label} — {f.hint}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Video codec</label>
              <select className="select" value={vcodec} onChange={(e) => setVcodec(e.target.value)} disabled={phase === "running" || format === "gif"}>
                {(VIDEO_CODECS[format] ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Audio codec</label>
              <select className="select" value={acodec} onChange={(e) => setAcodec(e.target.value)} disabled={phase === "running" || format === "gif"}>
                {AUDIO_CODECS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Frame rate</label>
              <select className="select" value={fps} onChange={(e) => setFps(+e.target.value)} disabled={phase === "running"}>
                {[24, 25, 30, 50, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Width</label>
              <input className="input" type="number" value={width} onChange={(e) => setWidth(+e.target.value)} disabled={phase === "running"} />
            </div>
            <div className="field">
              <label className="field-label">Height</label>
              <input className="input" type="number" value={height} onChange={(e) => setHeight(+e.target.value)} disabled={phase === "running"} />
            </div>
          </div>

          {format !== "gif" && (
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-xs text-[var(--color-text-dim)] cursor-pointer">
                <input type="checkbox" checked={useCrf} onChange={(e) => setUseCrf(e.target.checked)} disabled={phase === "running"} />
                Quality (CRF)
              </label>
              {useCrf ? (
                <div className="flex items-center gap-2">
                  <input type="range" min={0} max={51} value={crf} onChange={(e) => setCrf(+e.target.value)} className="flex-1" disabled={phase === "running"} />
                  <span className="text-xs text-[var(--color-text-dim)] w-12 text-right">CRF {crf}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input type="range" min={1} max={50} value={vbitrate} onChange={(e) => setVbitrate(+e.target.value)} className="flex-1" disabled={phase === "running"} />
                  <span className="text-xs text-[var(--color-text-dim)] w-16 text-right">{vbitrate} Mbps</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <label className="field-label w-24">Audio bitrate</label>
                <input type="range" min={32} max={320} step={16} value={abitrate} onChange={(e) => setAbitrate(+e.target.value)} className="flex-1" disabled={phase === "running"} />
                <span className="text-xs text-[var(--color-text-dim)] w-16 text-right">{abitrate} kbps</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="field-label w-24">Sample rate</label>
                <select className="select flex-1" value={sampleRate} onChange={(e) => setSampleRate(+e.target.value)} disabled={phase === "running"}>
                  {[44100, 48000, 96000].map((s) => <option key={s} value={s}>{s / 1000} kHz</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="field">
            <label className="field-label">Output</label>
            <div className="flex gap-2">
              <input className="input flex-1 font-mono text-xs" value={outputPath ?? ""} readOnly placeholder={defaultName} />
              <button className="btn btn-outline" onClick={pickPath} disabled={phase === "running"}><FolderOpen className="w-3.5 h-3.5" /> Browse</button>
            </div>
          </div>

          {phase === "running" && (
            <div className="flex flex-col gap-2">
              <div className="h-1.5 w-full rounded-full bg-[var(--color-surface-3)] overflow-hidden">
                <div className="h-full bg-[var(--color-accent)] transition-all duration-150" style={{ width: `${pct}%` }} />
              </div>
              <div className="flex items-center justify-between text-xs text-[var(--color-text-dim)]">
                <span className="flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> {progress?.kind === "progress" ? `${progress.fps?.toFixed(0) ?? 0} fps · ${progress.speed?.toFixed(2) ?? 0}×` : "Rendering…"}</span>
                <span>{pct}%</span>
              </div>
              {progress?.kind === "progress" && progress.time && <div className="text-[10px] text-[var(--color-text-faint)] font-mono">at {progress.time} / {formatTime(project.duration, true)}</div>}
            </div>
          )}
          {phase === "done" && (
            <div className="flex items-center gap-2 text-[var(--color-success)] text-sm">
              <CheckCircle2 className="w-5 h-5" /> Export complete.
              <button className="btn btn-ghost ml-auto text-xs" onClick={() => outputPath && ipc.openInFileManager(outputPath)}>Reveal</button>
            </div>
          )}
          {phase === "error" && (
            <div className="flex items-start gap-2 text-[var(--color-danger)] text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <pre className="whitespace-pre-wrap break-all">{err}</pre>
            </div>
          )}
        </div>

        <div className="h-14 shrink-0 flex items-center justify-end gap-2 px-4 border-t border-[var(--color-border)]">
          <button className="btn btn-ghost" onClick={onClose} disabled={phase === "running"}>Close</button>
          {(phase === "idle" || phase === "error") && (
            <button className="btn btn-primary" onClick={start}><Download className="w-4 h-4" /> Export</button>
          )}
          {phase === "done" && <button className="btn btn-primary" onClick={onClose}>Done</button>}
        </div>
      </div>
    </div>
  );
}
