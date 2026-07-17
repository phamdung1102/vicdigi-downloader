# VICdigi v6.2 Checklist

## Done
- Added backend smoke script for playlist parsing, diagnostics state, platform detection, and updater status shape.
- Added renderer smoke script plus `--smoke-renderer` mode in `main.js`.
- Added partial stdout recovery for playlist scan failures before falling back to mock data.
- Moved inline HTML event handlers into `src/renderer/v6-app.mjs`.
- Extracted the large inline stylesheet from `index-v6.html` to `src/renderer/v6.css`.
- Moved lightweight UI settings to `electron-store` through `uiSettings`.
- Updated docs and build metadata for `6.2.0`.

## Kept Intentionally
- Non-smoke files that remain in `scripts/` are the runtime test helpers still used by the current repo.

## Next Candidates
- Add a true network-backed integration suite for real downloads on a controlled sample URL set.
- Continue trimming stale docs and comments left over from earlier cleanup phases.
