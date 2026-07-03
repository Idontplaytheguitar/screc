# screc

Lightweight, cross-platform screen recorder and video editor. Windows, macOS, and Linux.

Built with Tauri 2 (Rust) + React, with all capture and rendering done by FFmpeg — detected on your system or downloaded automatically on first run.

## How it works

Launching screc opens a small always-on-top **recorder widget** — pick a screen, window, or drag-selected region, toggle microphone / system audio / webcam, and hit Record. Every source is captured to its own track.

When you stop, the recording opens in the **editor**: a multi-track timeline with trimming, splitting, ripple delete, speed, volume, opacity, fades, text overlays, webcam overlay positioning, and undo/redo. You can also open the editor directly from the widget, browse previous recordings in its library, start a blank project, and import existing media files.

**Export** to MP4, WebM, MKV, MOV, AVI, or GIF with your choice of codec (H.264, H.265, AV1, VP9, ProRes…), resolution, frame rate, and quality — or use one of the built-in presets.

## Features

- **Recorder**: full screen, single window, or region capture; multiple monitors; webcam; any number of mics plus system loopback audio, each on a separate track; cursor capture; countdown; codec/container/fps/quality controls.
- **Editor**: multi-track timeline with thumbnails and waveforms, snap, zoom, split (S), duplicate (D), ripple delete (Del), J/K/L and space transport, undo/redo (Ctrl+Z / Ctrl+Shift+Z), media import, text overlays, per-clip speed/volume/opacity/position/scale/fades.
- **Lightweight**: no bundled Chromium or Electron; a few MB installer; FFmpeg does the heavy lifting.

## Development

```bash
npm install
npm run tauri dev      # run the app
npm run tauri build    # produce installers (src-tauri/target/release/bundle)
```

Frontend typecheck: `npx tsc --noEmit` · Backend: `cd src-tauri && cargo check`

### Linux notes

- Window capture lists windows via `wmctrl` (install it for window mode).
- System audio loopback uses PulseAudio/PipeWire monitor sources.

## License

MIT
