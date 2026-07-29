'use strict';

const { buildClipArgs, buildSocialMethods, resolveOutputTemplate, trySocialDownload } = require('./shared');

async function downloadFacebook(download, context) {
  const baseArgs = [
    '--format', 'best[ext=mp4]/best',
    '--output', resolveOutputTemplate(download),
    '--no-check-certificates',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    ...buildClipArgs(download),
    download.url,
  ];

  const methods = buildSocialMethods(baseArgs, context);
  return trySocialDownload(download, 'Facebook', methods, context, {
    authPatterns: [
      /private/i,
      /login/i,
      /cookies/i,
      /authentication/i,
      /requires login/i,
    ],
  });
}

module.exports = { downloadFacebook };
