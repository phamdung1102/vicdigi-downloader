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
  let titleFilter = '';
  let sortMode = 'default';

  function renderBatch() {
    const { batchVideos, batchSelected } = getState();
    $('totalCount').textContent = batchVideos.length;
    const visibleVideos = getVisibleVideos(batchVideos);
    updateBatchCount();
    renderBatchList($('videoGrid'), visibleVideos, batchSelected, toggleBatchSelection, formatDuration);
    updateBatchEstimate(batchVideos, batchSelected);
  }

  function getVisibleVideos(videos) {
    const filtered = videos
      .map((video, index) => ({ ...video, _sourceIndex: index }))
      .filter(video => !titleFilter || String(video.title || '').toLocaleLowerCase('vi').includes(titleFilter));
    const dateValue = video => Number(video.timestamp || video.uploadTimestamp || String(video.uploadDate || '').replace(/\D/g, '') || 0);
    const sorters = {
      newest: (a, b) => dateValue(b) - dateValue(a),
      oldest: (a, b) => dateValue(a) - dateValue(b),
      'duration-desc': (a, b) => Number(b.duration || 0) - Number(a.duration || 0),
      'duration-asc': (a, b) => Number(a.duration || 0) - Number(b.duration || 0),
    };
    return sorters[sortMode] ? filtered.sort(sorters[sortMode]) : filtered;
  }

  function updateBatchEstimate(videos, selected) {
    const selectedVideos = [...selected].map(index => videos[index]).filter(Boolean);
    const quality = $('batchQuality')?.value || '1080p';
    const mbps = quality === '4k' ? 18 : quality === '1080p' ? 8 : quality === '720p' ? 5 : 2.5;
    const seconds = selectedVideos.reduce((sum, video) => sum + Number(video.duration || 0), 0);
    const bytes = seconds > 0 ? seconds * mbps * 1000000 / 8 : 0;
    $('batchTotalVideos').textContent = `${videos.length} video`;
    $('batchSelectedVideos').textContent = `${selectedVideos.length} video`;
    $('batchEstimatedSize').textContent = bytes ? formatBytes(bytes) : 'Chưa đủ dữ liệu';
  }

  function formatBytes(bytes) {
    if (bytes >= 1024 ** 3) return `~ ${(bytes / 1024 ** 3).toFixed(1)} GB`;
    return `~ ${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
  }

  function setTitleFilter(value) {
    titleFilter = String(value || '').trim().toLocaleLowerCase('vi');
    renderBatch();
  }

  function setSortMode(value) {
    sortMode = value || 'default';
    renderBatch();
  }

  function selectRange(startValue, endValue) {
    const { batchVideos, batchSelected } = getState();
    const start = Math.max(1, Number.parseInt(startValue, 10) || 1);
    const end = Math.min(batchVideos.length, Number.parseInt(endValue, 10) || batchVideos.length);
    batchSelected.clear();
    for (let index = start - 1; index < end; index += 1) batchSelected.add(index);
    renderBatch();
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
    state.batchVideos.forEach((_, index) => state.batchSelected.add(index));
    renderBatch();
  }

  function batchDeselectAll() {
    getState().batchSelected.clear();
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
    const normalizedMode = mode === 'facebook' ? 'facebook' : 'unified';
    persistUi({ batchSourceMode: normalizedMode });
    ['unified', 'facebook'].forEach(name => {
      const title = name.charAt(0).toUpperCase() + name.slice(1);
      $(`srcTab${title}`)?.classList.toggle('active', name === normalizedMode);
      const panel = $(`srcPanel${title}`);
      if (panel) panel.style.display = name === normalizedMode ? '' : 'none';
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
      if ($('batchLinksInput')) {
        $('batchLinksInput').value = urls.join('\n');
        $('batchLinksInput').dispatchEvent(new Event('input', { bubbles: true }));
      }
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
            uploadDate: info.uploadDate || current.uploadDate,
            timestamp: info.timestamp || current.timestamp,
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
    setTitleFilter,
    setSortMode,
    selectRange,
    showResultModal,
    closeResultModal,
    openResultFolder,
  };
}
