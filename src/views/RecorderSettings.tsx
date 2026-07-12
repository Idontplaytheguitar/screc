import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Mic, MousePointerClick, Keyboard, Webcam, X, RefreshCw, Settings2, Check,
} from "lucide-react";
import { platform } from "@tauri-apps/plugin-os";
import { ipc, getCurrentWindow } from "@/shared/ipc";
import { usePersistentState } from "@/shared/usePersistentState";
import { Panel, Field, Toggle } from "@/recorder/primitives";
import { CODECS, CONTAINERS, FPS, QUALITY } from "@/recorder/constants";
import { Skeleton } from "@/shared/ui";
import type { DeviceList } from "@/shared/types";

/** Recorder options, shown in a dedicated small window opened from the widget. */
export function RecorderSettings() {
  const isLinux = useMemo(() => { try { return platform() === "linux"; } catch { return false; } }, []);
  const [devices, setDevices] = useState<DeviceList | null>(null);

  const [captureCursor, setCaptureCursor] = usePersistentState("w.cursor", true);
  const [showKeys, setShowKeys] = usePersistentState("w.keys", false);
  const [webcamOn] = usePersistentState("w.webcam.on", false);
  const [webcamId, setWebcamId] = usePersistentState("w.webcam.dev", "");
  const [webcamSize, setWebcamSize] = usePersistentState<{ w: number; h: number }>("w.webcam.size", { w: 480, h: 270 });
  const [webcamFps, setWebcamFps] = usePersistentState("w.webcam.fps", 30);
  const [audioSel, setAudioSel] = usePersistentState<string[]>("w.audio", []);
  const [container, setContainer] = usePersistentState("w.container", "mkv");
  const [codec, setCodec] = usePersistentState("w.codec", "libx264");
  const [quality, setQuality] = usePersistentState("w.quality", "balanced");
  const [fps, setFps] = usePersistentState("w.fps", 30);
  const [useBitrate, setUseBitrate] = usePersistentState("w.useBitrate", false);
  const [bitrate, setBitrate] = usePersistentState("w.bitrate", 8);
  const [scaleMode, setScaleMode] = usePersistentState<"original" | "scale">("w.scaleMode", "original");
  const [scaleW, setScaleW] = usePersistentState("w.scaleW", 1280);
  const [scaleH, setScaleH] = usePersistentState("w.scaleH", 720);
  const [countdown, setCountdown] = usePersistentState("w.countdown", 3);

  const loadDevices = useCallback(() => {
    ipc.listDevices().then(setDevices).catch(() => {});
  }, []);
  useEffect(() => { loadDevices(); }, [loadDevices]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") void getCurrentWindow().close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const mics = useMemo(() => devices?.audio.filter((a) => a.kind === "mic") ?? [], [devices]);
  const loops = useMemo(() => devices?.audio.filter((a) => a.kind === "system_loopback") ?? [], [devices]);
  const toggleAudio = (id: string) => setAudioSel((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  return (
    <div className="h-full w-full flex flex-col bg-[var(--color-surface)]/95 backdrop-blur rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-2xl">
      <div data-tauri-drag-region className="h-10 shrink-0 flex items-center justify-between px-3 bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 pointer-events-none">
          <Settings2 className="w-4 h-4 text-[var(--color-accent-hover)]" />
          <span className="text-xs font-semibold">Recorder settings</span>
        </div>
        <button className="icon-btn !w-7 !h-7" onClick={() => void getCurrentWindow().close()} title="Close (Esc)">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
        <Panel icon={<Mic className="w-3.5 h-3.5" />} title="Audio devices">
          <div className="text-[10px] text-[var(--color-text-faint)] -mt-1">Each source records to its own track</div>
          {devices === null ? (
            <div className="flex flex-col gap-1.5">
              {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
            </div>
          ) : (
            <>
              {mics.length > 0 && <div className="text-[9px] uppercase tracking-wider text-[var(--color-text-faint)]">Microphones</div>}
              {mics.map((a) => <AudioRow key={a.id} name={a.name} checked={audioSel.includes(a.id)} onToggle={() => toggleAudio(a.id)} />)}
              <div className="text-[9px] uppercase tracking-wider text-[var(--color-text-faint)] mt-1">System audio</div>
              {loops.length === 0 && <div className="text-[10px] text-[var(--color-text-faint)]">{devices && !devices.supports_system_audio ? "Not supported on this OS" : "None found"}</div>}
              {loops.map((a) => <AudioRow key={a.id} name={a.name} checked={audioSel.includes(a.id)} onToggle={() => toggleAudio(a.id)} loopback />)}
            </>
          )}
        </Panel>

        <Panel icon={<Webcam className="w-3.5 h-3.5" />} title="Webcam">
          {!webcamOn && <div className="text-[10px] text-[var(--color-text-faint)] -mt-1">Enable the camera from the widget to record it</div>}
          <Field label="Device">
            <select className="select" value={webcamId} onChange={(e) => setWebcamId(e.target.value)}>
              {devices === null ? <option>Loading…</option> : devices.webcams.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              {devices && devices.webcams.length === 0 && <option disabled>None found</option>}
            </select>
          </Field>
          <div className="grid grid-cols-3 gap-1.5">
            <Field label="W"><input className="input" type="number" value={webcamSize.w} onChange={(e) => setWebcamSize((s) => ({ ...s, w: +e.target.value }))} /></Field>
            <Field label="H"><input className="input" type="number" value={webcamSize.h} onChange={(e) => setWebcamSize((s) => ({ ...s, h: +e.target.value }))} /></Field>
            <Field label="FPS"><select className="select" value={webcamFps} onChange={(e) => setWebcamFps(+e.target.value)}>{FPS.map((f) => <option key={f} value={f}>{f}</option>)}</select></Field>
          </div>
        </Panel>

        <Panel icon={<Settings2 className="w-3.5 h-3.5" />} title="Video">
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="Container"><select className="select" value={container} onChange={(e) => setContainer(e.target.value)}>{CONTAINERS.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
            <Field label="Codec"><select className="select" value={codec} onChange={(e) => setCodec(e.target.value)}>{CODECS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>
            <Field label="FPS"><select className="select" value={fps} onChange={(e) => setFps(+e.target.value)}>{FPS.map((f) => <option key={f} value={f}>{f}</option>)}</select></Field>
            <Field label="Quality"><select className="select" value={quality} onChange={(e) => setQuality(e.target.value)}>{QUALITY.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}</select></Field>
          </div>
          <Toggle label="Target bitrate" checked={useBitrate} onChange={setUseBitrate} />
          {useBitrate && <div className="flex items-center gap-2"><input type="range" min={1} max={50} value={bitrate} onChange={(e) => setBitrate(+e.target.value)} className="flex-1" /><span className="text-[10px] w-16 text-right">{bitrate} Mbps</span></div>}
          <select className="select" value={scaleMode} onChange={(e) => setScaleMode(e.target.value as "original" | "scale")}>
            <option value="original">Original resolution</option>
            <option value="scale">Scale to…</option>
          </select>
          {scaleMode === "scale" && <div className="flex items-center gap-1"><input className="input w-20" type="number" value={scaleW} onChange={(e) => setScaleW(+e.target.value)} /><span>×</span><input className="input w-20" type="number" value={scaleH} onChange={(e) => setScaleH(+e.target.value)} /></div>}
        </Panel>

        <Panel icon={<MousePointerClick className="w-3.5 h-3.5" />} title="Capture">
          <Toggle label="Capture cursor" checked={captureCursor} onChange={setCaptureCursor} icon={<MousePointerClick className="w-3 h-3" />} />
          {isLinux && <Toggle label="Show keystrokes" checked={showKeys} onChange={setShowKeys} icon={<Keyboard className="w-3 h-3" />} />}
          <Field label="Countdown (s)"><input className="input" type="number" min={0} max={10} value={countdown} onChange={(e) => setCountdown(Math.max(0, Math.min(10, +e.target.value)))} /></Field>
          <button className="btn btn-ghost text-[11px] w-full" onClick={loadDevices}><RefreshCw className="w-3 h-3" /> Refresh devices</button>
        </Panel>
      </div>
    </div>
  );
}

function AudioRow({ name, checked, onToggle, loopback }: { name: string; checked: boolean; onToggle: () => void; loopback?: boolean }) {
  return (
    <button onClick={onToggle} className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-left text-[11px] ${checked ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-border)] hover:border-[var(--color-border-strong)] text-[var(--color-text-dim)]"}`}>
      <span className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 ${checked ? "bg-[var(--color-accent)] text-white" : "border border-[var(--color-border-strong)]"}`}>
        {checked && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
      </span>
      <span className="truncate flex-1">{name}</span>
      {loopback && <span className="text-[9px] opacity-70">system</span>}
    </button>
  );
}
