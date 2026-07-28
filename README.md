# Andrew Downloader

Electron desktop app for downloading media from YouTube and common social platforms, with subtitle, thumbnail, batch, profiles, a persistent queue, and automatic updates.

## Version
`8.6.2` — Facebook scanner follows real next-page links until the requested video count is reached.

## Highlights
- Focused video workflow with quick presets, advanced naming/conflict controls, disk-space checks, and clipboard paste.
- Download Center supports pause/resume-all actions, persistent recovery, and Windows completion notifications.
- Production dependencies are audited during release preparation.
- Shared `yt-dlp` client for info lookup, downloads, updater, and batch scan.
- Renderer logic split into `src/renderer/` and stylesheet extracted to `src/renderer/v6.css`.
- Safer DOM rendering for batch/history content and no inline event handlers in `index-v6.html`.
- Smoke scripts for backend utilities and full renderer boot.
- Reusable services live under `src/core/`.
- Download Center stays compact by default and exposes job actions from an on-demand detail modal.
- Queue snapshots have SQLite-backed persistence (`node:sqlite`, built into Electron 38's Node 22), and settings include reusable download profiles.
- Machine-locked RSA license system with admin key generator (`tools/license-admin`).
- **App auto-update**: packaged builds check GitHub Releases on startup and every 4 hours (`src/app-updater.js`). See [UPDATE_GUIDE.md](UPDATE_GUIDE.md) for the release process.

## Setup
```bash
npm install
```
Binaries `yt-dlp.exe` and `ffmpeg.exe` are **not committed to git** (too large). After cloning, download them into the project root:
- yt-dlp: https://github.com/yt-dlp/yt-dlp/releases (yt-dlp.exe)
- ffmpeg: https://www.gyan.dev/ffmpeg/builds/ (copy ffmpeg.exe)

Without them the app runs in demo mode.

## Run
```bash
npm start
```

## Smoke Tests
```bash
npm run smoke:backend
npm run smoke:renderer
npm run smoke
```

## Build & Release
```bash
npm run build-win
```
Before the first release, set your GitHub username in `electron-builder.yml` (`publish.owner`) and `package.json` (`repository.url`). Full release/auto-update workflow: [UPDATE_GUIDE.md](UPDATE_GUIDE.md).

## Main Structure
```text
├── main.js                  # Electron bootstrap (thin)
├── preload.js               # contextBridge API surface
├── index-v6.html            # UI shell
├── electron-builder.yml     # Build + GitHub publish config
├── src\
│   ├── app-updater.js       # Auto-update (electron-updater + GitHub Releases)
│   ├── ipc-handlers.js      # IPC request mapping
│   ├── core\                # Services: jobs, media, platforms, persistence, licensing
│   └── renderer\            # UI modules (v6-app.mjs, controllers, css)
├── tools\license-admin\     # License key generator app
├── scripts\                 # Smoke + integration tests, license token CLI
└── assets\
```

## Notes
- `UPDATE_GUIDE.md` — how to ship a new version so installed apps auto-update.
- `V7_0_ROADMAP.md` documents the v7 architecture direction (largely landed).
- `RELEASE_CHECKLIST.md` is the quick checklist before packaging or handing off a build.
- `download-manager.js`, `src/video-info.js`, `src/downloader.js`, and `src/playlist-parser.js` are compatibility entrypoints; `src/core/` holds the real implementation.
