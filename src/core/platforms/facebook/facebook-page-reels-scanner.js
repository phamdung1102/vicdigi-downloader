'use strict';

const https = require('https');

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const SCAN_TIMEOUT_MS = 15000;
const MAX_FALLBACK_HTML_BYTES = 3 * 1024 * 1024;
// Keep layout resources available: Facebook's virtualized Reels grid only requests
// the next GraphQL page while its real scroll container is laid out correctly.
const BLOCKED_RESOURCE_TYPES = new Set(['media', 'font']);
const BLOCKED_FACEBOOK_TRACKING_HOSTS = [
  'analytics',
  'ads',
  'pixel',
  'tracking',
  'doubleclick',
  'google-analytics',
  'googletagmanager',
];

function createAbortError(message = 'Scan was cancelled') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError(signal.reason?.message || 'Scan was cancelled');
  }
}

function timeoutAfter(ms, controller, message = `Scan timed out after ${ms}ms`) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => {
      if (controller && !controller.signal.aborted) {
        controller.abort(createAbortError(message));
      }
      reject(createAbortError(message));
    }, ms);
    if (controller?.signal) {
      controller.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(createAbortError(controller.signal.reason?.message || 'Scan was cancelled'));
      }, { once: true });
    }
  });
}

async function withScanTimeout(task, options = {}, message) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : SCAN_TIMEOUT_MS;
  const controller = options.abortController || new AbortController();
  const signal = options.signal || controller.signal;
  throwIfAborted(signal);

  if (options.signal && !options.abortController) {
    options.signal.addEventListener('abort', () => {
      if (!controller.signal.aborted) {
        controller.abort(options.signal.reason || createAbortError());
      }
    }, { once: true });
  }

  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = createAbortError(message || `Scan timed out after ${timeoutMs}ms`);
      if (!controller.signal.aborted) {
        controller.abort(error);
      }
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      task({ ...options, signal, abortController: controller }),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeFacebookUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname === 'web.facebook.com' || parsed.hostname === 'm.facebook.com') {
      parsed.hostname = 'www.facebook.com';
    }
    parsed.hash = '';
    parsed.searchParams.delete('__tn__');
    parsed.searchParams.delete('__cft__');
    parsed.searchParams.delete('refsrc');
    return parsed.toString();
  } catch (_) {
    return trimmed;
  }
}

function isFacebookCollectionUrl(rawUrl) {
  try {
    const parsed = new URL(normalizeFacebookUrl(rawUrl));
    if (!/facebook\.com$/i.test(parsed.hostname)) return false;
    if (/^\/[^/]+\/(?:reels|videos)\/?$/i.test(parsed.pathname)) return true;
    if (/^\/profile\.php$/i.test(parsed.pathname)) {
      const sk = String(parsed.searchParams.get('sk') || '').toLowerCase();
      return ['reels', 'videos', 'reels_tab', 'videos_tab'].includes(sk);
    }
    return false;
  } catch (_) {
    return false;
  }
}

function isFacebookPageUrl(rawUrl) {
  try {
    const parsed = new URL(normalizeFacebookUrl(rawUrl));
    if (!/facebook\.com$/i.test(parsed.hostname)) return false;
    if (isFacebookCollectionUrl(parsed.toString())) return true;
    if (/^\/profile\.php$/i.test(parsed.pathname) && parsed.searchParams.get('id')) {
      return true;
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length !== 1) return false;

    const reserved = new Set([
      'reel',
      'watch',
      'videos',
      'login',
      'recover',
      'photo',
      'photos',
      'story.php',
      'groups',
      'events',
      'marketplace',
      'gaming',
      'friends',
      'messages',
      'notifications',
      'share',
    ]);

    return !reserved.has(String(segments[0] || '').toLowerCase());
  } catch (_) {
    return false;
  }
}

function decodeHtmlForMatching(html) {
  return String(html || '')
    .replace(/\\u0025/g, '%')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/');
}

function toAbsoluteFacebookUrl(candidate, baseUrl) {
  const clean = String(candidate || '').trim();
  if (!clean) return '';

  const decoded = decodeHtmlForMatching(clean)
    .replace(/^https:\/\/web\.facebook\.com/i, 'https://www.facebook.com')
    .replace(/^https:\/\/m\.facebook\.com/i, 'https://www.facebook.com');

  try {
    const absolute = new URL(decoded, baseUrl || 'https://www.facebook.com');
    if (!/facebook\.com$/i.test(absolute.hostname)) return '';
    absolute.hostname = 'www.facebook.com';
    absolute.hash = '';
    return absolute.toString();
  } catch (_) {
    return '';
  }
}

function extractVideoId(url) {
  const value = String(url || '');
  if (!value) return '';

  const matchers = [
    /\/(?:reel|videos)\/(\d{6,})(?:[/?#&]|$)/i,
    /[?&](?:v|story_fbid)=(\d{6,})(?:[&#]|$)/i,
  ];

  for (const matcher of matchers) {
    const match = value.match(matcher);
    if (match?.[1]) return match[1];
  }

  return '';
}

function buildFallbackTitle(url) {
  const videoId = extractVideoId(url);
  return videoId ? `Facebook Reel #${videoId}` : 'Facebook Reel';
}

function decodeJsonTextValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`).normalize('NFC');
  } catch (_) {
    return raw
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
      .replace(/\\n/g, ' ')
      .replace(/\\r/g, ' ')
      .replace(/\\t/g, ' ')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .normalize('NFC');
  }
}

function extractVideoTitlesFromText(text) {
  const source = decodeHtmlForMatching(text);
  const titles = new Map();
  const pattern = /"video":\{"id":"(\d{6,})"[\s\S]{0,4000}?"message":\{"text":"((?:\\.|[^"]){5,220})"/g;

  for (const match of source.matchAll(pattern)) {
    const videoId = match?.[1] || '';
    const title = decodeJsonTextValue(match?.[2] || '');
    if (!videoId || !title) continue;
    if (!titles.has(videoId)) {
      titles.set(videoId, title);
    }
  }

  return titles;
}

function collectUrlsFromText(text, baseUrl) {
  const source = decodeHtmlForMatching(text);
  const matches = [];
  const patterns = [
    /https?:\/\/(?:www|web|m)\.facebook\.com\/(?:watch\/?\?v=\d{6,}(?:[^\w]|$)[^\s"'<>]*)/gi,
    /https?:\/\/(?:www|web|m)\.facebook\.com\/(?:reel\/\d{6,}[^\s"'<>]*)/gi,
    /https?:\/\/(?:www|web|m)\.facebook\.com\/[^/\s"'<>?#]+\/videos\/\d{6,}[^\s"'<>]*/gi,
    /\/watch\/?\?v=\d{6,}(?:[^\w]|$)[^\s"'<>]*/gi,
    /\/reel\/\d{6,}[^\s"'<>]*/gi,
    /\/[^/\s"'<>?#]+\/videos\/\d{6,}[^\s"'<>]*/gi,
    /story\.php\?[^\s"'<>]*story_fbid=\d{6,}[^\s"'<>]*/gi,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const absolute = toAbsoluteFacebookUrl(match[0], baseUrl);
      if (absolute) {
        matches.push({
          url: absolute,
          index: typeof match.index === 'number' ? match.index : Number.MAX_SAFE_INTEGER,
        });
      }
    }
  }

  matches.sort((left, right) => left.index - right.index);

  const deduped = new Set();
  const orderedUrls = [];
  for (const match of matches) {
    if (!deduped.has(match.url)) {
      deduped.add(match.url);
      orderedUrls.push(match.url);
    }
  }

  return orderedUrls;
}

function normalizeCandidateUrl(url) {
  try {
    const parsed = new URL(normalizeFacebookUrl(url));
    const videoId = extractVideoId(parsed.toString());
    if (videoId && /\/watch/i.test(parsed.pathname)) {
      return `https://www.facebook.com/watch/?v=${videoId}`;
    }
    if (videoId && /\/reel\//i.test(parsed.pathname)) {
      return `https://www.facebook.com/reel/${videoId}`;
    }
    if (videoId && /\/videos\//i.test(parsed.pathname)) {
      const pageSegment = parsed.pathname.split('/').filter(Boolean)[0];
      if (pageSegment) return `https://www.facebook.com/${pageSegment}/videos/${videoId}`;
      return `https://www.facebook.com/watch/?v=${videoId}`;
    }
    return parsed.toString();
  } catch (_) {
    return url;
  }
}

function toScanItems(urls, maxVideos, titlesById = new Map()) {
  const deduped = new Map();

  for (const rawUrl of urls) {
    const normalized = normalizeCandidateUrl(rawUrl);
    const videoId = extractVideoId(normalized);
    if (!videoId) continue;
    const dedupeKey = videoId || normalized;
    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, {
        title: titlesById.get(videoId) || 'Facebook Reel',
        url: normalized,
        videoId,
        source: 'facebook-page-reels-scanner',
      });
    }
    if (deduped.size >= maxVideos) break;
  }

  return Array.from(deduped.values());
}

function countUniqueVideoItems(urls) {
  return toScanItems(urls, Number.MAX_SAFE_INTEGER).length;
}

function extractPaginationHints(text) {
  const source = decodeHtmlForMatching(text);
  const endCursors = [];

  for (const match of source.matchAll(/"page_info":\{"end_cursor":"([^"]+)","has_next_page":(true|false)/g)) {
    if (match[1]) endCursors.push(match[1]);
  }

  if (!endCursors.length) {
    for (const match of source.matchAll(/owner_reels\?cursor=([^"&\\]+)/g)) {
      if (match[1]) endCursors.push(match[1]);
    }
  }

  return {
    hasNextPage: /"has_next_page":true/.test(source),
    endCursors,
  };
}

function extractCollectionToken(text) {
  const source = decodeHtmlForMatching(text);
  const patterns = [
    /"collectionToken":"(YXBwX2NvbGxlY3Rpb246[^"]+)"/,
    /"tab_key":"owner_reels","id":"(YXBwX2NvbGxlY3Rpb246[^"]+)"/,
    /"__module_component_ProfileCometPaginatedAppCollection_timelineAppCollection":\{"__dr":"ProfileCometAppCollectionReelsRenderer\.react"\},"id":"(YXBwX2NvbGxlY3Rpb246[^"]+)"/,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1];
  }

  return '';
}

function extractCollectionUrlsFromText(text, baseUrl) {
  const source = decodeHtmlForMatching(text);
  const matches = [];
  const patterns = [
    /https?:\/\/(?:www|web|m)\.facebook\.com\/[^/\s"'<>?#]+\/(?:reels|videos)\/?[^\s"'<>]*/gi,
    /\/[^/\s"'<>?#]+\/(?:reels|videos)\/?[^\s"'<>]*/gi,
    /https?:\/\/(?:www|web|m)\.facebook\.com\/profile\.php\?[^\s"'<>]*[?&]id=\d+[^\s"'<>]*[?&]sk=(?:reels|videos|reels_tab|videos_tab)[^\s"'<>]*/gi,
    /\/profile\.php\?[^\s"'<>]*[?&]id=\d+[^\s"'<>]*[?&]sk=(?:reels|videos|reels_tab|videos_tab)[^\s"'<>]*/gi,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const absolute = toAbsoluteFacebookUrl(match[0], baseUrl);
      if (absolute && isFacebookCollectionUrl(absolute)) {
        matches.push({
          url: absolute,
          index: typeof match.index === 'number' ? match.index : Number.MAX_SAFE_INTEGER,
        });
      }
    }
  }

  matches.sort((left, right) => left.index - right.index);
  return preferCollectionCandidates(matches.map(item => item.url));
}

function buildSyntheticCollectionCandidates(rawUrl) {
  const normalizedUrl = normalizeFacebookUrl(rawUrl);

  try {
    const parsed = new URL(normalizedUrl);
    if (!/facebook\.com$/i.test(parsed.hostname)) return [];
    if (isFacebookCollectionUrl(parsed.toString())) {
      return [parsed.toString()];
    }

    if (/^\/profile\.php$/i.test(parsed.pathname)) {
      const profileId = String(parsed.searchParams.get('id') || '').trim();
      if (!profileId) return [];

      const reels = new URL(parsed.toString());
      reels.searchParams.set('sk', 'reels');

      const videos = new URL(parsed.toString());
      videos.searchParams.set('sk', 'videos');

      return preferCollectionCandidates([reels.toString(), videos.toString()]);
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length !== 1) return [];

    const pageKey = segments[0];
    return preferCollectionCandidates([
      `https://www.facebook.com/${pageKey}/reels/`,
      `https://www.facebook.com/${pageKey}/videos/`,
    ]);
  } catch (_) {
    return [];
  }
}

function preferCollectionCandidates(urls) {
  const unique = [];
  const seen = new Set();

  for (const rawUrl of urls || []) {
    const normalized = normalizeFacebookUrl(rawUrl);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }

  const reels = [];
  const videos = [];
  const rest = [];

  for (const url of unique) {
    if (/\/reels\/?$/i.test(url) || /[?&]sk=reels(?:_tab)?(?:&|$)/i.test(url)) {
      reels.push(url);
    } else if (/\/videos\/?$/i.test(url) || /[?&]sk=videos(?:_tab)?(?:&|$)/i.test(url)) {
      videos.push(url);
    } else {
      rest.push(url);
    }
  }

  return [...reels, ...videos, ...rest];
}

async function resolveCollectionCandidateUrls(rawUrl, options = {}) {
  const normalizedUrl = normalizeFacebookUrl(rawUrl);
  const log = createLogger(options.onLog);

  if (isFacebookCollectionUrl(normalizedUrl)) {
    return [normalizedUrl];
  }

  if (!isFacebookPageUrl(normalizedUrl)) {
    return [];
  }

  log('URL đang là page gốc, thử resolve tab /reels hoặc /videos.');

  const candidates = [];

  try {
    const discoveredByDom = await discoverCollectionUrlsWithElectron(normalizedUrl, options);
    candidates.push(...discoveredByDom);
    if (discoveredByDom.length) {
      log(`DOM resolve được ${discoveredByDom.length} candidate collection.`);
    }
  } catch (error) {
    log(`DOM resolve collection lỗi: ${error?.message || String(error)}`, 'warn');
  }

  if (!candidates.length) {
    try {
      const html = await (options.fetchHtml || defaultFetchHtml)(normalizedUrl, options);
      const discoveredByHtml = extractCollectionUrlsFromText(html, normalizedUrl);
      candidates.push(...discoveredByHtml);
      if (discoveredByHtml.length) {
        log(`Static HTML resolve được ${discoveredByHtml.length} candidate collection.`);
      }
    } catch (error) {
      log(`Static resolve collection lỗi: ${error?.message || String(error)}`, 'warn');
    }
  }

  const synthetic = buildSyntheticCollectionCandidates(normalizedUrl);
  if (synthetic.length) {
    log(`Thêm ${synthetic.length} candidate suy đoán từ URL page.`);
  }

  return preferCollectionCandidates([...candidates, ...synthetic]);
}

function createLogger(onLog) {
  if (typeof onLog !== 'function') {
    return () => {};
  }

  return (message, level = 'info', extra = {}) => {
    try {
      onLog({
        message: String(message || ''),
        level,
        timestamp: new Date().toISOString(),
        ...extra,
      });
    } catch (_) {}
  };
}

async function defaultFetchHtml(url, options = {}) {
  return withScanTimeout(({ signal }) => {
    const headers = {
      'user-agent': options.userAgent || DEFAULT_USER_AGENT,
      'accept-language': options.acceptLanguage || 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    return new Promise((resolve, reject) => {
      throwIfAborted(signal);
      const req = https.get(url, { headers, signal }, response => {
        const chunks = [];
        let totalBytes = 0;
        response.setEncoding('utf8');
        response.on('data', chunk => {
          totalBytes += Buffer.byteLength(chunk, 'utf8');
          if (totalBytes > MAX_FALLBACK_HTML_BYTES) {
            req.destroy(createAbortError('Static HTML fallback exceeded memory limit'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve(chunks.join(''));
        });
      });

      const abortRequest = () => req.destroy(createAbortError(signal.reason?.message || 'Static HTML fetch cancelled'));
      signal?.addEventListener('abort', abortRequest, { once: true });
      req.on('error', reject);
      req.on('close', () => signal?.removeEventListener('abort', abortRequest));
    });
  }, options, 'Static HTML fallback timed out');
}

async function scanWithStaticHtml(url, options = {}) {
  return withScanTimeout(async timeoutOptions => {
    const fetchHtml = timeoutOptions.fetchHtml || defaultFetchHtml;
    const log = createLogger(timeoutOptions.onLog);
    log('Đang thử fallback bằng static HTML.');
    const html = await fetchHtml(url, timeoutOptions);
    throwIfAborted(timeoutOptions.signal);
    const urls = collectUrlsFromText(html, url);
    const titlesById = extractVideoTitlesFromText(html);
    log(`Static HTML tìm thấy ${countUniqueVideoItems(urls)} video.`);
    return {
      urls,
      titlesById,
    };
  }, options, 'Static HTML scan timed out');
}

function tryRequireElectron() {
  try {
    return require('electron');
  } catch (_) {
    return null;
  }
}

function shouldBlockRequest(details) {
  if (BLOCKED_RESOURCE_TYPES.has(details.resourceType)) return true;

  try {
    const parsed = new URL(details.url);
    const hostAndPath = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
    return BLOCKED_FACEBOOK_TRACKING_HOSTS.some(token => hostAndPath.includes(token));
  } catch (_) {
    return false;
  }
}

function configureResourceBlocking(win) {
  const session = win?.webContents?.session;
  if (!session || session.__vicScanResourceBlockingConfigured) return;
  session.__vicScanResourceBlockingConfigured = true;
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: shouldBlockRequest(details) });
  });
}

function createHiddenScanWindow(BrowserWindow, options = {}) {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      backgroundThrottling: false,
      sandbox: false,
      partition: 'persist:andrew-facebook-scanner',
    },
  });

  configureResourceBlocking(win);

  if (typeof options.onHiddenWindowCreated === 'function') {
    options.onHiddenWindowCreated(win);
  }

  const signal = options.signal;
  const destroyOnAbort = () => {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  };
  signal?.addEventListener('abort', destroyOnAbort, { once: true });
  win.once('closed', () => signal?.removeEventListener('abort', destroyOnAbort));

  return win;
}

function attachFacebookNetworkCollector(win, options = {}) {
  const debug = win?.webContents?.debugger;
  const urls = new Set();
  const titlesById = new Map();
  const cursors = new Set();
  let hasNextPage = false;
  let latestGraphqlRequest = null;
  let attached = false;

  const ingestText = text => {
    const source = String(text || '');
    if (!source) return;
    for (const candidate of collectUrlsFromText(source, options.baseUrl)) urls.add(candidate);
    for (const match of source.matchAll(/"(?:video_id|top_level_post_id)"\s*:\s*"?(\d{6,})"?/g)) {
      urls.add(`https://www.facebook.com/reel/${match[1]}`);
    }
    for (const [videoId, title] of extractVideoTitlesFromText(source)) {
      if (!titlesById.has(videoId)) titlesById.set(videoId, title);
    }
    const hints = extractPaginationHints(source);
    hasNextPage = hasNextPage || hints.hasNextPage;
    for (const cursor of hints.endCursors || []) if (cursor) cursors.add(cursor);
  };

  const parseRequest = request => {
    const postData = String(request?.postData || '');
    if (!postData) return;
    try {
      const params = new URLSearchParams(postData);
      const variables = JSON.parse(params.get('variables') || '{}');
      latestGraphqlRequest = {
        docId: params.get('doc_id') || '',
        friendlyName: params.get('fb_api_req_friendly_name') || '',
        variables,
        postData,
      };
    } catch (_) {}
  };

  const onMessage = async (_event, method, params) => {
    try {
      if (method === 'Network.requestWillBeSent' && /facebook\.com\/api\/graphql/i.test(params?.request?.url || '')) {
        parseRequest(params.request);
        return;
      }
      if (method !== 'Network.responseReceived' || !/facebook\.com\/api\/graphql/i.test(params?.response?.url || '')) return;
      const bodyResult = await debug.sendCommand('Network.getResponseBody', { requestId: params.requestId });
      const body = bodyResult?.base64Encoded
        ? Buffer.from(bodyResult.body || '', 'base64').toString('utf8')
        : bodyResult?.body || '';
      ingestText(body);
    } catch (_) {
      // Some cached/streamed responses are no longer available by the time CDP
      // asks for their body. The DOM extractor remains the fallback for them.
    }
  };

  try {
    if (!debug.isAttached()) debug.attach('1.3');
    attached = debug.isAttached();
    if (attached) {
      debug.on('message', onMessage);
      debug.sendCommand('Network.enable', {
        maxTotalBufferSize: 50 * 1024 * 1024,
        maxResourceBufferSize: 10 * 1024 * 1024,
      }).catch(() => {});
    }
  } catch (_) {}

  return {
    mergeInto(targetUrls, targetTitles) {
      for (const candidate of urls) targetUrls.add(candidate);
      for (const [videoId, title] of titlesById) {
        if (!targetTitles.has(videoId)) targetTitles.set(videoId, title);
      }
    },
    pagination() {
      return { hasNextPage, endCursors: Array.from(cursors) };
    },
    latestRequest() {
      return latestGraphqlRequest;
    },
    async wheel() {
      if (!attached) return;
      try {
        await debug.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: 640,
          y: 450,
          deltaX: 0,
          deltaY: 950,
        });
      } catch (_) {}
    },
    detach() {
      if (!attached) return;
      try { debug.removeListener('message', onMessage); } catch (_) {}
      try { if (debug.isAttached()) debug.detach(); } catch (_) {}
      attached = false;
    },
  };
}

const EDGE_EXTRACTOR_SCRIPT = `
(() => {
  try {
  const normalizeFacebookUrl = value => {
    try {
      const parsed = new URL(String(value || ''), window.location.href);
      if (!/facebook\\.com$/i.test(parsed.hostname)) return '';
      if (/^(web|m)\\.facebook\\.com$/i.test(parsed.hostname)) {
        parsed.hostname = 'www.facebook.com';
      }
      parsed.hash = '';
      return parsed.toString();
    } catch (_) {
      return '';
    }
  };
  const isVideoUrl = value => /\\/(?:reel|videos)\\/\\d{6,}(?:[/?#&]|$)/i.test(value) || /[?&](?:v|story_fbid)=\\d{6,}(?:[&#]|$)/i.test(value);
  const isCollectionUrl = value => {
    try {
      const parsed = new URL(value, window.location.href);
      return /^\\/[^/]+\\/(?:reels|videos)\\/?$/i.test(parsed.pathname) ||
        (/^\\/profile\\.php$/i.test(parsed.pathname) && /^(?:reels|videos|reels_tab|videos_tab)$/i.test(parsed.searchParams.get('sk') || ''));
    } catch (_) {
      return false;
    }
  };
  const decodeJsonTextValue = value => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      return JSON.parse('"' + raw.replace(/"/g, '\\\\"') + '"').normalize('NFC');
    } catch (_) {
      return raw
        .replace(/\\\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
        .replace(/\\\\n|\\\\r|\\\\t/g, ' ')
        .replace(/\\\\"/g, '"')
        .replace(/\\\\\\\\/g, '\\\\')
        .normalize('NFC');
    }
  };
  const urls = [];
  const collectionUrls = [];
  for (const anchor of document.querySelectorAll('a[href]')) {
    const href = normalizeFacebookUrl(anchor.href || anchor.getAttribute('href') || '');
    if (!href) continue;
    if (isVideoUrl(href)) urls.push(href);
    if (isCollectionUrl(href)) collectionUrls.push(href);
  }

  const titles = [];
  const endCursors = [];
  const paginationUrls = [];
  const ownerCollectionUrls = [];
  const routeSnippets = [];
  let hasNextPage = false;
  let collectionToken = '';
  const scanText = text => {
    if (!text) return;
    const routeText = String(text)
      .replace(/\\\\u002F/gi, '/')
      .replaceAll(String.fromCharCode(92) + '/', '/')
      .replace(/\\\\u0025/gi, '%');
    const ownerRouteIndex = routeText.indexOf('owner_reels');
    if (ownerRouteIndex >= 0 && routeSnippets.length < 3) {
      routeSnippets.push(routeText.slice(Math.max(0, ownerRouteIndex - 180), ownerRouteIndex + 520));
    }
    const cursorRouteIndex = routeText.indexOf('cursor=');
    if (cursorRouteIndex >= 0 && routeSnippets.length < 6) {
      routeSnippets.push(routeText.slice(Math.max(0, cursorRouteIndex - 260), cursorRouteIndex + 520));
    }
    hasNextPage = hasNextPage || /"has_next_page":true/.test(text);
    for (const match of text.matchAll(/"page_info":\\{"end_cursor":"([^"]{1,1200})","has_next_page":(true|false)/g)) {
      if (match[1]) endCursors.push(match[1]);
    }
    for (const match of text.matchAll(/owner_reels\\?cursor=([^"&\\\\]{1,1200})/g)) {
      if (match[1]) endCursors.push(match[1]);
    }
    for (const match of routeText.matchAll(/(?:https?:\\/\\/(?:www\\.)?facebook\\.com)?\\/[^\\s"'<>\\/]+\\/owner_reels\\?cursor=[^\\s"'<>\\\\]+/gi)) {
      const pageUrl = normalizeFacebookUrl(match[0]);
      if (pageUrl) paginationUrls.push(pageUrl);
    }
    for (const match of routeText.matchAll(/https?:\\/\\/(?:www|web|m)\\.facebook\\.com\\/[^"'<>\\s]{1,900}[?&]sk=owner_reels/gi)) {
      const ownerUrl = normalizeFacebookUrl(match[0]);
      if (ownerUrl) ownerCollectionUrls.push(ownerUrl);
    }
    for (const match of text.matchAll(/"video":\\{"id":"(\\d{6,})"[\\s\\S]{0,4000}?"message":\\{"text":"((?:\\\\.|[^"]){5,220})"/g)) {
      titles.push([match[1], decodeJsonTextValue(match[2])]);
    }
    if (!collectionToken) {
      const tokenMatch =
        text.match(/"collectionToken":"(YXBwX2NvbGxlY3Rpb246[^"]{1,1200})"/) ||
        text.match(/"tab_key":"owner_reels","id":"(YXBwX2NvbGxlY3Rpb246[^"]{1,1200})"/);
      collectionToken = tokenMatch?.[1] || '';
    }
  };

  for (const script of document.querySelectorAll('script:not([src]),script[type="application/json"]')) {
    scanText(script.textContent || '');
  }

  let queryId = '';
  try {
    queryId = typeof require === 'function'
      ? (require('ProfileCometAppCollectionReelsRendererPaginationQuery.graphql')?.params?.id || '')
      : '';
  } catch (_) {}

  for (const ownerUrl of ownerCollectionUrls) {
    for (const cursor of endCursors) {
      try {
        const page = new URL(ownerUrl);
        page.searchParams.set('cursor', decodeJsonTextValue(cursor));
        const segments = page.pathname.split('/').filter(Boolean);
        const numericId = [...segments].reverse().find(segment => /^\\d{6,}$/.test(segment)) || '';
        const slug = segments[0] === 'people' ? segments[1] || '' : segments[0] || '';
        if (numericId) {
          const numericPage = new URL('/' + numericId + '/owner_reels', page.origin);
          numericPage.searchParams.set('cursor', decodeJsonTextValue(cursor));
          paginationUrls.push(numericPage.toString());
        }
        if (slug && slug !== numericId) {
          const slugPage = new URL('/' + slug + '/owner_reels', page.origin);
          slugPage.searchParams.set('cursor', decodeJsonTextValue(cursor));
          paginationUrls.push(slugPage.toString());
        }
        paginationUrls.push(page.toString());
      } catch (_) {}
    }
  }

  return {
    currentUrl: normalizeFacebookUrl(window.location.href),
    canonicalUrl: normalizeFacebookUrl(document.querySelector('link[rel="canonical"]')?.href || ''),
    urls,
    collectionUrls,
    titles,
    pagination: {
      hasNextPage,
      endCursors: Array.from(new Set(endCursors)).slice(0, 8),
      pageUrls: Array.from(new Set(paginationUrls)).slice(0, 8),
    },
    routeSnippets,
    collectionToken,
    queryId,
  };
  } catch (error) {
    return {
      error: String(error?.stack || error),
      currentUrl: String(window.location.href || ''),
      canonicalUrl: '',
      urls: [],
      collectionUrls: [],
      titles: [],
      pagination: { hasNextPage: false, endCursors: [], pageUrls: [] },
      collectionToken: '',
      queryId: '',
    };
  }
})()
`;

async function readEdgePayload(win, options = {}) {
  throwIfAborted(options.signal);
  try {
    return await win.webContents.executeJavaScript(EDGE_EXTRACTOR_SCRIPT, true);
  } catch (error) {
    return {
      error: error?.message || String(error),
      currentUrl: win.webContents.getURL(),
      canonicalUrl: '',
      urls: [],
      collectionUrls: [],
      titles: [],
      pagination: { hasNextPage: false, endCursors: [], pageUrls: [] },
      collectionToken: '',
      queryId: '',
    };
  }
}


async function discoverCollectionUrlsWithElectron(url, options = {}) {
  return withScanTimeout(async timeoutOptions => {
    const electron = timeoutOptions.electron || tryRequireElectron();
    const BrowserWindow = electron?.BrowserWindow;
    if (!BrowserWindow) return [];

    const waitMs = Number.isFinite(timeoutOptions.waitAfterLoadMs) ? timeoutOptions.waitAfterLoadMs : 1800;
    const win = createHiddenScanWindow(BrowserWindow, timeoutOptions);

    try {
      await win.loadURL(url, {
        userAgent: timeoutOptions.userAgent || DEFAULT_USER_AGENT,
      });
      await sleep(waitMs, timeoutOptions.signal);

      const payload = await readEdgePayload(win, timeoutOptions);
      const collectionUrls = Array.isArray(payload?.collectionUrls) ? payload.collectionUrls : [];
      return preferCollectionCandidates([
        payload?.currentUrl || '',
        payload?.canonicalUrl || '',
        ...collectionUrls,
      ].filter(isFacebookCollectionUrl));
    } finally {
      if (!win.isDestroyed()) {
        win.destroy();
      }
    }
  }, options, 'DOM collection discovery timed out');
}

async function scanWithElectronDom(url, options = {}) {
  return withScanTimeout(async timeoutOptions => {
    const electron = timeoutOptions.electron || tryRequireElectron();
    const BrowserWindow = electron?.BrowserWindow;
    const log = createLogger(timeoutOptions.onLog);
    if (!BrowserWindow) return { urls: [], titlesById: new Map() };

    const waitMs = Number.isFinite(timeoutOptions.waitAfterLoadMs) ? timeoutOptions.waitAfterLoadMs : 2200;
    const targetCount = Number.isFinite(timeoutOptions.maxVideos) ? timeoutOptions.maxVideos : 20;
    const scrollSteps = Number.isFinite(timeoutOptions.scrollSteps)
      ? timeoutOptions.scrollSteps
      : Math.max(16, Math.min(120, targetCount * 5));
    const scrollPauseMs = Number.isFinite(timeoutOptions.scrollPauseMs) ? timeoutOptions.scrollPauseMs : 1100;
    const stableRoundsLimit = Number.isFinite(timeoutOptions.stableRoundsLimit)
      ? timeoutOptions.stableRoundsLimit
      : 8;

    const win = createHiddenScanWindow(BrowserWindow, timeoutOptions);
    const collected = new Set();
    const titlesById = new Map();
    const network = attachFacebookNetworkCollector(win, { baseUrl: url });

    try {
      log('Đang mở trang Facebook collection.');
      await win.loadURL(url, {
        userAgent: timeoutOptions.userAgent || DEFAULT_USER_AGENT,
      });
      await sleep(waitMs, timeoutOptions.signal);
      log('Trang đã hydrate, bắt đầu quét DOM.');

    let bestCount = 0;
    let stableRounds = 0;
    let sawPaginationHint = false;
    let latestPagination = { hasNextPage: false, endCursors: [], pageUrls: [] };
    let collectionToken = '';
    let paginationQueryId = '';

    for (let index = 0; index < scrollSteps; index += 1) {
      const payload = await readEdgePayload(win, timeoutOptions);
      if (index === 0 && payload?.error) log(`DOM extractor: ${payload.error}`, 'warn');
      network.mergeInto(collected, titlesById);

      const urlsFromDom = Array.isArray(payload?.urls)
        ? payload.urls.map(entry => toAbsoluteFacebookUrl(entry, url)).filter(Boolean)
        : [];
      const discoveredTitles = Array.isArray(payload?.titles) ? payload.titles : [];
      for (const [videoId, title] of discoveredTitles) {
        if (!titlesById.has(videoId)) titlesById.set(videoId, title);
      }
      for (const candidate of urlsFromDom) {
        collected.add(candidate);
      }

      const networkPagination = network.pagination();
      const paginationHints = {
        hasNextPage: Boolean(payload?.pagination?.hasNextPage || networkPagination.hasNextPage),
        endCursors: Array.from(new Set([
          ...(payload?.pagination?.endCursors || []),
          ...(networkPagination.endCursors || []),
        ])),
        pageUrls: Array.from(new Set(payload?.pagination?.pageUrls || [])),
      };
      latestPagination = paginationHints;
      collectionToken = payload?.collectionToken || collectionToken;
      paginationQueryId = payload?.queryId || paginationQueryId;
      if (paginationHints.hasNextPage && !sawPaginationHint) {
        sawPaginationHint = true;
        log('Đã phát hiện pagination hint của Facebook.');
      }

      const uniqueVideoCount = countUniqueVideoItems(Array.from(collected));
      if (typeof options.onProgress === 'function') {
        options.onProgress(toScanItems(Array.from(collected), targetCount, titlesById));
      }
      if (uniqueVideoCount > bestCount) {
        bestCount = uniqueVideoCount;
        stableRounds = 0;
        log(`DOM đang có ${uniqueVideoCount}/${targetCount} video.`);
      } else {
        stableRounds += 1;
      }

      if (uniqueVideoCount >= targetCount) {
        return { urls: Array.from(collected), titlesById };
      }

      const effectiveStableRoundsLimit = sawPaginationHint
        ? stableRoundsLimit + 4
        : stableRoundsLimit;

      if (stableRounds >= effectiveStableRoundsLimit) {
        log('DOM scan đã ổn định, chuyển sang bước tổng hợp tiếp theo.');
        break;
      }

      await win.webContents.executeJavaScript(`
        (() => {
          const delta = Math.max(window.innerHeight * 1.25, 950);
          window.scrollBy(0, delta);

          const scrollables = Array.from(document.querySelectorAll('*'))
            .filter(element => {
              if (!element || element === document.body || element === document.documentElement) {
                return false;
              }
              const style = window.getComputedStyle(element);
              const canScrollY = /(auto|scroll|overlay)/i.test(style.overflowY);
              return canScrollY && element.scrollHeight > element.clientHeight + 120;
            })
            .sort((left, right) => (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight))
            .slice(0, 12);

          for (const element of scrollables) {
            const nextTop = Math.min(
              element.scrollTop + Math.max(element.clientHeight * 0.95, 700),
              element.scrollHeight
            );
            if (nextTop > element.scrollTop) {
              element.scrollTop = nextTop;
              element.dispatchEvent(new Event('scroll', { bubbles: true }));
            }
          }

          return true;
        })();
      `, true);

      // A genuine wheel event is required by Facebook's virtualized grid on
      // pages where assigning scrollTop alone does not trigger pagination.
      await network.wheel();

      await sleep(sawPaginationHint ? scrollPauseMs + 350 : scrollPauseMs, timeoutOptions.signal);
    }

    const payload = await readEdgePayload(win, timeoutOptions);
    network.mergeInto(collected, titlesById);

    const urlsFromDom = Array.isArray(payload?.urls)
      ? payload.urls.map(entry => toAbsoluteFacebookUrl(entry, url)).filter(Boolean)
      : [];
    const finalHtmlTitles = Array.isArray(payload?.titles) ? payload.titles : [];
    for (const [videoId, title] of finalHtmlTitles) {
      if (!titlesById.has(videoId)) titlesById.set(videoId, title);
    }
    const finalCollected = new Set([...collected, ...urlsFromDom]);

    const seenCursors = new Set();
    latestPagination = {
      hasNextPage: Boolean(payload?.pagination?.hasNextPage || latestPagination.hasNextPage),
      endCursors: Array.from(new Set([
        ...(payload?.pagination?.endCursors || []),
        ...(latestPagination.endCursors || []),
      ])),
      pageUrls: Array.from(new Set([
        ...(payload?.pagination?.pageUrls || []),
        ...(latestPagination.pageUrls || []),
      ])),
    };
    collectionToken = payload?.collectionToken || collectionToken;
    paginationQueryId = payload?.queryId || paginationQueryId;
    let nextCursor = latestPagination.endCursors?.[0] || '';

    // Facebook embeds a real /owner_reels?cursor=... route in the initial
    // payload. Navigating that route is more reliable than guessing Relay
    // variables, and each response embeds the route for the following page.
    const seenPageUrls = new Set();
    const pendingPageUrls = (latestPagination.pageUrls || []).filter(Boolean);
    let nextPageUrl = pendingPageUrls.shift() || '';
    while (
      nextPageUrl &&
      !seenPageUrls.has(nextPageUrl) &&
      seenPageUrls.size < 3 &&
      countUniqueVideoItems(Array.from(finalCollected)) < targetCount
    ) {
      seenPageUrls.add(nextPageUrl);
      log(`Đang mở trang Reels tiếp theo ${seenPageUrls.size}.`);
      throwIfAborted(timeoutOptions.signal);
      try {
        await Promise.race([
          win.loadURL(nextPageUrl, {
            userAgent: timeoutOptions.userAgent || DEFAULT_USER_AGENT,
          }),
          sleep(7000, timeoutOptions.signal).then(() => {
            throw new Error('Trang cursor phản hồi quá chậm');
          }),
        ]);
      } catch (error) {
        try { win.webContents.stop(); } catch (_) {}
        log(`Bỏ qua route cursor lỗi: ${error?.message || error}`, 'warn');
        nextPageUrl = pendingPageUrls.find(candidate => !seenPageUrls.has(candidate)) || '';
        if (nextPageUrl) pendingPageUrls.splice(pendingPageUrls.indexOf(nextPageUrl), 1);
        continue;
      }
      await sleep(waitMs, timeoutOptions.signal);

      const routePayload = await readEdgePayload(win, timeoutOptions);
      network.mergeInto(finalCollected, titlesById);
      for (const candidate of routePayload?.urls || []) {
        const absolute = toAbsoluteFacebookUrl(candidate, nextPageUrl);
        if (absolute) finalCollected.add(absolute);
      }
      for (const [videoId, title] of routePayload?.titles || []) {
        if (!titlesById.has(videoId)) titlesById.set(videoId, title);
      }

      const routeCount = countUniqueVideoItems(Array.from(finalCollected));
      log(`Sau trang ${seenPageUrls.size}, tổng hiện có ${routeCount}/${targetCount} video.`);
      if (typeof options.onProgress === 'function') {
        options.onProgress(toScanItems(Array.from(finalCollected), targetCount, titlesById));
      }
      if (routeCount >= targetCount) break;

      const routeUrls = routePayload?.pagination?.pageUrls || [];
      for (const candidate of routeUrls) {
        if (candidate && !seenPageUrls.has(candidate) && !pendingPageUrls.includes(candidate)) {
          pendingPageUrls.push(candidate);
        }
      }
      nextPageUrl = pendingPageUrls.find(candidate => !seenPageUrls.has(candidate)) || '';
      if (nextPageUrl) pendingPageUrls.splice(pendingPageUrls.indexOf(nextPageUrl), 1);
      nextCursor = (routePayload?.pagination?.endCursors || [])
        .find(candidate => candidate && !seenCursors.has(candidate)) || nextCursor;
      collectionToken = routePayload?.collectionToken || collectionToken;
      paginationQueryId = routePayload?.queryId || paginationQueryId;
    }

    if (paginationQueryId && collectionToken && nextCursor) {
      log('Đã tìm thấy pagination query thật của Facebook.');
    }

    while (
      paginationQueryId &&
      collectionToken &&
      nextCursor &&
      countUniqueVideoItems(Array.from(finalCollected)) < targetCount &&
      !seenCursors.has(nextCursor)
    ) {
      seenCursors.add(nextCursor);
      log(`Đang lấy thêm batch ${seenCursors.size} qua pagination.`);

      throwIfAborted(timeoutOptions.signal);
      const pagePayload = await win.webContents.executeJavaScript(
        `(async payload => {
          const decodeHtmlForMatching = value => String(value || '')
            .replace(/\\\\u0025/g, '%')
            .replace(/\\\\u002F/gi, '/')
            .replace(/\\\\\\//g, '/')
            .replace(/&amp;/g, '&')
            .replace(/&#x2F;/gi, '/')
            .replace(/&#47;/g, '/');
          const decodeJsonTextValue = value => {
            const raw = String(value || '').trim();
            if (!raw) return '';
            try {
              return JSON.parse('"' + raw.replace(/"/g, '\\\\"') + '"').normalize('NFC');
            } catch (_) {
              return raw
                .replace(/\\\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
                .replace(/\\\\n|\\\\r|\\\\t/g, ' ')
                .replace(/\\\\"/g, '"')
                .replace(/\\\\\\\\/g, '\\\\')
                .normalize('NFC');
            }
          };
          const normalizeFacebookUrl = value => {
            try {
              const parsed = new URL(decodeHtmlForMatching(value), window.location.href);
              if (!/facebook\\.com$/i.test(parsed.hostname)) return '';
              if (/^(web|m)\\.facebook\\.com$/i.test(parsed.hostname)) {
                parsed.hostname = 'www.facebook.com';
              }
              parsed.hash = '';
              return parsed.toString();
            } catch (_) {
              return '';
            }
          };
          const parsePageText = text => {
            const source = decodeHtmlForMatching(text);
            const urls = [];
            const titles = [];
            const endCursors = [];
            const patterns = [
              /https?:\\/\\/(?:www|web|m)\\.facebook\\.com\\/(?:watch\\/?\\?v=\\d{6,}(?:[^\\w]|$)[^\\s"'<>]*)/gi,
              /https?:\\/\\/(?:www|web|m)\\.facebook\\.com\\/(?:reel\\/\\d{6,}[^\\s"'<>]*)/gi,
              /https?:\\/\\/(?:www|web|m)\\.facebook\\.com\\/[^/\\s"'<>?#]+\\/videos\\/\\d{6,}[^\\s"'<>]*/gi,
              /\\/watch\\/?\\?v=\\d{6,}(?:[^\\w]|$)[^\\s"'<>]*/gi,
              /\\/reel\\/\\d{6,}[^\\s"'<>]*/gi,
              /\\/[^/\\s"'<>?#]+\\/videos\\/\\d{6,}[^\\s"'<>]*/gi,
              /story\\.php\\?[^\\s"'<>]*story_fbid=\\d{6,}[^\\s"'<>]*/gi,
            ];
            for (const pattern of patterns) {
              for (const match of source.matchAll(pattern)) {
                const url = normalizeFacebookUrl(match[0]);
                if (url) urls.push(url);
              }
            }
            for (const match of source.matchAll(/"video":\\{"id":"(\\d{6,})"[\\s\\S]{0,4000}?"message":\\{"text":"((?:\\\\.|[^"]){5,220})"/g)) {
              titles.push([match[1], decodeJsonTextValue(match[2])]);
            }
            for (const match of source.matchAll(/"page_info":\\{"end_cursor":"([^"]{1,1200})","has_next_page":(true|false)/g)) {
              if (match[1]) endCursors.push(match[1]);
            }
            for (const match of source.matchAll(/owner_reels\\?cursor=([^"&\\\\]{1,1200})/g)) {
              if (match[1]) endCursors.push(match[1]);
            }
            return {
              urls: Array.from(new Set(urls)),
              titles,
              pagination: {
                hasNextPage: /"has_next_page":true/.test(source),
                endCursors: Array.from(new Set(endCursors)).slice(0, 8),
              },
            };
          };
          try {
            const lsd =
              document.querySelector('[name="lsd"]')?.value ||
              (typeof require === 'function' ? require('LSD')?.token : '') ||
              '';
            const siteData = typeof require === 'function' ? require('SiteData') : null;
            const params = new URLSearchParams();
            params.set('av', '0');
            params.set('__aaid', '0');
            params.set('__user', '0');
            params.set('__a', '1');
            params.set('__req', '1');
            params.set('__hs', '20540.HYP:comet_loggedout_pkg.2.1...0');
            params.set('dpr', String(window.devicePixelRatio || 1));
            params.set('__ccg', 'EXCELLENT');
            params.set('__rev', String(siteData?.server_revision || ''));
            params.set('__comet_req', '15');
            params.set('lsd', lsd);
            params.set(
              'jazoest',
              document.querySelector('[name="jazoest"]')?.value || '22191'
            );
            params.set('__spin_r', String(siteData?.server_revision || ''));
            params.set('__spin_b', siteData?.__spin_b || 'trunk');
            params.set(
              '__spin_t',
              String(siteData?.__spin_t || Math.floor(Date.now() / 1000))
            );
            params.set('fb_api_caller_class', 'RelayModern');
            params.set(
              'fb_api_req_friendly_name',
              'ProfileCometAppCollectionReelsRendererPaginationQuery'
            );
            params.set('server_timestamps', 'true');
            params.set(
              'variables',
              JSON.stringify({
                id: payload.collectionToken,
                cursor: payload.cursor,
                count: Math.max(1, payload.count || 10),
                scale: 1,
                useDefaultActor: false,
              })
            );
            params.set('doc_id', payload.queryId);

            const response = await fetch('/api/graphql/', {
              method: 'POST',
              headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-fb-friendly-name': 'ProfileCometAppCollectionReelsRendererPaginationQuery',
                'x-asbd-id': '359341',
                'x-fb-lsd': lsd,
              },
              body: params.toString(),
              credentials: 'include',
            });

            return parsePageText(await response.text());
          } catch (error) {
            return {
              urls: [],
              titles: [],
              pagination: { hasNextPage: false, endCursors: [] },
              error: String(error),
            };
          }
        })(${JSON.stringify({
          queryId: paginationQueryId,
          collectionToken,
          cursor: nextCursor,
          count: Math.min(10, Math.max(1, targetCount - countUniqueVideoItems(Array.from(finalCollected)))),
        })});`,
        true
      );

      const pageUrls = Array.isArray(pagePayload?.urls) ? pagePayload.urls : [];
      for (const candidate of pageUrls) {
        finalCollected.add(candidate);
      }
      const pageTitles = Array.isArray(pagePayload?.titles) ? pagePayload.titles : [];
      for (const [videoId, title] of pageTitles) {
        if (!titlesById.has(videoId)) titlesById.set(videoId, title);
      }

      log(`Sau batch ${seenCursors.size}, tổng hiện có ${countUniqueVideoItems(Array.from(finalCollected))}/${targetCount} video.`);
      if (typeof options.onProgress === 'function') {
        options.onProgress(toScanItems(Array.from(finalCollected), targetCount, titlesById));
      }

      const pageHints = pagePayload?.pagination || { hasNextPage: false, endCursors: [] };
      const candidateCursor =
        pageHints.endCursors.find(cursor => cursor && !seenCursors.has(cursor)) || '';
      if (!pageHints.hasNextPage || !candidateCursor) {
        break;
      }
      nextCursor = candidateCursor;
    }

    return { urls: Array.from(finalCollected), titlesById };
  } finally {
    network.detach();
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
  }, options, 'DOM scan timed out');
}

async function scanResolvedCollectionUrl(collectionUrl, options = {}) {
  return withScanTimeout(async timeoutOptions => {
  const {
    maxVideos = 20,
    allowStaticHtmlFallback = true,
    onLog,
  } = timeoutOptions;

  const log = createLogger(onLog);
  let collected = { urls: [], titlesById: new Map() };

  try {
    collected = await scanWithElectronDom(collectionUrl, timeoutOptions);
  } catch (error) {
    log(`DOM scan lỗi trên ${collectionUrl}: ${error?.message || String(error)}`, 'error');
    if (!allowStaticHtmlFallback) throw error;
  }

  if (!Array.isArray(collected?.urls) && Array.isArray(collected)) {
    collected = { urls: collected, titlesById: new Map() };
  }

  if (!collected.urls.length && allowStaticHtmlFallback) {
    log(`Không có kết quả từ DOM trên ${collectionUrl}, chuyển sang static HTML fallback.`, 'warn');
    collected = await scanWithStaticHtml(collectionUrl, timeoutOptions);
  }

  const items = toScanItems(collected.urls, maxVideos, collected.titlesById).map(item => ({
    ...item,
    maxQuality: 720,
  }));

  return {
    success: true,
    source: items.length ? 'facebook-page-reels-scanner' : 'facebook-page-reels-scanner-empty',
    collectionUrl,
    videos: items,
    totalFound: items.length,
  };
  }, options, 'Collection scan timed out');
}

async function scanFacebookPageReels(options = {}) {
  return withScanTimeout(async timeoutOptions => {
  const {
    url,
    maxVideos = 20,
    onLog,
  } = timeoutOptions;

  const log = createLogger(onLog);

  if (!url) throw new Error('Thiếu URL Facebook cần quét');

  const normalizedUrl = normalizeFacebookUrl(url);
  log(`Bắt đầu quét ${normalizedUrl} với mục tiêu ${maxVideos} video.`);
  const candidates = await resolveCollectionCandidateUrls(normalizedUrl, timeoutOptions);

  if (!candidates.length) {
    throw new Error('Không resolve được tab /reels hoặc /videos từ URL Facebook này.');
  }

  let lastResult = null;
  for (const candidateUrl of candidates) {
    throwIfAborted(timeoutOptions.signal);
    log(`Đang thử collection ${candidateUrl}`);
    const result = await scanResolvedCollectionUrl(candidateUrl, timeoutOptions);
    if (result.totalFound > 0) {
      log(`Quét xong. Lấy được ${result.totalFound} video hợp lệ.`, 'success');
      return {
        ...result,
        requestedUrl: normalizedUrl,
      };
    }
    lastResult = result;
  }

  log('Đã thử hết candidate collection nhưng chưa lấy được video nào.', 'warn');
  return {
    ...(lastResult || {
      success: true,
      source: 'facebook-page-reels-scanner-empty',
      collectionUrl: candidates[0] || normalizedUrl,
      videos: [],
      totalFound: 0,
    }),
    requestedUrl: normalizedUrl,
  };
  }, options, 'Facebook scan timed out');
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(createAbortError(signal.reason?.message || 'Scan was cancelled'));
    }, { once: true });
  });
}

module.exports = {
  DEFAULT_USER_AGENT,
  buildFallbackTitle,
  buildSyntheticCollectionCandidates,
  collectUrlsFromText,
  countUniqueVideoItems,
  decodeJsonTextValue,
  discoverCollectionUrlsWithElectron,
  extractCollectionToken,
  extractCollectionUrlsFromText,
  extractPaginationHints,
  extractVideoId,
  extractVideoTitlesFromText,
  isFacebookPageUrl,
  isFacebookCollectionUrl,
  normalizeCandidateUrl,
  normalizeFacebookUrl,
  preferCollectionCandidates,
  resolveCollectionCandidateUrls,
  scanFacebookPageReels,
  scanResolvedCollectionUrl,
  scanWithElectronDom,
  scanWithStaticHtml,
  toAbsoluteFacebookUrl,
  toScanItems,
};
