'use strict';

const https = require('https');

const HONGGUO_HOST = /(^|\.)hongguoduanju\.com$/i;
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const CATALOG_CACHE_MS = 15 * 60 * 1000;
let catalogCache = null;
let catalogPromise = null;

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

function extractCatalog(routerData) {
  const page = routerData?.loaderData?.category_page;
  const list = page?.recommendList || page?.categoryData?.recommendList || [];
  return Array.isArray(list) ? list : [];
}

async function fetchCatalog() {
  if (catalogCache && Date.now() - catalogCache.loadedAt < CATALOG_CACHE_MS) {
    return catalogCache.items;
  }
  if (catalogPromise) return catalogPromise;

  catalogPromise = Promise.allSettled([0, 1, 2].map(async sortType => {
    const html = await getText(`https://hongguoduanju.com/category?sort_type=${sortType}`);
    return extractCatalog(parseRouterData(html));
  })).then(results => {
    const unique = new Map();
    results.forEach(result => {
      if (result.status !== 'fulfilled') return;
      result.value.forEach(item => {
        if (item?.series_id && item?.series_name) unique.set(String(item.series_id), item);
      });
    });
    if (!unique.size) throw new Error('Không tải được danh mục phim Hongguo.');
    const items = [...unique.values()];
    catalogCache = { loadedAt: Date.now(), items };
    return items;
  }).finally(() => {
    catalogPromise = null;
  });

  return catalogPromise;
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');
}

async function searchSeries(query, limit = 30) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) throw new Error('Hãy nhập tên phim cần tìm.');

  const catalog = await fetchCatalog();
  const ranked = catalog.flatMap(item => {
    const title = normalizeSearchText(item.series_name);
    const tags = normalizeSearchText((item.tags || []).join(' '));
    let rank = -1;
    if (title === normalizedQuery) rank = 0;
    else if (title.startsWith(normalizedQuery)) rank = 1;
    else if (title.includes(normalizedQuery)) rank = 2;
    else if (tags.includes(normalizedQuery)) rank = 3;
    return rank < 0 ? [] : [{ item, rank }];
  });

  ranked.sort((a, b) =>
    a.rank - b.rank ||
    String(a.item.series_name).length - String(b.item.series_name).length ||
    String(a.item.series_name).localeCompare(String(b.item.series_name), 'zh-CN'));

  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 50);
  return {
    success: true,
    query: String(query).trim(),
    catalogSize: catalog.length,
    totalMatches: ranked.length,
    results: ranked.slice(0, safeLimit).map(({ item }) => ({
      seriesId: String(item.series_id),
      title: String(item.series_name),
      cover: String(item.series_cover || ''),
      intro: String(item.series_intro || ''),
      tags: Array.isArray(item.tags) ? item.tags.slice(0, 6) : [],
      episodeText: String(item.episode_right_text || ''),
      detailUrl: `https://hongguoduanju.com/detail?series_id=${item.series_id}`,
    })),
  };
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
  searchSeries,
  scanChannelVideos,
};
