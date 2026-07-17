import { TEXT } from './messages.mjs';

export function createUpdateController(deps) {
  const {
    api,
    $,
    isSmokeRenderer,
    hasBusyDownloads,
    getPendingAutoUpdateResult,
    setPendingAutoUpdateResult,
    applyCaps,
  } = deps;

  function shouldOfferUpdate(result) {
    return Boolean(result?.success && (result.hasUpdate || (!result.isInstalled && result.canCompare)));
  }

  function setUpdateStatus(message, type) {
    $('updateStatus').textContent = message;
    $('updateStatus').className = `status show ${type}`;
  }

  function applyUpdateCheckResult(result) {
    $('localVerEl').textContent = result.localVersion || TEXT.update.localMissing;
    $('latestVerEl').textContent = result.latestVersion || '-';
    if (result.hasUpdate) {
      $('updateTitle').textContent = TEXT.update.hasUpdate;
      $('updateDoBtn').style.display = 'inline-flex';
      $('updateDoBtn').textContent = TEXT.update.doUpdate;
      $('updateDoBtn').disabled = false;
    } else if (!result.isInstalled && result.canCompare) {
      $('updateTitle').textContent = TEXT.update.missingYtdlp;
      $('updateDoBtn').style.display = 'inline-flex';
      $('updateDoBtn').textContent = TEXT.update.install;
      $('updateDoBtn').disabled = false;
    } else if (result.upToDate) {
      setUpdateStatus(TEXT.update.upToDate, 'ok');
    } else {
      setUpdateStatus(TEXT.update.unavailable, 'warn');
    }
  }

  function maybeShowDeferredUpdatePrompt() {
    const pending = getPendingAutoUpdateResult();
    if (!pending) return;
    if (hasBusyDownloads()) return;
    if ($('updateOverlay')?.classList.contains('show')) return;
    setPendingAutoUpdateResult(null);
    openUpdateModal(pending);
  }

  async function openUpdateModal(prefetchedResult = null) {
    $('updateOverlay').classList.add('show');
    $('localVerEl').textContent = '...';
    $('latestVerEl').textContent = '...';
    $('updateDoBtn').style.display = 'none';
    $('updateStatus').className = 'status';
    $('updateProgress').classList.remove('show');
    $('updateSkipBtn').textContent = TEXT.update.close;
    $('updateTitle').textContent = TEXT.update.title;
    $('updateSub').textContent = 'yt-dlp engine';
    try {
      const result = prefetchedResult || await api.checkYtdlpUpdate();
      applyUpdateCheckResult(result);
    } catch (error) {
      setUpdateStatus(TEXT.update.failed(error.message), 'err');
    }
  }

  async function doUpdate() {
    $('updateDoBtn').disabled = true;
    $('updateDoBtn').textContent = TEXT.update.downloading;
    $('updateProgress').classList.add('show');
    $('updateStatus').className = 'status';
    const remove = api?.onYtdlpUpdateProgress?.(data => {
      $('updateFill').style.width = `${data.percent}%`;
      $('updatePct').textContent = `${data.percent}%`;
    });
    try {
      const result = await api.downloadYtdlpUpdate();
      if (!result?.success) throw new Error(result?.error || 'Update failed');
      $('updateFill').style.width = '100%';
      $('updatePct').textContent = '100%';
      setUpdateStatus(TEXT.update.success(result.newVersion), 'ok');
      $('updateDoBtn').style.display = 'none';
      $('updateSkipBtn').textContent = TEXT.update.close;
      $('ytdlpVer').textContent = result.newVersion;
      try {
        const caps = await api?.getSystemCapabilities?.();
        if (caps) applyCaps(caps);
      } catch (_) {}
    } catch (error) {
      setUpdateStatus(error.message, 'err');
      $('updateDoBtn').disabled = false;
      $('updateDoBtn').textContent = TEXT.update.retry;
    } finally {
      remove?.();
    }
  }

  function closeUpdateModal() {
    $('updateOverlay').classList.remove('show');
  }

  function scheduleUpdateCheck() {
    if (isSmokeRenderer) return;
    setTimeout(async () => {
      try {
        const result = await api?.checkYtdlpUpdate?.();
        if (!shouldOfferUpdate(result)) return;
        if (hasBusyDownloads()) {
          setPendingAutoUpdateResult(result);
          return;
        }
        openUpdateModal(result);
      } catch (_) {}
    }, 30000);
  }

  return {
    shouldOfferUpdate,
    maybeShowDeferredUpdatePrompt,
    applyUpdateCheckResult,
    openUpdateModal,
    doUpdate,
    closeUpdateModal,
    setUpdateStatus,
    scheduleUpdateCheck,
  };
}
