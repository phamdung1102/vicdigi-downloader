// ============================================================
// ipc-handlers.js — Register all ipcMain handlers
// Keeps main.js clean: just call registerAll(deps)
// ============================================================
'use strict';

const { ipcMain, dialog, shell, clipboard, app, BrowserWindow, session, Notification } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const { execFile } = require('child_process');

const { isValidYouTubeUrl, getExecutablePath } = require('./utils');
const { getVideoInfo, getVideoInfoMulti } = require('./video-info');
const { downloadVideo, downloadSubtitle, downloadThumbnail } = require('./downloader');
const { scanChannelVideos } = require('./core/media/scan-service');
const { scanFacebookPageReels } = require('./core/platforms/facebook/facebook-page-reels-scanner');
const {
  deleteCustomProfile,
  getDownloadProfiles,
  saveCustomProfile,
} = require('./core/profiles/profile-service');
const { LicenseService } = require('./core/licensing/license-service');
const { trackActivation, trackDailyHeartbeat, requestOnlineLicense } = require('./core/licensing/activation-tracker');
const { checkUpdate, downloadUpdate } = require('./ytdlp-updater');
const { checkAppUpdates } = require('./app-updater');
const { recordYtDlpError } = require('./diagnostics');
const { runYtDlp, withCommonArgs } = require('./ytdlp-client');
const DownloadManager = require('../download-manager');
const audioSeparation = require('./core/audio-separation-service');

let _mainWindow   = null;
let _caps         = null;
let _appDir       = null;
let _store        = null;
let _dlManager    = null;
let _licenseSvc   = null;
let _activeFacebookScanCancel = null;
let _facebookLoginWindow = null;
const FACEBOOK_PARTITION = 'persist:andrew-facebook-scanner';
const ARCHIVE_INDEX_FILE = '.andrew-archive.json';
const ARCHIVE_VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v']);

function _archiveVideoId(text = '') {
  const value = String(text);
  return value.match(/(?:youtube\.com\/watch\?[^\s]*v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/i)?.[1]
    || value.match(/(?:facebook\.com\/(?:reel|videos)\/)(\d{8,})/i)?.[1]
    || value.match(/tiktok\.com\/@[^/]+\/video\/(\d{10,})/i)?.[1]
    || '';
}

function _normalizeArchiveTitle(value = '') {
  return path.basename(String(value), path.extname(String(value)))
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/(?:_trimmed|_cropped|_crop|_trim|\.f\d+)+$/gi, '')
    .replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();
}

function _titleSimilarity(left, right) {
  const a = new Set(_normalizeArchiveTitle(left).split(' ').filter(word => word.length > 2));
  const b = new Set(_normalizeArchiveTitle(right).split(' ').filter(word => word.length > 2));
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const word of a) if (b.has(word)) common++;
  return common / Math.max(a.size, b.size);
}

function _probeArchiveFile(ffmpegPath, filePath) {
  return new Promise(resolve => {
    execFile(ffmpegPath, ['-hide_banner', '-i', filePath], { windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      const output = `${stdout || ''}\n${stderr || ''}`;
      const durationMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
      const duration = durationMatch
        ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
        : 0;
      const title = output.match(/^\s*title\s*:\s*(.+)$/im)?.[1]?.trim() || path.basename(filePath, path.extname(filePath));
      resolve({ videoId: _archiveVideoId(output), title, duration });
    });
  });
}

async function _getFacebookLoginStatus() {
  const cookies = await session.fromPartition(FACEBOOK_PARTITION).cookies.get({ name: 'c_user' });
  const account = cookies.find(cookie => /(^|\.)facebook\.com$/i.test(cookie.domain || ''));
  return { loggedIn: Boolean(account?.value), userId: account?.value || '' };
}

/**
 * @param {BrowserWindow}  mainWindow
 * @param {object}         caps         live capabilities reference
 * @param {string}         appDir
 * @param {Store}          store        electron-store instance
 * @param {DownloadManager} dlManager
 */
function registerAll(mainWindow, caps, appDir, store, dlManager) {
  _mainWindow = mainWindow;
  _caps       = caps;
  _appDir     = appDir;
  _store      = store;
  _dlManager  = dlManager;
  _licenseSvc = new LicenseService(store);

  _registerVideo();
  _registerSubtitle();
  _registerThumbnail();
  _registerSystem();
  _registerStore();
  _registerDownloadManager();
  _registerBatch();
  _registerFacebookScanner();
  _registerUpdater();

  // Heartbeat theo dõi sử dụng (tối đa 1 lần/ngày, chỉ khi license active).
  // Lặp lại mỗi 6 giờ để máy treo app nhiều ngày vẫn báo đủ từng ngày.
  const sendHeartbeat = () => {
    try { trackDailyHeartbeat(_licenseSvc.getStatusCached(), _store); } catch (_) {}
  };
  setTimeout(sendHeartbeat, 5000);
  setInterval(sendHeartbeat, 6 * 60 * 60 * 1000);
}

// ── LICENSE GATE (tầng main process) ─────────────────────────
// Chặn sâu: dù renderer bị can thiệp, các chức năng chính vẫn
// từ chối chạy khi máy chưa kích hoạt license hợp lệ.
function _requireLicense() {
  const status = _licenseSvc?.getStatusCached?.();
  if (!status?.valid) {
    throw new Error('Chức năng bị khóa: máy này chưa kích hoạt license hợp lệ.');
  }
}

// ── VIDEO INFO ────────────────────────────────────────────────

function _registerVideo() {
  ipcMain.handle('get-video-info', async (_e, url) => {
    _requireLicense();
    if (!url || !isValidYouTubeUrl(url.trim()))
      throw new Error('URL YouTube không hợp lệ.');
    return getVideoInfo(url.trim(), _caps, _appDir);
  });

  ipcMain.handle('get-video-info-multi', async (_e, url) => {
    _requireLicense();
    const cleanUrl = String(url || '').trim();
    if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) throw new Error('URL không hợp lệ.');
    return getVideoInfoMulti(cleanUrl, _caps, _appDir);
  });

  ipcMain.handle('get-preview-url', async (_e, url) => {
    _requireLicense();
    const cleanUrl = String(url || '').trim();
    if (!/^https?:\/\//i.test(cleanUrl)) throw new Error('URL xem trước không hợp lệ.');
    const args = withCommonArgs([
      '--get-url',
      '--format', 'best[ext=mp4][vcodec!=none][acodec!=none]/best[ext=mp4]/best',
      '--no-playlist',
      cleanUrl,
    ]);
    const { stdout } = await runYtDlp(args, { appDir: _appDir, timeoutMs: 30000 });
    const previewUrl = stdout.split(/\r?\n/).map(value => value.trim()).find(value => /^https?:\/\//i.test(value));
    if (!previewUrl) throw new Error('Nguồn này không cung cấp luồng xem trước.');
    return { success: true, url: previewUrl };
  });

  ipcMain.handle('download-video', async (event, opts) => {
    _requireLicense();
    const { url, outputPath, format, quality, title, filenameTemplate, conflictPolicy, embedMetadata, embedThumbnail, clipStartSeconds, clipEndSeconds, requestId } = opts;
    if (!url || !outputPath) throw new Error('url và outputPath là bắt buộc');

    const platform = DownloadManager.detectPlatform(url);

    // Social platforms → queue via Download Manager
    if (['instagram', 'facebook', 'tiktok'].includes(platform)) {
      if (!_dlManager) throw new Error('Download Manager not ready');
      return _runManagedDownload(event, {
        url,
        outputPath,
        format,
        quality,
        platform,
        title: title || `${platform}_${Date.now()}`,
        clipStartSeconds,
        clipEndSeconds,
        requestId: String(requestId || ''),
      });
    }

    // YouTube / generic
    const onProgress = pct =>
      event.sender.send('download-progress', { percent: pct, requestId: String(requestId || '') });

    return downloadVideo({
      url, outputPath, format, quality, filenameTemplate, conflictPolicy, embedMetadata, embedThumbnail,
      clipStartSeconds, clipEndSeconds,
      cookiesPath: _store?.get('socialCookiesPath') || '',
    }, onProgress, _caps, _appDir);
  });
}

// ── SUBTITLE ─────────────────────────────────────────────────

function _registerSubtitle() {
  ipcMain.handle('download-subtitle', async (_e, opts) => {
    _requireLicense();
    const { url, outputPath } = opts;
    if (!url || !outputPath) throw new Error('url và outputPath là bắt buộc');
    return downloadSubtitle(opts, _caps, _appDir);
  });
}

// ── THUMBNAIL ────────────────────────────────────────────────

function _registerThumbnail() {
  ipcMain.handle('download-thumbnail', async (_e, opts) => {
    _requireLicense();
    if (!isValidYouTubeUrl(opts.url)) throw new Error('URL YouTube không hợp lệ');
    return downloadThumbnail(opts);
  });
}

// ── SYSTEM ───────────────────────────────────────────────────

function _registerSystem() {
  ipcMain.handle('select-download-folder', async () => {
    const res = await dialog.showOpenDialog(_mainWindow, {
      properties: ['openDirectory'],
      title: 'Chọn thư mục lưu',
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('select-cookie-file', async () => {
    const res = await dialog.showOpenDialog(_mainWindow, {
      properties: ['openFile'],
      title: 'Chọn file cookies.txt',
      filters: [
        { name: 'Cookies', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('open-folder', async (_e, folderPath) => {
    await shell.openPath(folderPath);
    return { success: true };
  });

  ipcMain.handle('open-path', async (_e, targetPath) => {
    await shell.openPath(targetPath);
    return { success: true };
  });

  ipcMain.handle('show-item-in-folder', async (_e, targetPath) => {
    shell.showItemInFolder(targetPath);
    return { success: true };
  });

  ipcMain.handle('copy-text', (_e, text) => {
    clipboard.writeText(String(text || ''));
    return { success: true };
  });
  ipcMain.handle('read-clipboard-text', () => clipboard.readText());
  ipcMain.handle('get-app-info', () => ({
    version: app.getVersion(),
    name: app.getName(),
    packaged: app.isPackaged,
    capabilities: { ..._caps },
  }));
  ipcMain.handle('check-disk-space', async (_e, folderPath) => {
    const target = String(folderPath || '').trim();
    if (!target) return { success: false, error: 'Thiếu thư mục cần kiểm tra.' };
    const stats = await fs.statfs(target);
    return {
      success: true,
      freeBytes: Number(stats.bavail) * Number(stats.bsize),
      totalBytes: Number(stats.blocks) * Number(stats.bsize),
    };
  });
  ipcMain.handle('open-logs-folder', async () => {
    const logsPath = app.getPath('logs');
    await fs.ensureDir(logsPath);
    await shell.openPath(logsPath);
    return { success: true, path: logsPath };
  });
  ipcMain.handle('clear-private-data', () => {
    ['socialCookiesPath', 'history', 'downloadHistory'].forEach(key => _store.delete(key));
    return { success: true };
  });

  ipcMain.handle('get-system-capabilities', () => ({ ..._caps }));
  ipcMain.handle('get-download-profiles', () => ({ success: true, profiles: getDownloadProfiles(_store) }));
  ipcMain.handle('save-download-profile', (_e, profile) => ({
    success: true,
    profile: saveCustomProfile(_store, profile),
  }));
  ipcMain.handle('delete-download-profile', (_e, profileId) => ({
    success: deleteCustomProfile(_store, profileId),
  }));
  ipcMain.handle('get-persistence-status', () => ({ success: true, persistence: _dlManager?.getPersistenceStatus?.() || null }));
  ipcMain.handle('get-recoverable-session', () => ({
    success: true,
    session: _dlManager?.getRecoverableSessionInfo?.() || { hasRecoverable: false, queued: 0, paused: 0, total: 0, updatedAt: null },
  }));
  ipcMain.handle('resume-pending-session', () => {
    _requireLicense();
    return {
      success: true,
      session: _dlManager?.resumePendingSession?.() || null,
    };
  });
  ipcMain.handle('discard-pending-session', () => ({
    success: true,
    session: _dlManager?.discardPendingSession?.() || null,
  }));

  ipcMain.handle('detect-platform', (_e, url) => {
    const platform = DownloadManager.detectPlatform(url);
    return { success: true, platform };
  });
  ipcMain.handle('get-license-status', () => ({
    success: true,
    licenseStatus: _licenseSvc?.getStatus?.() || null,
  }));
  ipcMain.handle('activate-license', (_e, licenseKey) => {
    const licenseStatus = _licenseSvc?.activate?.(licenseKey) || null;
    if (licenseStatus?.valid) trackActivation(licenseStatus);
    return {
      success: !!licenseStatus?.valid,
      licenseStatus,
      error: licenseStatus?.valid ? null : (licenseStatus?.message || 'Kich hoat that bai'),
    };
  });

  // Kích hoạt online: đổi mã kích hoạt lấy license token từ máy chủ,
  // rồi verify + lưu bằng chính LicenseService (không bỏ qua kiểm chữ ký).
  ipcMain.handle('activate-license-online', async (_e, activationCode) => {
    const machineId = _licenseSvc?.getMachineId?.();
    const issued = await requestOnlineLicense(activationCode, machineId);
    if (!issued.ok) {
      return { success: false, licenseStatus: _licenseSvc?.getStatus?.() || null, error: issued.error };
    }

    const licenseStatus = _licenseSvc?.activate?.(issued.token) || null;
    if (licenseStatus?.valid) trackActivation(licenseStatus);
    return {
      success: !!licenseStatus?.valid,
      licenseStatus,
      error: licenseStatus?.valid ? null : (licenseStatus?.message || 'License nhan tu may chu khong hop le'),
    };
  });
  ipcMain.handle('clear-license', () => ({
    success: true,
    licenseStatus: _licenseSvc?.clear?.() || null,
  }));
  ipcMain.handle('check-app-update', () => checkAppUpdates());
}

// ── PERSISTENT STORE ─────────────────────────────────────────

function _registerStore() {
  ipcMain.handle('store-get',    (_e, key)        => _store.get(key));
  ipcMain.handle('store-set',    (_e, key, value) => { _store.set(key, value); return true; });
  ipcMain.handle('store-delete', (_e, key)        => { _store.delete(key); return true; });
}

// ── DOWNLOAD MANAGER ─────────────────────────────────────────

function _registerDownloadManager() {
  ipcMain.handle('add-to-queue', (_e, info) => {
    _requireLicense();
    if (!_dlManager) throw new Error('Download Manager not ready');
    if (!info.platform) info.platform = DownloadManager.detectPlatform(info.url);
    return { success: true, downloadId: _dlManager.addToQueue(info) };
  });

  ipcMain.handle('pause-download',    async (_e, id) => ({ success: await (_dlManager?.pauseDownload(id) ?? false) }));
  ipcMain.handle('resume-download',   (_e, id) => { _requireLicense(); return { success: _dlManager?.resumeDownload(id) ?? false }; });
  ipcMain.handle('retry-download',    (_e, id) => { _requireLicense(); return { success: _dlManager?.retryDownload(id)  ?? false }; });
  ipcMain.handle('cancel-download',   async (_e, id) => ({ success: await (_dlManager?.cancelDownload(id) ?? false) }));
  ipcMain.handle('get-download-status',(_e,id) => ({ success: true, status: _dlManager?.getDownloadStatus(id) ?? null }));
  ipcMain.handle('get-all-downloads',  ()      => ({ success: true, downloads: _dlManager?.getAllDownloads() ?? {} }));
  ipcMain.handle('set-max-parallel',  (_e, n)  => { _dlManager?.setMaxParallelDownloads(n); return { success: true }; });
  ipcMain.handle('clear-completed',   ()       => { _dlManager?.clearCompleted(); return { success: true }; });
  ipcMain.handle('clear-failed',      ()       => { _dlManager?.clearFailed();    return { success: true }; });
  ipcMain.handle('pause-all-downloads', async () => ({ success: true, count: await (_dlManager?.pauseAllDownloads?.() || 0) }));
  ipcMain.handle('resume-all-downloads', () => ({ success: true, count: _dlManager?.resumeAllDownloads?.() || 0 }));
  ipcMain.handle('prioritize-download', (_e, id) => ({ success: _dlManager?.prioritizeDownload?.(id) || false }));
  ipcMain.handle('reorder-download', (_e, id, beforeId) => ({
    success: _dlManager?.reorderDownload?.(id, beforeId) || false,
  }));
}

// ── BATCH ────────────────────────────────────────────────────

function _registerBatch() {

  ipcMain.handle('scan-channel-videos', async (_e, opts) => {
    _requireLicense();
    const { url, maxVideos = 10 } = opts;
    const result = await scanChannelVideos({
      url,
      maxVideos,
      caps: _caps,
      appDir: _appDir,
      mockBatch: _mockBatch,
      onError: error => {
        recordYtDlpError('scan-channel-videos', error);
        console.log('⚠️  Batch scan failed:', error.message);
      },
    });

    if (result?.partial) {
      console.log('Batch scan returned partial recovery result');
    }

    return result;
  });

  ipcMain.handle('select-media-file', async () => {
    const res = await dialog.showOpenDialog(_mainWindow, {
      properties: ['openFile'],
      title: 'Chọn video hoặc audio',
      filters: [{ name: 'Video và audio', extensions: ['mp4', 'mkv', 'webm', 'mov', 'avi', 'mp3', 'wav', 'flac', 'm4a'] }],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('ai-separation-status', async (_event, modelFolder) => audioSeparation.getStatus(app.getPath('userData'), modelFolder));
  ipcMain.handle('ai-scan-models', async (_event, modelFolder) => audioSeparation.scanModels(modelFolder));
  ipcMain.handle('ai-install-engine', async event => audioSeparation.installEngine(app.getPath('userData'), message => {
    if (!event.sender.isDestroyed()) event.sender.send('ai-separation-progress', { phase: 'setup', message });
  }));
  ipcMain.handle('ai-separate', async (event, options) => {
    _requireLicense();
    return audioSeparation.separate(app.getPath('userData'), { ...options, ffmpegDir: _appDir }, message => {
      if (!event.sender.isDestroyed()) event.sender.send('ai-separation-progress', { phase: 'separate', message });
    });
  });
  ipcMain.handle('ai-separation-cancel', () => ({ success: audioSeparation.cancel() }));
  ipcMain.handle('show-system-notification', (_event, payload = {}) => {
    if (!Notification.isSupported()) return { success: false };
    new Notification({
      title: String(payload.title || 'Andrew Downloader').slice(0, 100),
      body: String(payload.body || '').slice(0, 220),
      icon: path.join(_appDir, 'assets', 'icon.ico'),
    }).show();
    return { success: true };
  });

  ipcMain.handle('scan-archive-source', async (_event, opts = {}) => {
    _requireLicense();
    const url = String(opts.url || '').trim();
    const maxVideos = Math.max(1, Math.min(Number(opts.maxVideos) || 100, 1000));
    if (!url) throw new Error('URL nguồn không được để trống.');

    if (/(^|\.)facebook\.com$/i.test(new URL(url).hostname)) {
      const result = await scanFacebookPageReels({
        url,
        maxVideos,
        timeoutMs: 180000,
        waitAfterLoadMs: 2200,
        scrollPauseMs: 1100,
      });
      return { success: true, videos: result?.videos || [], totalFound: result?.videos?.length || 0 };
    }

    return scanChannelVideos({
      url,
      maxVideos,
      caps: _caps,
      appDir: _appDir,
      mockBatch: _mockBatch,
      onError: error => recordYtDlpError('scan-archive-source', error),
    });
  });

  ipcMain.handle('archive-paths-exist', async (_event, paths = []) => {
    const unique = [...new Set((Array.isArray(paths) ? paths : []).map(value => String(value || '').trim()).filter(Boolean))].slice(0, 2000);
    const entries = await Promise.all(unique.map(async filePath => [filePath, await fs.pathExists(filePath)]));
    return Object.fromEntries(entries);
  });

  ipcMain.handle('archive-find-existing', async (_event, payload = {}) => {
    const folder = String(payload.folder || '').trim();
    const videos = (Array.isArray(payload.videos) ? payload.videos : []).map(video => ({
      videoId: String(video?.videoId || '').trim(),
      title: String(video?.title || ''),
      duration: Number(video?.duration) || 0,
    })).filter(video => video.videoId).slice(0, 2000);
    const videoIds = videos.length
      ? videos.map(video => video.videoId)
      : [...new Set((Array.isArray(payload.videoIds) ? payload.videoIds : []).map(value => String(value || '').trim()).filter(Boolean))].slice(0, 2000);
    if (!folder || !(await fs.pathExists(folder))) return {};
    const files = [];
    const pending = [folder];
    while (pending.length && files.length < 20000) {
      const current = pending.shift();
      let entries = [];
      try { entries = await fs.readdir(current, { withFileTypes: true }); } catch (_) { continue; }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(fullPath);
        else if (entry.isFile() && ARCHIVE_VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          const stat = await fs.stat(fullPath).catch(() => null);
          if (stat?.size > 1024 * 1024) files.push({ name: entry.name, path: fullPath, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) });
        }
        if (files.length >= 20000) break;
      }
    }
    const indexPath = path.join(folder, ARCHIVE_INDEX_FILE);
    const oldIndex = await fs.readJson(indexPath).catch(() => ({ files: {} }));
    const nextIndex = { version: 1, updatedAt: new Date().toISOString(), files: {} };
    const ffmpegPath = getExecutablePath('ffmpeg', _appDir);
    let cursor = 0;
    async function probeWorker() {
      while (cursor < files.length) {
        const file = files[cursor++];
        const cached = oldIndex?.files?.[file.path];
        const metadata = cached?.size === file.size && cached?.mtimeMs === file.mtimeMs
          ? cached
          : (ffmpegPath ? await _probeArchiveFile(ffmpegPath, file.path) : { videoId: '', title: file.name, duration: 0 });
        nextIndex.files[file.path] = { ...metadata, size: file.size, mtimeMs: file.mtimeMs };
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, files.length) }, () => probeWorker()));
    await fs.writeJson(indexPath, nextIndex, { spaces: 2 }).catch(() => {});

    const result = {};
    const usedPaths = new Set();
    for (const videoId of videoIds) {
      const direct = files.find(file => file.name.includes(`[${videoId}]`) || file.name.includes(videoId)
        || nextIndex.files[file.path]?.videoId === videoId);
      if (direct && !usedPaths.has(direct.path)) { result[videoId] = direct.path; usedPaths.add(direct.path); continue; }
      const video = videos.find(item => item.videoId === videoId);
      if (!video) continue;
      let best = null;
      for (const file of files) {
        if (usedPaths.has(file.path)) continue;
        const metadata = nextIndex.files[file.path] || {};
        const similarity = Math.max(_titleSimilarity(file.name, video.title), _titleSimilarity(metadata.title, video.title));
        const durationOk = !video.duration || !metadata.duration || Math.abs(video.duration - metadata.duration) <= 5;
        if (durationOk && similarity >= 0.72 && (!best || similarity > best.similarity)) best = { path: file.path, similarity };
      }
      if (best) { result[videoId] = best.path; usedPaths.add(best.path); continue; }
      if (video.duration) {
        const durationMatches = files.filter(file => !usedPaths.has(file.path)
          && nextIndex.files[file.path]?.duration
          && Math.abs(video.duration - nextIndex.files[file.path].duration) <= 2);
        if (durationMatches.length === 1) {
          result[videoId] = durationMatches[0].path;
          usedPaths.add(durationMatches[0].path);
        }
      }
    }
    return result;
  });
}

function _stopActiveFacebookScan(reason = 'replaced') {
  if (!_activeFacebookScanCancel) return false;
  _activeFacebookScanCancel(reason);
  _activeFacebookScanCancel = null;
  return true;
}

function _registerFacebookScanner() {
  ipcMain.handle('get-facebook-login-status', _getFacebookLoginStatus);
  ipcMain.handle('open-facebook-login', async () => {
    if (_facebookLoginWindow && !_facebookLoginWindow.isDestroyed()) {
      _facebookLoginWindow.show();
      _facebookLoginWindow.focus();
      return { success: true, ...(await _getFacebookLoginStatus()) };
    }

    const loginWindow = new BrowserWindow({
      width: 1100,
      height: 820,
      show: true,
      title: 'Facebook — Andrew Downloader',
      webPreferences: {
        partition: FACEBOOK_PARTITION,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    _facebookLoginWindow = loginWindow;
    const facebookSession = session.fromPartition(FACEBOOK_PARTITION);
    let settled = false;
    let finishLogin;

    const completion = new Promise(resolve => {
      const onCookieChanged = (_event, cookie, _cause, removed) => {
        if (removed || cookie?.name !== 'c_user' || !cookie?.value) return;
        if (!/(^|\.)facebook\.com$/i.test(cookie.domain || '')) return;
        setTimeout(() => finishLogin(true), 250);
      };

      finishLogin = async closeWindow => {
        if (settled) return;
        settled = true;
        facebookSession.cookies.removeListener('changed', onCookieChanged);
        const status = await _getFacebookLoginStatus();
        if (closeWindow && !loginWindow.isDestroyed()) loginWindow.close();
        if (_facebookLoginWindow === loginWindow) _facebookLoginWindow = null;
        resolve({ success: true, ...status });
      };

      facebookSession.cookies.on('changed', onCookieChanged);
      loginWindow.once('closed', () => finishLogin(false));
    });

    try {
      await loginWindow.loadURL('https://www.facebook.com/login');
      const currentStatus = await _getFacebookLoginStatus();
      if (currentStatus.loggedIn) setTimeout(() => finishLogin(true), 250);
    } catch (_) {
      await finishLogin(true);
    }
    return completion;
  });
  ipcMain.handle('get-default-download-folder', () => app.getPath('downloads'));
  ipcMain.handle('open-browser-extension-folder', async () => {
    const extensionPath = require('path').join(_appDir, 'browser-extension');
    if (!(await fs.pathExists(extensionPath))) {
      return { success: false, error: 'Không tìm thấy thư mục tiện ích trình duyệt.' };
    }
    await shell.openPath(extensionPath);
    return { success: true, path: extensionPath };
  });
  ipcMain.handle('scan-facebook-page', async (_event, payload = {}) => {
    _requireLicense();
    _stopActiveFacebookScan('replaced');

    try {
      const rawUrl = typeof payload === 'string' ? payload : payload.pageUrl;
      const maxVideos = Number(typeof payload === 'string' ? 20 : payload.maxVideos) || 20;
      const pageUrl = String(rawUrl || '').trim();
      const hiddenWindows = new Set();
      let cancelled = false;
      _activeFacebookScanCancel = () => {
        cancelled = true;
        for (const win of hiddenWindows) if (!win.isDestroyed()) win.destroy();
      };
      const startedAt = Date.now();
      const result = await scanFacebookPageReels({
        url: pageUrl,
        maxVideos,
        timeoutMs: 180000,
        waitAfterLoadMs: 2200,
        scrollPauseMs: 1100,
        onHiddenWindowCreated(win) {
          hiddenWindows.add(win);
          win.once('closed', () => hiddenWindows.delete(win));
        },
        onProgress(items) {
          if (cancelled || _event.sender.isDestroyed()) return;
          _event.sender.send('facebook-uids-discovered', items.filter(item => item.videoId));
          _event.sender.send('facebook-scan-status', {
            state: 'scroll',
            found: items.length,
            limit: maxVideos,
            elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
          });
        },
      });
      if (!cancelled && !_event.sender.isDestroyed()) {
        _event.sender.send('facebook-uids-discovered', result.videos.filter(item => item.videoId));
        _event.sender.send('facebook-scan-status', {
          state: 'stopped',
          reason: result.videos.length >= maxVideos ? 'limit-reached' : 'completed',
          found: result.videos.length,
          limit: maxVideos,
          elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
        });
      }
      _activeFacebookScanCancel = null;
      return { success: true };
    } catch (error) {
      _activeFacebookScanCancel = null;
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('scan-facebook-cancel', async () => ({
    cancelled: _stopActiveFacebookScan('cancelled'),
  }));
}

function _registerUpdater() {
  ipcMain.handle('check-ytdlp-update', async () => {
    try { return await checkUpdate(_appDir); }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('download-ytdlp-update', async () => {
    try {
      return await downloadUpdate(_appDir, (pct, dl, total) => {
        _mainWindow?.webContents.send('ytdlp-update-progress', { percent: pct, downloaded: dl, totalSize: total });
      });
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

// ── PRIVATE UTILS ────────────────────────────────────────────

async function _runManagedDownload(event, info) {
  const id = _dlManager.addToQueue(info);

  const progressForwarder = payload => {
    if (payload?.id !== id) return;
    event.sender.send('download-progress', {
      percent: payload.progress || 0,
      requestId: String(info.requestId || ''),
      downloadedBytes: payload.downloadedBytes || 0,
      totalBytes: payload.totalBytes || 0,
      downloadSpeed: payload.downloadSpeed || 0,
      peers: payload.peers || 0,
      fileCount: payload.fileCount || 0,
    });
  };

  _dlManager.on('download-progress', progressForwarder);

  try {
    const status = await _dlManager.waitForCompletion(id);
    return {
      success: true,
      filePath: status.outputFile || status.outputPath,
      outputPath: status.outputPath,
      fileCount: status.fileCount || 0,
    };
  } finally {
    _dlManager.removeListener('download-progress', progressForwarder);
  }
}

async function _mockBatch(maxVideos) {
  await new Promise(r => setTimeout(r, 1500));
  const videos = Array.from({ length: Math.min(maxVideos, 15) }, (_, i) => ({
    title:     `Demo Video ${i + 1}`,
    url:       'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    videoId:   `demo_${i + 1}`,
    author:    'Demo Channel',
    duration:  Math.floor(Math.random() * 600) + 60,
    views:     Math.floor(Math.random() * 1e6),
    thumbnail: `https://picsum.photos/320/180?random=${i}`,
    maxQuality: 720,
  }));
  return { success: true, videos, totalFound: videos.length };
}

function setMainWindow(win) { _mainWindow = win; }
function updateCaps(newCaps) { Object.assign(_caps, newCaps); }

module.exports = { registerAll, setMainWindow, updateCaps };
