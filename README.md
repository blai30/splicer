# Splicer

![Splicer hero splash](public/splash/hero-social.png)

Splicer is a browser-based video timeline cutter built with Astro + Preact. It ships two in-browser export engines: the browser's native WebCodecs API (the primary path for WebM) and FFmpeg (WebAssembly) for everything else.

It is designed for fast, local edits:

- import clips by click or drag-and-drop
- trim in/out points and split at the playhead
- preview edits with frame stepping and playback speed controls
- export to MP4, MKV, MOV, or WebM directly in the browser

No upload pipeline is used. Processing happens entirely client-side via WebCodecs and FFmpeg WASM.

## App Screenshots

### Light Theme

![Splicer light theme](public/screenshots/app-light.png)

### Dark Theme

![Splicer dark theme](public/screenshots/app-dark.png)

## Core Capabilities

### Timeline Editing

- Append one or more video files to the timeline.
- Select segments and:
  - set in-point
  - set out-point
  - cut at playhead
  - delete
- Drag segment trim handles for interactive left/right trimming.
- Seek by clicking/dragging in the timeline.

### Playback

- Segment-aware preview player.
- Playback speed: `0.25x` to `2x`.
- Frame stepping controls.
- Automatic segment advance during playback.

### Export

- Formats: `mp4`, `mkv`, `mov`, `webm`
- Quality presets: `lossless`, `high`, `medium`, `low`
- Framerate options: `original`, `60`, `30`, `24`
- WebM codec choice: `VP9` (recommended, smaller files) or `VP8` (faster to encode).
- Two export engines, selected automatically per export:
  - WebCodecs (native, runs in a Web Worker) is the primary path for WebM and handles HD sources that FFmpeg WASM cannot.
  - FFmpeg WASM handles all other formats, and is the transparent fallback whenever WebCodecs is unavailable or fails.
- Export progress + cancel support.
- Export history table with one-click download and drag-to-desktop support.
- In-app "Export & quality FAQ" plus an `/about` guide explaining containers vs codecs and how to avoid quality loss.

### Per-Segment Mute

- Toggle mute on a selected segment via the timeline toolbar button or `M` key.
- Muted segments show a 🔇 indicator on the segment block.
- Preview playback respects per-segment mute immediately.
- Exported video silences muted segments (FFmpeg applies `volume=0`; the WebCodecs engine fills the segment with silence).

## Keyboard Shortcuts

- `Space`: Play/Pause
- `ArrowLeft` or `,`: Step back one frame
- `ArrowRight` or `.`: Step forward one frame
- `-`: Zoom timeline out
- `=`: Zoom timeline in
- `Ctrl` + mouse wheel up/down: Zoom timeline in/out at cursor
- `Enter` (while focused in zoom % field): Apply typed zoom level
- `I`: Set in-point
- `O`: Set out-point
- `C`: Cut at playhead
- `M`: Toggle mute on selected segment
- `Delete` / `Backspace`: Delete selected segment
- `Ctrl` + `Z`: Undo
- `Ctrl` + `Shift` + `Z` or `Ctrl` + `Y`: Redo

## Tech Stack

- Astro
- Preact + Signals
- Tailwind CSS
- WebCodecs (`VideoEncoder` / `VideoDecoder` / `AudioEncoder` / `AudioDecoder`)
- `mp4box` (MP4/MOV demux) and `webm-muxer` (WebM muxing)
- FFmpeg WASM (`@ffmpeg/ffmpeg`, `@ffmpeg/core-mt`, `@ffmpeg/util`)

## Requirements

- Node.js `>= 22.12.0`
- pnpm

## Getting Started

```bash
pnpm install
pnpm dev
```

Open `http://localhost:4321`.

## Implementation Notes

### FFmpeg Core Delivery

This project serves `ffmpeg-core.js` from `node_modules` in development through a Vite plugin and copies it into `dist/ffmpeg` at build time.

`ffmpeg` is expected at `public/ffmpeg/`.

### Cross-Origin Isolation

The app config sets the following headers in dev and preview:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

These are required for stable FFmpeg WASM execution in the browser.

### Export Path Optimization

When all of the following are true:

- quality = `lossless`
- fps = `original`
- no muted segments

Splicer uses a stream-copy concat path (`-c copy`) to avoid re-encoding.

### WebCodecs WebM Engine

WebM export prefers the browser's native WebCodecs API over FFmpeg WASM:

- The full decode -> edit -> encode -> mux pipeline runs in a dedicated Web Worker, so memory stays bounded regardless of clip length.
- Sources are demuxed with `mp4box` (MP4/MOV) or an in-house EBML parser (WebM), re-encoded to VP8/VP9 + Opus, and muxed with `webm-muxer`.
- A capability gate checks encoder/decoder support up front. If WebCodecs is missing or the source is not demuxable, the router falls back to the FFmpeg path; any runtime failure falls back too, so an export always completes or surfaces an honest error.
- This is the only path that can export HD (e.g. 1080p60) to WebM in-browser. Single-threaded FFmpeg WASM runs out of memory before producing a frame.

## Usage Guidelines

- Prefer source clips with compatible codecs/containers when aiming for fastest export.
- Use `lossless + original fps` for near-instant remux exports when possible.
- Use `high`/`medium` presets for smaller files when re-encoding is acceptable.
- For WebM, prefer `VP9` for smaller files at similar quality; choose `VP8` when encode speed matters more than size.
- To export with no quality loss, keep the same format as your source at `lossless + original fps` with no crop or mute, so Splicer stream-copies instead of re-encoding. Exporting to a different format always re-encodes and loses a little quality. See the in-app FAQ or `/about` for the full explanation.
- Large clips can consume significant memory in browser sessions; close/reload tab if memory pressure grows.

## Current Limitations

- Project state is in-memory only (no save/load project file).
- Export history is session-only and clears on refresh.
- No multi-track composition.
- WebCodecs export requires a supporting browser (recent Chromium). Elsewhere it falls back to FFmpeg WASM, where HD WebM may run out of memory.
