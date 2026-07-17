'use strict';

const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const { resolveYtDlpPath } = require('../../ytdlp-client');
const { isPlaceholderTitle, normalizeMediaTitle, sanitizeFilename } = require('../../title-utils');

const reservedOutputNames = new Map();

function buildSocialMethods(baseArgs, context, options = {}) {
  const {
    includeNoCookies = true,
    browsers = ['edge', 'chrome', 'firefox'],
  } = options;

  const methods = [];

  if (includeNoCookies) {
    methods.push({ name: 'No cookies (public access)', args: ['--print', 'after_move:filepath', ...baseArgs] });
  }

  browsers.forEach(browser => {
    methods.push({
      name: `${browser[0].toUpperCase()}${browser.slice(1)} browser cookies`,
      args: ['--cookies-from-browser', browser, '--print', 'after_move:filepath', ...baseArgs],
    });
  });

  const cookieFile = resolveCookieFile(context);
  if (cookieFile) {
    methods.push({
      name: `${path.basename(cookieFile)} file`,
      args: ['--cookies', cookieFile, '--print', 'after_move:filepath', ...baseArgs],
    });
  }

  return methods;
}

function resolveOutputTemplate(download) {
  if (download._reservedOutputTemplate) return download._reservedOutputTemplate;

  const normalizedTitle = normalizeMediaTitle({
    title: download.title || '',
    description: download.description || '',
    uploader: download.author || download.uploader || '',
    platform: download.platform || 'unknown',
    fallback: '',
  });
  const preferredTitle = sanitizeFilename(normalizedTitle || download.title || '', '');

  if (preferredTitle && !isPlaceholderTitle(preferredTitle, download.platform)) {
    const reservedBaseName = reserveUniqueBaseName(download.outputPath, preferredTitle);
    download._reservedBaseName = reservedBaseName;
    download._reservedOutputTemplate = path.join(download.outputPath, `${reservedBaseName}.%(ext)s`);
    return download._reservedOutputTemplate;
  }

  download._reservedOutputTemplate = path.join(download.outputPath, '%(id)s.%(ext)s');
  return download._reservedOutputTemplate;
}

async function trySocialDownload(download, platformName, methods, context, patterns = {}) {
  const failures = [];
  let browserCookieLocked = false;
  let authLikelyRequired = false;
  let mediaUnavailable = false;

  const browserCookiePatterns = patterns.browserCookiePatterns || [
    /could not copy .*cookie database/i,
    /could not find firefox cookies database/i,
  ];
  const authPatterns = patterns.authPatterns || [
    /empty media response/i,
    /private/i,
    /login/i,
    /cookies/i,
    /authentication/i,
    /age-?restricted/i,
  ];
  const mediaPatterns = patterns.mediaPatterns || [
    /video not available/i,
    /status code 0/i,
    /format is not available/i,
  ];

  try {
    for (const method of methods) {
      if (!method?.args) continue;

      console.log(`Trying ${platformName} download with: ${method.name}`);

      try {
        await runSocialAttempt(download, platformName, method, context);
        console.log(`${platformName} download successful with ${method.name}`);
        return download;
      } catch (error) {
        const message = error.message || String(error);
        console.log(`${platformName} failed with ${method.name}: ${message}`);
        failures.push({ method: method.name, message });

        if (browserCookiePatterns.some(pattern => pattern.test(message))) browserCookieLocked = true;
        if (authPatterns.some(pattern => pattern.test(message))) authLikelyRequired = true;
        if (mediaPatterns.some(pattern => pattern.test(message))) mediaUnavailable = true;
      }
    }
  } finally {
    releaseReservedBaseName(download);
  }

  const lastMessage = failures.at(-1)?.message || 'Unknown error';
  if (browserCookieLocked) {
    throw new Error(`${platformName}: khong doc duoc cookies tu trinh duyet. Hay dong Chrome/Edge/Firefox roi thu lai, hoac chon cookies.txt trong app.`);
  }
  if (authLikelyRequired) {
    throw new Error(`${platformName}: noi dung co the can dang nhap hoac cookies hop le. Hay thu chon cookies.txt trong app roi tai lai.`);
  }
  if (mediaUnavailable) {
    throw new Error(`${platformName}: yt-dlp hien khong lay duoc media cong khai cho URL nay. Co the video da bi go, bi chan theo vung, hoac extractor upstream dang loi.`);
  }

  throw new Error(`${platformName} failed: ${lastMessage.substring(0, 220)}`);
}

function runSocialAttempt(download, platformName, method, context) {
  const ytdlpPath = resolveYtDlpPath(context.rootDir);

  return new Promise((resolve, reject) => {
    const existingFiles = new Set(safeReadDir(download.outputPath));
    const startedAt = Date.now();
    const process = spawn(ytdlpPath, method.args);
    context.trackActiveProcess(download.id, process);

    let errorOutput = '';

    process.stdout.on('data', data => {
      const output = data.toString();
      console.log(`${platformName} output:`, output);
      context.emitProgress(download, output);

      const destinationMatch = output.match(/\[download\] Destination: (.+)/);
      if (destinationMatch?.[1]) {
        download.outputFile = normalizeOutputPath(destinationMatch[1], download.outputPath);
      }

      const mergeMatch = output.match(/\[Merger\] Merging formats into "(.+)"/);
      if (mergeMatch?.[1]) {
        download.outputFile = normalizeOutputPath(mergeMatch[1], download.outputPath);
      }

      const metadataMatch = output.match(/\[Metadata\] Adding metadata to "(.+)"/);
      if (metadataMatch?.[1]) {
        download.outputFile = normalizeOutputPath(metadataMatch[1], download.outputPath);
      }

      const finalPath = output
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(line => isLikelyFilePath(line));

      if (finalPath) {
        download.outputFile = normalizeOutputPath(finalPath, download.outputPath);
      }
    });

    process.stderr.on('data', data => {
      errorOutput += data.toString();
      console.error(`${platformName} stderr:`, data.toString());
    });

    process.on('close', async code => {
      if (code === 0) {
        const resolvedOutputFile = await resolveCompletedOutputFile(download, existingFiles, startedAt);
        if (!resolvedOutputFile) {
          reject(new Error(`${platformName} did not produce an output file`));
          return;
        }
        download.outputFile = resolvedOutputFile;
        resolve(download);
      } else {
        reject(new Error(errorOutput.trim() || `${platformName} failed with code ${code}`));
      }
    });

    process.on('error', err => {
      reject(new Error(`${platformName} process error: ${err.message}`));
    });
  });
}

function isLikelyFilePath(value) {
  if (!value) return false;
  if (/^\[.*\]/.test(value)) return false;
  return /[\\/].+\.[A-Za-z0-9]{2,5}$/.test(value);
}

function normalizeOutputPath(value, outputPath) {
  const cleaned = String(value || '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/^"+|"+$/g, '')
    .trim();

  if (!cleaned) return '';
  if (path.isAbsolute(cleaned)) return cleaned;
  return path.join(outputPath, cleaned);
}

async function resolveCompletedOutputFile(download, existingFiles, startedAt) {
  if (download.outputFile && await fs.pathExists(download.outputFile)) {
    return download.outputFile;
  }

  const candidates = await findNewMediaFiles(download.outputPath, existingFiles, startedAt);
  if (!candidates.length) return '';

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0].filePath;
}

async function findNewMediaFiles(outputPath, existingFiles, startedAt) {
  const names = safeReadDir(outputPath);
  const results = [];

  for (const name of names) {
    if (existingFiles.has(name)) continue;
    if (!/\.(mp4|mkv|webm|mov|m4v|mp3|m4a|aac)$/i.test(name)) continue;

    const filePath = path.join(outputPath, name);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) continue;
    if (stat.mtimeMs + 1500 < startedAt) continue;

    results.push({ filePath, mtimeMs: stat.mtimeMs });
  }

  return results;
}

function safeReadDir(targetPath) {
  try {
    return fs.readdirSync(targetPath);
  } catch (_) {
    return [];
  }
}

function reserveUniqueBaseName(outputPath, preferredTitle) {
  const key = path.resolve(outputPath);
  const reserved = reservedOutputNames.get(key) || new Set();
  const existingNames = new Set(
    safeReadDir(outputPath)
      .map(name => path.parse(name).name.toLowerCase())
      .filter(Boolean)
  );

  let candidate = preferredTitle;
  let index = 2;

  while (existingNames.has(candidate.toLowerCase()) || reserved.has(candidate.toLowerCase())) {
    candidate = `${preferredTitle} (${index})`;
    index += 1;
  }

  reserved.add(candidate.toLowerCase());
  reservedOutputNames.set(key, reserved);
  return candidate;
}

function releaseReservedBaseName(download) {
  const reservedBaseName = download?._reservedBaseName;
  if (!reservedBaseName || !download?.outputPath) {
    if (download) delete download._reservedOutputTemplate;
    return;
  }

  const key = path.resolve(download.outputPath);
  const reserved = reservedOutputNames.get(key);
  if (reserved) {
    reserved.delete(reservedBaseName.toLowerCase());
    if (!reserved.size) reservedOutputNames.delete(key);
  }

  delete download._reservedBaseName;
  delete download._reservedOutputTemplate;
}

function resolveCookieFile(context) {
  const configuredPath = context.getCookieFile?.();
  if (configuredPath && fs.existsSync(configuredPath)) {
    return configuredPath;
  }

  const fallbackPath = path.join(context.rootDir, 'cookies.txt');
  if (fs.existsSync(fallbackPath)) {
    return fallbackPath;
  }

  return null;
}

module.exports = {
  buildSocialMethods,
  resolveOutputTemplate,
  trySocialDownload,
};
