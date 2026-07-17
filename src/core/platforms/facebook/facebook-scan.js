'use strict';

const {
  isFacebookCollectionUrl,
  normalizeFacebookUrl,
  scanFacebookPageReels,
} = require('./facebook-page-reels-scanner');

function normalizeScanUrl(rawUrl) {
  return normalizeFacebookUrl(rawUrl);
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
