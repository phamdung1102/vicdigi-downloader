// ============================================================
// ytdlp-updater.js — Check & download yt-dlp updates
// ============================================================
'use strict';

const path   = require('path');
const fs     = require('fs-extra');
const axios  = require('axios');
const { execAsync } = require('./exec-helper');
const { isNewerVersion } = require('./utils');
const { clearYtDlpError, recordYtDlpError } = require('./diagnostics');

const RELEASES_API   = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const DOWNLOAD_URL   = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const HEADERS        = { 'User-Agent': 'VICdigi-Downloader/6.2' };

/**
 * @param {string} appDir  process.resourcesPath (prod) or __dirname (dev)
 */
function getLocalPath(appDir) {
  return path.join(appDir, 'yt-dlp.exe');
}

async function getLocalVersion(appDir) {
  const candidates = [
    getLocalPath(appDir),
    path.join(path.dirname(process.execPath), 'yt-dlp.exe'),
  ].filter(Boolean);

  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const { stdout } = await execAsync(`"${p}" --version`, { timeout: 8000 });
      const v = stdout.trim();
      if (v) return v;
    } catch (_) {}
  }

  // System PATH fallback
  try {
    const { stdout } = await execAsync('yt-dlp --version', { timeout: 8000 });
    const v = stdout.trim();
    if (v) return v;
  } catch (_) {}

  return null;
}

async function getLatestVersion() {
  try {
    const res = await axios.get(RELEASES_API, { timeout: 10000, headers: HEADERS });
    return (res.data.tag_name || '').replace(/^v/, '').trim() || null;
  } catch (e) {
    console.log('⚠️  Could not fetch yt-dlp releases:', e.message);
    recordYtDlpError('checkUpdate', e);
    return null;
  }
}

/**
 * Check for updates. Returns status object sent to renderer.
 */
async function checkUpdate(appDir) {
  const [localVersion, latestVersion] = await Promise.all([
    getLocalVersion(appDir),
    getLatestVersion(),
  ]);

  const isInstalled = localVersion !== null;
  const canCompare  = isInstalled && latestVersion !== null;
  const hasUpdate   = canCompare && isNewerVersion(latestVersion, localVersion);

  return {
    success:       true,
    localVersion:  localVersion  || 'Chưa cài',
    latestVersion: latestVersion || 'Không lấy được',
    hasUpdate,
    upToDate:      canCompare && !hasUpdate,
    isInstalled,
    canCompare,
  };
}

/**
 * Download + install update. Reports progress via onProgress(pct).
 * @param {string}   appDir
 * @param {function} onProgress  (percent, downloaded, total) => void
 */
async function downloadUpdate(appDir, onProgress) {
  const targetPath = getLocalPath(appDir);
  const backupPath = targetPath + '.bak';

  if (fs.existsSync(targetPath)) {
    fs.copyFileSync(targetPath, backupPath);
    console.log('📂 Backed up old yt-dlp');
  }

  try {
    const res = await axios({
      method: 'GET', url: DOWNLOAD_URL, responseType: 'stream',
      timeout: 120000, headers: HEADERS,
    });
    const total = parseInt(res.headers['content-length'] || '0', 10);
    let downloaded = 0;

    await new Promise((resolve, reject) => {
      const w = fs.createWriteStream(targetPath);
      res.data.on('data', chunk => {
        downloaded += chunk.length;
        if (total > 0) onProgress(Math.round((downloaded / total) * 100), downloaded, total);
      });
      res.data.pipe(w);
      w.on('finish', resolve);
      w.on('error', reject);
    });

    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);

    const { stdout } = await execAsync(`"${targetPath}" --version`, { timeout: 10000 });
    const newVer = stdout.trim();
    console.log('✅ yt-dlp updated to', newVer);
    clearYtDlpError();
    return { success: true, newVersion: newVer };

  } catch (e) {
    recordYtDlpError('downloadUpdate', e);
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, targetPath);
      fs.unlinkSync(backupPath);
      console.log('⏪ Restored old yt-dlp from backup');
    }
    throw e;
  }
}

module.exports = { checkUpdate, downloadUpdate, getLocalPath };

