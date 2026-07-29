import { renderBatchList } from './renderers.mjs';
import { TEXT } from './messages.mjs';

export function createBatchController(deps) {
  const {
    api,
    $,
    getState,
    setState,
    persistUi,
    updateBatchRunSummary,
    maybeShowDeferredUpdatePrompt,
    addHistory,
    formatDuration,
    sleep,
    getInterVideoDelayMs,
    getBatchSourceMode,
    showStatus,
    ensureBatchAccess,
  } = deps;

  function getFilterValue(id) {
    return String($(id)?.value || '').trim();
  }

  function parseUploadDate(value) {
    const text = String(value || '').trim();
    if (!text) return 0;
    if (/^\d{8}$/.test(text)) {
      return new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00`).getTime();
    }
    const parsed = new Date(text).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function getFilteredBatchEntries() {
    const { batchVideos } = getState();
    const include = getFilterValue('batchFilterInclude').toLocaleLowerCase('vi');
    const excluded = getFilterValue('batchFilterExclude')
      .split(',')
      .map(value => value.trim().toLocaleLowerCase('vi'))
      .filter(Boolean);
    const minDuration = Number(getFilterValue('batchFilterMinDuration')) * 60 || 0;
    const maxDurationInput = Number(getFilterValue('batchFilterMaxDuration'));
    const maxDuration = maxDurationInput > 0 ? maxDurationInput * 60 : Infinity;
    const dateFrom = getFilterValue('batchFilterDateFrom')
      ? new Date(`${getFilterValue('batchFilterDateFrom')}T00:00:00`).getTime()
      : 0;
    const dateTo = getFilterValue('batchFilterDateTo')
      ? new Date(`${getFilterValue('batchFilterDateTo')}T23:59:59`).getTime()
      : Infinity;
    const orientation = getFilterValue('batchFilterOrientation') || 'all';
    const subtitleFilter = getFilterValue('batchFilterSubtitles') || 'all';
    const minQuality = Number(getFilterValue('batchFilterMinQuality')) || 0;
    const sort = getFilterValue('batchFilterSort') || 'source';

    const entries = batchVideos.map((video, sourceIndex) => ({ video, sourceIndex })).filter(({ video }) => {
      const title = String(video.title || '').toLocaleLowerCase('vi');
      if (include && !title.includes(include)) return false;
      if (excluded.some(keyword => title.includes(keyword))) return false;

      const duration = Number(video.duration || 0);
      if (duration && (duration < minDuration || duration > maxDuration)) return false;
      if (!duration && (minDuration > 0 || Number.isFinite(maxDuration))) return false;

      const uploadDate = parseUploadDate(video.uploadDate);
      if (uploadDate && (uploadDate < dateFrom || uploadDate > dateTo)) return false;
      if (!uploadDate && (dateFrom > 0 || Number.isFinite(dateTo))) return false;

      const width = Number(video.width || 0);
      const height = Number(video.height || 0);
      if (orientation !== 'all') {
        if (!width || !height) return false;
        const ratio = width / height;
        if (orientation === 'vertical' && ratio >= 0.9) return false;
        if (orientation === 'horizontal' && ratio <= 1.1) return false;
        if (orientation === 'square' && (ratio < 0.9 || ratio > 1.1)) return false;
      }

      const hasSubtitles = Boolean(video.hasSubtitles || video.subtitles?.length || video.autoCaptions?.length);
      if (subtitleFilter === 'yes' && !hasSubtitles) return false;
      if (subtitleFilter === 'no' && hasSubtitles) return false;
      if (Number(video.maxQuality || video.height || 0) < minQuality) return false;
      return true;
    });

    const sorters = {
      newest: (a, b) => parseUploadDate(b.video.uploadDate) - parseUploadDate(a.video.uploadDate),
      oldest: (a, b) => parseUploadDate(a.video.uploadDate) - parseUploadDate(b.video.uploadDate),
      'duration-desc': (a, b) => Number(b.video.duration || 0) - Number(a.video.duration || 0),
      'duration-asc': (a, b) => Number(a.video.duration || 0) - Number(b.video.duration || 0),
      title: (a, b) => String(a.video.title || '').localeCompare(String(b.video.title || ''), 'vi'),
    };
    if (sorters[sort]) entries.sort(sorters[sort]);
    return entries;
  }

  function renderBatch() {
    const { batchVideos, batchSelected } = getState();
    const entries = getFilteredBatchEntries();
    $('totalCount').textContent = entries.length;
    if ($('batchFilterResult')) {
      $('batchFilterResult').textContent = entries.length === batchVideos.length
        ? `Hiển thị toàn bộ ${batchVideos.length} video`
        : `Hiển thị ${entries.length} / ${batchVideos.length} video`;
    }
    updateBatchCount();
    renderBatchList(
      $('videoGrid'),
      entries.map(entry => entry.video),
      new Set(entries.map((entry, displayIndex) => batchSelected.has(entry.sourceIndex) ? displayIndex : -1).filter(index => index >= 0)),
      displayIndex => toggleBatchSelection(entries[displayIndex]?.sourceIndex),
      formatDuration,
    );
  }

  function toggleBatchSelection(index) {
    const state = getState();
    if (state.batchSelected.has(index)) state.batchSelected.delete(index);
    else state.batchSelected.add(index);
    renderBatch();
  }

  function updateBatchCount() {
    const { batchSelected } = getState();
    const count = batchSelected.size;
    $('selCount').textContent = count;
    $('selCountBtn').textContent = count;
    $('downloadBatchBtn').disabled = count === 0;
  }

  function batchSelectAll() {
    const state = getState();
    getFilteredBatchEntries().forEach(entry => state.batchSelected.add(entry.sourceIndex));
    renderBatch();
  }

  function batchDeselectAll() {
    const state = getState();
    getFilteredBatchEntries().forEach(entry => state.batchSelected.delete(entry.sourceIndex));
    renderBatch();
  }

  function resetFilters() {
    [
      'batchFilterInclude', 'batchFilterExclude', 'batchFilterMinDuration',
      'batchFilterMaxDuration', 'batchFilterDateFrom', 'batchFilterDateTo',
    ].forEach(id => { if ($(id)) $(id).value = ''; });
    ['batchFilterOrientation', 'batchFilterSubtitles'].forEach(id => { if ($(id)) $(id).value = 'all'; });
    if ($('batchFilterMinQuality')) $('batchFilterMinQuality').value = '0';
    if ($('batchFilterSort')) $('batchFilterSort').value = 'source';
    applyFilters();
  }

  function applyFilters() {
    const state = getState();
    state.batchSelected.clear();
    getFilteredBatchEntries().forEach(entry => state.batchSelected.add(entry.sourceIndex));
    renderBatch();
  }

  async function startBatchDownload() {
    if (typeof ensureBatchAccess === 'function' && !ensureBatchAccess()) return;
    const folder = $('batchFolderInput').value.trim();
    if (!folder) return showStatus(TEXT.batch.selectFolder, 'warn');

    const format = $('batchFormat').value;
    const quality = $('batchQuality').value;
    const selectedVideos = [...getState().batchSelected].map(index => getState().batchVideos[index]).filter(Boolean);

    await persistUi({ batchFormat: format, batchQuality: quality, batchSubs: $('batchSubs').value });
    if (!selectedVideos.length) return showStatus(TEXT.batch.selectVideo, 'warn');

    return executeBatchDownload(selectedVideos, {
      folder,
      format,
      quality,
      sourceMode: getBatchSourceMode(),
      historyTitle: `${selectedVideos.length} video (hàng loạt)`,
    });
  }

  async function executeBatchDownload(selectedVideos, options = {}) {
    const {
      folder,
      format,
      quality,
      sourceMode = 'channel',
      historyTitle = `${selectedVideos.length} video (hàng loạt)`,
    } = options;

    setState({ batchCancelled: false, lastBatchFailedVideos: [] });
    updateBatchRunSummary({
      active: selectedVideos.length ? 1 : 0,
      queued: Math.max(selectedVideos.length - 1, 0),
      failed: 0,
      completed: 0,
      total: selectedVideos.length,
      mode: 'running',
    });

    $('downloadBatchBtn').style.display = 'none';
    $('cancelBatchBtn').style.display = 'inline-flex';
    $('batchProgress').classList.add('show');

    let done = 0;
    let failed = 0;

    for (let index = 0; index < selectedVideos.length; index++) {
      if (getState().batchCancelled) break;

      const video = selectedVideos[index];
      updateBatchRunSummary({
        active: 1,
        queued: Math.max(selectedVideos.length - index - 1, 0),
        failed,
        completed: done,
        total: selectedVideos.length,
        mode: 'running',
      });

      const label = video.title?.slice(0, 48) || `Video ${index + 1}`;
      $('batchProgressLabel').textContent = `(${index + 1}/${selectedVideos.length}) ${label}...`;
      $('batchProgressText').textContent = `${index + 1}/${selectedVideos.length}`;
      $('batchProgressFill').style.width = `${Math.round((index / selectedVideos.length) * 100)}%`;

      const removeProgress = api?.onDownloadProgress?.(data => {
        const overall = (index / selectedVideos.length + (data.percent / 100) / selectedVideos.length) * 100;
        $('batchProgressFill').style.width = `${Math.round(overall)}%`;
      });

      try {
        await api.downloadVideo({ url: video.url, outputPath: folder, format, quality, title: video.title || '' });
        done++;
      } catch (error) {
        failed++;
        getState().lastBatchFailedVideos.push(video);
        console.warn(`Batch failed [${video.title}]:`, error.message);
      } finally {
        removeProgress?.();
      }

      updateBatchRunSummary({
        active: 0,
        queued: Math.max(selectedVideos.length - (done + failed), 0),
        failed,
        completed: done,
        total: selectedVideos.length,
        mode: getState().batchCancelled ? 'cancelled' : 'running',
      });

      const delayMs = getInterVideoDelayMs(video, index, selectedVideos.length);
      if (!getState().batchCancelled && delayMs > 0) {
        const delaySeconds = Math.ceil(delayMs / 1000);
        $('batchProgressLabel').textContent = TEXT.batch.waitingNext(delaySeconds);
        await sleep(delayMs);
      }
    }

    $('batchProgressFill').style.width = '100%';
    $('batchProgressText').textContent = `${done}/${selectedVideos.length}`;
    $('batchProgressLabel').textContent = getState().batchCancelled ? TEXT.batch.stoppedLabel : TEXT.batch.doneLabel;
    $('downloadBatchBtn').style.display = 'inline-flex';
    $('cancelBatchBtn').style.display = 'none';
    $('batchProgress').classList.remove('show');

    updateBatchRunSummary({
      active: 0,
      queued: getState().batchCancelled ? Math.max(selectedVideos.length - (done + failed), 0) : 0,
      failed,
      completed: done,
      total: selectedVideos.length,
      mode: getState().batchCancelled ? 'cancelled' : 'finished',
    });

    if (getState().batchCancelled) showStatus(TEXT.batch.stopped(done), 'warn');
    else if (failed > 0) showStatus(TEXT.batch.finishedWithErrors(done, failed), 'warn');
    else showStatus(TEXT.batch.finished(done, folder), 'ok');

    if (!getState().batchCancelled) showResultModal(selectedVideos.length, done, failed, folder, getState().lastBatchFailedVideos);
    addHistory({
      type: 'batch',
      title: historyTitle,
      url: sourceMode === 'channel' ? $('urlInput')?.value.trim() || '' : '',
      urls: sourceMode === 'channel' ? [] : selectedVideos.map(video => video.url).filter(Boolean),
      sourceMode,
      folder,
    });
    maybeShowDeferredUpdatePrompt();
  }

  function cancelBatchDownload() {
    setState({ batchCancelled: true });
    $('batchProgressLabel').textContent = TEXT.batch.cancelling;
  }

  async function retryFailedBatch() {
    if (typeof ensureBatchAccess === 'function' && !ensureBatchAccess()) return;
    const { lastBatchFailedVideos } = getState();
    if (!lastBatchFailedVideos.length) return showStatus(TEXT.batch.retryMissing, 'warn');

    const folder = getState().lastBatchFolder || $('batchFolderInput').value.trim();
    if (!folder) return showStatus(TEXT.batch.selectFolder, 'warn');

    closeResultModal();
    return executeBatchDownload(lastBatchFailedVideos, {
      folder,
      format: $('batchFormat').value,
      quality: $('batchQuality').value,
      sourceMode: 'links',
      historyTitle: `${lastBatchFailedVideos.length} video (retry failed)`,
    });
  }

  function switchBatchSrc(mode) {
    persistUi({ batchSourceMode: mode });
    ['channel', 'facebook', 'links', 'file'].forEach(name => {
      const title = name.charAt(0).toUpperCase() + name.slice(1);
      $(`srcTab${title}`)?.classList.toggle('active', name === mode);
      $(`srcPanel${title}`).style.display = name === mode ? '' : 'none';
    });
  }

  async function loadLinksFromTextarea() {
    const urls = $('batchLinksInput').value.split('\n').map(line => line.trim()).filter(line => line.startsWith('http'));
    if (!urls.length) return showStatus(TEXT.batch.linksMissing, 'warn');
    await loadManualUrls(urls, 'links');
  }

  function loadLinksFromFile(input) {
    const file = input?.files?.[0];
    if (!file) return;

    $('fileLoadedName').textContent = file.name;
    const reader = new FileReader();
    reader.onload = async event => {
      const urls = String(event.target.result || '').split('\n').map(line => line.trim()).filter(line => line.startsWith('http'));
      if (!urls.length) return showStatus(TEXT.batch.fileNoValidUrls, 'warn');
      await loadManualUrls(urls, 'file', file.name);
    };
    reader.readAsText(file, 'utf-8');
  }

  async function loadManualUrls(urls, source = 'links', sourceName = '') {
    const baseVideos = urls.map((url, index) => createManualBatchVideo(url, index, source));
    setState({ batchVideos: baseVideos });
    setState({ batchSelected: new Set(baseVideos.map((_, index) => index)) });
    renderBatch();
    $('videoListSection').style.display = 'block';

    showStatus(
      source === 'file' ? TEXT.batch.fileLoaded(urls.length, sourceName) : TEXT.batch.linksLoaded(urls.length),
      'ok',
    );

    const enrichedVideos = await enrichBatchVideos(baseVideos);
    setState({ batchVideos: enrichedVideos });
    setState({ batchSelected: new Set(enrichedVideos.map((_, index) => index)) });
    renderBatch();
  }

  function createManualBatchVideo(url, index, source) {
    return {
      title: `Video ${index + 1}`,
      url,
      videoId: `${source}_${index}`,
      author: '',
      duration: 0,
      views: 0,
      thumbnail: '',
      maxQuality: 1080,
      manualUrl: true,
    };
  }

  async function enrichBatchVideos(videos) {
    const nextVideos = [...videos];
    let resolvedCount = 0;

    for (let index = 0; index < nextVideos.length; index++) {
      const current = nextVideos[index];
      showStatus(TEXT.batch.linksResolving(index + 1, nextVideos.length), 'info');

      try {
        const info = await api?.getVideoInfoMulti?.(current.url);
        if (info) {
          nextVideos[index] = {
            ...current,
            title: info.title || current.title,
            author: info.author || current.author,
            duration: info.duration || 0,
            views: info.viewCount || 0,
            thumbnail: info.thumbnail || current.thumbnail,
            maxQuality: getMaxQualityFromInfo(info, current.maxQuality),
            videoId: info.videoId || current.videoId,
            platform: info.platform || current.platform,
            uploadDate: info.uploadDate || current.uploadDate || '',
            width: info.width || current.width || 0,
            height: info.height || current.height || 0,
            subtitles: info.subtitles || current.subtitles || [],
            autoCaptions: info.autoCaptions || current.autoCaptions || [],
          };
          resolvedCount += 1;
        }
      } catch (_) {
        // Keep placeholder row when metadata fetch fails for a specific URL.
      }

      setState({ batchVideos: [...nextVideos] });
      renderBatch();
    }

    showStatus(TEXT.batch.linksResolved(resolvedCount, nextVideos.length), resolvedCount ? 'ok' : 'warn');
    return nextVideos;
  }

  function getMaxQualityFromInfo(info, fallback = 1080) {
    const heights = [
      Number(info?.height || 0),
      ...((info?.formats || []).map(format => Number(String(format?.quality || '').replace(/[^\d]/g, '')) || 0)),
    ].filter(Boolean);

    return heights.length ? Math.max(...heights) : fallback;
  }

  function showResultModal(total, ok, fail, folder, failedVideos = []) {
    setState({
      lastBatchFolder: folder,
      lastBatchFailedVideos: Array.isArray(failedVideos) ? [...failedVideos] : [],
    });
    $('rTotal').textContent = total;
    $('rOk').textContent = ok;
    $('rFail').textContent = fail;
    if ($('resultRetryFailedBtn')) {
      $('resultRetryFailedBtn').style.display = getState().lastBatchFailedVideos.length ? 'inline-flex' : 'none';
    }
    $('resultFolder').textContent = folder || '-';
    if (fail === 0) {
      $('resultIcon').textContent = 'OK';
      $('resultTitle').textContent = TEXT.batch.result.successTitle;
      $('resultSub').textContent = TEXT.batch.result.successSubtitle(ok, total);
    } else if (ok === 0) {
      $('resultIcon').textContent = 'ERR';
      $('resultTitle').textContent = TEXT.batch.result.failTitle;
      $('resultSub').textContent = TEXT.batch.result.failSubtitle;
    } else {
      $('resultIcon').textContent = 'WARN';
      $('resultTitle').textContent = TEXT.batch.result.partialTitle;
      $('resultSub').textContent = TEXT.batch.result.partialSubtitle(ok, fail);
    }
    $('resultOverlay').classList.add('show');
  }

  function closeResultModal() {
    $('resultOverlay').classList.remove('show');
    if ($('resultRetryFailedBtn')) $('resultRetryFailedBtn').style.display = 'none';
  }

  function openResultFolder() {
    if (getState().lastBatchFolder) api?.openFolder?.(getState().lastBatchFolder);
    closeResultModal();
  }

  return {
    renderBatch,
    toggleBatchSelection,
    updateBatchCount,
    batchSelectAll,
    batchDeselectAll,
    startBatchDownload,
    executeBatchDownload,
    cancelBatchDownload,
    retryFailedBatch,
    switchBatchSrc,
    loadLinksFromTextarea,
    loadLinksFromFile,
    showResultModal,
    closeResultModal,
    openResultFolder,
    applyFilters,
    resetFilters,
  };
}
