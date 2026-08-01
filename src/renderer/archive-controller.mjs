const STORE_KEY = 'archiveSources.v1';

export function createArchiveController(deps) {
  const { api, $, storeGet, storeSet, enqueueBatchJob, showStatus } = deps;
  let sources = [];
  let scheduler = null;
  let schedulerBusy = false;

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[char]));

  function normalizeSource(source = {}) {
    return {
      id: String(source.id || `archive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
      name: String(source.name || 'Nguồn chưa đặt tên'),
      url: String(source.url || ''),
      platform: String(source.platform || detectPlatform(source.url)),
      mode: ['notify', 'queue', 'auto'].includes(source.mode) ? source.mode : 'queue',
      intervalMinutes: Math.max(0, Number(source.intervalMinutes) || 0),
      maxVideos: Math.max(1, Math.min(Number(source.maxVideos) || 100, 1000)),
      folder: String(source.folder || ''),
      enabled: source.enabled !== false,
      status: String(source.status || 'idle'),
      message: String(source.message || ''),
      lastCheckedAt: source.lastCheckedAt || null,
      lastChangedAt: source.lastChangedAt || null,
      items: Array.isArray(source.items) ? source.items : [],
      pendingIds: Array.isArray(source.pendingIds) ? source.pendingIds : [],
      removedIds: Array.isArray(source.removedIds) ? source.removedIds : [],
    };
  }

  function detectPlatform(url) {
    const value = String(url || '');
    if (/facebook\.com/i.test(value)) return 'Facebook';
    if (/youtu(?:be\.com|\.be)/i.test(value)) return 'YouTube';
    if (/tiktok\.com/i.test(value)) return 'TikTok';
    if (/instagram\.com/i.test(value)) return 'Instagram';
    return 'Nguồn video';
  }

  async function persist() {
    await storeSet(STORE_KEY, sources.slice(-100));
  }

  async function initialize() {
    const stored = await storeGet(STORE_KEY);
    sources = (Array.isArray(stored) ? stored : []).map(normalizeSource);
    render();
    scheduler = setInterval(checkDueSources, 60_000);
    setTimeout(checkDueSources, 8_000);
  }

  function videoIdOf(video = {}) {
    const direct = String(video.videoId || video.id || '').trim();
    if (direct) return direct;
    const url = String(video.url || '').trim();
    const match = url.match(/(?:v=|shorts\/|reel\/|video\/)([\w-]{5,})/i);
    return match?.[1] || url;
  }

  function normalizeVideo(video, source) {
    const videoId = videoIdOf(video);
    let url = String(video.url || '').trim();
    if (!url && source.platform === 'Facebook' && videoId) url = `https://www.facebook.com/reel/${videoId}`;
    return {
      videoId,
      url,
      title: String(video.title || videoId || 'Video'),
      author: String(video.author || video.channel || video.uploader || ''),
      channel: String(video.channel || video.author || video.uploader || ''),
      duration: Number(video.duration) || 0,
      thumbnail: String(video.thumbnail || ''),
      status: 'discovered',
      filePath: '',
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
  }

  async function addSource() {
    const url = $('archiveSourceUrl')?.value.trim() || '';
    if (!/^https?:\/\//i.test(url)) return showStatus('Hãy nhập URL nguồn hợp lệ.', 'warn');
    if (sources.some(source => source.url.replace(/\/$/, '') === url.replace(/\/$/, ''))) {
      return showStatus('Nguồn này đã có trong Watch List.', 'warn');
    }
    let folder = $('batchFolderInput')?.value.trim() || '';
    if (!folder) folder = await api?.getDefaultDownloadFolder?.();
    const source = normalizeSource({
      name: $('archiveSourceName')?.value.trim() || detectPlatform(url),
      url,
      mode: $('archiveSourceMode')?.value || 'queue',
      intervalMinutes: Number($('archiveSourceInterval')?.value) || 0,
      maxVideos: Number($('archiveSourceLimit')?.value) || 100,
      folder,
    });
    sources.push(source);
    await persist();
    render();
    if ($('archiveSourceUrl')) $('archiveSourceUrl').value = '';
    if ($('archiveSourceName')) $('archiveSourceName').value = '';
    await syncSource(source.id, { manual: true });
  }

  async function syncSource(sourceId, { manual = false } = {}) {
    const source = sources.find(item => item.id === sourceId);
    if (!source || source.status === 'syncing') return;
    source.status = 'syncing';
    source.message = 'Đang quét nguồn…';
    render();
    try {
      const result = await api.scanArchiveSource({ url: source.url, maxVideos: source.maxVideos });
      const videos = (result?.videos || []).map(video => normalizeVideo(video, source)).filter(video => video.videoId && video.url);
      if (!videos.length && result?.success === false) throw new Error(result.error || 'Không quét được nguồn.');

      const existingById = new Map(source.items.map(item => [String(item.videoId), item]));
      const currentIds = new Set(videos.map(video => video.videoId));
      const pathStates = await api.archivePathsExist?.(source.items.map(item => item.filePath).filter(Boolean)) || {};
      const fileMatches = await api.archiveFindExisting?.({ folder: source.folder, videoIds: videos.map(video => video.videoId) }) || {};
      const newlyDiscovered = [];

      for (const video of videos) {
        const old = existingById.get(video.videoId);
        const filePath = (old?.filePath && pathStates[old.filePath] ? old.filePath : '') || fileMatches[video.videoId] || '';
        const status = filePath ? 'archived' : (old?.status === 'archived' ? 'missing' : (old?.status || 'discovered'));
        const next = { ...old, ...video, status, filePath, firstSeenAt: old?.firstSeenAt || video.firstSeenAt };
        existingById.set(video.videoId, next);
        if (!old || status === 'missing') newlyDiscovered.push(next);
      }

      // Chỉ kết luận "không còn trên nguồn" khi lượt quét kết thúc trước giới hạn.
      // Nếu lấy đúng maxVideos, nguồn có thể còn các trang cũ chưa được quét.
      if (videos.length < source.maxVideos) {
        source.removedIds = source.items.filter(item => !currentIds.has(String(item.videoId))).map(item => item.videoId);
      }
      source.items = [...existingById.values()];
      source.pendingIds = [...new Set([...source.pendingIds, ...newlyDiscovered.map(video => video.videoId)])]
        .filter(id => source.items.some(item => item.videoId === id && item.status !== 'archived'));
      const detectedName = videos.map(video => video.channel || video.author).find(Boolean);
      if ((!source.name || source.name === source.platform || source.name === 'Nguồn video') && detectedName) source.name = detectedName;
      source.lastCheckedAt = new Date().toISOString();
      if (newlyDiscovered.length) source.lastChangedAt = source.lastCheckedAt;
      source.status = newlyDiscovered.length ? 'new' : 'ok';
      source.message = newlyDiscovered.length ? `${newlyDiscovered.length} video mới hoặc còn thiếu` : 'Thư viện đã đồng bộ';
      await persist();
      render();

      if (newlyDiscovered.length && source.mode !== 'auto') {
        api.showSystemNotification?.({
          title: `${source.name} có nội dung mới`,
          body: `Phát hiện ${newlyDiscovered.length} video mới hoặc file còn thiếu.`,
        });
      }

      if (source.mode === 'auto' && source.pendingIds.length) await downloadPending(source.id);
      else if (manual) showStatus(`${source.name}: ${source.message}`, newlyDiscovered.length ? 'info' : 'ok');
    } catch (error) {
      source.status = 'error';
      source.message = error?.message || 'Không thể đồng bộ nguồn.';
      source.lastCheckedAt = new Date().toISOString();
      await persist();
      render();
      if (manual) showStatus(`${source.name}: ${source.message}`, 'err');
    }
  }

  async function downloadPending(sourceId) {
    const source = sources.find(item => item.id === sourceId);
    if (!source) return;
    const pending = source.items.filter(item => source.pendingIds.includes(item.videoId) && item.status !== 'archived');
    if (!pending.length) return showStatus(`${source.name}: không có video cần tải.`, 'info');
    pending.forEach(item => { item.status = 'queued'; });
    source.status = 'queued';
    source.message = `${pending.length} video đã đưa vào hàng đợi`;
    await persist();
    render();
    await enqueueBatchJob(pending.map(video => ({
      ...video,
      archiveSourceId: source.id,
      archiveVideoId: video.videoId,
    })), {
      name: `${source.name} — ${pending.length} video`,
      folder: source.folder,
      format: 'mp4',
      quality: '1080p',
      sourceMode: 'archive',
      historyTitle: `${source.name} — Archive Sync`,
    });
  }

  async function recordDownload(video, result = null, error = null) {
    if (!video?.archiveSourceId || !video?.archiveVideoId) return;
    const source = sources.find(item => item.id === video.archiveSourceId);
    const item = source?.items.find(entry => entry.videoId === video.archiveVideoId);
    if (!source || !item) return;
    item.status = error ? 'failed' : 'archived';
    if (result?.filePath) item.filePath = result.filePath;
    if (!error) source.pendingIds = source.pendingIds.filter(id => id !== item.videoId);
    source.status = error ? 'error' : (source.pendingIds.length ? 'new' : 'ok');
    source.message = error ? `Tải lỗi: ${item.title}` : (source.pendingIds.length ? `${source.pendingIds.length} video đang chờ` : 'Thư viện đã đồng bộ');
    await persist();
    render();
  }

  async function removeSource(sourceId) {
    sources = sources.filter(source => source.id !== sourceId);
    await persist();
    render();
  }

  async function syncAll() {
    for (const source of sources.filter(item => item.enabled)) await syncSource(source.id, { manual: true });
  }

  async function checkDueSources() {
    if (schedulerBusy) return;
    schedulerBusy = true;
    try {
      const now = Date.now();
      for (const source of sources.filter(item => item.enabled && item.intervalMinutes > 0)) {
        const last = Date.parse(source.lastCheckedAt || '') || 0;
        if (now - last >= source.intervalMinutes * 60_000) await syncSource(source.id);
      }
    } finally {
      schedulerBusy = false;
    }
  }

  function render() {
    const container = $('archiveSourceList');
    if (!container) return;
    const totalPending = sources.reduce((sum, source) => sum + source.pendingIds.length, 0);
    if ($('archiveBadge')) $('archiveBadge').textContent = String(totalPending);
    if ($('archiveSummary')) $('archiveSummary').textContent = sources.length
      ? `${sources.length} nguồn · ${totalPending} video mới/chưa tải`
      : 'Chưa có nguồn theo dõi.';
    if (!sources.length) {
      container.innerHTML = '<div class="batch-job-empty">Thêm URL nguồn để bắt đầu Watch List và Archive Sync.</div>';
      return;
    }
    container.innerHTML = sources.map(source => {
      const archived = source.items.filter(item => item.status === 'archived').length;
      const missing = source.items.filter(item => item.status === 'missing' || item.status === 'failed').length;
      const mode = source.mode === 'auto' ? 'Tự động tải' : source.mode === 'notify' ? 'Chỉ thông báo' : 'Chờ xác nhận';
      const checked = source.lastCheckedAt ? new Date(source.lastCheckedAt).toLocaleString('vi-VN') : 'Chưa quét';
      return `<div class="archive-source-card" data-source-id="${escapeHtml(source.id)}">
        <div class="archive-source-head"><div><div class="archive-source-name">${escapeHtml(source.name)}</div><div class="archive-source-url">${escapeHtml(source.platform)} · ${escapeHtml(source.url)}</div></div>
        <div class="archive-source-actions"><button class="btn btn-ghost btn-xs" data-action="sync">Đồng bộ</button>${source.pendingIds.length ? `<button class="btn btn-primary btn-xs" data-action="download">Tải ${source.pendingIds.length} mới</button>` : ''}<button class="btn btn-danger btn-xs" data-action="remove">Xóa nguồn</button></div></div>
        <div class="archive-source-stats"><div class="archive-stat"><span>Đã phát hiện</span><b>${source.items.length}</b></div><div class="archive-stat"><span>Đã lưu</span><b>${archived}</b></div><div class="archive-stat"><span>Mới/chờ</span><b>${source.pendingIds.length}</b></div><div class="archive-stat"><span>Thiếu/lỗi</span><b>${missing}</b></div><div class="archive-stat"><span>Không còn thấy</span><b>${source.removedIds.length}</b></div></div>
        <div class="archive-source-foot"><span class="archive-status-${escapeHtml(source.status)}">${escapeHtml(source.message || 'Sẵn sàng')}</span><span>${escapeHtml(mode)} · ${escapeHtml(checked)}</span></div>
      </div>`;
    }).join('');
  }

  function handleClick(event) {
    const button = event.target.closest('[data-action]');
    const card = button?.closest('[data-source-id]');
    if (!button || !card) return;
    const sourceId = card.dataset.sourceId;
    if (button.dataset.action === 'sync') syncSource(sourceId, { manual: true });
    if (button.dataset.action === 'download') downloadPending(sourceId);
    if (button.dataset.action === 'remove') removeSource(sourceId);
  }

  return { initialize, addSource, syncAll, syncSource, downloadPending, recordDownload, handleClick, render };
}
