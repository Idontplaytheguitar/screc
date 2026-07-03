# screc — agent notes

Lightweight cross-platform screen recorder + editor. Tauri 2 (Rust) + React/TS + FFmpeg.

## Commands

```bash
# Dev (launches Vite + Tauri window)
npm run tauri dev

# Typecheck frontend
npx tsc --noEmit

# Build production frontend bundle
npm run build

# Typecheck/compile Rust backend
cd src-tauri && cargo check
# Full release build (produces installers in src-tauri/target/release/bundle)
npm run tauri build
```

## Architecture

- **Backend** (`src-tauri/src/`): `ffmpeg/` (resolver: detect-or-download FFmpeg, runner), `devices/` (per-OS screen/webcam/mic/loopback enumeration), `recording/` (per-OS capture args, session manifest, one file per source), `media/` (ffprobe, thumbnails, waveforms), `export/` (EDL → ffmpeg filter_complex renderer). All FFmpeg calls shell out to the resolved binary via `std::process::Command`.
- **Frontend** (`src/`): `shared/` (types mirroring Rust, IPC bindings, editor store, utils), `views/` (Widget, Editor, RegionSelector), `views/editor/` (PreviewPlayer, Timeline, Inspector, ExportDialog).
- **Windows**: the app launches as the frameless always-on-top recorder widget (label `main`, hash route `#` → Widget). The editor opens in its own decorated window (label `editor`, route `#editor?folder=…`) — from the widget's editor button or automatically after "Stop & edit". The editor's landing state is the library (recent recordings). Region selection uses a fullscreen transparent overlay (label `region`, route `#region?ox=…`; query params live inside the hash).
- **IPC**: Tauri commands in `lib.rs`; events `ffmpeg://status`, `recording://started|stopped`, `export://progress`, `editor://open-session`, `region://selected|cancel`.
- **Local files**: recordings + cached FFmpeg live under the OS app-data dir (`<appdata>/screc/recordings`, `<appdata>/ffmpeg`). Preview uses `convertFileSrc` (asset protocol) — already allowed by the `fs` plugin + core.

## Conventions

- No comments in code unless asked.
- Frontend path alias `@/*` → `src/*`.
- Shared types MUST stay in sync between `src/shared/types.ts` and the Rust serde structs.
- Rust errors flow through `error::AppError` (serializes to a string for the frontend).
