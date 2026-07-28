'use strict';

const assert = require('assert');
const fs = require('fs-extra');
const path = require('path');

const { parsePlaylistDump } = require('../src/playlist-parser');
const { normalizeMediaTitle } = require('../src/core/media/filename-policy');
const {
  deleteCustomProfile,
  getDownloadProfiles,
  saveCustomProfile,
} = require('../src/core/profiles/profile-service');
const { JobStore } = require('../src/core/jobs/job-store');
const { SettingsStore } = require('../src/core/persistence/settings-store');
const { SqlitePersistence } = require('../src/core/persistence/sqlite');
const { resolveScanAdapter } = require('../src/core/platforms/scan-adapters');
const { checkUpdate } = require('../src/ytdlp-updater');
const { clearYtDlpError, getDiagnostics, recordYtDlpError } = require('../src/diagnostics');
const DownloadManager = require('../download-manager');

async function main() {
  const sampleDump = [
    JSON.stringify({
      id: 'abc123xyz01',
      title: 'Smoke Item 1',
      uploader: 'Smoke Channel',
      duration: 125,
      thumbnail: 'https://example.com/1.jpg',
    }),
    'not-json',
    JSON.stringify({
      id: 'abc123xyz02',
      title: 'Smoke Item 2',
      channel: 'Smoke Channel',
      duration: 245,
    }),
  ].join('\n');

  const videos = parsePlaylistDump(sampleDump, 10);
  assert.equal(videos.length, 2, 'playlist parser should recover valid JSON lines');
  assert.equal(videos[0].title, 'Smoke Item 1');
  assert.equal(videos[1].videoId, 'abc123xyz02');
  assert.equal(
    normalizeMediaTitle({
      title: '4.5K views · 39 reactions | Demo title | Demo Uploader',
      description: 'Demo title',
      uploader: 'Demo Uploader',
      platform: 'facebook',
    }),
    'Demo title',
    'filename policy should normalize noisy Facebook titles',
  );
  const profiles = getDownloadProfiles();
  assert.equal(profiles.length >= 3, true, 'profile service should expose default presets');
  assert.equal(!!profiles.find(profile => profile.id === 'balanced-1080'), true);

  assert.equal(DownloadManager.detectPlatform('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'youtube');
  assert.equal(DownloadManager.detectPlatform('https://www.tiktok.com/@demo/video/123'), 'tiktok');
  assert.equal(DownloadManager.detectPlatform('https://www.facebook.com/reel/1234567890'), 'facebook');

  const memory = new Map();
  const smokeStore = {
    get: key => memory.get(key),
    set: (key, value) => memory.set(key, value),
    delete: key => memory.delete(key),
  };
  const savedProfile = saveCustomProfile(smokeStore, {
    name: 'Smoke Custom',
    description: 'Saved during smoke test',
    single: {
      videoFormat: 'mp4',
      videoQuality: '720p',
      subtitleLang: 'en',
      subtitleFormat: 'srt',
    },
    batch: {
      maxVideos: 7,
      batchFormat: 'mp4',
      batchQuality: '720p',
      batchSubs: 'yes',
    },
  });
  const profilesWithCustom = getDownloadProfiles(smokeStore);
  assert.equal(!!profilesWithCustom.find(profile => profile.id === savedProfile.id), true, 'custom profile should persist via store');
  assert.equal(deleteCustomProfile(smokeStore, savedProfile.id), true, 'custom profile should be deletable');
  assert.equal(!!getDownloadProfiles(smokeStore).find(profile => profile.id === savedProfile.id), false, 'deleted custom profile should not remain');

  const facebookAdapter = resolveScanAdapter('https://web.facebook.com/demo.page/reels/');
  assert.equal(facebookAdapter.normalizeScanUrl('https://web.facebook.com/demo.page/reels/').startsWith('https://www.facebook.com/'), true, 'facebook adapter should normalize web.facebook.com');
  assert.equal(typeof facebookAdapter.scanChannelVideos, 'function', 'facebook adapter should expose native collection scanner');
  assert.equal(facebookAdapter.allowSingleFallback('https://www.facebook.com/demo.page/reels/'), false, 'facebook collection URL should not single-fallback');
  const genericAdapter = resolveScanAdapter('https://example.com/videos');
  assert.equal(typeof genericAdapter.buildScanArgs, 'function', 'generic scan adapter should be available');
  const jobStore = new JobStore(new SettingsStore(smokeStore));
  jobStore.save({
    queue: [{
      id: 'smoke_job_1',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      outputPath: path.resolve(__dirname, '..'),
      title: 'Smoke queue item',
      status: 'queued',
      progress: 0,
    }],
    paused: [{
      id: 'smoke_job_2',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      outputPath: path.resolve(__dirname, '..'),
      title: 'Smoke paused item',
      status: 'paused',
      progress: 42,
    }],
  });
  const persisted = jobStore.load();
  assert.equal(Array.isArray(persisted.queue), true, 'queue snapshot should persist to store');
  assert.equal(persisted.queue[0]?.title, 'Smoke queue item');

  const tempDbPath = path.join(path.resolve(__dirname, '..'), '.smoke-v7.db');
  await fs.remove(tempDbPath).catch(() => {});
  const sqlite = new SqlitePersistence(tempDbPath);
  sqlite.saveSnapshot({
    queue: persisted.queue,
    active: [],
    paused: persisted.paused,
    completed: [],
    failed: [],
    updatedAt: new Date().toISOString(),
  });
  const sqliteStatus = sqlite.getStatus();
  assert.equal(sqliteStatus.enabled, true, 'sqlite persistence should initialize');

  const restoredQueue = new DownloadManager({ store: smokeStore, rootDir: path.resolve(__dirname, '..'), dbPath: tempDbPath });
  const restoredDownloads = restoredQueue.getAllDownloads();
  assert.equal(restoredDownloads.queued.length, 1, 'queue service should restore queued jobs from persisted snapshot');
  assert.equal(restoredDownloads.queued[0]?.title, 'Smoke queue item');
  assert.equal(restoredDownloads.paused.length, 1, 'queue service should restore paused jobs from persisted snapshot');
  const recoverable = restoredQueue.getRecoverableSessionInfo();
  assert.equal(recoverable.hasRecoverable, true, 'queue service should report recoverable session info');
  assert.equal(recoverable.total, 2, 'recoverable session should count queued and paused jobs');
  restoredQueue.discardPendingSession();
  const afterDiscard = restoredQueue.getRecoverableSessionInfo();
  assert.equal(afterDiscard.hasRecoverable, false, 'discard should clear unfinished jobs');
  assert.equal(typeof restoredQueue.retryDownload, 'function', 'queue service should expose retryDownload');
  assert.equal(restoredQueue.getPersistenceStatus().sqlite.enabled, true, 'queue service should surface sqlite status');
  await fs.remove(tempDbPath).catch(() => {});

  clearYtDlpError();
  recordYtDlpError('smoke-backend', new Error('synthetic smoke error'));
  let diagnostics = getDiagnostics(path.resolve(__dirname, '..'), { ytdlp: true, ffmpeg: true, workingMode: 'full' });
  assert.equal(diagnostics.lastYtDlpError?.source, 'smoke-backend');
  assert.equal(typeof diagnostics.executables.ytDlp !== 'undefined', true);

  clearYtDlpError();
  diagnostics = getDiagnostics(path.resolve(__dirname, '..'), { ytdlp: false, ffmpeg: false, workingMode: 'demo' });
  assert.equal(diagnostics.lastYtDlpError, null);

  const updateInfo = await checkUpdate(path.resolve(__dirname, '..'));
  assert.equal(updateInfo.success, true, 'update check should resolve with a status object');
  assert.ok(Object.prototype.hasOwnProperty.call(updateInfo, 'latestVersion'));
  assert.ok(Object.prototype.hasOwnProperty.call(updateInfo, 'localVersion'));

  console.log('backend smoke ok');
}

main().catch(error => {
  console.error('backend smoke failed:', error);
  process.exitCode = 1;
});
