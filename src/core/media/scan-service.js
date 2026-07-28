'use strict';

const { runYtDlp, withCommonArgs } = require('../../ytdlp-client');
const { normalizeMediaTitle } = require('./filename-policy');
const { resolveScanAdapter } = require('../platforms/scan-adapters');

function parsePlaylistDump(stdout, maxVideos = 10) {
  return String(stdout || '')
    .split('\n')
    .filter(Boolean)
    .slice(0, maxVideos)
    .flatMap(line => {
      try {
        const item = JSON.parse(line);
        const videoId = item.id || null;
        const platform = String(item.extractor_key || item.extractor || '').toLowerCase();
        return [{
          title: pickTitle(item, platform),
          url: pickUrl(item, videoId),
          videoId,
          author: item.uploader || item.channel || item.playlist_title || 'Unknown',
          duration: item.duration || 0,
          uploadDate: item.upload_date || item.release_date || '',
          timestamp: item.timestamp || item.release_timestamp || 0,
          views: item.view_count || 0,
          thumbnail: pickThumbnail(item, videoId, platform),
          maxQuality: 720,
        }];
      } catch (_) {
        return [];
      }
    });
}

async function scanChannelVideos(options) {
  const {
    url,
    maxVideos = 10,
    caps,
    appDir,
    onError,
    mockBatch,
  } = options;

  if (!url) throw new Error('URL không hợp lệ');

  const adapter = resolveScanAdapter(url);
  const normalizedUrl = adapter.normalizeScanUrl(url);

  if (typeof adapter.scanChannelVideos === 'function') {
    try {
      const nativeResult = await adapter.scanChannelVideos({
        ...options,
        url: normalizedUrl,
        maxVideos,
      });
      if (nativeResult) return normalizeNativeScanResult(nativeResult, normalizedUrl);
    } catch (error) {
      onError?.(error);
      throw adapter.makeScanError(normalizedUrl, error);
    }
  }

  if (!caps?.ytdlp) {
    if (typeof mockBatch === 'function') return mockBatch(maxVideos);
    return { success: true, videos: [], totalFound: 0, partial: false };
  }

  const spawnArgs = withCommonArgs(adapter.buildScanArgs(normalizedUrl, maxVideos));

  try {
    const { stdout } = await runYtDlp(spawnArgs, {
      appDir,
      timeoutMs: 60000,
    });

    const videos = parsePlaylistDump(stdout, maxVideos);
    if (!videos.length) {
      const singleFallback = await trySingleUrlBatchFallback(normalizedUrl, { appDir, adapter });
      if (singleFallback) return singleFallback;
    }

    return { success: true, videos, totalFound: videos.length };
  } catch (error) {
    const recovered = parsePlaylistDump(error.stdout, maxVideos);
    if (recovered.length) {
      return { success: true, videos: recovered, totalFound: recovered.length, partial: true };
    }

    const singleFallback = await trySingleUrlBatchFallback(normalizedUrl, { appDir, adapter });
    if (singleFallback) return { ...singleFallback, partial: true };

    onError?.(error);
    throw adapter.makeScanError(normalizedUrl, error);
  }
}

async function trySingleUrlBatchFallback(url, { appDir, adapter } = {}) {
  if (adapter && !adapter.allowSingleFallback(url)) return null;

  try {
    const { stdout } = await runYtDlp(withCommonArgs([
      '--dump-single-json',
      '--no-warnings',
      url,
    ]), {
      appDir,
      timeoutMs: 60000,
    });

    const videos = parsePlaylistDump(stdout, 1);
    if (!videos.length) return null;
    return { success: true, videos, totalFound: videos.length };
  } catch (_) {
    return null;
  }
}

function pickTitle(item, platform) {
  const normalized = normalizeMediaTitle({
    title: item.title || item.fulltitle || item.alt_title,
    description: item.description,
    uploader: item.uploader || item.channel || item.playlist_title,
    platform,
    fallback: '',
  });

  if (normalized) return normalized;
  if (platform.includes('tiktok') && item.id) return `TikTok video #${item.id}`;
  if (item.playlist_title && item.playlist_index) return `${item.playlist_title} #${item.playlist_index}`;
  return item.id || 'Unknown';
}

function normalizeNativeScanResult(result, url = '') {
  if (!result || !Array.isArray(result.videos)) return result;

  const platform = /facebook\.com/i.test(url) || /facebook/i.test(String(result.source || ''))
    ? 'facebook'
    : 'unknown';

  const videos = result.videos.map((video, index) => {
    const normalizedTitle = normalizeMediaTitle({
      title: video.title || '',
      description: video.description || '',
      uploader: video.author || video.uploader || '',
      platform,
      fallback: '',
    });

    return {
      ...video,
      title: normalizedTitle || video.title || `Video ${index + 1}`,
    };
  });

  return {
    ...result,
    videos,
    totalFound: Number.isFinite(result.totalFound) ? result.totalFound : videos.length,
  };
}

function pickUrl(item, videoId) {
  return item.webpage_url ||
    item.original_url ||
    item.url ||
    (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '');
}

function pickThumbnail(item, videoId, platform) {
  if (item.thumbnail) return item.thumbnail;
  if (Array.isArray(item.thumbnails)) {
    const firstThumb = item.thumbnails.find(entry => entry?.url);
    if (firstThumb?.url) return firstThumb.url;
  }
  if (platform.includes('youtube') && videoId) {
    return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
  }
  return '';
}

module.exports = {
  parsePlaylistDump,
  scanChannelVideos,
  trySingleUrlBatchFallback,
};
