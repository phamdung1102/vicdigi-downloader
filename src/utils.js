// ============================================================
// utils.js — Shared utility functions
// ============================================================
'use strict';

const path = require('path');
const fs   = require('fs-extra');
const { execSync } = require('child_process');

/**
 * Locate an executable by name.
 * Checks bundled paths (dev + prod) first, then falls back to system PATH.
 */
function getExecutablePath(execName, appDir) {
  const candidates = [
    path.join(appDir, `${execName}.exe`),
    path.join(path.dirname(process.execPath), `${execName}.exe`),
    path.join(path.dirname(process.execPath), 'resources', `${execName}.exe`),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  try {
    execSync(`where ${execName}`, { stdio: 'pipe' });
    return execName;
  } catch (_) {
    return null;
  }
}

/** Extract an 11-char YouTube video ID from any YouTube URL format. */
function extractVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  url = url.trim();
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /[?&]v=([a-zA-Z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m && m[1] && m[1].length === 11) return m[1];
  }
  return null;
}

/** Validate whether a URL is a recognisable YouTube URL. */
function isValidYouTubeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  url = url.trim();
  const patterns = [
    /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
    /^(https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /^(https?:\/\/)?(www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  if (patterns.some(re => re.test(url))) return true;
  const id = extractVideoId(url);
  return !!(id && id.length === 11);
}

/** Strip filesystem-unsafe characters from a filename. */
function cleanFilename(filename) {
  return filename.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
}

/** Format seconds -> "H:MM:SS" or "M:SS". */
function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const hrs  = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0)
    return `${hrs}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  return `${mins}:${String(secs).padStart(2,'0')}`;
}

/** Format a large number into K / M / B shorthand. */
function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toLocaleString();
}

/**
 * Compare two version strings like "2024.12.06".
 * Returns true only when latest is strictly newer than current.
 */
function isNewerVersion(latest, current) {
  if (!latest || !current) return false;
  const clean = v => v.replace(/^v/i, '').trim();
  const la = clean(latest);
  const cu = clean(current);
  if (la === cu) return false;
  const toSegs = v => v.split('.').map(n => { const i = parseInt(n, 10); return isNaN(i) ? 0 : i; });
  const l = toSegs(la);
  const c = toSegs(cu);
  const len = Math.max(l.length, c.length);
  for (let i = 0; i < len; i++) {
    const lv = l[i] ?? 0;
    const cv = c[i] ?? 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

module.exports = {
  getExecutablePath,
  extractVideoId,
  isValidYouTubeUrl,
  cleanFilename,
  formatDuration,
  formatNumber,
  isNewerVersion,
};
