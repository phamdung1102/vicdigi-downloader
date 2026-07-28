// ============================================================
// app-updater.js — Auto-update qua GitHub Releases
// Dùng electron-updater: đọc publish config (owner/repo) đã được
// electron-builder ghi vào app-update.yml lúc build.
//
// Luồng: khởi động app (bản packaged) → check GitHub Releases →
// nếu có bản mới thì tải ngầm → hỏi người dùng restart để cài.
// ============================================================
'use strict';

const { app, dialog } = require('electron');

const CHECK_DELAY_MS = 5000;              // đợi app ổn định rồi mới check
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // check lại mỗi 4 giờ khi app mở lâu

let _initialized = false;
let _autoUpdater = null;

/**
 * @param {BrowserWindow} mainWindow  để đẩy trạng thái update xuống renderer
 */
function setupAutoUpdater(mainWindow, isBusy = () => false) {
  if (_initialized) return;
  if (!app.isPackaged) {
    console.log('[app-updater] Dev mode — bỏ qua auto-update.');
    return;
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (error) {
    console.log('[app-updater] electron-updater không khả dụng:', error.message);
    return;
  }

  _initialized = true;
  _autoUpdater = autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const sendStatus = (status, data = {}) => {
    try { mainWindow?.webContents?.send('app-update-status', { status, ...data }); } catch (_) {}
  };

  autoUpdater.on('checking-for-update', () => sendStatus('checking'));
  autoUpdater.on('update-not-available', () => sendStatus('none'));
  autoUpdater.on('error', error => {
    console.log('[app-updater] Lỗi update:', error?.message || error);
    sendStatus('error', { message: error?.message || String(error) });
  });
  autoUpdater.on('update-available', info => {
    console.log('[app-updater] Có bản mới:', info?.version);
    sendStatus('available', { version: info?.version });
  });
  autoUpdater.on('download-progress', progress => {
    sendStatus('downloading', { percent: Math.round(progress?.percent || 0) });
  });

  autoUpdater.on('update-downloaded', async info => {
    sendStatus('downloaded', { version: info?.version });
    while (isBusy()) {
      sendStatus('downloaded-deferred', { version: info?.version });
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Phiên bản VICdigi Downloader mới',
      message: `VICdigi Downloader ${info?.version ? `v${info.version}` : 'phiên bản mới'} đã sẵn sàng.`,
      detail: 'Bản cập nhật ứng dụng đã được tải xong. Khởi động lại để sử dụng các tính năng và cải tiến mới.',
      buttons: ['Cập nhật và khởi động lại', 'Để sau'],
      defaultId: 0,
      cancelId: 1,
    });
    // Cài im lặng và tự mở lại app: người dùng chỉ cần xác nhận một lần.
    if (response === 0) autoUpdater.quitAndInstall(true, true);
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch(error => {
      console.log('[app-updater] checkForUpdates thất bại:', error?.message || error);
    });
  };

  setTimeout(check, CHECK_DELAY_MS);
  setInterval(check, RECHECK_INTERVAL_MS);
}

function checkAppUpdates() {
  if (!_autoUpdater) return Promise.resolve({ success: false, available: false, reason: 'not-packaged' });
  return _autoUpdater.checkForUpdates()
    .then(result => ({ success: true, available: Boolean(result?.updateInfo?.version), version: result?.updateInfo?.version || '' }));
}

module.exports = { setupAutoUpdater, checkAppUpdates };
