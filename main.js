// ============================================================
// main.js — Entry point
// All heavy logic lives in src/*  — keep this file thin.
// ============================================================
'use strict';

const { app, BrowserWindow, Menu, Notification } = require('electron');
const path  = require('path');
const fs    = require('fs-extra');
const Store = require('electron-store');

const caps               = require('./src/capabilities');
const { registerAll }    = require('./src/ipc/register-handlers');
const QueueService       = require('./src/core/jobs/queue-service');
const { setupAutoUpdater } = require('./src/app-updater');

// ── Persistent store (replaces localStorage) ─────────────────
const store = new Store();
const IS_SMOKE_RENDERER = process.argv.includes('--smoke-renderer');

// ── Add app folder to PATH so bundled exes are found ─────────
function _patchPath() {
  const dir = app.isPackaged ? process.resourcesPath : __dirname;
  if (!process.env.PATH.includes(dir))
    process.env.PATH = `${dir}${path.delimiter}${process.env.PATH}`;
}

// ── App dir helper ────────────────────────────────────────────
function appDir() {
  return app.isPackaged ? process.resourcesPath : __dirname;
}

// ── Unhandled rejection safety net ───────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection:', reason);
});

// ── Create BrowserWindow ──────────────────────────────────────
let mainWindow;
let _dlManagerRef = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800,
    minWidth: 880, minHeight: 620,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      sandbox:          false,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon:            path.join(__dirname, 'assets', 'icon.png'),
    titleBarStyle:   'default',
    show:            false,
    title:           `Andrew Downloader v${app.getVersion()}`,
    autoHideMenuBar: true,
  });

  const htmlFile = path.join(__dirname, 'index-v6.html');

  if (fs.existsSync(htmlFile)) {
    console.log('✅ Loading:', path.basename(htmlFile));
    const loadOptions = IS_SMOKE_RENDERER ? { query: { smoke: '1' } } : undefined;
    mainWindow.loadFile(htmlFile, loadOptions);
  } else {
    mainWindow.loadURL('data:text/html,<h1 style="font-family:sans-serif;padding:40px">HTML not found</h1>');
  }

  mainWindow.once('ready-to-show', () => {
    if (!IS_SMOKE_RENDERER) mainWindow.show();
    mainWindow.setMenuBarVisibility(false);
  });

  // Relay renderer console messages
  mainWindow.webContents.on('console-message', (event) => {
    console.log(`[Renderer L${event.level}]`, event.message);
  });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === 'https:' || target.protocol === 'http:') {
        require('electron').shell.openExternal(target.toString());
      }
    } catch (_) {}
    return { action: 'deny' };
  });
}

// ── App lifecycle ─────────────────────────────────────────────
app.whenReady().then(async () => {
  _patchPath();
  Menu.setApplicationMenu(null);

  // 1. Đăng ký IPC handlers TRƯỚC — dùng caps tạm, renderer không bị lỗi "no handler"
  const dlManager = new QueueService({
    store,
    rootDir: __dirname,
    dbPath: path.join(app.getPath('userData'), 'vicdigi-v7.db'),
  });
  _dlManagerRef = dlManager;
  const capsDummy = { ytdlp: false, ffmpeg: false, workingMode: 'demo' };
  registerAll(null, capsDummy, appDir(), store, dlManager);

  // 2. Tạo window
  createWindow();
  _setupDlManagerEvents(dlManager);

  const { setMainWindow, updateCaps } = require('./src/ipc-handlers');
  setMainWindow(mainWindow);

  // 3. Check capabilities song song với window đang load
  const capabilities = await caps.check(appDir());

  // 4. Cập nhật caps vào handlers ngay
  updateCaps(capabilities);

  mainWindow.setTitle(`Andrew Downloader v${app.getVersion()}`);

  // 4b. Auto-update qua GitHub Releases (chỉ chạy với bản packaged)
  if (!IS_SMOKE_RENDERER) {
    setupAutoUpdater(mainWindow, () => {
      const downloads = _dlManagerRef?.getAllDownloads?.() || {};
      return Boolean((downloads.active?.length || 0) + (downloads.queued?.length || 0));
    });
  }

  // 5. Push caps xuống renderer — dù window đã load hay chưa đều ok
  const sendCaps = () => {
    try { mainWindow.webContents.send('capabilities-updated', capabilities); } catch (_) {}
  };

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', sendCaps);
  } else {
    sendCaps(); // window đã load xong trước khi caps.check() return
  }

  if (IS_SMOKE_RENDERER) {
    try {
      const smokeResult = await _runRendererSmoke(mainWindow);
      console.log('✅ Renderer smoke passed:', JSON.stringify(smokeResult));
      app.exit(0);
      return;
    } catch (error) {
      console.error('❌ Renderer smoke failed:', error);
      app.exit(1);
      return;
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Dừng các tác vụ đang chạy và chốt snapshot trước khi thoát
app.on('before-quit', () => {
  try { _dlManagerRef?.shutdown?.(); } catch (_) {}
});

// ── Forward Download Manager events to renderer ───────────────
function _setupDlManagerEvents(dlManager) {
  const eventMap = {
    'download-added':     'download-added',
    'download-started':   'download-started',
    'download-progress':  'download-progress-manager',
    'download-completed': 'download-completed',
    'download-failed':    'download-failed',
    'download-retry':     'download-retry',
    'download-cancelled': 'download-cancelled',
    'download-paused':    'download-paused',
  };

  for (const [emitterEv, ipcChannel] of Object.entries(eventMap)) {
    dlManager.on(emitterEv, data => {
      if (mainWindow?.webContents) mainWindow.webContents.send(ipcChannel, data);
      if (app.isPackaged && Notification.isSupported() && (emitterEv === 'download-completed' || emitterEv === 'download-failed')) {
        const ok = emitterEv === 'download-completed';
        const notification = new Notification({
          title: ok ? 'Tải xuống hoàn tất' : 'Tải xuống chưa thành công',
          body: String(data?.title || data?.url || 'Tác vụ tải xuống').slice(0, 180),
          icon: path.join(__dirname, 'assets', 'icon.ico'),
        });
        notification.on('click', () => {
          if (mainWindow?.isMinimized()) mainWindow.restore();
          mainWindow?.show();
          mainWindow?.focus();
          mainWindow?.webContents?.send('open-download-center', { id: data?.id || '' });
        });
        notification.show();
      }
    });
  }
}

async function _runRendererSmoke(window) {
  await new Promise(resolve => {
    if (!window.webContents.isLoading()) return resolve();
    window.webContents.once('did-finish-load', resolve);
  });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const probe = await window.webContents.executeJavaScript(`
      ({
        booted: window.__VIC_BOOTED === true,
        error: window.__VIC_BOOT_ERROR || null,
        hasShell: !!document.querySelector('.shell'),
        hasUrlInput: !!document.getElementById('urlInput'),
        hasApi: !!window.electronAPI
      })
    `, true);

    if (probe.booted) return probe;
    if (probe.error) throw new Error(probe.error);
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw new Error('Renderer boot timeout after 15s');
}

console.log(`🚀 Andrew Downloader v${app.getVersion()} — main.js loaded`);

