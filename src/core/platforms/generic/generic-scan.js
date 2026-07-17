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

function makeScanError(url, originalError) {
  const message = originalError?.message || 'Không quét được URL này';
  if (/Unsupported URL/i.test(message)) {
    return new Error('URL này chưa được hỗ trợ ở chế độ quét. Hãy thử dán link video cụ thể hoặc danh sách URL trực tiếp.');
  }
  return new Error(message);
}

module.exports = {
  allowSingleFallback,
  buildScanArgs,
  makeScanError,
  normalizeScanUrl,
};
