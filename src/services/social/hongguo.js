'use strict';

const { buildSocialMethods, resolveOutputTemplate, trySocialDownload } = require('./shared');

const MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

/**
 * Download media exposed by a public Hongguo share page.
 *
 * Hongguo currently has no dedicated yt-dlp extractor. The generic extractor
 * can still handle public HTML5 video, MP4/HLS, or playlist pages.
 * Protected/DRM streams are deliberately not bypassed.
 */
async function downloadHongguo(download, context) {
  const mediaPageUrl = resolvePublicPlayerUrl(download.url);
  const outputTemplate = resolveOutputTemplate(download);
  const baseArgs = [
    '--format', 'bestvideo+bestaudio/best',
    '--merge-output-format', 'mp4',
    '--output', outputTemplate,
    '--yes-playlist',
    '--newline',
    '--no-check-certificates',
    '--referer', mediaPageUrl,
    '--user-agent', MOBILE_USER_AGENT,
    mediaPageUrl,
  ];

  const methods = buildSocialMethods(baseArgs, context, {
    includeNoCookies: true,
    browsers: ['edge', 'chrome'],
  });

  return trySocialDownload(download, 'Hongguo', methods, context, {
    authPatterns: [
      /login/i,
      /cookies/i,
      /authentication/i,
      /sign(?:ature)? required/i,
    ],
    mediaPatterns: [
      /unsupported url/i,
      /no video formats/i,
      /no media links/i,
      /drm/i,
    ],
  });
}

function resolvePublicPlayerUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (/(^|\.)hongguoduanju\.com$/i.test(parsed.hostname) && parsed.pathname === '/detail') {
      const seriesId = parsed.searchParams.get('series_id');
      if (/^\d{10,}$/.test(seriesId || '')) {
        return `${parsed.protocol}//${parsed.host}/player/${seriesId}`;
      }
    }
  } catch (_) {}
  return value;
}

module.exports = { downloadHongguo, resolvePublicPlayerUrl };
