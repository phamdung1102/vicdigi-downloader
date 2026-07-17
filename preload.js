// ============================================================
// VICdigi Downloader — preload.js
// Chạy trong Node.js context, KHÔNG có window/navigator/document
// Chỉ dùng: contextBridge, ipcRenderer, process
// ============================================================
const { contextBridge, ipcRenderer } = require('electron');

const progressListeners = new Set();

// Helper: bọc ipcRenderer.invoke trong try/catch
function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

// ── EXPOSE API ───────────────────────────────────────────────
contextBridge.exposeInMainWorld('electronAPI', {

  // ── Video info ────────────────────────────────────────────
  getVideoInfo: (url) => invoke('get-video-info', url),
  getVideoInfoMulti: (url) => invoke('get-video-info-multi', url),

  // ── Download ──────────────────────────────────────────────
  selectDownloadFolder: () => invoke('select-download-folder'),
  selectCookieFile: () => invoke('select-cookie-file'),
  selectTorrentFile: () => invoke('select-torrent-file'),
  downloadVideo: (options) => invoke('download-video', options),
  downloadSubtitle: (options) => invoke('download-subtitle', options),
  downloadThumbnail: (options) => invoke('download-thumbnail', options),

  // ── Utility ───────────────────────────────────────────────
  openFolder: (folderPath) => invoke('open-folder', folderPath),
  openPath: (targetPath) => invoke('open-path', targetPath),
  showItemInFolder: (targetPath) => invoke('show-item-in-folder', targetPath),
  copyText: (text) => invoke('copy-text', text),

  // ── System ────────────────────────────────────────────────
  getSystemCapabilities: () => invoke('get-system-capabilities'),
  getDownloadProfiles: () => invoke('get-download-profiles'),
  saveDownloadProfile: (profile) => invoke('save-download-profile', profile),
  deleteDownloadProfile: (profileId) => invoke('delete-download-profile', profileId),
  getPersistenceStatus: () => invoke('get-persistence-status'),
  getRecoverableSession: () => invoke('get-recoverable-session'),
  resumePendingSession: () => invoke('resume-pending-session'),
  discardPendingSession: () => invoke('discard-pending-session'),
  detectPlatform: (url) => invoke('detect-platform', url),
  getLicenseStatus: () => invoke('get-license-status'),
  activateLicense: (licenseKey) => invoke('activate-license', licenseKey),
  clearLicense: () => invoke('clear-license'),

  // ── Persistent Store (thay thế localStorage) ────────────────────────
  storeGet: (key) => invoke('store-get', key),
  storeSet: (key, value) => invoke('store-set', key, value),
  storeDelete: (key) => invoke('store-delete', key),

  // ── yt-dlp update ─────────────────────────────────────────
  checkYtdlpUpdate: () => invoke('check-ytdlp-update'),
  downloadYtdlpUpdate: () => invoke('download-ytdlp-update'),
  onYtdlpUpdateProgress: (callback) => {
    const wrapped = (_event, data) => callback(data);
    ipcRenderer.on('ytdlp-update-progress', wrapped);
    return () => ipcRenderer.removeListener('ytdlp-update-progress', wrapped);
  },

  // ── Download Manager ──────────────────────────────────────
  addToQueue: (info) => invoke('add-to-queue', info),
  pauseDownload: (id) => invoke('pause-download', id),
  resumeDownload: (id) => invoke('resume-download', id),
  retryDownload: (id) => invoke('retry-download', id),
  cancelDownload: (id) => invoke('cancel-download', id),
  getAllDownloads: () => invoke('get-all-downloads'),
  getDownloadStatus: (id) => invoke('get-download-status', id),
  setMaxParallelDownloads: (max) => invoke('set-max-parallel', max),
  clearCompleted: () => invoke('clear-completed'),
  clearFailed: () => invoke('clear-failed'),

  // ── Batch ─────────────────────────────────────────────────
  scanChannelVideos: (options) => invoke('scan-channel-videos', options),
  scanFacebookPage: (options) => invoke('scan-facebook-page', options),
  cancelFacebookScan: () => invoke('scan-facebook-cancel'),
  onFacebookUidsDiscovered: (callback) => {
    const wrapped = (_event, data) => callback(data);
    ipcRenderer.on('facebook-uids-discovered', wrapped);
    return () => ipcRenderer.removeListener('facebook-uids-discovered', wrapped);
  },
  onFacebookScanStatus: (callback) => {
    const wrapped = (_event, data) => callback(data);
    ipcRenderer.on('facebook-scan-status', wrapped);
    return () => ipcRenderer.removeListener('facebook-scan-status', wrapped);
  },

  // ── Events: auto-update app (electron-updater) ─────────────
  onAppUpdateStatus: (callback) => {
    const wrapped = (_event, data) => callback(data);
    ipcRenderer.on('app-update-status', wrapped);
    return () => ipcRenderer.removeListener('app-update-status', wrapped);
  },

  // ── Events: capabilities update (main push khi detect xong) ─
  onCapabilitiesUpdated: (callback) => {
    const wrapped = (_event, data) => callback(data);
    ipcRenderer.on('capabilities-updated', wrapped);
    return () => ipcRenderer.removeListener('capabilities-updated', wrapped);
  },

  // ── Events: download progress ─────────────────────────────
  onDownloadProgress: (callback) => {
    const wrapped = (_event, ...args) => {
      try { callback(...args); } catch (e) { /* ignore */ }
    };
    progressListeners.add(wrapped);
    ipcRenderer.on('download-progress', wrapped);
    return () => {
      ipcRenderer.removeListener('download-progress', wrapped);
      progressListeners.delete(wrapped);
    };
  },

  removeAllProgressListeners: () => {
    progressListeners.forEach(l => ipcRenderer.removeListener('download-progress', l));
    progressListeners.clear();
    ipcRenderer.removeAllListeners('download-progress');
  },

  // ── Events: download manager ──────────────────────────────
  onDownloadAdded:           (cb) => ipcRenderer.on('download-added',            (_e, d) => cb(d)),
  onDownloadStarted:         (cb) => ipcRenderer.on('download-started',           (_e, d) => cb(d)),
  onDownloadProgressManager: (cb) => ipcRenderer.on('download-progress-manager', (_e, d) => cb(d)),
  onDownloadCompleted:       (cb) => ipcRenderer.on('download-completed',         (_e, d) => cb(d)),
  onDownloadFailed:          (cb) => ipcRenderer.on('download-failed',            (_e, d) => cb(d)),
  onDownloadRetry:           (cb) => ipcRenderer.on('download-retry',             (_e, d) => cb(d)),
  onDownloadCancelled:       (cb) => ipcRenderer.on('download-cancelled',         (_e, d) => cb(d)),
  onDownloadPaused:          (cb) => ipcRenderer.on('download-paused',            (_e, d) => cb(d)),

});

// ── Cleanup khi renderer unload ──────────────────────────────
// Dùng ipcRenderer.on('destroy') thay vì window.addEventListener
// vì window chưa tồn tại trong preload context khi đóng gói
process.on('exit', () => {
  try {
    progressListeners.forEach(l => ipcRenderer.removeListener('download-progress', l));
    progressListeners.clear();
  } catch (_) { /* ignore */ }
});

console.log('✅ preload.js loaded — electronAPI exposed');

