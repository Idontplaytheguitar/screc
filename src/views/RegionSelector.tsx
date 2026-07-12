import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { fileUrl } from "@/shared/utils";

interface Rect { x: number; y: number; width: number; height: number; }

/**
 * Fullscreen region picker drawn over a frozen screenshot of the target screen.
 * Selection coordinates are converted from CSS pixels to physical screen pixels
 * before being emitted (region://selected).
 */
export function RegionSelector() {
  const hash = window.location.hash;
  const params = new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "");
  const ox = Number(params.get("ox") ?? 0);
  const oy = Number(params.get("oy") ?? 0);
  const pw = Number(params.get("w") ?? 0);
  const ph = Number(params.get("h") ?? 0);
  const shot = params.get("shot") ?? "";
  const cacheBust = params.get("t") ?? "";

  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [cur, setCur] = useState<{ x: number; y: number } | null>(null);
  const [done, setDone] = useState(false);

  const cancel = useCallback(async () => {
    await emit("region://cancel", {});
    await getCurrentWindow().close();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") void cancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (done || e.button !== 0) return;
    setStart({ x: e.clientX, y: e.clientY });
    setCur({ x: e.clientX, y: e.clientY });
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!start) return;
    setCur({ x: e.clientX, y: e.clientY });
  };
  const onMouseUp = () => {
    if (!start || !cur || done) return;
    const x = Math.min(start.x, cur.x);
    const y = Math.min(start.y, cur.y);
    const width = Math.abs(cur.x - start.x);
    const height = Math.abs(cur.y - start.y);
    if (width < 8 || height < 8) { setStart(null); setCur(null); return; }
    // CSS px → physical px of the captured screen.
    const sx = pw > 0 ? pw / window.innerWidth : 1;
    const sy = ph > 0 ? ph / window.innerHeight : 1;
    const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
    const rect: Rect = {
      x: ox + Math.round(x * sx),
      y: oy + Math.round(y * sy),
      width: even(width * sx),
      height: even(height * sy),
    };
    setDone(true);
    setTimeout(() => {
      void emit("region://selected", rect);
      void getCurrentWindow().close();
    }, 150);
  };

  const live: Rect | null = start && cur
    ? {
        x: Math.min(start.x, cur.x),
        y: Math.min(start.y, cur.y),
        width: Math.abs(cur.x - start.x),
        height: Math.abs(cur.y - start.y),
      }
    : null;

  return (
    <div
      className="fixed inset-0 select-none overflow-hidden bg-black"
      style={{ cursor: done ? "default" : "crosshair" }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {/* Frozen screen */}
      {shot && (
        <img
          src={`${fileUrl(shot)}?t=${cacheBust}`}
          className="absolute inset-0 w-full h-full"
          alt=""
          draggable={false}
        />
      )}
      {/* Dim everything outside the selection */}
      {live ? (
        <>
          <div className="absolute bg-black/55 transition-[height] duration-75 ease-screc" style={{ left: 0, top: 0, right: 0, height: live.y }} />
          <div className="absolute bg-black/55 transition-all duration-75 ease-screc" style={{ left: 0, top: live.y + live.height, right: 0, bottom: 0 }} />
          <div className="absolute bg-black/55 transition-all duration-75 ease-screc" style={{ left: 0, top: live.y, width: live.x, height: live.height }} />
          <div className="absolute bg-black/55 transition-all duration-75 ease-screc" style={{ left: live.x + live.width, top: live.y, right: 0, height: live.height }} />
          <div
            className="absolute border-2 border-[var(--color-accent)] pop-in"
            style={{ left: live.x, top: live.y, width: live.width, height: live.height, boxShadow: "0 0 0 1px rgba(0,0,0,0.4), 0 0 16px rgba(99,102,241,0.4)" }}
          >
            <span className="absolute -top-6 left-0 text-xs text-white font-mono bg-[var(--color-accent)] px-1.5 py-0.5 rounded whitespace-nowrap shadow-lg">
              {Math.round(live.width * (pw > 0 ? pw / window.innerWidth : 1))}×{Math.round(live.height * (ph > 0 ? ph / window.innerHeight : 1))}
            </span>
          </div>
        </>
      ) : (
        <div className="absolute inset-0 bg-black/40" />
      )}
      {!start && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center bg-black/60 rounded-xl px-6 py-4 fade-in backdrop-blur-sm shadow-pop">
            <p className="text-white text-lg font-medium">Drag to select a region</p>
            <p className="text-white/70 text-sm mt-1">Esc to cancel</p>
          </div>
        </div>
      )}
      {done && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-white text-lg font-medium bg-black/60 rounded-xl px-6 py-4 pop-in">Selected ✓</div>
        </div>
      )}
      <button className="absolute top-4 right-4 btn btn-outline" onClick={(e) => { e.stopPropagation(); void cancel(); }} onMouseDown={(e) => e.stopPropagation()}>
        Cancel
      </button>
    </div>
  );
}
