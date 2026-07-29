(() => {
  const BUTTON_ID = 'andrew-downloader-video-button';
  let enabled = true;
  let updateQueued = false;
  let activeVideoUrl = '';

  async function sendDownload(url, button) {
    if (!/^https?:\/\//i.test(String(url || ''))) return;
    const requestId = `${Date.now()}-${crypto.randomUUID().replaceAll('-', '')}`;
    showButtonStatus(button, 'Đang kết nối…', 'working');
    location.href = `andrew-downloader://download?url=${encodeURIComponent(url)}&requestId=${encodeURIComponent(requestId)}`;
    pollDownloadStatus(requestId, button);
  }

  function showButtonStatus(button, text, state = 'working') {
    if (!button) return;
    let status = button.parentElement?.querySelector?.(`:scope > .andrew-download-progress[data-for="${button.dataset.andrewId}"]`);
    if (!status) {
      button.dataset.andrewId ||= crypto.randomUUID();
      status = document.createElement('div');
      status.className = 'andrew-download-progress';
      if (button.id === BUTTON_ID) status.classList.add('andrew-primary-progress');
      status.dataset.for = button.dataset.andrewId;
      button.insertAdjacentElement('afterend', status);
    }
    status.textContent = text;
    if (button.id === BUTTON_ID) {
      const rect = button.getBoundingClientRect();
      status.style.top = `${rect.bottom + 5}px`;
      status.style.right = `${Math.max(8, innerWidth - rect.right)}px`;
    }
    status.dataset.state = state;
    status.hidden = false;
  }

  async function pollDownloadStatus(requestId, button) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30 * 60 * 1000) {
      await new Promise(resolve => setTimeout(resolve, 700));
      try {
        const response = await fetch(`http://127.0.0.1:32145/status?id=${encodeURIComponent(requestId)}`, { cache: 'no-store' });
        if (!response.ok) continue;
        const status = await response.json();
        if (status.state === 'completed') {
          showButtonStatus(button, '✓ Tải xong', 'completed');
          return;
        }
        if (status.state === 'failed') {
          showButtonStatus(button, `Lỗi: ${status.message || 'Không tải được'}`, 'failed');
          return;
        }
        const percent = Math.max(0, Math.min(99, Number(status.percent) || 0));
        showButtonStatus(button, percent > 0 ? `Đang tải ${Math.round(percent)}%` : (status.message || 'Đang kết nối…'), 'working');
      } catch (_) {
        showButtonStatus(button, 'Đang mở ứng dụng…', 'working');
      }
    }
    showButtonStatus(button, 'Quá thời gian chờ', 'failed');
  }

  function resolveVideoUrl(video) {
    const currentUrl = location.href;
    if (/youtube\.com\/(?:watch|shorts)|youtu\.be\/|facebook\.com\/(?:reel|watch)|instagram\.com\/reel|tiktok\.com\/@[^/]+\/video/i.test(currentUrl)) {
      return currentUrl;
    }

    const container = video?.closest?.(
      'ytd-rich-item-renderer,ytd-video-renderer,ytd-grid-video-renderer,ytd-reel-item-renderer,ytd-reel-video-renderer,[data-e2e*="video"],article',
    );
    const candidate = container?.querySelector?.(
      'a#thumbnail[href],a[href*="/watch?"],a[href*="/shorts/"],a[href*="/reel/"],a[href*="/video/"]',
    );
    return candidate?.href || currentUrl;
  }

  function getButton() {
    let button = document.getElementById(BUTTON_ID);
    if (button) return button;

    button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.title = 'Tải video bằng Andrew Downloader';

    const logo = document.createElement('img');
    logo.src = chrome.runtime.getURL('icon32.png');
    logo.alt = '';
    const label = document.createElement('span');
    label.textContent = 'Tải video';
    button.append(logo, label);

    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      sendDownload(activeVideoUrl || location.href, button);
    }, true);

    document.documentElement.appendChild(button);
    return button;
  }

  function getPrimaryVideo() {
    return [...document.querySelectorAll('video')]
      .map(video => ({ video, rect: video.getBoundingClientRect() }))
      .filter(({ rect }) => (
        rect.width >= 240 &&
        rect.height >= 135 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < innerHeight &&
        rect.left < innerWidth
      ))
      .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0] || null;
  }

  function updatePosition() {
    updateQueued = false;
    const button = getButton();
    if (!enabled) {
      button.classList.remove('andrew-visible');
      return;
    }

    const target = getPrimaryVideo();
    if (!target) {
      button.classList.remove('andrew-visible');
      return;
    }

    activeVideoUrl = resolveVideoUrl(target.video);
    button.style.left = 'auto';
    button.style.right = `${Math.max(8, innerWidth - target.rect.right + 10)}px`;
    button.style.top = `${Math.max(8, target.rect.top + 10)}px`;
    button.classList.add('andrew-visible');
    const progress = document.querySelector(`.andrew-primary-progress[data-for="${button.dataset.andrewId}"]`);
    if (progress) {
      progress.style.top = `${Math.max(8, target.rect.top + 49)}px`;
      progress.style.right = `${Math.max(8, innerWidth - target.rect.right + 10)}px`;
    }
  }

  function scanYouTubeCards() {
    if (!enabled || !/(^|\.)youtube\.com$/i.test(location.hostname)) return;
    const cards = document.querySelectorAll(
      'ytd-rich-item-renderer,ytd-video-renderer,ytd-grid-video-renderer,ytd-reel-item-renderer,ytd-reel-video-renderer',
    );

    cards.forEach(card => {
      if (card.querySelector(':scope .andrew-card-download')) return;
      const link = card.querySelector(
        'a#thumbnail[href*="/watch"],a#thumbnail[href*="/shorts/"],a[href*="/watch?v="],a[href*="/shorts/"]',
      );
      if (!link?.href) return;
      const cardUrl = new URL(link.getAttribute('href') || link.href, location.origin).href;
      if (!/youtube\.com\/(?:watch|shorts)\//i.test(cardUrl) && !/youtube\.com\/watch\?/i.test(cardUrl)) return;

      const host = card;
      const style = getComputedStyle(host);
      if (style.position === 'static') host.style.position = 'relative';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'andrew-card-download';
      button.title = 'Tải ngay bằng Andrew Downloader';
      const logo = document.createElement('img');
      logo.src = chrome.runtime.getURL('icon32.png');
      logo.alt = '';
      const label = document.createElement('span');
      label.textContent = 'Tải';
      button.append(logo, label);
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        sendDownload(cardUrl, button);
      }, true);
      host.appendChild(button);
    });
  }

  function scheduleUpdate() {
    if (updateQueued) return;
    updateQueued = true;
    requestAnimationFrame(updatePosition);
  }

  chrome.storage.local.get({ videoButtonEnabled: true }, settings => {
    enabled = settings.videoButtonEnabled !== false;
    scanYouTubeCards();
    scheduleUpdate();
  });

  chrome.storage.onChanged.addListener(changes => {
    if (!changes.videoButtonEnabled) return;
    enabled = changes.videoButtonEnabled.newValue !== false;
    document.querySelectorAll('.andrew-card-download').forEach(button => {
      button.style.display = enabled ? '' : 'none';
    });
    scanYouTubeCards();
    scheduleUpdate();
  });

  new MutationObserver(() => {
    scheduleUpdate();
    scanYouTubeCards();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  window.addEventListener('scroll', scheduleUpdate, true);
  window.addEventListener('resize', scheduleUpdate);
  document.addEventListener('fullscreenchange', scheduleUpdate);
  setInterval(scheduleUpdate, 1500);
  scheduleUpdate();
})();
