'use strict';

function detectPlatform(url = '') {
  const raw = String(url || '').trim();
  const source = raw.toLowerCase();
  if (source.includes('youtube.com') || source.includes('youtu.be')) return 'youtube';
  if (source.includes('instagram.com')) return 'instagram';
  if (source.includes('tiktok.com') || source.includes('vm.tiktok.com') || source.includes('vt.tiktok.com')) return 'tiktok';
  if (source.includes('facebook.com') || source.includes('fb.watch')) return 'facebook';
  if (source.includes('twitter.com') || source.includes('x.com')) return 'twitter';
  if (source.includes('vimeo.com')) return 'vimeo';
  return 'unknown';
}

module.exports = { detectPlatform };
