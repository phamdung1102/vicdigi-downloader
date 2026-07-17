# VICdigi v7.0 Roadmap

## Vision
`v7.0` should be the release that turns VICdigi from a capable Electron downloader into a maintainable download platform.

The main goal is not "more buttons". The main goal is:
- separate core logic from UI
- make social scanning less dependent on `yt-dlp`
- persist jobs cleanly across app restarts
- turn queue/download handling into a first-class system
- make future feature work cheaper and safer

## Product Direction
`v6.x` is a working app.
`v7.0` should be a platform release.

That means:
- UI becomes thinner
- core services become reusable
- platform-specific behavior moves into adapters
- state becomes durable, not mostly in-memory

## Proposed Target Architecture
```text
D:\\VIC v6.0\\
├── main.js                      # Electron shell/bootstrap
├── preload.js                   # Safe bridge only
├── index-v6.html                # Transitional shell until v7 UI lands
├── src\\
│   ├── core\\
│   │   ├── jobs\\
│   │   │   ├── job-store.js
│   │   │   ├── job-runner.js
│   │   │   ├── queue-service.js
│   │   │   └── retry-policy.js
│   │   ├── media\\
│   │   │   ├── info-service.js
│   │   │   ├── scan-service.js
│   │   │   ├── download-service.js
│   │   │   ├── filename-policy.js
│   │   │   └── subtitle-service.js
│   │   ├── platforms\\
│   │   │   ├── youtube\\
│   │   │   ├── tiktok\\
│   │   │   ├── instagram\\
│   │   │   ├── facebook\\
│   │   │   └── shared\\
│   │   ├── persistence\\
│   │   │   ├── sqlite.js
│   │   │   ├── migrations\\
│   │   │   └── settings-store.js
│   │   └── events\\
│   │       └── event-bus.js
│   ├── ipc\\
│   │   ├── register-handlers.js
│   │   ├── map-requests.js
│   │   └── dto.js
│   ├── renderer\\
│   │   ├── app\\
│   │   ├── modules\\
│   │   ├── state\\
│   │   └── components\\
│   └── legacy\\
│       └── transition-notes.md
```

## Big Upgrades

### 1. Core Download Engine
Move core logic out of Electron-first files into a reusable service layer.

Expected outcomes:
- `main.js` gets smaller
- `ipc-handlers.js` stops owning business logic
- download/scan/info rules are shared by single and batch flows
- future CLI or local HTTP mode becomes possible

Main deliverables:
- `src/core/media/info-service.js`
- `src/core/media/scan-service.js`
- `src/core/media/download-service.js`
- `src/core/media/filename-policy.js`

### 2. Social Scanner v2
Stop relying on `yt-dlp` alone for social scanning.

Why:
- Facebook page reels are not scan-friendly in `yt-dlp`
- Instagram collections are fragile
- TikTok channel/profile scan behavior can change often

Approach:
- keep `yt-dlp` for media extraction when it works
- add platform scan adapters for URL normalization, metadata extraction, and collection parsing
- expose a clear distinction between:
  - `scan collection`
  - `get single item info`
  - `download media`

Main deliverables:
- `src/core/platforms/facebook/facebook-scan.js`
- `src/core/platforms/tiktok/tiktok-scan.js`
- `src/core/platforms/instagram/instagram-scan.js`
- unified scan result shape

### 3. Job Store + Resume
Persist queue state and recent jobs in SQLite.

Why:
- current queue is good for live work, but weak across app restarts
- users should not lose context after closing the app

Persist at minimum:
- job id
- source url
- detected platform
- normalized title
- output folder
- requested format/quality/subtitle mode
- status
- progress snapshot
- file path
- failure reason
- created/updated timestamps

Main deliverables:
- `src/core/persistence/sqlite.js`
- `src/core/jobs/job-store.js`
- startup queue restore flow

### 4. Download Center v2
Turn the current summary card into a proper operations center.

Capabilities:
- grouped by `queued / downloading / paused / failed / completed`
- per-job actions: retry, cancel, open file, open folder
- mini event log per job
- filters by platform
- bulk actions for failed/completed jobs

Important:
- keep the default UI simple
- advanced details should expand on demand

### 5. Download Profiles
Add reusable presets for common use cases.

Examples:
- `YouTube 1080p MP4`
- `YouTube audio only`
- `TikTok clean title`
- `Facebook reel`
- `Subtitle pack`

Each profile should store:
- output format
- quality target
- subtitle mode
- filename rules
- post-processing flags

### 6. Filename Policy System
Centralize naming logic instead of patching titles case by case.

Rules should support:
- platform-specific title cleanup
- optional uploader suffix
- duplicate handling
- date prefix/suffix
- safe filename sanitization
- fallback naming when title is missing

This is especially important for:
- Facebook titles polluted with stats
- TikTok placeholder names
- Instagram titles derived from captions

### 7. Test Strategy Upgrade
Move from smoke-heavy confidence to real integration confidence.

Recommended layers:
- unit tests for parsers, title normalization, filename policy
- integration tests for scan/info/download adapters
- renderer smoke tests for boot and critical tabs
- small controlled network test suite with known sample URLs

## Release Plan

## Phase 1: Foundation
Goal: introduce new `core/` structure without breaking `v6.2`

Tasks:
- create `src/core/` folders
- move shared title and filename logic first
- move info/scan/download wrappers into core services
- keep existing IPC surface stable

Exit criteria:
- app behavior unchanged for normal users
- core services are callable independently from renderer

## Phase 2: Persistence
Goal: durable jobs and settings backbone

Tasks:
- add SQLite dependency and migration bootstrap
- persist job lifecycle
- restore recent jobs at app launch
- move queue snapshots out of memory-only assumptions

Exit criteria:
- app restart restores completed/failed/recent jobs
- failed jobs retain actionable metadata

## Phase 3: Social Scanner v2
Goal: improve reliability of scan flows

Tasks:
- create platform scan adapters
- add URL normalization table per platform
- implement Facebook reel/page scan strategy
- improve Instagram and TikTok collection parsing

Exit criteria:
- no fake demo fallback for real scan failures
- unsupported scans return clear errors
- platform scan coverage improves measurably

## Phase 4: UI Upgrade
Goal: expose the new backend cleanly

Tasks:
- replace transitional batch state with job-driven state
- build Download Center v2
- add profile selector
- move settings into clear sections

Exit criteria:
- queue feels like a real subsystem
- users can understand and recover failed jobs without terminal logs

## Phase 5: Hardening
Goal: ship-ready stabilization

Tasks:
- add integration suite
- add migration safety checks
- package validation
- real-world sample regression pass across platforms

Exit criteria:
- stable installer and portable build
- repeatable release checklist

## Suggested File Migration Order
1. `src/title-utils.js` -> `src/core/media/filename-policy.js`
2. `src/video-info.js` -> `src/core/media/info-service.js`
3. `src/playlist-parser.js` + scan helpers -> `src/core/media/scan-service.js`
4. `src/services/social/*` -> `src/core/platforms/*`
5. `download-manager.js` -> `src/core/jobs/queue-service.js`
6. `src/ipc-handlers.js` -> thin request mapping only
7. renderer modules -> state-driven job UI

## Risks
- Social platforms change often, so scanner adapters need clear isolation.
- A partial migration can create duplicate logic if old and new services coexist too long.
- SQLite adds a real migration surface, so schema discipline matters.
- Overbuilding the UI before the job model stabilizes would waste time.

## Non-Goals For v7.0
- Full cloud sync
- Multi-user accounts
- Browser automation as the primary extraction strategy
- A complete UI rewrite before backend boundaries are defined

## Recommended Scope Cut If Time Is Tight
If `v7.0` needs to stay realistic, keep these as must-have:
- core service split
- filename policy system
- job persistence
- social scanner v2 for Facebook + TikTok
- Download Center v2

Push these to `v7.1` if needed:
- profile sharing/export
- advanced analytics
- CLI mode
- auto-update for the whole app

## Success Criteria
`v7.0` is successful if:
- Facebook/TikTok/Instagram scan behavior is more predictable
- single and batch downloads use the same core rules
- app restart no longer loses important queue context
- naming rules are consistent across platforms
- new features can land without touching five unrelated files
