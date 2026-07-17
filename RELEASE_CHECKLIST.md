# Release Checklist

## Before Build
- Run `npm run smoke`.
- Confirm `yt-dlp.exe` and `ffmpeg.exe` exist in the app root.
- Launch the app once and confirm working mode plus core actions show normally.

## Build
- Run `npm run build-win`.
- Confirm NSIS installer and portable build are created under `dist/`.

## After Build
- Launch the packaged app once.
- Verify single download UI boots, batch tab opens, history tab opens, and update modal still works.
- Confirm bundled `yt-dlp.exe` and `ffmpeg.exe` land in the packaged resources.
