'use strict';

const { buildSocialMethods, resolveOutputTemplate, trySocialDownload } = require('./shared');

async function downloadInstagram(download, context) {
  const baseArgs = [
    '--format', 'best[ext=mp4]/best',
    '--output', resolveOutputTemplate(download),
    '--no-playlist',
    '--no-check-certificates',
    '--age-limit', '99',
    '--user-agent', 'Instagram 219.0.0.12.117 Android',
    download.url,
  ];

  const methods = buildSocialMethods(baseArgs, context);
  return trySocialDownload(download, 'Instagram', methods, context, {
    authPatterns: [
      /empty media response/i,
      /private/i,
      /login/i,
      /cookies/i,
      /authentication/i,
      /age-?restricted/i,
    ],
  });
}

module.exports = { downloadInstagram };
