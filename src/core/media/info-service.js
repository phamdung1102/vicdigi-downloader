'use strict';

const { extractVideoId, formatDuration, formatNumber } = require('../../utils');
const { normalizeMediaTitle } = require('./filename-policy');
const { runYtDlpJson } = require('../../ytdlp-client');
const { detectPlatform } = require('../platforms/detect-platform');

async function getVideoInfo(url, caps, appDir) {
  if (caps.ytdlp) {
    try { return await getYtDlpInfo(url, appDir); }
    catch (error) {
      console.log('⚠️  yt-dlp info failed, using mock:', error.message);
    }
  }
  return createMockInfo(url);
}

async function getVideoInfoMulti(url, caps, appDir) {
  if (caps.ytdlp) {
    try { return await getYtDlpInfoMulti(url, appDir); }
    catch (error) {
      console.log('⚠️  multi-platform info failed:', error.message);
    }
  }
  return {
    title: 'Video',
    author: 'Unknown',
    duration: 0,
    thumbnail: null,
    platform: 'unknown',
    url,
    description: '',
    formats: [],
  };
}

async function getYtDlpInfo(url, appDir) {
  const info = await runYtDlpJson(url, { appDir, timeoutMs: 30000 });
  const platform = detectPlatform(`${info?.extractor_key || info?.extractor || ''} ${url}`);
  const title = normalizeMediaTitle({
    title: info.title,
    description: info.description,
    uploader: info.uploader || info.channel,
    platform,
    fallback: 'Unknown',
  });

  const formats = (info.formats || [])
    .map(format => ({
      quality: format.height ? `${format.height}p` : format.format_note || 'audio',
      container: format.ext,
      filesize: format.filesize ? `${Math.round(format.filesize / 1024 / 1024)}MB` : '?',
      height: format.height || 0,
      vcodec: format.vcodec || 'unknown',
    }))
    .sort((a, b) => b.height - a.height);

  return {
    title,
    author: info.uploader || info.channel || 'Unknown',
    duration: info.duration || 0,
    durationStr: formatDuration(info.duration),
    thumbnail: info.thumbnail,
    uploadDate: info.upload_date,
    viewCount: info.view_count || 0,
    viewCountStr: formatNumber(info.view_count),
    likeCount: info.like_count || 0,
    description: info.description || '',
    height: info.height || (formats[0]?.height ?? 0),
    formats: formats.slice(0, 6),
    channel: info.channel || info.uploader || 'Unknown',
    channelUrl: info.channel_url || null,
    videoId: info.id || extractVideoId(url),
    webpage_url: info.webpage_url || url,
    platform,
    subtitles: info.subtitles ? Object.keys(info.subtitles) : [],
    autoCaptions: info.automatic_captions ? Object.keys(info.automatic_captions) : [],
    width: info.width || 0,
    previewUrl: info.url || null,
  };
}

async function getYtDlpInfoMulti(url, appDir) {
  const info = await runYtDlpJson(url, { appDir, timeoutMs: 30000 });
  const platform = detectPlatform(`${info?.extractor_key || info?.extractor || ''} ${url}`);

  return {
    title: normalizeMediaTitle({
      title: info.title,
      description: info.description,
      uploader: info.uploader || info.channel || info.creator,
      platform,
      fallback: 'Video',
    }),
    author: info.uploader || info.channel || info.creator || 'Unknown',
    duration: info.duration || 0,
    durationStr: formatDuration(info.duration),
    thumbnail: info.thumbnail || info.thumbnails?.[0]?.url || null,
    uploadDate: info.upload_date,
    viewCount: info.view_count || 0,
    description: info.description || '',
    url,
    webpage_url: info.webpage_url || url,
    platform,
    formats: (info.formats || []).slice(0, 5).map(format => ({
      quality: format.height ? `${format.height}p` : format.format_note || 'audio',
      container: format.ext,
      filesize: format.filesize ? `${Math.round(format.filesize / 1024 / 1024)}MB` : '?',
    })),
    videoId: info.id || extractVideoId(url),
    height: info.height || 0,
    width: info.width || 0,
    subtitles: info.subtitles ? Object.keys(info.subtitles) : [],
    autoCaptions: info.automatic_captions ? Object.keys(info.automatic_captions) : [],
    previewUrl: info.url || null,
  };
}

function createMockInfo(url) {
  const id = extractVideoId(url) || 'demo';
  return {
    title: `Demo Video – ${id}`,
    author: 'Demo Channel',
    duration: 300,
    durationStr: '5:00',
    thumbnail: `https://img.youtube.com/vi/${id}/maxresdefault.jpg`,
    uploadDate: new Date().toISOString(),
    viewCount: Math.floor(Math.random() * 500000),
    description: `Demo video for ${id}`,
    height: 720,
    formats: [
      { quality: '720p', container: 'mp4', filesize: '75MB', height: 720 },
      { quality: '1080p', container: 'mp4', filesize: '150MB', height: 1080 },
    ],
    videoId: id,
    platform: detectPlatform(url),
    subtitles: [],
    autoCaptions: [],
  };
}

module.exports = {
  getVideoInfo,
  getVideoInfoMulti,
  getYtDlpInfo,
  getYtDlpInfoMulti,
  createMockInfo,
};
