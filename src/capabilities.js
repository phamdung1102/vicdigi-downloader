// ============================================================
// capabilities.js - Detect & auto-install yt-dlp / ffmpeg
// ============================================================
'use strict';

const path    = require('path');
const fs      = require('fs-extra');
const axios   = require('axios');
const { execAsync } = require('./exec-helper');
const extractZip    = require('extract-zip');
const { getExecutablePath } = require('./utils');

const state = {
  ytdlp:       false,
  ffmpeg:      false,
  workingMode: 'demo',  // 'full' | 'basic' | 'demo'
};

/** Expose a read-only snapshot of capabilities */
function get() {
  return { ...state };
}

/**
 * Probe yt-dlp and ffmpeg.
 * Falls back to auto-install when binary not found.
 * @param {string} appDir  __dirname (dev) or process.resourcesPath (prod)
 */
async function check(appDir) {
  console.log('[capabilities] Checking system capabilities...');

  // ── yt-dlp ────────────────────────────────────────────────
  const ytPath = getExecutablePath('yt-dlp', appDir);
  if (ytPath) {
    try {
      const { stdout } = await execAsync(`"${ytPath}" --version`, { timeout: 10000 });
      if (stdout) { state.ytdlp = true; console.log('[capabilities] yt-dlp:', stdout.trim()); }
    } catch (e) {
      console.log('[capabilities] bundled yt-dlp test failed:', e.message);
    }
  }

  if (!state.ytdlp) {
    try {
      const { stdout } = await execAsync('yt-dlp --version', { timeout: 8000 });
      if (stdout) { state.ytdlp = true; console.log('[capabilities] yt-dlp in PATH'); }
    } catch (_) {
      await _autoInstallYtDlp(appDir);
    }
  }

  // ── ffmpeg ────────────────────────────────────────────────
  const ffPath = getExecutablePath('ffmpeg', appDir);
  if (ffPath) {
    try {
      const { stdout } = await execAsync(`"${ffPath}" -version`, { timeout: 10000 });
      if (stdout) { state.ffmpeg = true; console.log('[capabilities] ffmpeg found'); }
    } catch (e) {
      console.log('[capabilities] bundled ffmpeg test failed:', e.message);
    }
  }

  if (!state.ffmpeg) {
    try {
      const { stdout } = await execAsync('ffmpeg -version', { timeout: 8000 });
      if (stdout) { state.ffmpeg = true; console.log('[capabilities] ffmpeg in PATH'); }
    } catch (_) {
      await _autoInstallFfmpeg(appDir);
    }
  }

  // ── Determine working mode ─────────────────────────────────
  if (state.ytdlp && state.ffmpeg)  state.workingMode = 'full';
  else if (state.ytdlp)             state.workingMode = 'basic';
  else {
    // Last-resort: local exe in dev folder
    if (fs.existsSync(path.join(appDir, 'yt-dlp.exe'))) {
      state.ytdlp = true;
      state.workingMode = 'basic';
    } else {
      state.workingMode = 'demo';
    }
  }

  console.log(`[capabilities] Mode: ${state.workingMode.toUpperCase()} | yt-dlp:${state.ytdlp} ffmpeg:${state.ffmpeg}`);
  return get();
}

// ── Private helpers ────────────────────────────────────────

async function _autoInstallYtDlp(appDir) {
  try {
    console.log('[capabilities] Auto-installing yt-dlp...');
    const dest = path.join(appDir, 'yt-dlp.exe');
    const res  = await axios({ method: 'GET', responseType: 'stream', timeout: 60000,
      url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' });
    await _streamToFile(res.data, dest);
    const { stdout } = await execAsync(`"${dest}" --version`, { timeout: 10000 });
    if (stdout) { state.ytdlp = true; console.log('[capabilities] yt-dlp auto-installed:', stdout.trim()); }
  } catch (e) {
    console.log('[capabilities] yt-dlp auto-install failed:', e.message);
  }
}

async function _autoInstallFfmpeg(appDir) {
  const zipPath    = path.join(appDir, 'ffmpeg_tmp.zip');
  const extractDir = path.join(appDir, 'ffmpeg_extracted');
  try {
    console.log('[capabilities] Auto-installing ffmpeg...');
    const res = await axios({ method: 'GET', responseType: 'stream', timeout: 180000,
      url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' });
    await _streamToFile(res.data, zipPath);
    await fs.ensureDir(extractDir);
    await extractZip(zipPath, { dir: extractDir });

    const found = _findFile(extractDir, 'ffmpeg.exe');
    if (found) {
      await fs.copy(found, path.join(appDir, 'ffmpeg.exe'), { overwrite: true });
      state.ffmpeg = true;
      console.log('[capabilities] ffmpeg auto-installed');
    }
  } catch (e) {
    console.log('[capabilities] ffmpeg auto-install failed:', e.message);
  } finally {
    await fs.remove(zipPath).catch(() => {});
    await fs.remove(extractDir).catch(() => {});
  }
}

function _streamToFile(stream, dest) {
  return new Promise((resolve, reject) => {
    const w = fs.createWriteStream(dest);
    stream.pipe(w);
    w.on('finish', resolve);
    w.on('error', reject);
  });
}

function _findFile(dir, name) {
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { const f = _findFile(full, name); if (f) return f; }
      else if (e.name.toLowerCase() === name.toLowerCase()) return full;
    }
  } catch (_) {}
  return null;
}

module.exports = { check, get };
