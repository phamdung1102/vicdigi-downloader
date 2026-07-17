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
  const message = originalError?.message || 'Không quét được URL Instagram này';
  if (/login|private|cookies/i.test(message)) {
    return new Error('Instagram collection này có thể cần đăng nhập hoặc cookies hợp lệ để quét.');
  }
  return new Error(message);
}

module.exports = {
  allowSingleFallback,
  buildScanArgs,
  makeScanError,
  normalizeScanUrl,
};
