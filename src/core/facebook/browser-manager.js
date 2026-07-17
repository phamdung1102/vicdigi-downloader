const path = require('node:path');
const { BrowserWindow, session } = require('electron');

async function createHiddenWindow() {
  const partition = 'persist:vic-fb-scanner';
  const scanSession = session.fromPartition(partition);

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, '../../../assets/icon.ico'),
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      images: true,
      webSecurity: true
    }
  });

  win.setMenuBarVisibility(false);
  return win;
}

module.exports = { createHiddenWindow };
