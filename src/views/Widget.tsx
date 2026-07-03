import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Circle, Square, Monitor, Mic, MicOff, Volume2, VolumeX, Settings2, Crop,
  Webcam, Layers, X, Clapperboard, Loader2, AlertTriangle, Save, Check,
} from "lucide-react";
import { platform } from "@tauri-apps/plugin-os";
import {
  ipc, resizeWidget, closeWidget, openRegionSelector, onRegionSelected,
  onFfmpegStatus, openEditorWindow, openSettingsWindow,
} from "@/shared/ipc";
import { usePersistentState } from "@/shared/usePersistentState";
import { formatTime } from "@/shared/utils";
import { QUALITY } from "@/recorder/constants";
import type { AudioDevice, AudioInput, DeviceList, FfmpegStatus, RecordingConfig, Region, ScreenCapture } from "@/shared/types";

const H_IDLE = 224;
const H_RECORDING = 96;
const H_COUNTDOWN = 132;

type SourceMode = "screen" | "window" | "region";
type WidgetState = "idle" | "countdown" | "recording";

export function Widget() {
  const isLinux = useMemo(() => { try { return platform() === "linux"; } catch { return false; } }, []);

  const [devices, setDevices] = useState<DeviceList | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const [sourceMode, setSourceMode] = usePersistentState<SourceMode>("w.source", "screen");
  const [screenId, setScreenId] = usePersistentState("w.screen", "");
  const [windowId, setWindowId] = usePersistentState("w.window", "");
  const [region, setRegion] = usePersistentState<Region | null>("w.region", null);
  const [captureCursor] = usePersistentState("w.cursor", true);
  const [showKeys] = usePersistentState("w.keys", false);

  const [webcamOn, setWebcamOn] = usePersistentState("w.webcam.on", false);
  const [webcamId, setWebcamId] = usePersistentState("w.webcam.dev", "");
  const [webcamSize] = usePersistentState<{ w: number; h: number }>("w.webcam.size", { w: 480, h: 270 });
  const [webcamFps] = usePersistentState("w.webcam.fps", 30);

  const [audioSel, setAudioSel] = usePersistentState<string[]>("w.audio", []);
  const [container] = usePersistentState("w.container", "mkv");
  const [codec] = usePersistentState("w.codec", "libx264");
  const [quality] = usePersistentState("w.quality", "balanced");
  const [fps] = usePersistentState("w.fps", 30);
  const [useBitrate] = usePersistentState("w.useBitrate", false);
  const [bitrate] = usePersistentState("w.bitrate", 8);
  const [scaleMode] = usePersistentState<"original" | "scale">("w.scaleMode", "original");
  const [scaleW] = usePersistentState("w.scaleW", 1280);
  const [scaleH] = usePersistentState("w.scaleH", 720);
  const [countdown] = usePersistentState("w.countdown", 3);

  const [state, setState] = useState<WidgetState>("idle");
  const [countN, setCountN] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const sessRef = useRef<string | null>(null);
  const startRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDevices = useCallback(() => {
    ipc.listDevices().then((d) => {
      setDevices(d);
      setScreenId((prev) => (prev && d.screens.some((s) => s.id === prev) ? prev : d.screens[0]?.id ?? ""));
      setWebcamId((prev) => (prev && d.webcams.some((w) => w.id === prev) ? prev : d.webcams[0]?.id ?? ""));
    }).catch((e) => setErr(String(e)));
  }, [setScreenId, setWebcamId]);

  useEffect(() => { loadDevices(); }, [loadDevices]);

  // FFmpeg readiness — resolve current status and follow download progress.
  useEffect(() => {
    const un = onFfmpegStatus(setFfmpeg);
    ipc.ffmpegStatus().then((s) => {
      setFfmpeg((prev) => prev ?? s);
      if (s.kind !== "resolved") {
        ipc.ensureFfmpeg()
          .then((paths) => setFfmpeg({ kind: "resolved", paths, version: "" }))
          .catch((e) => setFfmpeg({ kind: "failed", error: String(e) }));
      }
    }).catch(() => {});
    return () => { un.then((f) => f()); };
  }, []);

  const ffmpegReady = ffmpeg?.kind === "resolved";

  // Resize the OS window to fit the current state (best-effort — some
  // compositors ignore runtime resizes, and every state fits in H_IDLE).
  useEffect(() => {
    let h: number;
    if (state === "recording") h = H_RECORDING;
    else if (state === "countdown") h = H_COUNTDOWN;
    else h = H_IDLE;
    void resizeWidget(h);
  }, [state]);

  // Region selection results from the overlay window.
  useEffect(() => {
    const un = onRegionSelected((r) => { setRegion(r); setSourceMode("region"); });
    return () => { un.then((f) => f()); };
  }, [setRegion, setSourceMode]);

  const selectedScreen = devices?.screens.find((s) => s.id === screenId) ?? devices?.screens[0] ?? null;
  const selectedWindow = devices?.windows.find((w) => w.id === windowId) ?? null;

  const buildConfig = useCallback((): RecordingConfig | null => {
    if (!selectedScreen) return null;
    const screen: ScreenCapture = (() => {
      if (sourceMode === "window" && selectedWindow) {
        return {
          screen_id: selectedScreen.id,
          width: selectedWindow.width, height: selectedWindow.height,
          origin_x: selectedWindow.x, origin_y: selectedWindow.y,
          region: { x: selectedWindow.x, y: selectedWindow.y, width: selectedWindow.width, height: selectedWindow.height },
          capture_cursor: captureCursor, show_keys: showKeys,
        };
      }
      return {
        screen_id: selectedScreen.id,
        width: selectedScreen.width, height: selectedScreen.height,
        origin_x: selectedScreen.x, origin_y: selectedScreen.y,
        region: sourceMode === "region" ? region : null,
        capture_cursor: captureCursor, show_keys: showKeys,
      };
    })();
    const crf = QUALITY.find((q) => q.id === quality)?.crf ?? 22;
    const audio: AudioInput[] = audioSel
      .map((id) => devices?.audio.find((a) => a.id === id))
      .filter((a): a is AudioDevice => !!a)
      .map((a) => ({ device_id: a.id, name: a.name, kind: a.kind }));
    return {
      screen,
      webcam: webcamOn && webcamId ? { device_id: webcamId, width: webcamSize.w, height: webcamSize.h, fps: webcamFps } : null,
      audio,
      video: { fps, codec, crf, bitrate: useBitrate ? bitrate * 1_000_000 : null, scale: scaleMode === "scale" ? [scaleW, scaleH] : null, hwaccel: null },
      container, output_dir: "", countdown_secs: countdown,
    };
  }, [sourceMode, selectedScreen, selectedWindow, region, captureCursor, showKeys, webcamOn, webcamId, webcamSize, webcamFps, audioSel, devices, quality, fps, codec, useBitrate, bitrate, scaleMode, scaleW, scaleH, container, countdown]);

  const start = useCallback(async () => {
    const cfg = buildConfig();
    if (!cfg) { setErr("No screen available"); setState("idle"); return; }
    try {
      const id = await ipc.startRecording(cfg);
      sessRef.current = id; startRef.current = performance.now();
      setState("recording"); setElapsed(0);
      const loop = () => { setElapsed((performance.now() - startRef.current) / 1000); rafRef.current = requestAnimationFrame(loop); };
      loop();
    } catch (e) {
      setErr(String(e)); setState("idle");
    }
  }, [buildConfig]);

  const cancelCountdown = useCallback(() => {
    if (countdownTimer.current) clearTimeout(countdownTimer.current);
    countdownTimer.current = null;
    setState("idle");
  }, []);

  const beginCountdown = useCallback(() => {
    if (state !== "idle") return;
    setErr(null); setSavedNotice(false);
    if (countdown <= 0) { void start(); return; }
    setState("countdown"); setCountN(countdown);
    let n = countdown;
    const tick = () => {
      n -= 1;
      if (n <= 0) { countdownTimer.current = null; setCountN(0); void start(); }
      else { setCountN(n); countdownTimer.current = setTimeout(tick, 1000); }
    };
    countdownTimer.current = setTimeout(tick, 1000);
  }, [countdown, state, start]);

  const stop = useCallback(async (openEditor: boolean) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const id = sessRef.current;
    sessRef.current = null;
    setState("idle");
    if (!id) return;
    try {
      const manifest = await ipc.stopRecording(id);
      if (openEditor) {
        await openEditorWindow(manifest.folder);
      } else {
        setSavedNotice(true);
        setTimeout(() => setSavedNotice(false), 3000);
      }
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  // Esc: stop while recording, cancel during countdown.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (state === "recording") { e.preventDefault(); void stop(true); }
      if (state === "countdown") { e.preventDefault(); cancelCountdown(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, stop, cancelCountdown]);

  const mics = useMemo(() => devices?.audio.filter((a) => a.kind === "mic") ?? [], [devices]);
  const loops = useMemo(() => devices?.audio.filter((a) => a.kind === "system_loopback") ?? [], [devices]);
  const micOn = mics.some((m) => audioSel.includes(m.id));
  const loopOn = loops.some((l) => audioSel.includes(l.id));

  const toggleKind = (kind: "mic" | "system_loopback") => {
    const of = (devices?.audio ?? []).filter((a) => a.kind === kind);
    if (of.length === 0) return;
    setAudioSel((p) => {
      const anyOn = of.some((a) => p.includes(a.id));
      if (anyOn) return p.filter((id) => !of.some((a) => a.id === id));
      return [...p, of[0].id];
    });
  };

  const pickRegion = () => {
    if (!selectedScreen) return;
    setErr(null);
    openRegionSelector(selectedScreen).catch((e) => setErr(String(e)));
  };

  const canRecord = ffmpegReady && !!selectedScreen
    && (sourceMode !== "window" || !!selectedWindow)
    && (sourceMode !== "region" || !!region);

  const recordHint = !ffmpegReady ? null
    : sourceMode === "window" && !selectedWindow ? "Pick a window first"
    : sourceMode === "region" && !region ? "Select a region first"
    : null;

  return (
    <div className="h-full w-full flex flex-col bg-[var(--color-surface)]/95 backdrop-blur rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-2xl">
      {/* Header / drag handle */}
      <div data-tauri-drag-region className="h-10 shrink-0 flex items-center justify-between px-3 bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 pointer-events-none">
          <div className="w-5 h-5 rounded-md bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-track-webcam)] flex items-center justify-center">
            <Circle className="w-3 h-3 text-white fill-current" />
          </div>
          <span className="text-xs font-semibold">screc</span>
          {state === "recording" && (
            <span className="flex items-center gap-1.5 ml-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-danger)] animate-pulse" />
              <span className="font-mono text-[11px] tabular-nums">{formatTime(elapsed, true)}</span>
            </span>
          )}
          {savedNotice && state === "idle" && (
            <span className="flex items-center gap-1 ml-1 text-[var(--color-success)] text-[11px]">
              <Check className="w-3 h-3" /> Saved
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {state === "idle" && (
            <button className="icon-btn !w-7 !h-7" onClick={() => void openEditorWindow()} title="Open editor">
              <Clapperboard className="w-4 h-4" />
            </button>
          )}
          {state === "idle" && (
            <button className="icon-btn !w-7 !h-7" onClick={() => void openSettingsWindow()} title="Recorder settings">
              <Settings2 className="w-4 h-4" />
            </button>
          )}
          <button className="icon-btn !w-7 !h-7" onClick={() => closeWidget()} title="Quit"><X className="w-4 h-4" /></button>
        </div>
      </div>

      {state === "countdown" && (
        <div className="flex-1 flex items-center justify-between px-4">
          <div className="text-4xl font-bold tabular-nums text-[var(--color-accent-hover)] pl-2">{countN || "Go"}</div>
          <button className="btn btn-outline" onClick={cancelCountdown}>Cancel</button>
        </div>
      )}

      {state === "recording" && (
        <div className="flex-1 flex items-center gap-2 px-3">
          <button
            className="flex-1 h-10 rounded-lg flex items-center justify-center gap-2 text-sm font-medium text-white border border-[var(--color-danger)] bg-[var(--color-danger)]/90 hover:bg-[var(--color-danger)] transition-colors"
            onClick={() => void stop(true)}
            title="Stop and open in the editor (Esc)"
          >
            <Square className="w-3.5 h-3.5 fill-current" /> Stop & edit
          </button>
          <button className="icon-btn !w-10 !h-10 border border-[var(--color-border-strong)]" onClick={() => void stop(false)} title="Stop and save without editing">
            <Save className="w-4 h-4" />
          </button>
        </div>
      )}

      {state === "idle" && (
        <div className="flex-1 min-h-0 flex flex-col px-3 py-2.5 gap-2">
          {/* Source mode */}
          <div className="flex rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] p-0.5">
            <SegBtn active={sourceMode === "screen"} onClick={() => setSourceMode("screen")} icon={<Monitor className="w-3.5 h-3.5" />} label="Screen" />
            <SegBtn active={sourceMode === "window"} onClick={() => setSourceMode("window")} icon={<Layers className="w-3.5 h-3.5" />} label="Window" />
            <SegBtn active={sourceMode === "region"} onClick={() => { setSourceMode("region"); if (!region) pickRegion(); }} icon={<Crop className="w-3.5 h-3.5" />} label="Region" />
          </div>

          {/* Source picker */}
          {sourceMode === "window" ? (
            <select className="select !py-1.5 text-xs" value={windowId} onChange={(e) => setWindowId(e.target.value)}>
              <option value="">Pick a window…</option>
              {devices?.windows.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
              {devices && devices.windows.length === 0 && <option disabled>{isLinux ? "None found (install wmctrl)" : "None found"}</option>}
            </select>
          ) : sourceMode === "region" ? (
            <div className="flex items-center gap-1.5">
              <button className="btn btn-outline !py-1.5 text-xs flex-1" onClick={pickRegion}>
                <Crop className="w-3.5 h-3.5" />
                {region ? `${Math.round(region.width)}×${Math.round(region.height)} — reselect` : "Select region"}
              </button>
              {region && <button className="icon-btn !w-8 !h-8" onClick={() => setRegion(null)} title="Clear region"><X className="w-3.5 h-3.5" /></button>}
            </div>
          ) : (
            <select className="select !py-1.5 text-xs" value={screenId} onChange={(e) => setScreenId(e.target.value)}>
              {devices?.screens.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.width}×{s.height})</option>)}
            </select>
          )}

          {/* Quick input toggles */}
          <div className="flex gap-1.5">
            <QuickToggle
              on={micOn} disabled={mics.length === 0}
              onClick={() => toggleKind("mic")}
              iconOn={<Mic className="w-3.5 h-3.5" />} iconOff={<MicOff className="w-3.5 h-3.5" />}
              label="Mic" title={mics.length === 0 ? "No microphones found" : micOn ? "Microphone on" : "Microphone off"}
            />
            <QuickToggle
              on={loopOn} disabled={loops.length === 0}
              onClick={() => toggleKind("system_loopback")}
              iconOn={<Volume2 className="w-3.5 h-3.5" />} iconOff={<VolumeX className="w-3.5 h-3.5" />}
              label="System" title={loops.length === 0 ? (devices && !devices.supports_system_audio ? "System audio not supported on this OS" : "No loopback device found") : loopOn ? "System audio on" : "System audio off"}
            />
            <QuickToggle
              on={webcamOn && !!webcamId} disabled={!devices || devices.webcams.length === 0}
              onClick={() => setWebcamOn((v) => !v)}
              iconOn={<Webcam className="w-3.5 h-3.5" />} iconOff={<Webcam className="w-3.5 h-3.5 opacity-50" />}
              label="Camera" title={devices && devices.webcams.length === 0 ? "No webcams found" : webcamOn ? "Webcam on" : "Webcam off"}
            />
          </div>

          {/* FFmpeg status */}
          {ffmpeg && ffmpeg.kind === "downloading" && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-dim)]">
              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
              <span className="truncate flex-1">Preparing FFmpeg…</span>
              <span className="tabular-nums">{Math.round(ffmpeg.progress * 100)}%</span>
            </div>
          )}
          {ffmpeg?.kind === "failed" && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--color-danger)]">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              <span className="truncate flex-1" title={ffmpeg.error}>FFmpeg unavailable</span>
              <button className="underline" onClick={() => { setFfmpeg(null); ipc.ensureFfmpeg().then((p) => setFfmpeg({ kind: "resolved", paths: p, version: "" })).catch((e) => setFfmpeg({ kind: "failed", error: String(e) })); }}>Retry</button>
            </div>
          )}
          {err && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--color-danger)]">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              <span className="flex-1 leading-tight" title={err}>{err}</span>
              <button className="icon-btn !w-5 !h-5 shrink-0" onClick={() => setErr(null)}><X className="w-3 h-3" /></button>
            </div>
          )}

          {/* Record */}
          <button
            className="h-10 mt-auto shrink-0 rounded-lg flex items-center justify-center gap-2 text-sm font-semibold text-white bg-[var(--color-danger)]/90 hover:bg-[var(--color-danger)] disabled:opacity-40 disabled:hover:bg-[var(--color-danger)]/90 transition-colors"
            onClick={beginCountdown}
            disabled={!canRecord}
            title={recordHint ?? "Start recording"}
          >
            <Circle className="w-3.5 h-3.5 fill-current" /> {recordHint ?? "Record"}
          </button>
        </div>
      )}
    </div>
  );
}

function SegBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      className={`flex-1 h-7 rounded-md flex items-center justify-center gap-1.5 text-[11px] font-medium transition-colors ${active ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-text-dim)] hover:text-[var(--color-text)]"}`}
      onClick={onClick}
    >
      {icon}{label}
    </button>
  );
}

function QuickToggle({ on, disabled, onClick, iconOn, iconOff, label, title }: {
  on: boolean; disabled?: boolean; onClick: () => void;
  iconOn: React.ReactNode; iconOff: React.ReactNode; label: string; title: string;
}) {
  return (
    <button
      className={`flex-1 h-8 rounded-lg flex items-center justify-center gap-1.5 text-[11px] font-medium border transition-colors disabled:opacity-40 ${on ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text)]" : "border-[var(--color-border)] text-[var(--color-text-dim)] hover:border-[var(--color-border-strong)]"}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {on ? iconOn : iconOff}{label}
    </button>
  );
}
