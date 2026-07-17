'use strict';

const assert = require('assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DownloadManager = require('../download-manager');
const { parsePlaylistDump } = require('../src/playlist-parser');

const TIKTOK_VIDEO_URL = process.env.VIC_TEST_TIKTOK_VIDEO || 'https://www.tiktok.com/@somni.core/video/7608433504593972511';
const TIKTOK_PROFILE_URL = process.env.VIC_TEST_TIKTOK_PROFILE || 'https://www.tiktok.com/@tonito.rt';
const INSTAGRAM_URL = process.env.VIC_TEST_INSTAGRAM || 'https://www.instagram.com/reel/C5c3p8dS6jM/';

async function main() {
  const dm = new DownloadManager();

  await testTikTokDownload(dm);
  await testTikTokProfileScan();
  await testInstagramMessage(dm);

  console.log('social integration ok');
}

async function testTikTokDownload(dm) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vic-social-tt-'));
  try {
    const result = await dm.downloadTikTok({
      id: `tt-${Date.now()}`,
      url: TIKTOK_VIDEO_URL,
      outputPath: dir,
      platform: 'tiktok',
    });

    const files = await fs.readdir(dir);
    assert.ok(files.length > 0, 'TikTok integration should download at least one file');
    const filePath = path.join(dir, files[0]);
    const stat = await fs.stat(filePath);
    assert.ok(stat.size > 0, 'Downloaded TikTok file should not be empty');
    assert.ok(result.outputFile || files[0], 'TikTok result should carry output info');
  } finally {
    await fs.remove(dir);
  }
}

async function testTikTokProfileScan() {
  const stdout = execFileSync(path.resolve(__dirname, '..', 'yt-dlp.exe'), [
    '--flat-playlist',
    '--dump-json',
    '--playlist-end', '3',
    '--no-warnings',
    TIKTOK_PROFILE_URL,
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });

  const videos = parsePlaylistDump(stdout, 3);
  assert.ok(videos.length > 0, 'TikTok profile scan should return items');
  assert.ok(videos.every(video => video.title && video.url), 'Parsed TikTok playlist items should have title and url');
  assert.ok(videos.some(video => video.thumbnail), 'At least one TikTok playlist item should have a thumbnail');
}

async function testInstagramMessage(dm) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vic-social-ig-'));
  try {
    await dm.downloadInstagram({
      id: `ig-${Date.now()}`,
      url: INSTAGRAM_URL,
      outputPath: dir,
      platform: 'instagram',
    });
  } catch (error) {
    const message = error.message || '';
    const looksInformative =
      /cookies\.txt|đăng nhập|cookies hợp lệ|social/i.test(message);
    assert.ok(looksInformative, `Instagram integration should fail with a helpful auth message, got: ${message}`);
  } finally {
    await fs.remove(dir);
  }
}

main().catch(error => {
  console.error('social integration failed:', error);
  process.exitCode = 1;
});
