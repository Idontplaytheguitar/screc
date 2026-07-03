import { Sliders, Volume2, Eye, Gauge, Move, Type, Sparkles, Waves } from "lucide-react";
import { useEditor } from "@/shared/editorStore";
import { formatTime } from "@/shared/utils";
import type { Clip } from "@/shared/types";

export function Inspector() {
  const project = useEditor((s) => s.project);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const updateClip = useEditor((s) => s.updateClip);

  let selected: { clip: Clip; trackId: string } | null = null;
  for (const t of project.tracks) {
    const c = t.clips.find((c) => c.id === selectedClipId);
    if (c) { selected = { clip: c, trackId: t.id }; break; }
  }

  return (
    <aside className="w-72 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col">
      <div className="h-11 shrink-0 flex items-center gap-2 px-4 border-b border-[var(--color-border)]">
        <Sliders className="w-4 h-4 text-[var(--color-accent-hover)]" />
        <h2 className="text-sm font-semibold">Inspector</h2>
      </div>
      {!selected ? (
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <p className="text-xs text-[var(--color-text-faint)] leading-relaxed">
            Select a clip to edit its properties — volume, opacity, speed, position, fades, and text.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
          <Section icon={<Gauge className="w-3.5 h-3.5" />} title="Timing">
            <Row label="In"><span className="font-mono text-xs">{formatTime(selected.clip.source_in, true)}</span></Row>
            <Row label="Out"><span className="font-mono text-xs">{formatTime(selected.clip.source_out, true)}</span></Row>
            <Row label="Duration"><span className="font-mono text-xs">{formatTime(selected.clip.timeline_duration, true)}</span></Row>
            <Slider label="Speed" value={selected.clip.speed} min={0.25} max={4} step={0.05} onChange={(v) => updateClip(selected!.trackId, selected!.clip.id, { speed: v })} format={(v) => `${v.toFixed(2)}×`} />
          </Section>

          {selected.clip.source_path && project.tracks.find((t) => t.id === selected!.trackId)?.kind === "audio" && (
            <Section icon={<Volume2 className="w-3.5 h-3.5" />} title="Audio">
              <Slider label="Volume" value={selected.clip.volume} min={0} max={2} step={0.02} onChange={(v) => updateClip(selected!.trackId, selected!.clip.id, { volume: v })} format={(v) => `${Math.round(v * 100)}%`} />
            </Section>
          )}

          {project.tracks.find((t) => t.id === selected!.trackId)?.kind === "video" && (
            <Section icon={<Eye className="w-3.5 h-3.5" />} title="Video">
              <Slider label="Opacity" value={selected.clip.opacity} min={0} max={1} step={0.02} onChange={(v) => updateClip(selected!.trackId, selected!.clip.id, { opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
            </Section>
          )}

          {project.tracks.find((t) => t.id === selected!.trackId)?.kind === "video" && (
            <Section icon={<Move className="w-3.5 h-3.5" />} title="Transform (overlay)">
              <Slider label="X position" value={selected.clip.x} min={0} max={1} step={0.01} onChange={(v) => updateClip(selected!.trackId, selected!.clip.id, { x: v })} format={(v) => `${Math.round(v * 100)}%`} />
              <Slider label="Y position" value={selected.clip.y} min={0} max={1} step={0.01} onChange={(v) => updateClip(selected!.trackId, selected!.clip.id, { y: v })} format={(v) => `${Math.round(v * 100)}%`} />
              <Slider label="Scale" value={selected.clip.scale} min={0.05} max={2} step={0.01} onChange={(v) => updateClip(selected!.trackId, selected!.clip.id, { scale: v })} format={(v) => `${Math.round(v * 100)}%`} />
            </Section>
          )}

          <Section icon={<Waves className="w-3.5 h-3.5" />} title="Fades">
            <Slider label="Fade in" value={selected.clip.fade_in} min={0} max={Math.min(5, selected.clip.timeline_duration / 2)} step={0.05} onChange={(v) => updateClip(selected!.trackId, selected!.clip.id, { fade_in: v })} format={(v) => `${v.toFixed(2)}s`} />
            <Slider label="Fade out" value={selected.clip.fade_out} min={0} max={Math.min(5, selected.clip.timeline_duration / 2)} step={0.05} onChange={(v) => updateClip(selected!.trackId, selected!.clip.id, { fade_out: v })} format={(v) => `${v.toFixed(2)}s`} />
          </Section>

          {project.tracks.find((t) => t.id === selected!.trackId)?.kind === "text" && (
            <Section icon={<Type className="w-3.5 h-3.5" />} title="Text">
              <textarea
                className="input min-h-[60px] resize-none"
                value={selected.clip.text ?? ""}
                onChange={(e) => updateClip(selected!.trackId, selected!.clip.id, { text: e.target.value })}
                placeholder="Enter text…"
              />
              <Slider label="X position" value={selected.clip.x} min={0} max={1} step={0.01} onChange={(v) => updateClip(selected!.trackId, selected!.clip.id, { x: v })} format={(v) => `${Math.round(v * 100)}%`} />
              <Slider label="Y position" value={selected.clip.y} min={0} max={1} step={0.01} onChange={(v) => updateClip(selected!.trackId, selected!.clip.id, { y: v })} format={(v) => `${Math.round(v * 100)}%`} />
            </Section>
          )}

          <Section icon={<Sparkles className="w-3.5 h-3.5" />} title="Transition">
            <select
              className="select"
              value={selected.clip.transition ?? ""}
              onChange={(e) => updateClip(selected!.trackId, selected!.clip.id, { transition: e.target.value || null })}
            >
              <option value="">None</option>
              <option value="fade">Fade</option>
              <option value="dissolve">Dissolve</option>
              <option value="wipe">Wipe</option>
              <option value="slide">Slide</option>
            </select>
          </Section>
        </div>
      )}
    </aside>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-1.5 text-[var(--color-text-dim)]">
        <span className="text-[var(--color-accent-hover)]">{icon}</span>
        <h3 className="text-[10px] font-semibold uppercase tracking-wider">{title}</h3>
      </div>
      <div className="flex flex-col gap-2 pl-1">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[var(--color-text-faint)]">{label}</span>
      {children}
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <div className="field">
      <div className="flex items-center justify-between">
        <label className="field-label">{label}</label>
        <span className="text-xs text-[var(--color-text-dim)] font-mono">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} className="w-full" />
    </div>
  );
}
