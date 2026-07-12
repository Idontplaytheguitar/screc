import { useEffect, useMemo, useRef } from "react";
import { Film } from "lucide-react";
import { useEditor } from "@/shared/editorStore";
import { fileUrl } from "@/shared/utils";
import type { Clip, Track } from "@/shared/types";

/**
 * Preview player: composites active video/audio/text tracks via DOM elements
 * synced to a master clock. Live approximation of the export render.
 */
export function PreviewPlayer() {
  const project = useEditor((s) => s.project);
  const playing = useEditor((s) => s.playing);
  const playhead = useEditor((s) => s.playhead);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const setPlaying = useEditor((s) => s.setPlaying);

  const mediaRefs = useRef<Map<string, HTMLMediaElement>>(new Map());
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  const active = useMemo(() => {
    const out: { clip: Clip; track: Track }[] = [];
    for (const track of project.tracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (playhead >= clip.timeline_start - 0.001 && playhead < clip.timeline_start + clip.timeline_duration) {
          out.push({ clip, track });
        }
      }
    }
    return out;
  }, [project.tracks, playhead]);

  const videoClips = active.filter((a) => a.track.kind === "video");
  const audioClips = active.filter((a) => a.track.kind === "audio");
  const textClips = active.filter((a) => a.track.kind === "text" && a.clip.text);

  // Order: base screen first, overlays after.
  const orderedVideo = [...videoClips].sort((a, b) => {
    const isOverlay = (x: { clip: Clip; track: Track }) =>
      x.track.name.toLowerCase().includes("webcam") || x.clip.x !== 0 || x.clip.y !== 0 || x.clip.scale < 1;
    return Number(isOverlay(a)) - Number(isOverlay(b));
  });

  // Cleanup refs for clips no longer active.
  useEffect(() => {
    const ids = new Set(active.map((a) => a.clip.id));
    for (const [id, el] of mediaRefs.current) {
      if (!ids.has(id)) { el.pause(); mediaRefs.current.delete(id); }
    }
  }, [active]);

  // Apply clip properties to elements whenever clips/playhead change.
  useEffect(() => {
    for (const { clip, track } of active) {
      const el = mediaRefs.current.get(clip.id);
      if (!el) continue;
      if (track.kind === "audio") (el as HTMLAudioElement).volume = Math.min(1, Math.max(0, clip.volume));
      el.playbackRate = clip.speed;
    }
  }, [active]);

  // Master clock: play/pause + rAF.
  useEffect(() => {
    const map = mediaRefs.current;
    const seekAll = (t: number) => {
      for (const { clip } of active) {
        const el = map.get(clip.id);
        if (!el) continue;
        const target = clip.source_in + (t - clip.timeline_start) * clip.speed;
        try { if (Math.abs(el.currentTime - target) > 0.03) el.currentTime = Math.max(0, target); } catch { /* */ }
      }
    };

    if (playing) {
      seekAll(playhead);
      for (const { clip } of active) { const el = map.get(clip.id); if (el) void el.play().catch(() => {}); }
      lastTickRef.current = performance.now();
      const loop = () => {
        const now = performance.now();
        const dt = (now - lastTickRef.current) / 1000;
        lastTickRef.current = now;
        const next = useEditor.getState().playhead + dt;
        if (next >= project.duration && project.duration > 0) {
          setPlayhead(project.duration);
          setPlaying(false);
          for (const { clip } of active) { const el = map.get(clip.id); el?.pause(); }
          return;
        }
        setPlayhead(next);
        // Resync drifters.
        for (const { clip } of active) {
          const el = map.get(clip.id);
          if (!el) continue;
          const target = clip.source_in + (next - clip.timeline_start) * clip.speed;
          if (Math.abs(el.currentTime - target) > 0.25) { try { el.currentTime = target; } catch { /* */ } }
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
      return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    } else {
      for (const { clip } of active) { const el = map.get(clip.id); el?.pause(); }
      seekAll(playhead);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Seek while paused.
  useEffect(() => {
    if (playing) return;
    for (const { clip } of active) {
      const el = mediaRefs.current.get(clip.id);
      if (!el) continue;
      const target = clip.source_in + (playhead - clip.timeline_start) * clip.speed;
      try { el.currentTime = Math.max(0, target); } catch { /* */ }
    }
  }, [playhead, playing, active]);

  const ar = project.width && project.height ? project.width / project.height : 16 / 9;

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center bg-black p-4">
      <div className="relative max-w-full max-h-full" style={{ aspectRatio: String(ar), height: "100%", maxWidth: `${(100 / ar) * 100}vh` }}>
        <div className="absolute inset-0 bg-black overflow-hidden rounded-md">
          {orderedVideo.map(({ clip, track }) => {
            const overlay = track.name.toLowerCase().includes("webcam") || clip.x !== 0 || clip.y !== 0 || clip.scale < 1;
            return (
              <video
                key={clip.id}
                ref={(el) => { if (el) mediaRefs.current.set(clip.id, el); else mediaRefs.current.delete(clip.id); }}
                src={fileUrl(clip.source_path)}
                playsInline
                muted
                style={{
                  position: "absolute",
                  left: overlay ? `${clip.x * 100}%` : "0",
                  top: overlay ? `${clip.y * 100}%` : "0",
                  width: overlay ? `${clip.scale * 100}%` : "100%",
                  height: overlay ? "auto" : "100%",
                  objectFit: overlay ? "cover" : "contain",
                  opacity: clip.opacity,
                  pointerEvents: "none",
                  borderRadius: overlay ? "8px" : 0,
                }}
              />
            );
          })}
          {audioClips.map(({ clip }) => (
            <audio
              key={clip.id}
              ref={(el) => { if (el) mediaRefs.current.set(clip.id, el); else mediaRefs.current.delete(clip.id); }}
              src={fileUrl(clip.source_path)}
              preload="auto"
            />
          ))}
          {textClips.map(({ clip }) => (
            <div
              key={clip.id}
              style={{
                position: "absolute",
                left: `${clip.x * 100}%`,
                top: `${clip.y * 100}%`,
                opacity: clip.opacity,
                fontSize: "min(6vw, 48px)",
              }}
              className="text-white font-semibold drop-shadow-lg px-2 py-1 rounded bg-black/40 whitespace-nowrap"
            >
              {clip.text}
            </div>
          ))}
          {!videoClips.length && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-[var(--color-text-faint)] pointer-events-none">
              {project.tracks.length === 0 ? (
                <>
                  <Film className="w-7 h-7 opacity-60" />
                  <span className="text-sm">No clips on the timeline</span>
                  <span className="text-xs opacity-70">Import media or open a recording</span>
                </>
              ) : (
                <span className="text-sm">No video at playhead</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
