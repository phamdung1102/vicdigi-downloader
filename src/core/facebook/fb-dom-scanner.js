const { createHiddenWindow } = require('./browser-manager');

const DEFAULT_SCAN_TIMEOUT_MS = 5 * 60 * 1000;
const MIN_LIMITED_SCAN_TIMEOUT_MS = 3 * 60 * 1000;
const MAX_LIMITED_SCAN_TIMEOUT_MS = 12 * 60 * 1000;
const PER_VIDEO_TIMEOUT_MS = 9000;
const INITIAL_NO_UID_TIMEOUT_MS = 45 * 1000;
const STALE_AFTER_FOUND_TIMEOUT_MS = 120 * 1000;
const HEARTBEAT_INTERVAL_MS = 5000;
const SCROLL_INTERVAL_MS = 1200;
const FIRST_SCAN_DELAY_MS = 1200;
const STABLE_ROUTE_SWITCH_ROUNDS = 22;

const FACEBOOK_VIDEO_URL_REGEXES = [
  /\/reel\/(\d{6,})/i,
  /\/videos\/(\d{6,})/i,
  /[?&]v=(\d{6,})/i
];
const PAGINATION_QUERY_NAMES = [
  'ProfileCometAppCollectionReelsRendererPaginationQuery',
  'ProfileCometAppCollectionVideosRendererPaginationQuery'
];

function normalizeFacebookUrl(rawUrl) {
  const url = new URL(String(rawUrl || '').trim());

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Chi chap nhan URL http/https.');
  }

  if (!/(^|\.)facebook\.com$/i.test(url.hostname)) {
    throw new Error('URL phai thuoc domain facebook.com.');
  }

  if (url.hostname === 'web.facebook.com' || url.hostname === 'm.facebook.com') {
    url.hostname = 'www.facebook.com';
  }

  url.hash = '';
  url.searchParams.delete('__tn__');
  url.searchParams.delete('__cft__');
  url.searchParams.delete('refsrc');
  return url.toString();
}

function makeProfileTabUrl(id, tab, host = 'www.facebook.com') {
  const url = new URL(`https://${host}/profile.php`);
  url.searchParams.set('id', id);
  url.searchParams.set('sk', tab);
  return url.toString();
}

function makeBasicVideoUrl(id, host = 'mbasic.facebook.com') {
  const url = new URL(`https://${host}/profile.php`);
  url.searchParams.set('id', id);
  url.searchParams.set('v', 'videos');
  return url.toString();
}

function normalizeFacebookTab(tab) {
  const clean = String(tab || '').toLowerCase();
  if (clean.includes('reel')) return 'reels';
  if (clean.includes('video')) return 'videos';
  return 'reels';
}

function computeScanTimeoutMs(maxVideos, overrideMs) {
  if (Number.isFinite(overrideMs) && overrideMs > 0) {
    return overrideMs;
  }

  if (maxVideos > 0) {
    return Math.min(
      MAX_LIMITED_SCAN_TIMEOUT_MS,
      Math.max(MIN_LIMITED_SCAN_TIMEOUT_MS, maxVideos * PER_VIDEO_TIMEOUT_MS)
    );
  }

  return DEFAULT_SCAN_TIMEOUT_MS;
}

function buildScanPlan(normalizedUrl) {
  const urls = [];

  function add(candidate) {
    if (candidate && !urls.includes(candidate)) {
      urls.push(candidate);
    }
  }

  const parsed = new URL(normalizedUrl);
  const parts = parsed.pathname.split('/').filter(Boolean);
  const profileId = parsed.pathname === '/profile.php' && /^\d{6,}$/.test(parsed.searchParams.get('id') || '')
    ? parsed.searchParams.get('id')
    : '';
  const numericId = profileId || (parts[0] && /^\d{6,}$/.test(parts[0]) ? parts[0] : '');
  const tab = profileId
    ? normalizeFacebookTab(parsed.searchParams.get('sk'))
    : (/^(reels|videos)$/i.test(parts[1] || '') ? normalizeFacebookTab(parts[1]) : '');

  if (numericId && tab) {
    add(normalizedUrl);
    add(makeProfileTabUrl(numericId, `${tab}_tab`));
    add(makeProfileTabUrl(numericId, tab));

    const queryTabUrl = new URL(`https://www.facebook.com/${numericId}/`);
    queryTabUrl.searchParams.set('sk', tab);
    add(queryTabUrl.toString());

    add(`https://www.facebook.com/${numericId}/${tab}/`);
    add(makeProfileTabUrl(numericId, tab, 'm.facebook.com'));
    add(makeBasicVideoUrl(numericId, 'm.facebook.com'));
    add(makeBasicVideoUrl(numericId, 'mbasic.facebook.com'));
    add(makeProfileTabUrl(numericId, tab === 'reels' ? 'videos_tab' : 'reels_tab'));
    add(makeProfileTabUrl(numericId, tab === 'reels' ? 'videos' : 'reels'));
    return { mode: 'numeric', numericId, tab, urls };
  } else {
    add(normalizedUrl);
  }

  return { mode: 'slug', numericId: '', tab: '', urls };
}

function sendStatus(mainWindow, payload) {
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send('facebook-scan-status', payload);
  }
}

function sendDiscoveredUids(mainWindow, uids) {
  if (!mainWindow.isDestroyed() && uids.length > 0) {
    mainWindow.webContents.send('facebook-uids-discovered', uids);
  }
}

function normalizeMaxVideos(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.min(Math.floor(parsed), 100000);
}

function decodeHtmlForMatching(text) {
  return String(text || '')
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
    if (!/(^|\.)facebook\.com$/i.test(absolute.hostname)) return '';
    absolute.hostname = 'www.facebook.com';
    absolute.hash = '';
    return absolute.toString();
  } catch (error) {
    return '';
  }
}

function toAbsoluteFacebookPaginationUrl(candidate, baseUrl) {
  const clean = decodeHtmlForMatching(candidate).trim();
  if (!clean) return '';
  try {
    const absolute = new URL(clean, baseUrl || 'https://www.facebook.com');
    if (!/(^|\.)facebook\.com$/i.test(absolute.hostname)) return '';
    absolute.hash = '';
    return absolute.toString();
  } catch (_) {
    return '';
  }
}

function extractVideoIdFromUrl(url) {
  const value = String(url || '');
  for (const regex of FACEBOOK_VIDEO_URL_REGEXES) {
    const match = value.match(regex);
    if (match && match[1]) {
      return match[1];
    }
  }

  return '';
}

function collectVideoIdsFromText(text, baseUrl) {
  const source = decodeHtmlForMatching(text);
  const ids = new Set();
  const patterns = [
    /https?:\/\/(?:www|web|m|mbasic)\.facebook\.com\/watch\/?\?v=\d{6,}(?:[^\w]|$)[^\s"'<>]*/gi,
    /https?:\/\/(?:www|web|m|mbasic)\.facebook\.com\/reel\/\d{6,}[^\s"'<>]*/gi,
    /https?:\/\/(?:www|web|m|mbasic)\.facebook\.com\/[^/\s"'<>?#]+\/videos\/\d{6,}[^\s"'<>]*/gi,
    /\/watch\/?\?v=\d{6,}(?:[^\w]|$)[^\s"'<>]*/gi,
    /\/reel\/\d{6,}[^\s"'<>]*/gi,
    /\/[^/\s"'<>?#]+\/videos\/\d{6,}[^\s"'<>]*/gi
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const absolute = toAbsoluteFacebookUrl(match[0], baseUrl);
      const videoId = extractVideoIdFromUrl(absolute);
      if (videoId) {
        ids.add(videoId);
      }
    }
  }

  const jsonPatterns = [
    /"(?:video_id|legacy_video_id)"\s*:\s*"(\d{6,})"/g,
    /\\"(?:video_id|legacy_video_id)\\"\s*:\s*\\"(\d{6,})\\"/g
  ];

  for (const pattern of jsonPatterns) {
    for (const match of source.matchAll(pattern)) {
      if (match && match[1]) {
        ids.add(match[1]);
      }
    }
  }

  return [...ids];
}

function addCursor(target, cursor) {
  if (cursor && !target.includes(cursor)) {
    target.push(cursor);
  }
}

function stripFacebookJsonPrefix(text) {
  return String(text || '').replace(/^for\s*\(\s*;\s*;\s*\)\s*;\s*/i, '').trim();
}

function collectPaginationFromJson(value, endCursors) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  let hasNextPage = false;

  if (Array.isArray(value)) {
    for (const item of value) {
      if (collectPaginationFromJson(item, endCursors)) {
        hasNextPage = true;
      }
    }
    return hasNextPage;
  }

  const ownHasNext =
    value.has_next_page === true ||
    value.hasNextPage === true ||
    value.has_next === true;
  const ownCursor = value.end_cursor || value.endCursor || value.cursor;
  if (ownHasNext && typeof ownCursor === 'string') {
    addCursor(endCursors, ownCursor);
    hasNextPage = true;
  }

  for (const child of Object.values(value)) {
    if (collectPaginationFromJson(child, endCursors)) {
      hasNextPage = true;
    }
  }

  return hasNextPage || ownHasNext;
}

function extractPaginationHints(text, options = {}) {
  const source = decodeHtmlForMatching(text);
  const endCursors = [];
  let hasNextPage = false;

  const regexes = [
    /"page_info"\s*:\s*\{[\s\S]{0,900}?"end_cursor"\s*:\s*"([^"]+)"[\s\S]{0,500}?"has_next_page"\s*:\s*true/g,
    /"page_info"\s*:\s*\{[\s\S]{0,900}?"has_next_page"\s*:\s*true[\s\S]{0,500}?"end_cursor"\s*:\s*"([^"]+)"/g,
    /"end_cursor"\s*:\s*"([^"]+)"[\s\S]{0,500}?"has_next_page"\s*:\s*true/g,
    /"has_next_page"\s*:\s*true[\s\S]{0,500}?"end_cursor"\s*:\s*"([^"]+)"/g,
    /"endCursor"\s*:\s*"([^"]+)"[\s\S]{0,500}?"hasNextPage"\s*:\s*true/g,
    /"hasNextPage"\s*:\s*true[\s\S]{0,500}?"endCursor"\s*:\s*"([^"]+)"/g,
    /\\"end_cursor\\"\s*:\s*\\"([^"\\]+)\\"[\s\S]{0,650}?\\"has_next_page\\"\s*:\s*true/g,
    /\\"has_next_page\\"\s*:\s*true[\s\S]{0,650}?\\"end_cursor\\"\s*:\s*\\"([^"\\]+)\\"/g
  ];

  for (const regex of regexes) {
    for (const match of source.matchAll(regex)) {
      addCursor(endCursors, match[1]);
      hasNextPage = true;
    }
  }

  if (!endCursors.length) {
    for (const match of source.matchAll(/owner_reels\?cursor=([^"&\\]+)/g)) {
      addCursor(endCursors, match[1]);
    }
  }

  if (options.parseJson) {
    try {
      const parsed = JSON.parse(stripFacebookJsonPrefix(source));
      if (collectPaginationFromJson(parsed, endCursors)) {
        hasNextPage = true;
      }
    } catch (error) {
      // Some Facebook HTML/script payloads are not standalone JSON.
    }
  }

  return {
    hasNextPage: hasNextPage || /"has_next_page"\s*:\s*true/.test(source) || /"hasNextPage"\s*:\s*true/.test(source),
    endCursors
  };
}

function extractCollectionToken(text) {
  const source = decodeHtmlForMatching(text);
  const patterns = [
    /"collectionToken":"(YXBwX2NvbGxlY3Rpb246[^"]+)"/,
    /"tab_key":"owner_reels","id":"(YXBwX2NvbGxlY3Rpb246[^"]+)"/,
    /"__module_component_ProfileCometPaginatedAppCollection_timelineAppCollection":\{"__dr":"ProfileCometAppCollectionReelsRenderer\.react"\},"id":"(YXBwX2NvbGxlY3Rpb246[^"]+)"/,
    /ProfileCometAppCollectionReelsRenderer[\s\S]{0,1400}?"id":"(YXBwX2NvbGxlY3Rpb246[^"]+)"/,
    /ProfileCometAppCollectionVideosRenderer[\s\S]{0,1400}?"id":"(YXBwX2NvbGxlY3Rpb246[^"]+)"/,
    /\\"collectionToken\\"\s*:\s*\\"(YXBwX2NvbGxlY3Rpb246[^"\\]+)\\"/,
    /owner_reels[\s\S]{0,1400}?\\"id\\"\s*:\s*\\"(YXBwX2NvbGxlY3Rpb246[^"\\]+)\\"/
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return '';
}

function extractPaginationQueryFromText(text) {
  const source = decodeHtmlForMatching(text);

  for (const name of PAGINATION_QUERY_NAMES) {
    const patterns = [
      new RegExp(`"params"\\s*:\\s*\\{"id":"(\\d+)"[\\s\\S]{0,260}?"name":"${name}"`),
      new RegExp(`"name":"${name}"[\\s\\S]{0,260}?"id":"(\\d+)"`),
      new RegExp(`${name}[\\s\\S]{0,700}?"id":"(\\d+)"`),
      new RegExp(`${name}\\\\.graphql[\\s\\S]{0,700}?"id":"(\\d+)"`),
      new RegExp(`${name}[\\s\\S]{0,700}?\\\\"id\\\\"\\s*:\\s*\\\\"(\\d+)\\\\"`)
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match && match[1]) {
        return { queryId: match[1], queryName: name };
      }
    }
  }

  return { queryId: '', queryName: '' };
}

function extractSlugHintsFromText(text) {
  const source = decodeHtmlForMatching(text);
  const slugs = [];

  function add(slug) {
    const clean = String(slug || '').trim().replace(/^\/+|\/+$/g, '');
    if (
      clean &&
      !/^\d+$/.test(clean) &&
      !clean.includes('/') &&
      !['profile.php', 'reel', 'reels', 'videos', 'watch', 'pages'].includes(clean.toLowerCase()) &&
      !slugs.includes(clean)
    ) {
      slugs.push(clean);
    }
  }

  const patterns = [
    /"(?:vanity|username|page_uri|profile_uri)"\s*:\s*"([^"\\/?#]+)"/g,
    /"url"\s*:\s*"https:\\\/\\\/www\.facebook\.com\\\/([^"\\/?#]+)(?:\\\/(?:reels|videos))?/g,
    /"url"\s*:\s*"https:\/\/www\.facebook\.com\/([^"\/?#]+)(?:\/(?:reels|videos))?/g,
    /https?:\/\/(?:www|web|m)\.facebook\.com\/([^\/\s"'<>?#]+)\/(?:reels|videos)/g
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      add(match[1]);
    }
  }

  return slugs;
}

async function collectDomSnapshot(webContents, baseUrl) {
  const payload = await webContents.executeJavaScript(
    `(() => {
      const anchorNodes = Array.from(document.querySelectorAll('a[href]'));
      const anchors = anchorNodes.map(anchor => anchor.href);
      const roleLinks = Array.from(document.querySelectorAll('[role="link"][href]')).map(node => node.href);
      const canonical =
        document.querySelector('link[rel="canonical"]')?.href ||
        document.querySelector('meta[property="og:url"]')?.content ||
        '';
      const html = document.documentElement ? document.documentElement.outerHTML : '';
      const text = document.body ? document.body.innerText : '';
      return {
        hrefs: anchors.concat(roleLinks),
        paginationLinks: anchorNodes.map(anchor => ({
          href: anchor.href,
          text: String(anchor.textContent || anchor.getAttribute('aria-label') || '').trim()
        })),
        canonical,
        location: window.location.href,
        html: html.slice(0, 1800000),
        text: text.slice(0, 300000)
      };
    })();`,
    true
  );

  const ids = new Set();
  const hrefs = Array.isArray(payload && payload.hrefs) ? payload.hrefs : [];
  for (const href of hrefs) {
    const absolute = toAbsoluteFacebookUrl(href, baseUrl);
    const videoId = extractVideoIdFromUrl(absolute);
    if (videoId) {
      ids.add(videoId);
    }
  }

  for (const videoId of collectVideoIdsFromText(payload && payload.html, baseUrl)) {
    ids.add(videoId);
  }

  for (const videoId of collectVideoIdsFromText(payload && payload.text, baseUrl)) {
    ids.add(videoId);
  }

  const paginationUrls = [];
  for (const link of Array.isArray(payload?.paginationLinks) ? payload.paginationLinks : []) {
    // Giữ nguyên host m.facebook.com/mbasic.facebook.com. Ép sang www ở đây
    // sẽ làm hỏng link "Xem thêm" và quay lại batch 10 đầu tiên.
    const absolute = toAbsoluteFacebookPaginationUrl(link?.href, baseUrl);
    if (!absolute || extractVideoIdFromUrl(absolute)) continue;
    const text = String(link?.text || '');
    const hasPaginationParam = /[?&](?:cursor|startindex|sectionLoadingID|bacr|pageno|after)=/i.test(absolute);
    const hasPaginationLabel = /see more|show more|view more|xem th[eê]m|ti[eế]p|next|older/i.test(text);
    if ((hasPaginationParam || hasPaginationLabel) && !paginationUrls.includes(absolute)) {
      paginationUrls.push(absolute);
    }
  }

  return {
    ids: [...ids],
    paginationUrls,
    html: payload && payload.html ? payload.html : '',
    location: payload && payload.location ? payload.location : '',
    canonical: payload && payload.canonical ? payload.canonical : ''
  };
}

function destroyWindow(win) {
  if (win && !win.isDestroyed()) {
    win.destroy();
  }
}

async function startDomScanner(rawPageUrl, mainWindow, options = {}) {
  const pageUrl = normalizeFacebookUrl(rawPageUrl);
  const scanPlan = buildScanPlan(pageUrl);
  const candidateUrls = scanPlan.urls;
  const isNumericMode = scanPlan.mode === 'numeric';
  const scanWin = await createHiddenWindow();
  const webContents = scanWin.webContents;
  const maxVideos = normalizeMaxVideos(options.maxVideos);
  const scanTimeoutMs = computeScanTimeoutMs(maxVideos, options.scanTimeoutMs);
  const discoveredInScan = new Set();
  const startedAt = Date.now();

  let scrollInterval = null;
  let firstScanTimeout = null;
  let scanTimeout = null;
  let noUidTimeout = null;
  let heartbeatInterval = null;
  let stopped = false;
  let domScanCount = 0;
  let scrollCount = 0;
  let paginationCount = 0;
  let stableRounds = 0;
  let bestCount = 0;
  let paginationQueryId = '';
  let paginationQueryName = PAGINATION_QUERY_NAMES[0];
  let collectionToken = '';
  let nextCursor = '';
  let activeCandidateIndex = 0;
  let activePageUrl = candidateUrls[0] || pageUrl;
  const seenCursors = new Set();
  const seenPaginationUrls = new Set();
  const pendingPaginationUrls = [];

  function buildStatus(payload = {}) {
    return {
      found: discoveredInScan.size,
      limit: maxVideos,
      domScanCount,
      scrollCount,
      paginationCount,
      activeUrl: activePageUrl,
      mode: scanPlan.mode,
      routeIndex: activeCandidateIndex + 1,
      routeTotal: candidateUrls.length,
      elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
      ...payload
    };
  }

  function sendScannerStatus(payload) {
    sendStatus(mainWindow, buildStatus(payload));
  }

  function stopScan(reason = 'cancelled') {
    if (stopped) {
      return;
    }

    stopped = true;
    clearInterval(scrollInterval);
    clearInterval(heartbeatInterval);
    clearTimeout(firstScanTimeout);
    clearTimeout(scanTimeout);
    clearTimeout(noUidTimeout);
    destroyWindow(scanWin);
    sendScannerStatus({ state: 'stopped', reason });
  }

  function resetNoUidTimer() {
    clearTimeout(noUidTimeout);
    const timeoutMs = discoveredInScan.size > 0 ? STALE_AFTER_FOUND_TIMEOUT_MS : INITIAL_NO_UID_TIMEOUT_MS;
    noUidTimeout = setTimeout(() => {
      if (isNumericMode && tryNextRoute('stale')) {
        return;
      }
      stopScan('no-uids');
    }, timeoutMs);
  }

  function resetRouteState() {
    paginationQueryId = '';
    paginationQueryName = PAGINATION_QUERY_NAMES[0];
    collectionToken = '';
    nextCursor = '';
    seenCursors.clear();
    stableRounds = 0;
    bestCount = discoveredInScan.size;
  }

  function loadActiveRoute(reason) {
    resetRouteState();
    resetNoUidTimer();
    sendScannerStatus({ state: 'route-loading', reason, url: activePageUrl });

    webContents
      .loadURL(activePageUrl, {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      })
      .then(() => {
        if (!stopped) {
          sendScannerStatus({ state: 'page-loaded', url: activePageUrl });
        }
      })
      .catch((error) => {
        if (!stopped) {
          sendScannerStatus({ state: 'load-error', error: error.message, url: activePageUrl });
          tryNextRoute('load-error');
        }
      });
  }

  function enqueuePaginationUrls(urls = []) {
    for (const url of urls) {
      if (!url || seenPaginationUrls.has(url) || pendingPaginationUrls.includes(url)) continue;
      pendingPaginationUrls.push(url);
    }
  }

  function loadNextPaginationPage(reason = 'pagination-link') {
    while (pendingPaginationUrls.length) {
      const nextUrl = pendingPaginationUrls.shift();
      if (!nextUrl || seenPaginationUrls.has(nextUrl)) continue;
      seenPaginationUrls.add(nextUrl);
      activePageUrl = nextUrl;
      resetRouteState();
      resetNoUidTimer();
      sendScannerStatus({
        state: 'pagination-page-loading',
        reason,
        page: seenPaginationUrls.size,
        url: nextUrl
      });
      webContents.loadURL(nextUrl, {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }).catch(error => {
        sendScannerStatus({ state: 'pagination-page-error', error: error.message, url: nextUrl });
        loadNextPaginationPage('pagination-link-error');
      });
      return true;
    }
    return false;
  }

  function tryNextRoute(reason) {
    if (activeCandidateIndex + 1 >= candidateUrls.length) {
      return false;
    }

    activeCandidateIndex += 1;
    activePageUrl = candidateUrls[activeCandidateIndex];
    loadActiveRoute(reason);
    return true;
  }

  function publishNewUids(uids, source = 'dom') {
    if (stopped || !Array.isArray(uids) || uids.length === 0) {
      return;
    }

    const newUids = uids.filter((uid) => /^\d+$/.test(uid) && !discoveredInScan.has(uid));
    const allowedUids = maxVideos > 0 ? newUids.slice(0, Math.max(maxVideos - discoveredInScan.size, 0)) : newUids;
    allowedUids.forEach((uid) => discoveredInScan.add(uid));
    sendDiscoveredUids(mainWindow, allowedUids);

    if (allowedUids.length > 0) {
      resetNoUidTimer();
      stableRounds = 0;
      bestCount = discoveredInScan.size;
      sendScannerStatus({
        state: 'uids-found',
        source,
        count: allowedUids.length
      });
    }

    if (maxVideos > 0 && discoveredInScan.size >= maxVideos) {
      stopScan('limit-reached');
    }
  }

  function updatePaginationStateFromText(text, options = {}) {
    if (!collectionToken) {
      collectionToken = extractCollectionToken(text);
    }

    if (!paginationQueryId) {
      const extractedQuery = extractPaginationQueryFromText(text);
      if (extractedQuery.queryId) {
        paginationQueryId = extractedQuery.queryId;
        paginationQueryName = extractedQuery.queryName || paginationQueryName;
      }
    }

    const hints = extractPaginationHints(text, options);
    const candidateCursor = hints.endCursors.find((cursor) => cursor && !seenCursors.has(cursor));
    if (candidateCursor) {
      nextCursor = candidateCursor;
    }
  }

  function addSlugRoute(slugOrUrl, source = 'hint') {
    if (!isNumericMode) {
      return;
    }

    let slug = String(slugOrUrl || '').trim();
    if (!slug) {
      return;
    }

    if (/^https?:\/\//i.test(slug)) {
      const absolute = toAbsoluteFacebookUrl(slug, activePageUrl);
      if (!absolute) {
        return;
      }

      try {
        const parsed = new URL(absolute);
        slug = parsed.pathname.split('/').filter(Boolean)[0] || '';
      } catch (error) {
        return;
      }
    }

    slug = slug.replace(/^\/+|\/+$/g, '');
    if (!slug || /^\d+$/.test(slug) || slug === 'profile.php') {
      return;
    }

    const reelsUrl = `https://www.facebook.com/${slug}/reels/`;
    if (!candidateUrls.includes(reelsUrl)) {
      candidateUrls.splice(Math.min(activeCandidateIndex + 1, candidateUrls.length), 0, reelsUrl);
      sendScannerStatus({ state: 'route-added', source, url: reelsUrl });
    }
  }

  function addCanonicalRoute(candidate) {
    const absolute = toAbsoluteFacebookUrl(candidate, activePageUrl);
    if (!absolute) {
      return;
    }

    try {
      const parsed = new URL(absolute);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const slug = parts[0] || '';
      if (!slug || /^\d+$/.test(slug) || slug === 'profile.php') {
        return;
      }

      addSlugRoute(slug, 'canonical');
    } catch (error) {
      // Ignore malformed canonical hints.
    }
  }

  async function runDomScan() {
    if (stopped || scanWin.isDestroyed() || webContents.isDestroyed()) {
      return;
    }

    try {
      domScanCount += 1;
      const snapshot = await collectDomSnapshot(webContents, activePageUrl);
      enqueuePaginationUrls(snapshot.paginationUrls);
      addCanonicalRoute(snapshot.location);
      addCanonicalRoute(snapshot.canonical);
      for (const slug of extractSlugHintsFromText(snapshot.html)) {
        addSlugRoute(slug, 'html');
      }
      updatePaginationStateFromText(snapshot.html, { parseJson: false });
      publishNewUids(snapshot.ids, 'dom');

      if (discoveredInScan.size > bestCount) {
        bestCount = discoveredInScan.size;
        stableRounds = 0;
      } else {
        stableRounds += 1;
      }

      sendScannerStatus({ state: 'dom-scan', stableRounds });

      if (
        discoveredInScan.size > 0 &&
        stableRounds >= 3 &&
        loadNextPaginationPage('dom-stable')
      ) {
        return;
      }

      if (
        isNumericMode &&
        discoveredInScan.size > 0 &&
        stableRounds >= STABLE_ROUTE_SWITCH_ROUNDS &&
        tryNextRoute('stable')
      ) {
        sendScannerStatus({ state: 'route-switch-stable', stableRounds });
      }
    } catch (error) {
      sendScannerStatus({ state: 'dom-scan-error', error: error.message });
    }
  }

  async function ensurePaginationQueryId() {
    if (paginationQueryId || stopped || webContents.isDestroyed()) {
      return paginationQueryId;
    }

    try {
      paginationQueryId = await webContents.executeJavaScript(
        `(() => {
          const names = ${JSON.stringify(PAGINATION_QUERY_NAMES)};
          for (const name of names) {
            try {
              const query = require(name + '.graphql');
              if (query?.params?.id) {
                return { id: query.params.id, name };
              }
            } catch (_) {}
          }
          return { id: '', name: '' };
        })();`,
        true
      );
      if (paginationQueryId && typeof paginationQueryId === 'object') {
        paginationQueryName = paginationQueryId.name || paginationQueryName;
        paginationQueryId = paginationQueryId.id || '';
      }
    } catch (error) {
      paginationQueryId = '';
    }

    return paginationQueryId;
  }

  async function runPaginationFetch() {
    if (
      stopped ||
      scanWin.isDestroyed() ||
      webContents.isDestroyed() ||
      seenCursors.has(nextCursor) ||
      (maxVideos > 0 && discoveredInScan.size >= maxVideos)
    ) {
      return;
    }

    if (!collectionToken || !nextCursor) {
      sendScannerStatus({
        state: 'pagination-waiting',
        hasToken: Boolean(collectionToken),
        hasCursor: Boolean(nextCursor),
        hasQuery: Boolean(paginationQueryId),
        queryName: paginationQueryName
      });
      return;
    }

    const queryId = await ensurePaginationQueryId();
    if (!queryId) {
      sendScannerStatus({
        state: 'pagination-waiting',
        hasToken: Boolean(collectionToken),
        hasCursor: Boolean(nextCursor),
        hasQuery: false,
        queryName: paginationQueryName
      });
      return;
    }

    const cursor = nextCursor;
    seenCursors.add(cursor);
    paginationCount += 1;

    try {
      const remaining = maxVideos > 0 ? Math.max(maxVideos - discoveredInScan.size, 1) : 10;
      const pageText = await webContents.executeJavaScript(
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
            params.set('__req', String(payload.req || 1));
            params.set('__hs', '20540.HYP:comet_loggedout_pkg.2.1...0');
            params.set('dpr', String(window.devicePixelRatio || 1));
            params.set('__ccg', 'EXCELLENT');
            params.set('__rev', String(siteData?.server_revision || ''));
            params.set('__comet_req', '15');
            params.set('lsd', lsd);
            params.set('jazoest', document.querySelector('[name="jazoest"]')?.value || '22191');
            params.set('__spin_r', String(siteData?.server_revision || ''));
            params.set('__spin_b', siteData?.__spin_b || 'trunk');
            params.set('__spin_t', String(siteData?.__spin_t || Math.floor(Date.now() / 1000)));
            params.set('fb_api_caller_class', 'RelayModern');
            params.set('fb_api_req_friendly_name', payload.queryName);
            params.set('server_timestamps', 'true');
            params.set(
              'variables',
              JSON.stringify({
                id: payload.collectionToken,
                cursor: payload.cursor,
                count: Math.max(1, payload.count || 10),
                scale: 1,
                useDefaultActor: false
              })
            );
            params.set('doc_id', payload.queryId);

            const response = await fetch('/api/graphql/', {
              method: 'POST',
              headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-fb-friendly-name': payload.queryName,
                'x-asbd-id': '359341',
                'x-fb-lsd': lsd
              },
              body: params.toString(),
              credentials: 'include'
            });

            return await response.text();
          } catch (error) {
            return JSON.stringify({ __scan_error: String(error) });
          }
        })(${JSON.stringify({
          queryId,
          queryName: paginationQueryName,
          collectionToken,
          cursor,
          count: Math.min(24, remaining),
          req: paginationCount + 1
        })});`,
        true
      );

      updatePaginationStateFromText(pageText || '', { parseJson: true });
      publishNewUids(collectVideoIdsFromText(pageText || '', activePageUrl), 'pagination');
      sendScannerStatus({ state: 'pagination', cursorSeen: seenCursors.size, hasNextCursor: Boolean(nextCursor && !seenCursors.has(nextCursor)) });
    } catch (error) {
      sendScannerStatus({ state: 'pagination-error', error: error.message });
    }
  }

  async function runScroll() {
    if (stopped || scanWin.isDestroyed() || webContents.isDestroyed()) {
      return;
    }

    try {
      await runDomScan();
      await runPaginationFetch();
      if (stopped) {
        return;
      }

      webContents.sendInputEvent({ type: 'mouseMove', x: 640, y: 460 });
      webContents.sendInputEvent({ type: 'mouseWheel', x: 640, y: 460, deltaX: 0, deltaY: -1150, canScroll: true });
      webContents.sendInputEvent({ type: 'keyDown', keyCode: 'PageDown' });
      webContents.sendInputEvent({ type: 'keyUp', keyCode: 'PageDown' });

      await webContents.executeJavaScript(
        `(() => {
          const beforeY = window.scrollY || document.documentElement.scrollTop || 0;
          const deltas = [
            Math.max(window.innerHeight * 1.15, 850),
            Math.max(window.innerHeight * 1.55, 1150),
            Math.max(window.innerHeight * 2.05, 1500)
          ];

          for (const delta of deltas) {
            window.scrollBy(0, delta);
            window.dispatchEvent(new Event('scroll'));
            document.dispatchEvent(new Event('scroll', { bubbles: true }));
            document.body && document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: delta }));
          }

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
            for (const delta of deltas) {
              const nextTop = Math.min(
                element.scrollTop + Math.max(delta, element.clientHeight * 0.95),
                element.scrollHeight
              );
              if (nextTop <= element.scrollTop) {
                continue;
              }
              element.scrollTop = nextTop;
              element.dispatchEvent(new Event('scroll', { bubbles: true }));
              element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: delta }));
            }
          }

          const afterY = window.scrollY || document.documentElement.scrollTop || 0;
          return {
            beforeY,
            afterY,
            scrollables: scrollables.length,
            bodyHeight: document.body ? document.body.scrollHeight : 0,
            docHeight: document.documentElement ? document.documentElement.scrollHeight : 0
          };
        })();`,
        true
      );
      scrollCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 420));
      await runDomScan();
      await runPaginationFetch();
    } catch (error) {
      sendScannerStatus({ state: 'scroll-error', error: error.message });
    }
  }

  scanTimeout = setTimeout(() => {
    stopScan('timeout');
  }, scanTimeoutMs);
  resetNoUidTimer();

  sendScannerStatus({
    state: 'loading',
    url: activePageUrl,
    scanTimeoutSeconds: Math.floor(scanTimeoutMs / 1000),
    noUidTimeoutSeconds: Math.floor(INITIAL_NO_UID_TIMEOUT_MS / 1000),
    staleAfterFoundSeconds: Math.floor(STALE_AFTER_FOUND_TIMEOUT_MS / 1000)
  });

  loadActiveRoute('initial');

  heartbeatInterval = setInterval(() => {
    if (!stopped) {
      sendScannerStatus({ state: 'heartbeat' });
    }
  }, HEARTBEAT_INTERVAL_MS);

  sendScannerStatus({ state: 'scanning', url: activePageUrl });
  firstScanTimeout = setTimeout(() => {
    runScroll();
    scrollInterval = setInterval(runScroll, SCROLL_INTERVAL_MS);
  }, FIRST_SCAN_DELAY_MS);

  return stopScan;
}

module.exports = {
  normalizeMaxVideos,
  normalizeFacebookUrl,
  startDomScanner
};
