'use strict';

const path = require('path');
const fs = require('fs-extra');
const { getExecutablePath } = require('./utils');

const state = {
  lastYtDlpError: null,
};

function recordYtDlpError(source, error) {
  if (!error) return;

  state.lastYtDlpError = {
    source,
    message: error.message || String(error),
    stderr: error.stderr || null,
    stdout: error.stdout || null,
    at: new Date().toISOString(),
  };
}

function clearYtDlpError() {
  state.lastYtDlpError = null;
}

function getDiagnostics(appDir, caps = {}) {
  const ytDlpPath = getExecutablePath('yt-dlp', appDir);
  const ffmpegPath = getExecutablePath('ffmpeg', appDir);

  return {
    appDir,
    cwd: process.cwd(),
    execPath: process.execPath,
    nodeVersion: process.version,
    electronVersion: process.versions?.electron || null,
    platform: process.platform,
    packaged: !!process.mainModule,
    capabilities: { ...caps },
    executables: {
      ytDlp: ytDlpPath,
      ffmpeg: ffmpegPath,
    },
    configs: {
      ytDlp: _fileState(path.join(appDir, 'yt-dlp.conf')),
      ytDlp4k: _fileState(path.join(appDir, 'yt-dlp-4k.conf')),
    },
    lastYtDlpError: state.lastYtDlpError,
  };
}

function _fileState(filePath) {
  return {
    path: filePath,
    exists: fs.existsSync(filePath),
  };
}

module.exports = {
  clearYtDlpError,
  getDiagnostics,
  recordYtDlpError,
};
