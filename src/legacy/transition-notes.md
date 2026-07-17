# Transition Notes

This folder tracks the migration from the `v6.x` layout into the new `v7` core architecture.

## Current State
- `main.js` now boots through `src/core/jobs/queue-service.js`.
- `src/video-info.js`, `src/downloader.js`, and `src/playlist-parser.js` are compatibility shims.
- New business logic entry points live under `src/core/`.

## Migration Rule
- New backend work should prefer `src/core/`.
- Existing imports may keep using legacy file paths until each slice is fully migrated.
- Once a slice is stable, the old shim should be removed in a later cleanup pass.
