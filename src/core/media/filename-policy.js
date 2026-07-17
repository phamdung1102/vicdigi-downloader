'use strict';

function normalizeMediaTitle({ title, description = '', uploader = '', platform = 'unknown', fallback = 'Video' } = {}) {
  const cleanTitle = cleanupText(title);
  const cleanDescription = cleanupText(description);
  const cleanUploader = cleanupText(uploader);
  const platformKey = String(platform || '').toLowerCase();

  if (platformKey.includes('facebook')) {
    return normalizeFacebookTitle(cleanTitle, cleanDescription, cleanUploader, fallback);
  }

  return cleanTitle || cleanDescription || fallback;
}

function sanitizeFilename(name, fallback = 'video') {
  const normalized = cleanupText(name)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();

  return (normalized || fallback).slice(0, 180);
}

function isPlaceholderTitle(title, platform = '') {
  const cleanTitle = cleanupText(title);
  const cleanPlatform = cleanupText(platform).toLowerCase();
  if (!cleanTitle) return false;

  if (/^video \d+$/i.test(cleanTitle)) return true;
  if (/^(?:facebook\s+)?reel(?:\s*#?\d+)?$/i.test(cleanTitle)) return true;
  if (/^(?:facebook\s+)?video(?:\s*#?\d+)?$/i.test(cleanTitle) && cleanPlatform.includes('facebook')) {
    return true;
  }

  return !!cleanPlatform &&
    cleanTitle === `${cleanPlatform}_${cleanTitle.split('_').pop()}` &&
    /^\w+_\d+$/.test(cleanTitle);
}

function normalizeFacebookTitle(title, description, uploader, fallback) {
  const segments = title
    .split(/\s+\|\s+/)
    .map(cleanupText)
    .filter(Boolean);

  const meaningfulSegment = segments.find(segment => !isFacebookStatsSegment(segment) && !isSameText(segment, uploader));
  if (description && meaningfulSegment && isSameText(meaningfulSegment, description)) return description;
  if (description) return description;
  if (meaningfulSegment) return meaningfulSegment;

  const stripped = cleanupText(
    title.replace(/^[^|]*\b(?:views?|reactions?|comments?|shares?)\b[^|]*\|\s*/i, '')
  );
  if (stripped && !isSameText(stripped, uploader)) return stripped;

  return title || uploader || fallback;
}

function isFacebookStatsSegment(value) {
  const cleanValue = cleanupText(value).toLowerCase();
  if (!cleanValue) return false;

  const statsPattern = /^\d+([.,]\d+)?\s*[kmb]?\s*(views?|reactions?|comments?|shares?)(\s*[·|-]\s*\d+([.,]\d+)?\s*[kmb]?\s*(views?|reactions?|comments?|shares?))*$/i;
  if (statsPattern.test(cleanValue)) return true;

  const keywords = ['views', 'view', 'reactions', 'reaction', 'comments', 'comment', 'shares', 'share'];
  return keywords.some(keyword => cleanValue.includes(keyword)) && /\d/.test(cleanValue);
}

function cleanupText(value) {
  return String(value || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+[|·-]\s*$/g, '')
    .trim();
}

function isSameText(a, b) {
  return cleanupText(a).toLowerCase() === cleanupText(b).toLowerCase();
}

module.exports = {
  isPlaceholderTitle,
  normalizeMediaTitle,
  sanitizeFilename,
};
