'use strict';

const { buildClipArgs, buildSocialMethods, resolveOutputTemplate, trySocialDownload } = require('./shared');

async function downloadTikTok(download, context) {
  const outputTemplate = resolveOutputTemplate(download);
  const mobileAppInfo = '7324387654321098765/trill/34.1.2/2023401020/1180';

  const methods = [
    {
      name: 'TikTok mobile API (no cookies)',
      args: [
        '--print', 'after_move:filepath',
        '--extractor-args', `tiktok:app_info=${mobileAppInfo}`,
        '--output', outputTemplate,
        '--no-check-certificates',
        ...buildClipArgs(download),
        download.url,
      ],
    },
    ...buildSocialMethods([
      '--output', outputTemplate,
      '--no-playlist',
      '--no-check-certificates',
      '--referer', 'https://www.tiktok.com/',
      '--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1',
      ...buildClipArgs(download),
      download.url,
    ], context),
  ];

  return trySocialDownload(download, 'TikTok', methods, context, {
    mediaPatterns: [
      /video not available/i,
      /status code 0/i,
      /format is not available/i,
    ],
  });
}

module.exports = { downloadTikTok };
