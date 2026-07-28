'use strict';

const https = require('https');

const HONGGUO_HOST = /(^|\.)hongguoduanju\.com$/i;
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

function normalizeScanUrl(rawUrl) {
  const parsed = new URL(String(rawUrl || '').trim());
  if (!HONGGUO_HOST.test(parsed.hostname)) return parsed.toString();

  const pathSeriesId = parsed.pathname.match(/^\/(?:player|detail)\/?(\d{10,})?/i)?.[1];
  const seriesId = parsed.searchParams.get('series_id') || pathSeriesId;
  if (!seriesId && /^\/player\/(\d{10,})/i.test(parsed.pathname)) {
    return `${parsed.origin}/detail?series_id=${parsed.pathname.split('/')[2]}`;
  }
  if (seriesId) return `${parsed.origin}/detail?series_id=${seriesId}`;
  return parsed.toString();
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
  return false;
}

function parseRouterData(html) {
  const match = String(html || '').match(/window\._ROUTER_DATA\s*=\s*([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('Không tìm thấy dữ liệu bộ phim trên trang Hongguo.');
  return JSON.parse(match[1].trim().replace(/;\s*$/, ''));
}

function getText(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': MOBILE_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      timeout: 30000,
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirectsLeft > 0) {
        response.resume();
        return resolve(getText(new URL(response.headers.location, url).toString(), redirectsLeft - 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Hongguo trả về HTTP ${response.statusCode}`));
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    request.on('timeout', () => request.destroy(new Error('Hongguo phản hồi quá lâu.')));
    request.on('error', reject);
  });
}

async function scanChannelVideos(options = {}) {
  const detailUrl = normalizeScanUrl(options.url);
  const html = await getText(detailUrl);
  const routerData = parseRouterData(html);
  const series = routerData?.loaderData?.detail_page?.seriesDetail;
  if (!series) throw new Error('Không đọc được thông tin bộ phim Hongguo.');

  const allVideoIds = Array.isArray(series.vid_list) ? series.vid_list : [];
  const totalEpisodes = Number(series.episode_cnt) || allVideoIds.length;
  const accessibleEpisodes = Math.min(
    Number(series.accessible_episode_cnt) || 0,
    allVideoIds.length,
  );
  const requestedLimit = Math.max(1, Number(options.maxVideos) || accessibleEpisodes);
  const publicIds = allVideoIds.slice(0, Math.min(accessibleEpisodes, requestedLimit));
  const origin = new URL(detailUrl).origin;
  const seriesId = String(series.series_id || new URL(detailUrl).searchParams.get('series_id') || '');
  const seriesName = String(series.series_name || 'Hongguo');

  return {
    success: true,
    source: 'hongguo',
    seriesTitle: seriesName,
    totalFound: totalEpisodes,
    accessibleCount: accessibleEpisodes,
    restrictedCount: Math.max(totalEpisodes - accessibleEpisodes, 0),
    partial: accessibleEpisodes < totalEpisodes,
    videos: publicIds.map((videoId, index) => ({
      title: `${seriesName} - Tập ${String(index + 1).padStart(2, '0')}`,
      url: index === 0
        ? `${origin}/player/${seriesId}`
        : `${origin}/player/${seriesId}/${videoId}`,
      videoId: String(videoId),
      author: 'Hongguo',
      duration: 0,
      views: 0,
      thumbnail: series.series_cover || '',
      maxQuality: 720,
      platform: 'hongguo',
      episodeNumber: index + 1,
    })),
  };
}

function makeScanError(_url, originalError) {
  return new Error(originalError?.message || 'Không quét được bộ phim Hongguo này.');
}

module.exports = {
  allowSingleFallback,
  buildScanArgs,
  makeScanError,
  normalizeScanUrl,
  parseRouterData,
  scanChannelVideos,
};
