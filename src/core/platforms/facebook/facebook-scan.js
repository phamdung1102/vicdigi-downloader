'use strict';

const {
  isFacebookCollectionUrl,
  normalizeFacebookUrl,
  scanFacebookPageReels,
} = require('./facebook-page-reels-scanner');

function normalizeScanUrl(rawUrl) {
  const normalized = normalizeFacebookUrl(rawUrl);
  try {
    const parsed = new URL(normalized);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const profileId = parsed.pathname === '/profile.php'
      ? String(parsed.searchParams.get('id') || '').trim()
      : '';

    if (profileId) {
      parsed.pathname = `/${profileId}/reels/`;
      parsed.search = '';
      return parsed.toString();
    }

    if (parts.length === 1 && !['reel', 'watch'].includes(parts[0].toLowerCase())) {
      parsed.pathname = `/${parts[0]}/reels/`;
      parsed.search = '';
      return parsed.toString();
    }

    return parsed.toString();
  } catch (_) {
    return normalized;
  }
}

function buildScanArgs(url, maxVideos) {
  return [
    '--flat-playlist', '--dump-json',
    '--playlist-end', String(maxVideos),
    '--no-warnings',
    normalizeScanUrl(url),
  ];
}

function isCollectionUrl(rawUrl) {
  return isFacebookCollectionUrl(rawUrl);
}

function allowSingleFallback(url) {
  return !isCollectionUrl(url);
}

async function scanChannelVideos(options = {}) {
  const normalizedUrl = normalizeScanUrl(options.url);
  if (!isCollectionUrl(normalizedUrl)) return null;

  return scanFacebookPageReels({
    ...options,
    url: normalizedUrl,
    maxVideos: Number.isFinite(options.maxVideos) ? options.maxVideos : 10,
  });
}

function makeScanError(url, originalError) {
  if (isCollectionUrl(url)) {
    return new Error('Khong quet duoc danh sach reel/video tu Facebook Page nay. Hay thu lai hoac dan link reel/video cu the.');
  }

  const message = originalError?.message || 'Khong quet duoc URL Facebook nay';
  if (/Unsupported URL/i.test(message)) {
    return new Error('URL Facebook nay chua duoc ho tro o che do quet. Hay thu dan link reel/video cu the.');
  }
  return new Error(message);
}

module.exports = {
  allowSingleFallback,
  buildScanArgs,
  isCollectionUrl,
  makeScanError,
  normalizeScanUrl,
  scanChannelVideos,
};
