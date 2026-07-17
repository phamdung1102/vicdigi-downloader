'use strict';

const CUSTOM_PROFILES_KEY = 'downloadProfiles.custom';

const DEFAULT_PROFILES = [
  {
    id: 'balanced-1080',
    name: 'Balanced 1080p',
    description: 'Preset \u006d\u1eb7c \u0111\u1ecbnh cho video \u0111\u01a1n v\u00e0 batch 1080p.',
    single: {
      videoFormat: 'mp4',
      videoQuality: '1080p',
      subtitleLang: 'auto',
      subtitleFormat: 'both',
    },
    batch: {
      maxVideos: 10,
      batchFormat: 'mp4',
      batchQuality: '1080p',
      batchSubs: 'no',
    },
  },
  {
    id: 'audio-archive',
    name: 'Audio Archive',
    description: '\u01afu ti\u00ean MP3 v\u00e0 ph\u1ee5 \u0111\u1ec1 TXT \u0111\u1ec3 l\u01b0u n\u1ed9i dung nh\u1eb9.',
    single: {
      videoFormat: 'mp3',
      videoQuality: 'best',
      subtitleLang: 'auto',
      subtitleFormat: 'txt',
    },
    batch: {
      maxVideos: 20,
      batchFormat: 'mp3',
      batchQuality: 'best',
      batchSubs: 'no',
    },
  },
  {
    id: 'social-fast',
    name: 'Social Fast',
    description: 'Nhanh, g\u1ecdn, ph\u00f9 h\u1ee3p TikTok/Facebook/Instagram.',
    single: {
      videoFormat: 'mp4',
      videoQuality: '720p',
      subtitleLang: 'auto',
      subtitleFormat: 'srt',
    },
    batch: {
      maxVideos: 15,
      batchFormat: 'mp4',
      batchQuality: '720p',
      batchSubs: 'no',
    },
  },
  {
    id: 'subtitle-pack',
    name: 'Subtitle Pack',
    description: 'Video chu\u1ea9n 1080p, \u01b0u ti\u00ean l\u1ea5y \u0111\u1ee7 ph\u1ee5 \u0111\u1ec1 d\u1ec5 x\u1eed l\u00fd.',
    single: {
      videoFormat: 'mp4',
      videoQuality: '1080p',
      subtitleLang: 'auto',
      subtitleFormat: 'both',
    },
    batch: {
      maxVideos: 10,
      batchFormat: 'mp4',
      batchQuality: '1080p',
      batchSubs: 'yes',
    },
  },
];

function getDownloadProfiles(store) {
  const defaults = DEFAULT_PROFILES.map(profile => materializeProfile(profile));
  const custom = loadCustomProfiles(store);
  return [...defaults, ...custom];
}

function getDownloadProfileById(profileId, store) {
  return getDownloadProfiles(store).find(profile => profile.id === profileId) || null;
}

function saveCustomProfile(store, input) {
  const customProfiles = loadCustomProfiles(store);
  const normalized = normalizeProfileInput(input);
  const profileId = normalized.id && isCustomProfileId(normalized.id)
    ? normalized.id
    : `custom-${slugify(normalized.name || 'profile')}-${Date.now()}`;

  const profile = materializeProfile({
    ...normalized,
    id: profileId,
    isCustom: true,
  });

  const nextProfiles = customProfiles.filter(item => item.id !== profileId);
  nextProfiles.push(profile);
  persistCustomProfiles(store, nextProfiles);
  return profile;
}

function deleteCustomProfile(store, profileId) {
  if (!isCustomProfileId(profileId)) return false;
  const customProfiles = loadCustomProfiles(store);
  const nextProfiles = customProfiles.filter(profile => profile.id !== profileId);
  if (nextProfiles.length === customProfiles.length) return false;
  persistCustomProfiles(store, nextProfiles);
  return true;
}

function isCustomProfileId(profileId = '') {
  return String(profileId).startsWith('custom-');
}

function loadCustomProfiles(store) {
  const raw = store?.get?.(CUSTOM_PROFILES_KEY);
  const source = Array.isArray(raw) ? raw : [];
  return source.map(profile => materializeProfile({ ...profile, isCustom: true }));
}

function persistCustomProfiles(store, profiles) {
  store?.set?.(CUSTOM_PROFILES_KEY, profiles.map(profile => materializeProfile({ ...profile, isCustom: true })));
}

function normalizeProfileInput(input = {}) {
  return {
    id: input.id || '',
    name: String(input.name || '').trim() || 'Custom Profile',
    description: String(input.description || '').trim() || 'Profile t\u00f9y ch\u1ec9nh c\u1ee7a ng\u01b0\u1eddi d\u00f9ng.',
    single: {
      videoFormat: input.single?.videoFormat || 'mp4',
      videoQuality: input.single?.videoQuality || '1080p',
      subtitleLang: input.single?.subtitleLang || 'auto',
      subtitleFormat: input.single?.subtitleFormat || 'both',
    },
    batch: {
      maxVideos: Number(input.batch?.maxVideos || 10),
      batchFormat: input.batch?.batchFormat || 'mp4',
      batchQuality: input.batch?.batchQuality || '1080p',
      batchSubs: input.batch?.batchSubs || 'no',
    },
    isCustom: !!input.isCustom,
  };
}

function materializeProfile(input = {}) {
  const normalized = normalizeProfileInput(input);
  return {
    ...normalized,
    id: normalized.id || slugify(normalized.name || 'profile'),
    isCustom: !!input.isCustom,
  };
}

function slugify(value) {
  return String(value || 'profile')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[-\s]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'profile';
}

module.exports = {
  CUSTOM_PROFILES_KEY,
  deleteCustomProfile,
  getDownloadProfileById,
  getDownloadProfiles,
  isCustomProfileId,
  saveCustomProfile,
};
