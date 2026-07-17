'use strict';

const fs = require('fs-extra');
const path = require('path');

let webTorrentCtorPromise = null;

function getWebTorrentCtor() {
  if (!webTorrentCtorPromise) {
    webTorrentCtorPromise = import('webtorrent')
      .then(mod => mod.default || mod);
  }
  return webTorrentCtorPromise;
}

function isMagnetUri(source = '') {
  return /^magnet:\?/i.test(String(source || '').trim());
}

function isTorrentLikeUrl(source = '') {
  return /^https?:\/\/.+\.torrent(?:[?#].*)?$/i.test(String(source || '').trim());
}

function isLocalTorrentFile(source = '') {
  const candidate = String(source || '').trim();
  return /\.torrent$/i.test(candidate) && fs.existsSync(candidate);
}

function resolveTorrentSource(source = '') {
  const candidate = String(source || '').trim();
  if (!candidate) throw new Error('Thiếu magnet link hoặc file .torrent');
  if (isMagnetUri(candidate)) return candidate;
  if (isTorrentLikeUrl(candidate)) return candidate;
  if (isLocalTorrentFile(candidate)) return path.resolve(candidate);
  throw new Error('Nguồn torrent không hợp lệ. Hãy dùng magnet link hoặc file .torrent');
}

function pickOutputTarget(outputDir, torrent) {
  const files = Array.isArray(torrent?.files) ? torrent.files : [];
  if (files.length === 1) {
    return path.join(outputDir, files[0].path);
  }
  if (torrent?.name) {
    return path.join(outputDir, torrent.name);
  }
  return outputDir;
}

async function destroyClient(client, options = {}) {
  if (!client) return;
  try {
    await new Promise(resolve => {
      client.destroy(options, () => resolve());
    });
  } catch (_) {
    // Ignore cleanup failures during shutdown.
  }
}

async function createTorrentSession({
  source,
  outputPath,
  onMetadata = null,
  onProgress = null,
  onLog = null,
} = {}) {
  const torrentSource = resolveTorrentSource(source);
  const WebTorrent = await getWebTorrentCtor();

  await fs.ensureDir(outputPath);

  const client = new WebTorrent({
    dht: true,
    tracker: true,
    maxConns: 55,
  });

  let torrentRef = null;
  let progressTimer = null;

  const emitLog = message => {
    if (typeof onLog === 'function') onLog(message);
  };

  const startProgressTimer = torrent => {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = setInterval(() => {
      if (!torrent || torrent.done) return;
      if (typeof onProgress !== 'function') return;
      onProgress({
        percent: Math.max(0, Math.min(100, (torrent.progress || 0) * 100)),
        downloadedBytes: torrent.downloaded || 0,
        totalBytes: torrent.length || 0,
        downloadSpeed: torrent.downloadSpeed || client.downloadSpeed || 0,
        peers: torrent.numPeers || 0,
        fileCount: Array.isArray(torrent.files) ? torrent.files.length : 0,
      });
    }, 500);
  };

  const stopProgressTimer = () => {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  };

  const ready = new Promise((resolve, reject) => {
    let settled = false;

    const finishResolve = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const finishReject = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    client.once('error', finishReject);

    client.add(torrentSource, { path: outputPath }, torrent => {
      torrentRef = torrent;
      emitLog(`Torrent metadata ready: ${torrent.name || torrent.infoHash}`);
      if (typeof onMetadata === 'function') {
        onMetadata({
          title: torrent.name || 'Torrent download',
          totalBytes: torrent.length || 0,
          fileCount: Array.isArray(torrent.files) ? torrent.files.length : 0,
          infoHash: torrent.infoHash || '',
        });
      }

      torrent.on('error', finishReject);
      startProgressTimer(torrent);
      finishResolve(torrent);
    });
  });

  const torrent = await ready;

  const completion = new Promise((resolve, reject) => {
    let settled = false;
    const finishResolve = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const finishReject = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const doneHandler = async () => {
      stopProgressTimer();
      if (typeof onProgress === 'function') {
        onProgress({
          percent: 100,
          downloadedBytes: torrent.downloaded || torrent.length || 0,
          totalBytes: torrent.length || 0,
          downloadSpeed: 0,
          peers: torrent.numPeers || 0,
          fileCount: Array.isArray(torrent.files) ? torrent.files.length : 0,
        });
      }
      finishResolve({
        outputFile: pickOutputTarget(outputPath, torrent),
        outputPath,
        title: torrent.name || 'Torrent download',
        totalBytes: torrent.length || 0,
        fileCount: Array.isArray(torrent.files) ? torrent.files.length : 0,
        infoHash: torrent.infoHash || '',
      });
    };

    torrent.once('done', doneHandler);
    torrent.once('error', finishReject);
    client.once('error', finishReject);
  });

  const close = async (options = {}) => {
    stopProgressTimer();
    await destroyClient(client, options);
  };

  return {
    client,
    torrent,
    completion,
    close,
  };
}

module.exports = {
  createTorrentSession,
  isMagnetUri,
  isTorrentLikeUrl,
  isLocalTorrentFile,
  resolveTorrentSource,
};
