const STORE_KEY = 'archiveSources.v1';

export function createArchiveController(deps) {
  const { api, $, storeGet, storeSet, showStatus } = deps;
  let sources = [];
  let scheduler = null;
  let schedulerBusy = false;
  let archiveQueueBusy = false;

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
      baselineReady: source.baselineReady === true || Boolean(source.lastCheckedAt),
      autoRestore: source.autoRestore === true,
      format: String(source.format || 'mp4'),
      quality: String(source.quality || '1080p'),
      download: {
        status: ['idle', 'queued', 'running', 'stopped', 'completed', 'failed'].includes(source.download?.status)
          ? (source.download.status === 'running' ? 'stopped' : source.download.status) : 'idle',
        ids: Array.isArray(source.download?.ids) ? source.download.ids : [],
        index: Math.max(0, Number(source.download?.index) || 0),
        done: Math.max(0, Number(source.download?.done) || 0),
        failed: Math.max(0, Number(source.download?.failed) || 0),
        progress: 0,
        currentTitle: '',
        stopRequested: false,
      },
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
    if (sources.some(source => source.download.status === 'queued')) processArchiveQueue();
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
    const folder = $('archiveSourceFolder')?.value.trim() || '';
    if (!folder) return showStatus('Hãy chọn thư mục thư viện của nguồn để đối chiếu file.', 'warn');
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
    if ($('archiveSourceFolder')) $('archiveSourceFolder').value = '';
    await syncSource(source.id, { manual: true });
  }

  async function chooseAddFolder() {
    const folder = await api?.selectDownloadFolder?.();
    if (folder && $('archiveSourceFolder')) $('archiveSourceFolder').value = folder;
  }

  async function changeSourceFolder(sourceId) {
    const source = sources.find(item => item.id === sourceId);
    if (!source) return;
    const folder = await api?.selectDownloadFolder?.();
    if (!folder) return;
    source.folder = folder;
    source.status = 'idle';
    source.message = 'Đã đổi thư mục, cần đồng bộ lại';
    await persist();
    render();
    await syncSource(source.id, { manual: true });
  }

  async function syncSource(sourceId, { manual = false } = {}) {
    const source = sources.find(item => item.id === sourceId);
    if (!source || source.status === 'syncing') return;
    if (!source.folder) {
      source.status = 'error';
      source.message = 'Chưa chọn thư mục thư viện';
      await persist();
      render();
      if (manual) showStatus(`${source.name}: hãy chọn thư mục thư viện trước.`, 'warn');
      return;
    }
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
      const fileMatches = await api.archiveFindExisting?.({
        folder: source.folder,
        videos: videos.map(video => ({ videoId: video.videoId, title: video.title, duration: video.duration })),
      }) || {};
      const newlyDiscovered = [];
      const newIds = [];
      const missingIds = [];
      const hadBaseline = source.baselineReady;

      for (const video of videos) {
        const old = existingById.get(video.videoId);
        const filePath = (old?.filePath && pathStates[old.filePath] ? old.filePath : '') || fileMatches[video.videoId] || '';
        const status = filePath ? 'archived' : (old?.status === 'archived' ? 'missing' : (old?.status || 'discovered'));
        const next = { ...old, ...video, status, filePath, firstSeenAt: old?.firstSeenAt || video.firstSeenAt };
        existingById.set(video.videoId, next);
        if (!old || status === 'missing') newlyDiscovered.push(next);
        if (!old) newIds.push(next.videoId);
        else if (status === 'missing') missingIds.push(next.videoId);
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
      source.baselineReady = true;
      await persist();
      render();

      if (newlyDiscovered.length && source.mode !== 'auto') {
        api.showSystemNotification?.({
          title: `${source.name} có nội dung mới`,
          body: `Phát hiện ${newlyDiscovered.length} video mới hoặc file còn thiếu.`,
        });
      }

      const autoIds = hadBaseline && source.mode === 'auto'
        ? [...newIds, ...(source.autoRestore ? missingIds : [])]
        : [];
      if (autoIds.length) await downloadPending(source.id, autoIds);
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

  async function downloadPending(sourceId, selectedIds = null) {
    const source = sources.find(item => item.id === sourceId);
    if (!source) return;
    const allowedIds = new Set(Array.isArray(selectedIds) && selectedIds.length ? selectedIds : source.pendingIds);
    const pending = source.items.filter(item => allowedIds.has(item.videoId) && item.status !== 'archived');
    if (!pending.length) return showStatus(`${source.name}: không có video cần tải.`, 'info');
    pending.forEach(item => { item.status = 'queued'; });
    source.download = { status: 'queued', ids: pending.map(item => item.videoId), index: 0, done: 0, failed: 0, progress: 0, currentTitle: '', stopRequested: false };
    source.message = `${pending.length} video đang chờ trong nguồn này`;
    await persist();
    render();
    processArchiveQueue().catch(error => console.warn('Archive queue failed:', error));
  }

  async function processArchiveQueue() {
    if (archiveQueueBusy) return;
    archiveQueueBusy = true;
    try {
      while (true) {
        const source = sources.find(item => item.download.status === 'queued');
        if (!source) break;
        source.download.status = 'running';
        source.download.stopRequested = false;
        await persist();
        render();
        for (let index = source.download.index; index < source.download.ids.length; index++) {
          if (source.download.stopRequested) break;
          const videoId = source.download.ids[index];
          const video = source.items.find(item => item.videoId === videoId);
          source.download.index = index;
          source.download.currentTitle = video?.title || videoId;
          source.download.progress = 0;
          if (!video) continue;
          video.status = 'downloading';
          render();
          const requestId = `${source.id}:${video.videoId}`;
          const removeProgress = api?.onDownloadProgress?.(data => {
            if (data?.requestId !== requestId) return;
            source.download.progress = Math.max(0, Math.min(100, Number(data?.percent) || 0));
            render();
          });
          try {
            const result = await api.downloadVideo({
              url: video.url,
              outputPath: source.folder,
              format: source.format,
              quality: source.quality,
              title: video.title || '',
              embedMetadata: true,
              requestId,
            });
            video.status = 'archived';
            if (result?.filePath) video.filePath = result.filePath;
            source.pendingIds = source.pendingIds.filter(id => id !== video.videoId);
            source.download.done++;
          } catch (error) {
            video.status = 'failed';
            video.error = error?.message || 'Tải thất bại';
            source.download.failed++;
          } finally {
            removeProgress?.();
          }
          source.download.index = index + 1;
          await persist();
          render();
        }
        const stopped = source.download.stopRequested;
        source.download.status = stopped ? 'stopped' : (source.download.failed ? 'failed' : 'completed');
        source.download.progress = stopped ? source.download.progress : 100;
        source.download.currentTitle = '';
        source.status = source.pendingIds.length ? 'new' : 'ok';
        source.message = stopped
          ? `Đã dừng · ${source.download.done}/${source.download.ids.length} video`
          : `Tải xong ${source.download.done}/${source.download.ids.length} video${source.download.failed ? ` · lỗi ${source.download.failed}` : ''}`;
        await persist();
        render();
      }
    } finally {
      archiveQueueBusy = false;
    }
  }

  async function stopSourceDownload(sourceId) {
    const source = sources.find(item => item.id === sourceId);
    if (!source || !['running', 'queued'].includes(source.download.status)) return;
    source.download.stopRequested = true;
    if (source.download.status === 'queued') source.download.status = 'stopped';
    source.message = 'Đang dừng sau video hiện tại…';
    await persist();
    render();
  }

  async function setSourceMode(sourceId, mode) {
    const source = sources.find(item => item.id === sourceId);
    if (!source || !['auto', 'queue', 'notify'].includes(mode)) return;
    source.mode = mode;
    await persist();
    render();
  }

  async function toggleRestore(sourceId) {
    const source = sources.find(item => item.id === sourceId);
    if (!source) return;
    source.autoRestore = !source.autoRestore;
    await persist();
    render();
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
    const target = sources.find(source => source.id === sourceId);
    if (target && ['queued', 'running'].includes(target.download.status)) {
      return showStatus('Hãy dừng tải của nguồn trước khi xóa.', 'warn');
    }
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
      const download = source.download;
      const processed = Math.min(download.ids.length, download.done + download.failed);
      const overall = download.ids.length ? Math.round(((processed + (download.status === 'running' ? download.progress / 100 : 0)) / download.ids.length) * 100) : 0;
      const isDownloading = ['queued', 'running'].includes(download.status);
      const modeTitle = isDownloading
        ? (source.mode === 'auto' ? 'ĐANG TỰ ĐỘNG TẢI' : 'ĐANG TẢI THEO YÊU CẦU')
        : source.mode === 'auto' ? 'TỰ ĐỘNG TẢI' : source.mode === 'notify' ? 'CHỈ THÔNG BÁO' : 'CHỜ XÁC NHẬN';
      const modeDescription = isDownloading
        ? `${processed}/${download.ids.length} video · ${overall}%`
        : source.mode === 'auto' ? 'Video mới sẽ tự tải về thư mục của kênh.'
          : source.mode === 'notify' ? 'Chỉ báo khi có video mới, không tự tạo lượt tải.'
            : 'Video mới sẽ chờ bạn bấm nút Tải.';
      return `<div class="archive-source-card" data-source-id="${escapeHtml(source.id)}">
        <div class="archive-source-head"><div><div class="archive-source-name">${escapeHtml(source.name)}</div><div class="archive-source-url">${escapeHtml(source.platform)} · ${escapeHtml(source.url)}</div><div class="archive-source-folder">Thư viện: ${escapeHtml(source.folder || 'Chưa chọn')}</div></div>
        <div class="archive-source-actions"><button class="btn btn-ghost btn-xs" data-action="folder">Đổi thư mục</button><button class="btn btn-ghost btn-xs" data-action="sync">Đồng bộ</button>${source.pendingIds.length && !isDownloading ? `<button class="btn btn-primary btn-xs" data-action="download">Tải ${source.pendingIds.length}</button>` : ''}${isDownloading ? '<button class="btn btn-danger btn-xs" data-action="stop">Dừng tải</button>' : ''}<button class="btn btn-danger btn-xs" data-action="remove">Xóa nguồn</button></div></div>
        <div class="archive-activity ${escapeHtml(isDownloading ? 'running' : source.mode)}">
          <div class="archive-activity-state"><span class="archive-activity-dot"></span><div><b>${escapeHtml(modeTitle)}</b><span>${escapeHtml(modeDescription)}</span></div></div>
          <div class="archive-mode-switch" role="group" aria-label="Chế độ theo dõi"><button class="${source.mode === 'auto' ? 'active' : ''}" data-action="mode-auto">Tự động</button><button class="${source.mode === 'queue' ? 'active' : ''}" data-action="mode-queue">Chờ duyệt</button><button class="${source.mode === 'notify' ? 'active' : ''}" data-action="mode-notify">Chỉ báo</button></div>
          <button class="archive-restore-switch ${source.autoRestore ? 'active' : ''}" data-action="restore" role="switch" aria-checked="${source.autoRestore}"><span></span> Tự khôi phục file thiếu</button>
        </div>
        <div class="archive-source-stats"><div class="archive-stat"><span>Đã phát hiện</span><b>${source.items.length}</b></div><div class="archive-stat"><span>Đã lưu</span><b>${archived}</b></div><div class="archive-stat"><span>Mới/chờ</span><b>${source.pendingIds.length}</b></div><div class="archive-stat"><span>Thiếu/lỗi</span><b>${missing}</b></div><div class="archive-stat"><span>Không còn thấy</span><b>${source.removedIds.length}</b></div></div>
        ${download.ids.length ? `<div class="archive-download"><div class="archive-download-meta"><span>${isDownloading ? escapeHtml(download.currentTitle || 'Đang chuẩn bị…') : escapeHtml(source.message)}</span><b>${processed}/${download.ids.length} · ${overall}%</b></div><div class="archive-download-track"><div class="archive-download-fill" style="width:${overall}%"></div></div></div>` : ''}
        <div class="archive-source-foot"><span class="archive-status-${escapeHtml(source.status)}">${escapeHtml(source.message || 'Sẵn sàng')}</span><span>${escapeHtml(mode)} · ${escapeHtml(checked)}</span></div>
      </div>`;
    }).join('');
  }

  function handleClick(event) {
    const button = event.target.closest('[data-action]');
    const card = button?.closest('[data-source-id]');
    if (!button || !card) return;
    const sourceId = card.dataset.sourceId;
    if (button.dataset.action.startsWith('mode-')) setSourceMode(sourceId, button.dataset.action.slice(5));
    if (button.dataset.action === 'restore') toggleRestore(sourceId);
    if (button.dataset.action === 'stop') stopSourceDownload(sourceId);
    if (button.dataset.action === 'folder') changeSourceFolder(sourceId);
    if (button.dataset.action === 'sync') syncSource(sourceId, { manual: true });
    if (button.dataset.action === 'download') downloadPending(sourceId);
    if (button.dataset.action === 'remove') removeSource(sourceId);
  }

  return { initialize, addSource, chooseAddFolder, syncAll, syncSource, downloadPending, recordDownload, handleClick, render };
}
