'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

const {
  createLicensePayload,
  createLicenseToken,
} = require('../../src/core/licensing/license-token');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 860,
    minWidth: 900,
    minHeight: 760,
    autoHideMenuBar: true,
    title: 'VICdigi - Quản lý bản quyền',
    backgroundColor: '#0b1220',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    console.log(`[License Admin L${level}]`, message);
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function registerIpc() {
  ipcMain.handle('license-admin:get-config', () => {
    const privateKeyPath = resolveDefaultPrivateKeyPath();
    return {
      success: true,
      config: {
        defaultPrivateKeyPath: privateKeyPath,
        hasDefaultPrivateKey: !!privateKeyPath,
      },
    };
  });

  ipcMain.handle('license-admin:generate', (_event, input) => {
    const privateKey = readPrivateKey(input?.privateKeyPath);
    const payload = createLicensePayload({
      machineId: input?.machineId,
      customerName: input?.customerName,
      email: input?.email,
      durationMode: input?.durationMode,
      days: input?.days,
      features: ['downloads'],
    });
    const licenseKey = createLicenseToken(payload, privateKey);
    return {
      success: true,
      result: {
        licenseKey,
        payload,
      },
    };
  });

  ipcMain.handle('license-admin:copy', (_event, text) => {
    clipboard.writeText(String(text || ''));
    return { success: true };
  });

  ipcMain.handle('license-admin:save', async (_event, payload) => {
    const machineId = String(payload?.machineId || 'license').replace(/[^\w.-]+/g, '_');
    const mode = payload?.durationMode === 'lifetime' ? 'lifetime' : `${payload?.days || 0}d`;
    const defaultPath = path.join(app.getPath('documents'), `${machineId}-${mode}.license.txt`);
    const response = await dialog.showSaveDialog(mainWindow, {
      title: 'Lưu khóa bản quyền',
      defaultPath,
      filters: [
        { name: 'Tệp văn bản', extensions: ['txt'] },
        { name: 'Tất cả tệp', extensions: ['*'] },
      ],
    });
    if (response.canceled || !response.filePath) return { success: false, cancelled: true };
    fs.writeFileSync(response.filePath, String(payload?.licenseKey || ''), 'utf8');
    return { success: true, filePath: response.filePath };
  });

  ipcMain.handle('license-admin:select-private-key', async () => {
    const response = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn private key PEM',
      properties: ['openFile'],
      filters: [
        { name: 'Tệp PEM', extensions: ['pem'] },
        { name: 'Tất cả tệp', extensions: ['*'] },
      ],
    });
    if (response.canceled || !response.filePaths?.[0]) return { success: false, cancelled: true };
    return {
      success: true,
      filePath: response.filePaths[0],
    };
  });
}

function resolveDefaultPrivateKeyPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'license-private.pem'),
    path.resolve(__dirname, '..', '..', '.local', 'license-private.pem'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function readPrivateKey(privateKeyPath) {
  const resolvedPath = privateKeyPath || resolveDefaultPrivateKeyPath();
  if (!resolvedPath) throw new Error('Không tìm thấy private key mặc định');
  if (!fs.existsSync(resolvedPath)) throw new Error('Private key không tồn tại');
  return fs.readFileSync(resolvedPath, 'utf8');
}
