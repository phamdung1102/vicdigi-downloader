'use strict';

function normalizeScanUrl(url) {
  return String(url || '').trim();
}

function buildScanArgs(url, maxVideos) {
  return [
    '--flat-playlist', '--dump-json',
    '--playlist-end', String(maxVideos),
    '--no-warnings',
    normalizeScanUrl(url),
  ];
}

function allowSingleFallback() {
  return true;
}

function makeScanError(_url, originalError) {
  const message = originalError?.message || 'Không quét được URL TikTok này';
  return new Error(message);
}

module.exports = {
  allowSingleFallback,
  buildScanArgs,
  makeScanError,
  normalizeScanUrl,
};
