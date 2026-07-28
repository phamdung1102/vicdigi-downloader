'use strict';

const https = require('https');

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

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
    if (parsed.pathname === '/profile.php') {
      const profileId = String(parsed.searchParams.get('id') || '').trim();
      const tab = String(parsed.searchParams.get('sk') || '').trim();
      return /^\d{6,}$/.test(profileId) && /^(reels?|videos?)(?:_tab)?$/i.test(tab);
    }
    return /^\/[^/]+\/(?:reels|videos)\/?$/i.test(parsed.pathname);
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
    /\/reel\/(\d{6,})/i,
    /\/videos\/(\d{6,})/i,
    /[?&]v=(\d{6,})/i,
    /story_fbid=(\d{6,})/i,
  ];

  for (const matcher of matchers) {
    const match = value.match(matcher);
    if (match?.[1]) return match[1];
  }

  return '';
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

async function defaultFetchHtml(url, options = {}) {
  const headers = {
    'user-agent': options.userAgent || DEFAULT_USER_AGENT,
    'accept-language': options.acceptLanguage || 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
      });
      response.on('end', () => {
        resolve(body);
      });
    });

    req.on('error', reject);
  });
}

async function scanWithStaticHtml(url, options = {}) {
  const fetchHtml = options.fetchHtml || defaultFetchHtml;
  const html = await fetchHtml(url, options);
  return {
    urls: collectUrlsFromText(html, url),
    titlesById: extractVideoTitlesFromText(html),
  };
}

function tryRequireElectron() {
  try {
    return require('electron');
  } catch (_) {
    return null;
  }
}

async function scanWithElectronDom(url, options = {}) {
  const electron = options.electron || tryRequireElectron();
  const BrowserWindow = electron?.BrowserWindow;
  if (!BrowserWindow) return { urls: [], titlesById: new Map() };

  const waitMs = Number.isFinite(options.waitAfterLoadMs) ? options.waitAfterLoadMs : 2200;
  const targetCount = Number.isFinite(options.maxVideos) ? options.maxVideos : 20;
  const scrollSteps = Number.isFinite(options.scrollSteps)
    ? options.scrollSteps
    : Math.max(16, Math.min(120, targetCount * 5));
  const scrollPauseMs = Number.isFinite(options.scrollPauseMs) ? options.scrollPauseMs : 1100;
  const stableRoundsLimit = Number.isFinite(options.stableRoundsLimit)
    ? options.stableRoundsLimit
    : 8;

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      backgroundThrottling: false,
      sandbox: false,
    },
  });

  try {
    await win.loadURL(url, {
      userAgent: options.userAgent || DEFAULT_USER_AGENT,
    });
    await sleep(waitMs);

    const collected = new Set();
    const titlesById = new Map();
    let bestCount = 0;
    let stableRounds = 0;
    let sawPaginationHint = false;
    let latestHtml = '';

    for (let index = 0; index < scrollSteps; index += 1) {
      const payload = await win.webContents.executeJavaScript(`
        (() => {
          const getScrollableElements = () => {
            return Array.from(document.querySelectorAll('*'))
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
          };

          return {
            hrefs: Array.from(document.querySelectorAll('a[href]')).map(anchor => anchor.href),
            html: document.documentElement ? document.documentElement.outerHTML : '',
            scrollables: getScrollableElements().map(element => ({
              scrollHeight: element.scrollHeight,
              clientHeight: element.clientHeight,
              scrollTop: element.scrollTop,
            })),
          };
        })();
      `, true);

      const hrefs = Array.isArray(payload?.hrefs) ? payload.hrefs : [];
      const urlsFromDom = hrefs.map(entry => toAbsoluteFacebookUrl(entry, url)).filter(Boolean);
      const urlsFromHtml = collectUrlsFromText(payload?.html || '', url);
      latestHtml = payload?.html || latestHtml;
      const discoveredTitles = extractVideoTitlesFromText(payload?.html || '');
      for (const [videoId, title] of discoveredTitles.entries()) {
        if (!titlesById.has(videoId)) titlesById.set(videoId, title);
      }
      for (const candidate of [...urlsFromDom, ...urlsFromHtml]) {
        collected.add(candidate);
      }

      const paginationHints = extractPaginationHints(payload?.html || '');
      if (paginationHints.hasNextPage) {
        sawPaginationHint = true;
      }

      const uniqueVideoCount = countUniqueVideoItems(Array.from(collected));
      if (uniqueVideoCount >= targetCount) {
        return { urls: Array.from(collected), titlesById };
      }

      if (uniqueVideoCount > bestCount) {
        bestCount = uniqueVideoCount;
        stableRounds = 0;
      } else {
        stableRounds += 1;
      }

      const effectiveStableRoundsLimit = sawPaginationHint
        ? stableRoundsLimit + 4
        : stableRoundsLimit;

      if (stableRounds >= effectiveStableRoundsLimit) {
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

      await sleep(sawPaginationHint ? scrollPauseMs + 350 : scrollPauseMs);
    }

    const payload = await win.webContents.executeJavaScript(`
      (() => ({
        hrefs: Array.from(document.querySelectorAll('a[href]')).map(anchor => anchor.href),
        html: document.documentElement ? document.documentElement.outerHTML : ''
      }))();
    `, true);

    const hrefs = Array.isArray(payload?.hrefs) ? payload.hrefs : [];
    const urlsFromDom = hrefs.map(entry => toAbsoluteFacebookUrl(entry, url)).filter(Boolean);
    const urlsFromHtml = collectUrlsFromText(payload?.html || '', url);
    latestHtml = payload?.html || latestHtml;
    const finalHtmlTitles = extractVideoTitlesFromText(payload?.html || '');
    for (const [videoId, title] of finalHtmlTitles.entries()) {
      if (!titlesById.has(videoId)) titlesById.set(videoId, title);
    }
    const finalCollected = new Set([...collected, ...urlsFromDom, ...urlsFromHtml]);

    const paginationQueryId = await win.webContents.executeJavaScript(`
      (() => {
        try {
          return require('ProfileCometAppCollectionReelsRendererPaginationQuery.graphql')?.params?.id || '';
        } catch (_) {
          return '';
        }
      })();
    `, true);

    const collectionToken = extractCollectionToken(latestHtml);
    const seenCursors = new Set();
    let nextCursor = extractPaginationHints(latestHtml).endCursors[0] || '';

    while (
      paginationQueryId &&
      collectionToken &&
      nextCursor &&
      countUniqueVideoItems(Array.from(finalCollected)) < targetCount &&
      !seenCursors.has(nextCursor)
    ) {
      seenCursors.add(nextCursor);

      const pageText = await win.webContents.executeJavaScript(
        `(async payload => {
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

            return await response.text();
          } catch (error) {
            return JSON.stringify({ __scan_error: String(error) });
          }
        })(${JSON.stringify({
          queryId: paginationQueryId,
          collectionToken,
          cursor: nextCursor,
          count: Math.min(10, Math.max(1, targetCount - countUniqueVideoItems(Array.from(finalCollected)))),
        })});`,
        true
      );

      const pageUrls = collectUrlsFromText(pageText || '', url);
      for (const candidate of pageUrls) {
        finalCollected.add(candidate);
      }
      const pageTitles = extractVideoTitlesFromText(pageText || '');
      for (const [videoId, title] of pageTitles.entries()) {
        if (!titlesById.has(videoId)) titlesById.set(videoId, title);
      }

      const pageHints = extractPaginationHints(pageText || '');
      const candidateCursor =
        pageHints.endCursors.find(cursor => cursor && !seenCursors.has(cursor)) || '';
      if (!pageHints.hasNextPage || !candidateCursor) {
        break;
      }
      nextCursor = candidateCursor;
    }

    return { urls: Array.from(finalCollected), titlesById };
  } finally {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}

async function scanFacebookPageReels(options = {}) {
  const {
    url,
    maxVideos = 20,
    allowStaticHtmlFallback = true,
  } = options;

  if (!url) throw new Error('Thiếu URL Facebook cần quét');
  if (!isFacebookCollectionUrl(url)) {
    throw new Error('Scanner này chỉ dành cho URL Facebook Page dạng /reels hoặc /videos');
  }

  const normalizedUrl = normalizeFacebookUrl(url);
  let collected = { urls: [], titlesById: new Map() };

  try {
    collected = await scanWithElectronDom(normalizedUrl, options);
  } catch (error) {
    if (!allowStaticHtmlFallback) throw error;
  }

  if (!Array.isArray(collected?.urls) && Array.isArray(collected)) {
    collected = { urls: collected, titlesById: new Map() };
  }

  if (!collected.urls.length && allowStaticHtmlFallback) {
    collected = await scanWithStaticHtml(normalizedUrl, options);
  }

  const items = toScanItems(collected.urls, maxVideos, collected.titlesById).map(item => ({
    ...item,
    maxQuality: 720,
  }));

  return {
    success: true,
    source: items.length ? 'facebook-page-reels-scanner' : 'facebook-page-reels-scanner-empty',
    collectionUrl: normalizedUrl,
    videos: items,
    totalFound: items.length,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  isFacebookCollectionUrl,
  normalizeFacebookUrl,
  scanFacebookPageReels,
};
