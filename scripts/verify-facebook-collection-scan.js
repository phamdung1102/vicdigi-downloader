'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { scanChannelVideos } = require('../src/core/media/scan-service');

async function main() {
  const [, , url, maxVideosArg, outputArg] = process.argv;
  if (!url) {
    throw new Error(
      'Usage: electron scripts/verify-facebook-collection-scan.js "https://www.facebook.com/<page>/reels" [maxVideos] [outputFile]'
    );
  }

  const maxVideos = Number.parseInt(maxVideosArg || '20', 10);
  const outputFile = path.resolve(outputArg || 'verify-facebook-collection-scan-output.json');

  await app.whenReady();

  try {
    const result = await scanChannelVideos({
      url,
      maxVideos: Number.isFinite(maxVideos) ? maxVideos : 20,
      caps: { ytdlp: false },
      appDir: path.resolve(__dirname, '..'),
    });

    fs.writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  } finally {
    await app.quit();
  }
}

main().catch(error => {
  try {
    fs.writeFileSync(
      path.resolve('verify-facebook-collection-scan-error.txt'),
      `${error?.stack || error?.message || String(error)}\n`,
      'utf8'
    );
  } catch (_) {}
  process.exitCode = 1;
});
