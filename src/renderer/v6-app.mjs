import { renderDownloadCenterJobs, renderQualityPills } from './renderers.mjs';
import { createBatchController } from './batch-controller.mjs';
import { createHistoryController } from './history-controller.mjs';
import { createUpdateController } from './update-controller.mjs';
import { DEFAULTS, MAX_BATCH_VIDEOS, MAX_YOUTUBE_BATCH_DELAY_MS, MIN_YOUTUBE_BATCH_DELAY_MS, TEXT } from './messages.mjs';

const api = typeof window !== 'undefined' ? window.electronAPI : null;
const isSmokeRenderer = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('smoke') === '1';

const VIC = (() => {
  let currentTab = 'single';
  let ui = { ...DEFAULTS };
  let history = [];
  let videoInfo = null;
  let batchVideos = [];
  let batchSelected = new Set();
  let batchCancelled = false;
  let facebookScanActive = false;
  let facebookScanUids = new Set();
  let facebookMetadataQueue = [];
  let facebookMetadataPending = new Set();
  let facebookMetadataActive = 0;
  let facebookMetadataScanToken = 0;
  let lastBatchFolder = '';
  let lastBatchFailedVideos = [];
  let batchRunSummary = null;
  let downloadCenter = { active: [], paused: [], queued: [], completed: [], failed: [] };
  let socialCookiePath = '';
  let downloadProfiles = [];
  let persistenceStatus = null;
  let licenseStatus = null;
  let pendingAutoUpdateResult = null;
  let sessionRecoveryHandled = false;
  let activationPromptShown = false;
  let batchController;
  let historyController;
  let updateController;

  const $ = id => document.getElementById(id);
  const on = (id, eventName, handler) => $(id)?.addEventListener(eventName, handler);
  const setValue = (id, value) => { if ($(id) && value !== undefined && value !== null) $(id).value = value; };
  const isCustomProfile = profile => Boolean(profile?.isCustom || String(profile?.id || '').startsWith('custom-'));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const isLicenseActive = () => licenseStatus?.status === 'active';
  const storeGet = async key => { try { return await api?.storeGet?.(key); } catch (_) { return null; } };
  const parseStored = value => {
    if (!value) return {};
    if (typeof value === 'string') { try { return JSON.parse(value); } catch (_) { return {}; } }
    return typeof value === 'object' ? value : {};
  };
  const getDownloadCenterCounts = () => {
    if (batchRunSummary) {
      return {
        active: batchRunSummary.active || 0,
        queued: batchRunSummary.queued || 0,
        failed: batchRunSummary.failed || 0,
        completed: batchRunSummary.completed || 0,
      };
    }
    return {
      active: downloadCenter.active?.length || 0,
      queued: (downloadCenter.queued?.length || 0) + (downloadCenter.paused?.length || 0),
      failed: downloadCenter.failed?.length || 0,
      completed: downloadCenter.completed?.length || 0,
    };
  };
  const isYouTubeUrl = url => /(?:youtube\.com|youtu\.be)/i.test(String(url || ''));
  const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const getInterVideoDelayMs = (video, index, total) => {
    if (isSmokeRenderer) return 0;
    if (index >= total - 1) return 0;
    if (!isYouTubeUrl(video?.url)) return 0;
    return randomBetween(MIN_YOUTUBE_BATCH_DELAY_MS, MAX_YOUTUBE_BATCH_DELAY_MS);
  };

  async function boot() {
    window.__VIC_BOOTED = false;
    window.__VIC_BOOT_ERROR = null;
    try {
      ui = { ...DEFAULTS, ...parseStored(await storeGet('uiSettings')) };
      socialCookiePath = String((await storeGet('socialCookiesPath')) || '');
      await loadHistory();
      await loadDownloadProfiles();
      await loadPersistenceStatus();
      await loadLicenseStatus();
      await loadAppInfo();
      wireEvents();
      applyTheme(ui.theme);
      applyUi();
      applySocialCookiePath();
      await applyParallelDownloadsSetting(ui.parallelDownloads, { persist: false, silent: true });
      await refreshDownloadCenter();
      await maybePromptSessionRecovery();
      await maybePromptActivation();
      switchBatchSrc(ui.batchSourceMode);
      switchTab(currentTab);
      try { const caps = await api?.getSystemCapabilities?.(); if (caps) applyCaps(caps); } catch (_) {}
      renderHistory();
      scheduleUpdateCheck();
      window.__VIC_BOOTED = true;
    } catch (error) {
      window.__VIC_BOOT_ERROR = error?.message || String(error);
      console.error('[VIC] boot failed:', error);
      throw error;
    }
  }

  function wireEvents() {
    $('urlInput')?.addEventListener('input', syncHeaderInputState);
    $('urlInput')?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      if (currentTab === 'batch') return $('scanBtnHeader') && !$('scanBtnHeader').disabled ? scanVideos() : null;
      if ($('getInfoBtn') && !$('getInfoBtn').disabled) getVideoInfo();
    });
    on('getInfoBtn', 'click', getVideoInfo);
    on('scanBtnHeader', 'click', scanVideos);
    on('selectFolderBtn', 'click', selectFolder);
    on('pasteUrlBtn', 'click', pasteUrlFromClipboard);
    on('selectCookieFileBtn', 'click', selectCookieFile);
    on('clearCookieFileBtn', 'click', clearCookieFile);
    on('openLogsBtn', 'click', () => api?.openLogsFolder?.());
    on('clearPrivateDataBtn', 'click', clearPrivateData);
    on('downloadVideoBtn', 'click', downloadVideo);
    on('downloadSubtitleBtn', 'click', downloadSubtitle);
    on('downloadThumbnailBtn', 'click', downloadThumbnail);
    on('selectBatchFolderBtn', 'click', selectBatchFolder);
    on('downloadBatchBtn', 'click', startBatchDownload);
    on('cancelBatchBtn', 'click', cancelBatchDownload);
    on('themeToggleBtn', 'click', toggleTheme);
    on('openUpdateBtn', 'click', openUpdateFromSettings);
    on('checkAppUpdateBtn', 'click', checkApplicationUpdate);
    on('nav-single', 'click', () => switchTab('single'));
    on('nav-batch', 'click', () => switchTab('batch'));
    on('nav-history', 'click', () => switchTab('history'));
    on('nav-settings', 'click', openSettingsModal);
    on('nav-license', 'click', openLicenseModal);
    on('srcTabUnified', 'click', () => switchBatchSrc('unified'));
    on('srcTabFacebook', 'click', () => switchBatchSrc('facebook'));
    on('loadLinksBtn', 'click', scanVideos);
    on('scanFacebookBtn', 'click', scanFacebookPageVideos);
    on('facebookScanCancelBtn', 'click', cancelFacebookScan);
    on('batchFilePickerBtn', 'click', () => $('batchFileInput')?.click());
    on('batchSelectAllBtn', 'click', batchSelectAll);
    on('batchDeselectAllBtn', 'click', batchDeselectAll);
    on('batchApplyRangeBtn', 'click', () => batchController?.selectRange?.($('batchRangeStart')?.value, $('batchRangeEnd')?.value));
    on('openDownloadCenterBtn', 'click', openDownloadCenterModal);
    on('refreshDownloadCenterBtn', 'click', refreshDownloadCenter);
    on('profileSelect', 'change', onProfileSelected);
    on('parallelDownloads', 'change', onParallelDownloadsChanged);
    on('applySingleProfileBtn', 'click', applySelectedProfileToSingle);
    on('applyBatchProfileBtn', 'click', applySelectedProfileToBatch);
    on('applyAllProfileBtn', 'click', applySelectedProfileEverywhere);
    on('saveCurrentProfileBtn', 'click', saveCurrentProfile);
    on('deleteProfileBtn', 'click', deleteSelectedProfile);
    on('activateLicenseBtn', 'click', activateLicense);
    on('activateOnlineBtn', 'click', activateLicenseOnline);
    on('activationCodeInput', 'keydown', event => { if (event.key === 'Enter') activateLicenseOnline(); });
    on('refreshLicenseBtn', 'click', () => refreshLicenseStatus({ notify: true }));
    on('clearLicenseBtn', 'click', clearLicense);
    on('copyMachineIdBtn', 'click', copyMachineId);
    on('downloadCenterCloseBtn', 'click', closeDownloadCenterModal);
    on('licenseCloseBtn', 'click', closeLicenseModal);
    on('dcCloseBtn', 'click', closeDownloadCenterModal);
    on('dcRefreshBtn', 'click', refreshDownloadCenter);
    on('dcClearCompletedBtn', 'click', clearCompletedDownloads);
    on('dcClearFailedBtn', 'click', clearFailedDownloads);
    on('dcPauseAllBtn', 'click', pauseAllDownloads);
    on('dcResumeAllBtn', 'click', resumeAllDownloads);
    on('clearHistoryBtn', 'click', clearHistory);
    on('settingsCloseBtn', 'click', closeSettingsModal);
    on('settingsDoneBtn', 'click', closeSettingsModal);
    on('updateCloseBtn', 'click', closeUpdateModal);
    on('updateSkipBtn', 'click', closeUpdateModal);
    on('updateDoBtn', 'click', doUpdate);
    on('resultCloseTopBtn', 'click', closeResultModal);
    on('resultCloseBtn', 'click', closeResultModal);
    on('resultRetryFailedBtn', 'click', retryFailedBatch);
    on('resultOpenFolderBtn', 'click', openResultFolder);
    document.querySelectorAll('[data-preset]').forEach(button => {
      button.addEventListener('click', () => applyQuickPreset(button.dataset.preset));
    });
    $('batchLinksInput')?.addEventListener('input', updateUnifiedBatchSourceHint);
    $('batchTitleFilter')?.addEventListener('input', event => batchController?.setTitleFilter?.(event.target.value));
    $('batchSort')?.addEventListener('change', event => batchController?.setSortMode?.(event.target.value));
    $('batchQuality')?.addEventListener('change', () => batchController?.renderBatch?.());
    $('batchFileInput')?.addEventListener('change', event => loadLinksFromFile(event.target));
    bindUiField('maxVideos', 'maxVideos', value => {
      const parsed = parseInt(value, 10);
      return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_BATCH_VIDEOS) : DEFAULTS.maxVideos;
    });
    bindUiField('batchFormat', 'batchFormat');
    bindUiField('batchQuality', 'batchQuality');
    bindUiField('batchSubs', 'batchSubs');
    wireOverlay('downloadCenterOverlay', closeDownloadCenterModal);
    wireOverlay('settingsOverlay', closeSettingsModal);
    wireOverlay('licenseOverlay', closeLicenseModal);
    wireOverlay('updateOverlay', closeUpdateModal);
    wireOverlay('resultOverlay', closeResultModal);
    api?.onCapabilitiesUpdated?.(applyCaps);
    api?.onAppUpdateStatus?.(handleAppUpdateStatus);
    api?.onFacebookUidsDiscovered?.(handleFacebookUidsDiscovered);
    api?.onFacebookScanStatus?.(handleFacebookScanStatus);
    wireDownloadCenterEvents();
  }

  function bindUiField(id, key, normalize = value => value) {
    $(id)?.addEventListener('change', () => {
      const nextValue = normalize($(id).value);
      if ($(id).type === 'number') $(id).value = String(nextValue);
      persistUi({ [key]: nextValue });
    });
  }

  function wireOverlay(id, onClose) {
    const overlay = $(id);
    if (!overlay) return;
    overlay.addEventListener('click', event => { if (event.target === overlay) onClose(); });
    overlay.querySelector('.modal')?.addEventListener('click', event => event.stopPropagation());
  }

  function applyUi() {
    setValue('maxVideos', String(ui.maxVideos));
    setValue('parallelDownloads', String(ui.parallelDownloads || DEFAULTS.parallelDownloads));
    setValue('batchFormat', ui.batchFormat);
    setValue('batchQuality', ui.batchQuality);
    setValue('batchSubs', ui.batchSubs);
    setValue('profileSelect', ui.selectedProfileId || DEFAULTS.selectedProfileId);
    renderProfileDescription();
    renderPersistenceStatus();
    renderLicenseStatus();
    syncHeaderInputState();
  }

  function wireDownloadCenterEvents() {
    const refreshLater = () => {
      clearTimeout(wireDownloadCenterEvents._timer);
      wireDownloadCenterEvents._timer = setTimeout(() => {
        refreshDownloadCenter().catch(() => {});
      }, 120);
    };

    api?.onDownloadAdded?.(refreshLater);
    api?.onDownloadStarted?.(refreshLater);
    api?.onDownloadProgressManager?.(refreshLater);
    api?.onDownloadCompleted?.(refreshLater);
    api?.onDownloadFailed?.(refreshLater);
    api?.onDownloadRetry?.(refreshLater);
    api?.onDownloadCancelled?.(refreshLater);
    api?.onDownloadPaused?.(refreshLater);
    api?.onOpenDownloadCenter?.(payload => {
      openDownloadCenterModal();
      setTimeout(() => focusDownloadJob(payload?.id), 80);
    });
  }

  function applySocialCookiePath() {
    setValue('socialCookiePath', socialCookiePath);
  }

  function openSettingsModal() { $('settingsOverlay')?.classList.add('show'); }
  function closeSettingsModal() { $('settingsOverlay')?.classList.remove('show'); }
  function openLicenseModal() {
    $('licenseOverlay')?.classList.add('show');
    setTimeout(() => $('licenseKeyInput')?.focus(), 30);
  }
  function closeLicenseModal() { $('licenseOverlay')?.classList.remove('show'); }
  function openDownloadCenterModal() {
    $('downloadCenterOverlay')?.classList.add('show');
    renderDownloadCenterDetailView();
  }
  function closeDownloadCenterModal() { $('downloadCenterOverlay')?.classList.remove('show'); }
  function openUpdateFromSettings() {
    closeSettingsModal();
    openUpdateModal();
  }

  async function refreshDownloadCenter() {
    const response = await api?.getAllDownloads?.();
    downloadCenter = response?.downloads || { active: [], paused: [], queued: [], completed: [], failed: [] };
    renderDownloadCenterView();
    maybeShowDeferredUpdatePrompt();
  }

  function renderDownloadCenterView() {
    const counts = getDownloadCenterCounts();
    $('dcActiveCount').textContent = counts.active;
    $('dcQueuedCount').textContent = counts.queued;
    $('dcFailedCount').textContent = counts.failed;
    $('dcCompletedCount').textContent = counts.completed;
    $('dcModalActiveCount').textContent = counts.active;
    $('dcModalQueuedCount').textContent = counts.queued;
    $('dcModalFailedCount').textContent = counts.failed;
    $('dcModalCompletedCount').textContent = counts.completed;
    renderDownloadCenterDetailView();
  }

  function renderDownloadCenterDetailView() {
    const container = $('downloadCenterDetailList');
    if (!container) return;
    renderDownloadCenterJobs(container, downloadCenter, {
      onRetry: retryDownloadJob,
      onPause: pauseDownloadJob,
      onResume: resumeDownloadJob,
      onPrioritize: prioritizeDownloadJob,
      onReorder: reorderDownloadJob,
      onDetails: showDownloadJobDetails,
      onCancel: cancelDownloadJob,
      onOpenFolder: openDownloadJobFolder,
      onRevealFile: revealDownloadJobFile,
      onOpenFile: openDownloadJobFile,
    });
  }

  function updateBatchRunSummary(summary) {
    batchRunSummary = summary ? { ...summary } : null;
    renderDownloadCenterView();
  }

  function hasBusyDownloads() {
    return Boolean(
      $('progressWrap')?.classList.contains('show') ||
      $('batchProgress')?.classList.contains('show') ||
      (downloadCenter.active?.length || 0) ||
      (downloadCenter.queued?.length || 0) ||
      (downloadCenter.paused?.length || 0)
    );
  }

  function shouldOfferUpdate(result) {
    return updateController.shouldOfferUpdate(result);
  }

  function maybeShowDeferredUpdatePrompt() {
    return updateController.maybeShowDeferredUpdatePrompt();
  }


  async function maybePromptSessionRecovery() {
    if (isSmokeRenderer) return;
    if (sessionRecoveryHandled) return;
    sessionRecoveryHandled = true;
    const response = await api?.getRecoverableSession?.();
    const session = response?.session;
    if (!session?.hasRecoverable) return;

    if (window.confirm(TEXT.session.confirm(session))) {
      await api?.resumePendingSession?.();
      await refreshDownloadCenter();
      showStatus(TEXT.session.restored, 'ok');
      return;
    }

    await api?.discardPendingSession?.();
    await refreshDownloadCenter();
    showStatus(TEXT.session.discarded, 'info');
  }



  function applyUpdateCheckResult(result) {
    return updateController.applyUpdateCheckResult(result);
  }



  async function retryDownloadJob(job) {
    const result = await api?.retryDownload?.(job.id);
    if (!result?.success) return showStatus(TEXT.downloadCenter.retryFailed, 'warn');
    showStatus(TEXT.downloadCenter.retrySuccess(job.title || job.id), 'ok');
    await refreshDownloadCenter();
  }

  async function cancelDownloadJob(job) {
    const result = await api?.cancelDownload?.(job.id);
    if (!result?.success) return showStatus(TEXT.downloadCenter.cancelFailed, 'warn');
    showStatus(TEXT.downloadCenter.cancelSuccess(job.title || job.id), 'warn');
    await refreshDownloadCenter();
  }

  async function clearCompletedDownloads() {
    await api?.clearCompleted?.();
    await refreshDownloadCenter();
    showStatus(TEXT.downloadCenter.clearCompleted, 'ok');
  }

  async function clearFailedDownloads() {
    await api?.clearFailed?.();
    await refreshDownloadCenter();
    showStatus(TEXT.downloadCenter.clearFailed, 'ok');
  }

  async function pauseDownloadJob(job) {
    const result = await api?.pauseDownload?.(job.id);
    if (!result?.success) return showStatus('Không thể tạm dừng tác vụ này.', 'warn');
    await refreshDownloadCenter();
  }

  async function resumeDownloadJob(job) {
    const result = await api?.resumeDownload?.(job.id);
    if (!result?.success) return showStatus('Không thể tiếp tục tác vụ này.', 'warn');
    await refreshDownloadCenter();
  }

  async function prioritizeDownloadJob(job) {
    const result = await api?.prioritizeDownload?.(job.id);
    if (!result?.success) return showStatus('Không thể đổi ưu tiên tác vụ này.', 'warn');
    showStatus('Đã đưa tác vụ lên đầu hàng đợi.', 'ok');
    await refreshDownloadCenter();
  }

  async function reorderDownloadJob(downloadId, beforeDownloadId) {
    const result = await api?.reorderDownload?.(downloadId, beforeDownloadId);
    if (!result?.success) return showStatus('Không thể thay đổi thứ tự hàng đợi.', 'warn');
    await refreshDownloadCenter();
  }

  function showDownloadJobDetails(job) {
    const detail = [
      job.title || 'Tác vụ tải xuống',
      job.error ? `Lỗi: ${job.error}` : '',
      job.url ? `Liên kết: ${job.url}` : '',
      job.outputPath ? `Thư mục: ${job.outputPath}` : '',
    ].filter(Boolean).join('\n\n');
    window.alert(detail);
  }

  function focusDownloadJob(id) {
    if (!id) return;
    const escaped = window.CSS?.escape ? CSS.escape(String(id)) : String(id).replace(/"/g, '\\"');
    const row = document.querySelector(`.dc-row[data-job-id="${escaped}"]`);
    if (!row) return;
    row.classList.add('focused');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => row.classList.remove('focused'), 2200);
  }

  async function checkApplicationUpdate() {
    if ($('appUpdateStatusText')) $('appUpdateStatusText').textContent = 'Đang kiểm tra bản cập nhật ứng dụng…';
    const result = await api?.checkAppUpdate?.();
    if (!result?.success && result?.reason === 'not-packaged') {
      if ($('appUpdateStatusText')) $('appUpdateStatusText').textContent = 'Chỉ kiểm tra cập nhật trên bản đã cài đặt.';
    }
  }

  function handleAppUpdateStatus(payload = {}) {
    if (!$('appUpdateStatusText')) return;
    const labels = {
      checking: 'Đang kiểm tra bản cập nhật ứng dụng…',
      none: 'Bạn đang dùng phiên bản mới nhất.',
      available: `Có bản ${payload.version || 'mới'}, đang tải nền…`,
      downloading: `Đang tải bản cập nhật… ${payload.percent || 0}%`,
      downloaded: `Bản ${payload.version || 'mới'} đã sẵn sàng để cài đặt.`,
      'downloaded-deferred': `Bản ${payload.version || 'mới'} đã tải xong, sẽ cài sau khi các tác vụ hoàn tất.`,
      error: 'Không thể kiểm tra cập nhật lúc này.',
    };
    $('appUpdateStatusText').textContent = labels[payload.status] || labels.error;
  }

  async function pauseAllDownloads() {
    const result = await api?.pauseAllDownloads?.();
    await refreshDownloadCenter();
    showStatus(`Đã tạm dừng ${result?.count || 0} tác vụ đang chạy.`, 'info');
  }

  async function resumeAllDownloads() {
    const result = await api?.resumeAllDownloads?.();
    await refreshDownloadCenter();
    showStatus(`Đã tiếp tục ${result?.count || 0} tác vụ.`, 'ok');
  }


  async function openDownloadJobFolder(job) {
    const target = job.outputPath || '';
    if (!target) return showStatus(TEXT.downloadCenter.noFolder, 'warn');
    await api?.openFolder?.(target);
  }

  async function revealDownloadJobFile(job) {
    const target = job.outputFile || '';
    if (!target) return showStatus(TEXT.downloadCenter.noOutput, 'warn');
    await api?.showItemInFolder?.(target);
  }

  async function openDownloadJobFile(job) {
    const target = job.outputFile || '';
    if (!target) return showStatus(TEXT.downloadCenter.noOutput, 'warn');
    await api?.openPath?.(target);
  }

  async function persistUi(partial) {
    ui = { ...ui, ...partial };
    try { await api?.storeSet?.('uiSettings', ui); } catch (_) {}
  }

  async function loadDownloadProfiles() {
    const response = await api?.getDownloadProfiles?.();
    downloadProfiles = response?.profiles || [];
    renderProfileOptions();
  }

  async function loadPersistenceStatus() {
    const response = await api?.getPersistenceStatus?.();
    persistenceStatus = response?.persistence || null;
    renderPersistenceStatus();
  }

  async function loadLicenseStatus() {
    const response = await api?.getLicenseStatus?.();
    licenseStatus = response?.licenseStatus || null;
    renderLicenseStatus();
  }

  function renderProfileOptions() {
    const select = $('profileSelect');
    if (!select) return;
    select.innerHTML = '';

    if (!downloadProfiles.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = TEXT.profiles.none;
      select.appendChild(option);
      return;
    }

    downloadProfiles.forEach(profile => {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.isCustom ? `${profile.name} (Tùy chỉnh)` : profile.name;
      if ((ui.selectedProfileId || DEFAULTS.selectedProfileId) === profile.id) option.selected = true;
      select.appendChild(option);
    });

    renderProfileDescription();
  }

  function renderProfileDescription() {
    const selected = getSelectedProfile();
    if ($('profileDescription')) {
      $('profileDescription').textContent = selected?.description || TEXT.profiles.descriptionFallback;
    }
    if ($('deleteProfileBtn')) $('deleteProfileBtn').disabled = !isCustomProfile(selected);
  }

  function renderPersistenceStatus() {
    const sqlite = persistenceStatus?.sqlite;
    if (!$('persistenceStatusText')) return;
    if (!sqlite?.enabled) {
      $('persistenceStatusText').textContent = TEXT.profiles.persistenceFallback;
      return;
    }
    $('persistenceStatusText').textContent = TEXT.profiles.persistenceActive(sqlite.jobCount || 0, sqlite.dbPath || '');
  }

  function renderLicenseStatus() {
    if ($('machineIdInput')) $('machineIdInput').value = licenseStatus?.machineId || '';
    if ($('clearLicenseBtn')) $('clearLicenseBtn').disabled = !licenseStatus?.license;
    if ($('licenseCustomerName')) $('licenseCustomerName').textContent = getLicenseCustomerName();
    if ($('licenseCustomerEmail')) $('licenseCustomerEmail').textContent = getLicenseCustomerEmail();
    if ($('licenseStatusValue')) $('licenseStatusValue').textContent = getLicenseStateLabel();
    if ($('licenseExpiryValue')) $('licenseExpiryValue').textContent = getLicenseExpiryLabel();

    if ($('licenseCustomerCard')) {
      $('licenseCustomerCard').className = `license-customer-card ${getLicenseCardTone()}`.trim();
    }

    syncToolAvailability();
    batchController?.updateBatchCount?.();
  }

  function getLicenseStatusLabel() {
    if (!licenseStatus) return TEXT.license.inactive;
    if (licenseStatus.status === 'unconfigured') return TEXT.license.unconfigured;
    if (licenseStatus.status === 'inactive') return TEXT.license.inactive;
    if (licenseStatus.status === 'expired') {
      return TEXT.license.expired(formatLicenseDate(licenseStatus.license?.expiresAt));
    }
    if (licenseStatus.status === 'active' && licenseStatus.license) {
      return TEXT.license.active(
        licenseStatus.license.customerName || '',
        formatLicenseDate(licenseStatus.license.expiresAt)
      );
    }
    return TEXT.license.invalid(licenseStatus.message || 'Khong xac dinh');
  }

  function getLicenseStateLabel() {
    if (!licenseStatus) return TEXT.license.stateInactive;
    if (licenseStatus.status === 'active') return TEXT.license.stateActive;
    if (licenseStatus.status === 'expired') return TEXT.license.stateExpired;
    if (licenseStatus.status === 'unconfigured') return TEXT.license.stateUnconfigured;
    if (licenseStatus.status === 'inactive') return TEXT.license.stateInactive;
    return TEXT.license.stateInvalid;
  }

  function getLicenseExpiryLabel() {
    if (!licenseStatus || !licenseStatus.license) return TEXT.license.expiryPending;
    return formatLicenseDate(licenseStatus.license.expiresAt) || TEXT.license.expiryLifetime;
  }

  function getLicenseCustomerName() {
    return licenseStatus?.license?.customerName || TEXT.license.customerPending;
  }

  function getLicenseCustomerEmail() {
    return licenseStatus?.license?.email || TEXT.license.customerPendingHint;
  }

  function getLicenseCardTone() {
    if (licenseStatus?.status === 'active') return 'active';
    if (licenseStatus?.status === 'expired') return 'warn';
    if (licenseStatus?.status === 'inactive') return '';
    return 'invalid';
  }

  function ensureLicenseAccess(actionLabel = 'su dung cong cu nay') {
    if (isLicenseActive()) return true;
    activationPromptShown = true;
    openLicenseModal();
    showStatus(TEXT.license.required(actionLabel), 'warn');
    return false;
  }

  function syncHeaderInputState() {
    const inputValue = $('urlInput')?.value.trim() || '';
    const urlLength = inputValue.length;
    if ($('urlIcon')) $('urlIcon').textContent = '🔗';
    if ($('getInfoBtn')) $('getInfoBtn').disabled = urlLength < 10;
    if ($('getInfoLabel')) $('getInfoLabel').textContent = 'Lấy thông tin';
    if ($('scanBtnHeader')) $('scanBtnHeader').disabled = urlLength < 5;
  }

  function syncToolAvailability() {
    syncHeaderInputState();
    const hasVideoInfo = !!videoInfo;

    if ($('downloadVideoBtn')) {
      $('downloadVideoBtn').disabled = !hasVideoInfo;
      $('downloadVideoBtn').textContent = '⬇ Bắt đầu tải';
    }
    if ($('downloadSubtitleBtn')) $('downloadSubtitleBtn').disabled = !hasVideoInfo;
    if ($('downloadThumbnailBtn')) $('downloadThumbnailBtn').disabled = !hasVideoInfo;
    if ($('downloadBatchBtn')) $('downloadBatchBtn').disabled = !(batchSelected.size > 0);
  }

  async function maybePromptActivation() {
    if (isSmokeRenderer) return;
    if (activationPromptShown) return;
    if (licenseStatus?.status === 'active') return;

    activationPromptShown = true;
    openLicenseModal();

    if (licenseStatus?.status === 'expired') {
      showStatus(TEXT.license.expired(formatLicenseDate(licenseStatus.license?.expiresAt)), 'warn');
      return;
    }
    if (licenseStatus?.status === 'unconfigured') {
      showStatus(TEXT.license.unconfigured, 'warn');
      return;
    }
    showStatus(TEXT.license.reminder, 'warn');
  }

  function formatLicenseDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('vi-VN');
  }

  async function refreshLicenseStatus(options = {}) {
    const { notify = false } = options;
    await loadLicenseStatus();
    if (notify) showStatus(TEXT.license.checked, 'info');
  }

  function getSelectedProfile() {
    const selectedId = $('profileSelect')?.value || ui.selectedProfileId || DEFAULTS.selectedProfileId;
    return downloadProfiles.find(profile => profile.id === selectedId) || downloadProfiles[0] || null;
  }

  function onProfileSelected() {
    const selectedId = $('profileSelect')?.value || DEFAULTS.selectedProfileId;
    persistUi({ selectedProfileId: selectedId });
    renderProfileDescription();
  }

  async function onParallelDownloadsChanged() {
    const value = $('parallelDownloads')?.value || DEFAULTS.parallelDownloads;
    await applyParallelDownloadsSetting(value);
  }

  async function applyParallelDownloadsSetting(value, options = {}) {
    const { persist = true, silent = false } = options;
    const parsed = Number.parseInt(value, 10);
    const nextValue = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 1), 6)
      : DEFAULTS.parallelDownloads;

    setValue('parallelDownloads', String(nextValue));
    if (persist) await persistUi({ parallelDownloads: nextValue });
    await api?.setMaxParallelDownloads?.(nextValue);
    if (!silent) showStatus(TEXT.settings.parallelSaved(nextValue), 'ok');
  }

  async function activateLicense() {
    const licenseKey = $('licenseKeyInput')?.value?.trim() || '';
    if (!licenseKey) return showStatus(TEXT.license.emptyKey, 'warn');
    const response = await api?.activateLicense?.(licenseKey);
    licenseStatus = response?.licenseStatus || null;
    renderLicenseStatus();
    if (!response?.success) return showStatus(response?.error || licenseStatus?.message || TEXT.license.invalid('Khong kich hoat duoc'), 'warn');
    setValue('licenseKeyInput', '');
    showStatus(TEXT.license.activated, 'ok');
  }

  async function activateLicenseOnline() {
    const code = $('activationCodeInput')?.value?.trim() || '';
    if (!code) return showStatus(TEXT.license.emptyCode, 'warn');

    const btn = $('activateOnlineBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang kích hoạt…'; }
    showStatus(TEXT.license.activating, 'info');
    try {
      const response = await api?.activateLicenseOnline?.(code);
      licenseStatus = response?.licenseStatus || null;
      renderLicenseStatus();
      if (!response?.success) {
        return showStatus(response?.error || TEXT.license.invalid('Kich hoat online that bai'), 'warn');
      }
      setValue('activationCodeInput', '');
      showStatus(TEXT.license.activated, 'ok');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Kích hoạt'; }
    }
  }

  async function clearLicense() {
    const response = await api?.clearLicense?.();
    licenseStatus = response?.licenseStatus || null;
    renderLicenseStatus();
    setValue('licenseKeyInput', '');
    showStatus(TEXT.license.cleared, 'info');
  }

  async function copyMachineId() {
    const machineId = licenseStatus?.machineId || $('machineIdInput')?.value || '';
    if (!machineId) return;
    await api?.copyText?.(machineId);
    showStatus(TEXT.license.machineIdCopied, 'ok');
  }

  function collectCurrentProfileDraft(existingProfile = null) {
    return {
      id: existingProfile?.id || '',
      name: existingProfile?.name || '',
      description: existingProfile?.description || '',
      single: {
        videoFormat: $('videoFormat')?.value || 'mp4',
        videoQuality: $('videoQuality')?.value || '1080p',
        subtitleLang: $('subtitleLang')?.value || 'auto',
        subtitleFormat: $('subtitleFormat')?.value || 'both',
      },
      batch: {
        maxVideos: parseInt($('maxVideos')?.value || DEFAULTS.maxVideos, 10) || DEFAULTS.maxVideos,
        batchFormat: $('batchFormat')?.value || 'mp4',
        batchQuality: $('batchQuality')?.value || '1080p',
        batchSubs: $('batchSubs')?.value || 'no',
      },
    };
  }

  async function saveCurrentProfile() {
    const selected = getSelectedProfile();
    const updateExisting = isCustomProfile(selected);
    const profileName = window.prompt(TEXT.profiles.saveNamePrompt, updateExisting ? selected.name : TEXT.profiles.savePrompt(new Date().toLocaleDateString('vi-VN')));
    if (!profileName || !profileName.trim()) return;
    const profileDescription = window.prompt(TEXT.profiles.saveDescriptionPrompt, updateExisting ? (selected.description || '') : TEXT.profiles.saveDescriptionFallback);
    const response = await api?.saveDownloadProfile?.({
      ...collectCurrentProfileDraft(updateExisting ? selected : null),
      id: updateExisting ? selected.id : '',
      name: profileName.trim(),
      description: String(profileDescription || '').trim(),
    });

    if (!response?.profile) return showStatus(TEXT.profiles.saveFailed, 'warn');
    await loadDownloadProfiles();
    setValue('profileSelect', response.profile.id);
    await persistUi({ selectedProfileId: response.profile.id });
    renderProfileDescription();
    showStatus(TEXT.profiles.saveSuccess(response.profile.name), 'ok');
  }

  async function deleteSelectedProfile() {
    const selected = getSelectedProfile();
    if (!isCustomProfile(selected)) return showStatus(TEXT.profiles.deleteCustomOnly, 'warn');
    if (!window.confirm(TEXT.profiles.deleteConfirm(selected.name))) return;
    const response = await api?.deleteDownloadProfile?.(selected.id);
    if (!response?.success) return showStatus(TEXT.profiles.deleteFailed, 'warn');
    await loadDownloadProfiles();
    const fallbackId = downloadProfiles[0]?.id || DEFAULTS.selectedProfileId;
    setValue('profileSelect', fallbackId);
    await persistUi({ selectedProfileId: fallbackId });
    renderProfileDescription();
    showStatus(TEXT.profiles.deleteSuccess(selected.name), 'ok');
  }

  async function applySelectedProfileToSingle() {
    const profile = getSelectedProfile();
    if (!profile?.single) return showStatus(TEXT.profiles.profileMissing, 'warn');
    setValue('videoFormat', profile.single.videoFormat);
    setValue('videoQuality', profile.single.videoQuality);
    setValue('subtitleLang', profile.single.subtitleLang);
    setValue('subtitleFormat', profile.single.subtitleFormat);
    await persistUi({ selectedProfileId: profile.id });
    showStatus(TEXT.profiles.applySingle(profile.name), 'ok');
  }

  async function applySelectedProfileToBatch() {
    const profile = getSelectedProfile();
    if (!profile?.batch) return showStatus(TEXT.profiles.profileMissing, 'warn');
    setValue('maxVideos', String(profile.batch.maxVideos));
    setValue('batchFormat', profile.batch.batchFormat);
    setValue('batchQuality', profile.batch.batchQuality);
    setValue('batchSubs', profile.batch.batchSubs);
    await persistUi({
      selectedProfileId: profile.id,
      maxVideos: profile.batch.maxVideos,
      batchFormat: profile.batch.batchFormat,
      batchQuality: profile.batch.batchQuality,
      batchSubs: profile.batch.batchSubs,
    });
    showStatus(TEXT.profiles.applyBatch(profile.name), 'ok');
  }

  async function applySelectedProfileEverywhere() {
    await applySelectedProfileToSingle();
    await applySelectedProfileToBatch();
  }

  function applyCaps(caps) {
    const modeMap = { full: { label: 'Đầy đủ', cls: 'full', dot: 'ok' }, basic: { label: 'Cơ bản', cls: 'basic', dot: 'warn' }, demo: { label: 'Dùng thử', cls: 'demo', dot: 'error' } };
    const mode = modeMap[caps?.workingMode] || modeMap.demo;
    if ($('modeBadge')) { $('modeBadge').textContent = mode.label; $('modeBadge').className = `mode-badge ${mode.cls}`; }
    if ($('ytdlpDot')) $('ytdlpDot').className = `ytdlp-dot ${mode.dot}`;
    if ($('ytdlpVer')) $('ytdlpVer').textContent = caps?.ytdlp ? 'Sẵn sàng' : 'Chưa tìm thấy';
    if ($('systemComponentsText')) {
      $('systemComponentsText').textContent = [
        `Bộ tải: ${caps?.ytdlp ? 'sẵn sàng' : 'chưa sẵn sàng'}`,
        `Xử lý media: ${caps?.ffmpeg ? 'sẵn sàng' : 'chưa sẵn sàng'}`,
      ].join(' · ');
    }
  }



  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    $(`tab-${tab}`)?.classList.add('active');
    $(`nav-${tab}`)?.classList.add('active');
    if (tab === 'batch') {
      if ($('header-url-bar')) $('header-url-bar').style.display = 'none';
      if ($('getInfoBtn')) $('getInfoBtn').style.display = 'none';
      if ($('scanBtnHeader')) $('scanBtnHeader').style.display = 'none';
    } else {
      if ($('header-url-bar')) $('header-url-bar').style.display = 'flex';
      if ($('urlInput')) $('urlInput').placeholder = TEXT.placeholders.singleUrl;
      if ($('getInfoBtn')) $('getInfoBtn').style.display = 'inline-flex';
      if ($('scanBtnHeader')) $('scanBtnHeader').style.display = 'none';
    }
    if (tab === 'history') renderHistory();
    syncHeaderInputState();
  }
  function toggleTheme() { const nextTheme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; applyTheme(nextTheme); persistUi({ theme: nextTheme }); }
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    if ($('themeToggleIcon')) $('themeToggleIcon').textContent = theme === 'light' ? '🌙' : '☀️';
    if ($('themeToggleLabel')) $('themeToggleLabel').textContent = theme === 'light' ? 'Giao diện tối' : 'Giao diện sáng';
  }


  function showStatus(message, type = 'info') { if (!$('statusMsg')) return; $('statusMsg').textContent = message; $('statusMsg').className = `status show ${type}`; clearTimeout($('statusMsg')._timer); if (type !== 'err') $('statusMsg')._timer = setTimeout(() => { $('statusMsg').className = 'status'; }, 6000); }

  function showProgress(label = '\u0110ang x\u1eed l\u00fd...') { $('progressWrap')?.classList.add('show'); if ($('progressLabel')) $('progressLabel').textContent = label; setProgress(0); }


  function hideProgress() {
    $('progressWrap')?.classList.remove('show');
    maybeShowDeferredUpdatePrompt();
  }
  function setProgress(percent) { const safe = Math.max(0, Math.min(100, Math.round(percent || 0))); if ($('progressFill')) $('progressFill').style.width = `${safe}%`; if ($('progressPct')) $('progressPct').textContent = `${safe}%`; }
  async function selectFolder() { const folder = await api?.selectDownloadFolder?.(); if (folder) $('folderInput').value = folder; }


  async function selectCookieFile() {
    const cookieFile = await api?.selectCookieFile?.();
    if (!cookieFile) return;
    socialCookiePath = cookieFile;
    applySocialCookiePath();
    try { await api?.storeSet?.('socialCookiesPath', cookieFile); } catch (_) {}
    showStatus(TEXT.social.cookiesSaved, 'ok');
  }

  async function clearCookieFile() {
    socialCookiePath = '';
    applySocialCookiePath();
    try { await api?.storeDelete?.('socialCookiesPath'); } catch (_) {}
    showStatus(TEXT.social.cookiesCleared, 'info');
  }


  async function selectBatchFolder() { const folder = await api?.selectDownloadFolder?.(); if (folder) $('batchFolderInput').value = folder; }
  async function pasteUrlFromClipboard() {
    const value = String(await api?.readClipboardText?.() || '').trim();
    if (!/^https?:\/\//i.test(value)) return showStatus('Clipboard chưa có liên kết video hợp lệ.', 'warn');
    setValue('urlInput', value);
    syncHeaderInputState();
    if (currentTab === 'single') await getVideoInfo();
  }

  async function loadAppInfo() {
    const info = await api?.getAppInfo?.();
    if ($('appVersionText')) $('appVersionText').textContent = `Andrew Downloader ${info?.version ? `v${info.version}` : ''}`;
    if ($('systemComponentsText')) {
      const caps = info?.capabilities || {};
      $('systemComponentsText').textContent = [
        `Bộ tải: ${caps.ytdlp ? 'sẵn sàng' : 'chưa sẵn sàng'}`,
        `Xử lý media: ${caps.ffmpeg ? 'sẵn sàng' : 'chưa sẵn sàng'}`,
      ].join(' · ');
    }
  }

  async function clearPrivateData() {
    if (!window.confirm('Xóa cookies đã chọn và lịch sử tải trên máy này?')) return;
    await api?.clearPrivateData?.();
    socialCookiePath = '';
    history = [];
    applySocialCookiePath();
    renderHistory();
    showStatus('Đã xóa dữ liệu riêng tư lưu cục bộ.', 'ok');
  }

  function applyQuickPreset(preset) {
    const presets = {
      compatible: { format: 'mp4', quality: '1080p' },
      quality: { format: 'mp4', quality: 'best' },
      audio: { format: 'mp3', quality: 'best' },
    };
    const selected = presets[preset] || presets.compatible;
    setValue('videoFormat', selected.format);
    setValue('videoQuality', selected.quality);
    document.querySelectorAll('[data-preset]').forEach(button => {
      button.classList.toggle('active', button.dataset.preset === preset);
    });
    showStatus(`Đã chọn cấu hình ${preset === 'quality' ? 'Chất lượng cao' : preset === 'audio' ? 'Chỉ nghe' : 'Nhanh & tương thích'}.`, 'info');
  }
  function disableDownloadButtons() { ['downloadVideoBtn', 'downloadSubtitleBtn', 'downloadThumbnailBtn'].forEach(id => { if ($(id)) $(id).disabled = true; }); }
  function enableDownloadButtons() { syncToolAvailability(); }



  async function getVideoInfo() {
    if (!ensureLicenseAccess('lay thong tin video')) return;
    const url = $('urlInput').value.trim();
    if (!url) return;
    videoInfo = null;
    if ($('getInfoBtn')) { $('getInfoBtn').disabled = true; $('getInfoBtn').innerHTML = '<span class="spin"></span> \u0110ang l\u1ea5y...'; }
    $('videoCard').style.display = 'none';
    disableDownloadButtons();
    showStatus('\u0110ang l\u1ea5y th\u00f4ng tin video...', 'info');
    try {
      videoInfo = await api.getVideoInfoMulti(url);
      renderVideoCard(videoInfo);
      enableDownloadButtons();
      showStatus(`L\u1ea5y info th\u00e0nh c\u00f4ng: ${videoInfo.title}`, 'ok');
    } catch (error) {
      showStatus(error.message, 'err');
    } finally {
      if ($('getInfoBtn')) { $('getInfoBtn').disabled = false; $('getInfoBtn').innerHTML = 'LẤY THÔNG TIN'; }
      syncToolAvailability();
    }
  }



  function renderVideoCard(info) {
    $('videoCard').style.display = 'block';
    if (info.thumbnail) { $('videoThumb').src = info.thumbnail; $('videoThumb').style.display = 'block'; $('thumbPh').style.display = 'none'; }
    else { $('videoThumb').removeAttribute('src'); $('videoThumb').style.display = 'none'; $('thumbPh').style.display = 'grid'; }
    if (info.durationStr && info.durationStr !== '0:00') { $('thumbDuration').textContent = info.durationStr; $('thumbDuration').style.display = 'block'; }
    else { $('thumbDuration').textContent = ''; $('thumbDuration').style.display = 'none'; }
    $('videoTitle').textContent = info.title || '-';
    $('metaAuthor').textContent = `Kênh: ${info.author || '-'}`;
    $('metaViews').textContent = info.viewCountStr ? `Lượt xem: ${info.viewCountStr}` : '';
    $('metaViews').style.display = info.viewCountStr ? 'inline-flex' : 'none';
    if (info.height) { $('metaMaxQ').textContent = `Tối đa ${info.height}p`; $('metaMaxQ').style.display = 'inline-flex'; } else $('metaMaxQ').style.display = 'none';
    if (info.platform && !['youtube', 'unknown'].includes(info.platform)) { $('metaPlatform').textContent = info.platform; $('metaPlatform').style.display = 'inline-flex'; } else $('metaPlatform').style.display = 'none';
    renderQualityPills($('qualityPills'), info.formats || []);
  }



  async function downloadVideo() {
    if (!ensureLicenseAccess('tai video')) return;
    const url = $('urlInput').value.trim();
    const folder = $('folderInput').value.trim();
    if (!url || !folder) return showStatus('\u0056ui l\u00f2ng ch\u1ecdn th\u01b0 m\u1ee5c l\u01b0u', 'warn');
    const disk = await api?.checkDiskSpace?.(folder);
    if (disk?.success && disk.freeBytes < 512 * 1024 * 1024) {
      return showStatus('Ổ đĩa còn dưới 512 MB. Hãy chọn thư mục khác trước khi tải.', 'warn');
    }
    const format = $('videoFormat').value;
    const quality = $('videoQuality').value;
    $('downloadVideoBtn').disabled = true;
    showProgress(`\u0110ang t\u1ea3i ${format.toUpperCase()} ${quality}...`);
    showStatus('\u0042\u1eaft \u0111\u1ea7u t\u1ea3i video...', 'info');
    const removeProgress = api?.onDownloadProgress?.(data => setProgress(data.percent || 0));
    try {
      const result = await api.downloadVideo({
        url,
        outputPath: folder,
        format,
        quality,
        title: videoInfo?.title || '',
        filenameTemplate: $('filenameTemplate')?.value || 'title',
        conflictPolicy: $('fileConflictPolicy')?.value || 'rename',
        embedMetadata: $('embedMetadata')?.checked !== false,
        embedThumbnail: Boolean($('embedThumbnail')?.checked),
      });
      hideProgress();
      showStatus(`T\u1ea3i xong! File: ${result.filePath || folder}`, 'ok');
      addHistory({ type: 'video', title: videoInfo?.title || url, url, format, quality, folder });
    } catch (error) {
      hideProgress();
      showStatus(error.message, 'err');
    } finally {
      syncToolAvailability();
      removeProgress?.();
    }
  }



  async function downloadSubtitle() {
    if (!ensureLicenseAccess('tai phu de')) return;
    const url = $('urlInput').value.trim();
    const folder = $('folderInput').value.trim();
    if (!url || !folder) return showStatus('\u0056ui l\u00f2ng ch\u1ecdn th\u01b0 m\u1ee5c l\u01b0u', 'warn');
    const language = $('subtitleLang').value;
    const format = $('subtitleFormat').value;
    $('downloadSubtitleBtn').disabled = true;
    showProgress('\u0110ang t\u1ea3i ph\u1ee5 \u0111\u1ec1...');
    showStatus('\u0110ang t\u1ea3i ph\u1ee5 \u0111\u1ec1...', 'info');
    try {
      const result = await api.downloadSubtitle({ url, outputPath: folder, language, format });
      hideProgress();
      showStatus(`T\u1ea3i xong ${result.files?.length || 0} file subtitle`, 'ok');
      addHistory({ type: 'subtitle', title: videoInfo?.title || url, url, language, format, folder });
    } catch (error) {
      hideProgress();
      showStatus(error.message, 'err');
    } finally {
      syncToolAvailability();
    }
  }



  async function downloadThumbnail() {
    if (!ensureLicenseAccess('tai thumbnail')) return;
    const url = $('urlInput').value.trim();
    const folder = $('folderInput').value.trim();
    if (!url || !folder) return showStatus('\u0056ui l\u00f2ng ch\u1ecdn th\u01b0 m\u1ee5c l\u01b0u', 'warn');
    $('downloadThumbnailBtn').disabled = true;
    showStatus('\u0110ang t\u1ea3i thumbnail...', 'info');
    try {
      const result = await api.downloadThumbnail({ url, outputPath: folder, videoInfo });
      showStatus(`Thumbnail: ${result.filePath || folder}`, 'ok');
      addHistory({ type: 'thumbnail', title: videoInfo?.title || url, url, folder });
    } catch (error) {
      showStatus(error.message, 'err');
    } finally {
      syncToolAvailability();
    }
  }



  function isFacebookUrl(url) {
    try {
      const parsed = new URL(String(url || '').trim());
      return /(^|\.)facebook\.com$/i.test(parsed.hostname);
    } catch (_) {
      return false;
    }
  }

  async function scanVideos() {
    if (!ensureLicenseAccess('quet danh sach video')) return;

    const sourceText = $('batchLinksInput')?.value.trim() || $('urlInput')?.value.trim() || '';
    const urls = sourceText.split(/\r?\n/).map(line => line.trim()).filter(line => /^https?:\/\//i.test(line));
    if (!urls.length) return showStatus('Vui lòng dán playlist, kênh hoặc liên kết video.', 'warn');
    if (urls.length > 1) return loadLinksFromTextarea();
    const url = urls[0];
    if ($('urlInput')) $('urlInput').value = url;

    if (isFacebookUrl(url)) {
      switchBatchSrc('facebook');
      if ($('facebookPageInput')) $('facebookPageInput').value = url;
      return showStatus('Facebook đã được tách sang tab riêng. Nhấn “Quét Facebook” để bắt đầu.', 'info');
    }

    const maxVideos = parseInt($('maxVideos').value, 10) || DEFAULTS.maxVideos;
    await persistUi({ maxVideos });
    $('loadLinksBtn').disabled = true;
    $('loadLinksBtn').innerHTML = '<span class="spin"></span> Đang phân tích...';
    batchSelected.clear();
    try {
      const result = await api?.scanChannelVideos?.({ url, maxVideos });
      batchVideos = result?.videos || [];
      batchSelected = new Set(batchVideos.map((_, index) => index));
      renderBatch();
      $('videoListSection').style.display = 'block';
      showStatus(result?.partial ? `Kh\u00f4i ph\u1ee5c \u0111\u01b0\u1ee3c ${batchVideos.length} video t\u1eeb k\u1ebft qu\u1ea3 qu\u00e9t m\u1ed9t ph\u1ea7n` : `T\u00ecm th\u1ea5y ${batchVideos.length} video`, result?.partial ? 'warn' : 'ok');
    } catch (error) {
      showStatus(error.message, 'err');
    } finally {
      $('loadLinksBtn').disabled = false;
      $('loadLinksBtn').textContent = 'Phân tích nguồn';
    }
  }

  function updateUnifiedBatchSourceHint() {
    const value = $('batchLinksInput')?.value || '';
    const urls = value.split(/\r?\n/).map(line => line.trim()).filter(line => /^https?:\/\//i.test(line));
    if ($('linkCount')) $('linkCount').textContent = `${urls.length} liên kết`;
    if (!$('batchSourceType')) return;
    if (!urls.length) $('batchSourceType').textContent = 'Tự nhận diện nguồn';
    else if (urls.length > 1) $('batchSourceType').textContent = 'Danh sách nhiều liên kết';
    else if (isFacebookUrl(urls[0])) $('batchSourceType').textContent = 'Facebook Page / Reels';
    else if (/playlist|channel|\/@|\/c\/|\/user\//i.test(urls[0])) $('batchSourceType').textContent = 'Kênh hoặc danh sách phát';
    else $('batchSourceType').textContent = 'Liên kết video';
  }

  function reelUrlFromFacebookUid(uid) {
    return `https://www.facebook.com/reel/${uid}`;
  }

  function makeFacebookBatchVideo(uid, index) {
    const cleanUid = String(uid || '').trim();
    return {
      title: cleanUid || `Facebook Reel ${index + 1}`,
      url: reelUrlFromFacebookUid(cleanUid),
      videoId: cleanUid,
      author: 'Facebook',
      duration: 0,
      views: 0,
      thumbnail: '',
      maxQuality: 1080,
      manualUrl: true,
    };
  }

  function getMaxQualityFromInfo(info, fallback = 1080) {
    const heights = [
      Number(info?.height || 0),
      ...((info?.formats || []).map(format => Number(String(format?.quality || '').replace(/[^\d]/g, '')) || 0)),
    ].filter(Boolean);

    return heights.length ? Math.max(...heights) : fallback;
  }

  function resetFacebookMetadataResolver() {
    facebookMetadataQueue = [];
    facebookMetadataPending = new Set();
    facebookMetadataActive = 0;
    facebookMetadataScanToken += 1;
    return facebookMetadataScanToken;
  }

  function enqueueFacebookMetadata(videoId, url, scanToken) {
    const key = String(videoId || '').trim();
    if (!key || facebookMetadataPending.has(key)) return;
    facebookMetadataPending.add(key);
    facebookMetadataQueue.push({ key, url, scanToken, pendingSet: facebookMetadataPending });
    processFacebookMetadataQueue();
  }

  async function processFacebookMetadataQueue() {
    const concurrency = 2;
    while (facebookMetadataActive < concurrency && facebookMetadataQueue.length) {
      const task = facebookMetadataQueue.shift();
      facebookMetadataActive += 1;
      resolveFacebookMetadataTask(task)
        .catch(() => {})
        .finally(() => {
          facebookMetadataActive = Math.max(facebookMetadataActive - 1, 0);
          processFacebookMetadataQueue();
        });
    }
  }

  async function resolveFacebookMetadataTask(task) {
    if (!task || task.scanToken !== facebookMetadataScanToken) return;

    try {
      const info = await api?.getVideoInfoMulti?.(task.url);
      if (!info || task.scanToken !== facebookMetadataScanToken) return;

      const index = batchVideos.findIndex(video => String(video.videoId || '').trim() === task.key);
      if (index < 0) return;

      const current = batchVideos[index];
      batchVideos[index] = {
        ...current,
        title: info.title || current.title,
        author: info.author || current.author,
        duration: info.duration || current.duration || 0,
        views: info.viewCount || current.views || 0,
        thumbnail: info.thumbnail || current.thumbnail,
        maxQuality: getMaxQualityFromInfo(info, current.maxQuality),
        videoId: info.videoId || current.videoId,
        platform: info.platform || current.platform || 'facebook',
      };
      renderBatch();
    } catch (_) {
      // Keep placeholder if one reel cannot resolve metadata.
    } finally {
      task.pendingSet?.delete(task.key);
    }
  }

  function setFacebookScanActive(isActive) {
    facebookScanActive = isActive;
    if ($('scanFacebookBtn')) {
      $('scanFacebookBtn').disabled = isActive;
      $('scanFacebookBtn').innerHTML = isActive ? '<span class="spin"></span> Đang quét...' : 'Quét Facebook';
    }
    if ($('facebookScanCancelBtn')) $('facebookScanCancelBtn').disabled = !isActive;
  }

  function updateFacebookScanMetrics(status = {}) {
    if ($('facebookScanFound')) $('facebookScanFound').textContent = String(status.found ?? facebookScanUids.size);
    if ($('facebookScanDom')) $('facebookScanDom').textContent = String(status.domScanCount ?? 0);
    if ($('facebookScanElapsed')) $('facebookScanElapsed').textContent = `${status.elapsedSeconds ?? 0}s`;
    if ($('facebookScanState')) $('facebookScanState').textContent = status.state || (facebookScanActive ? 'Đang quét' : 'Sẵn sàng');
  }

  async function scanFacebookPageVideos() {
    const pageUrl = $('facebookPageInput')?.value.trim() || '';
    if (!pageUrl) return showStatus('Vui lòng dán URL Facebook Page/Reels vào ô trên', 'warn');
    if (!isFacebookUrl(pageUrl)) return showStatus('Nguồn Facebook Page/Reels chỉ nhận URL facebook.com', 'warn');

    const maxVideos = Math.min(parseInt($('maxVideos').value, 10) || DEFAULTS.maxVideos, 200);
    if ($('maxVideos')) $('maxVideos').value = String(maxVideos);
    await persistUi({ maxVideos, batchSourceMode: 'facebook' });
    resetFacebookMetadataResolver();
    facebookScanUids = new Set();
    batchVideos = [];
    batchSelected.clear();
    renderBatch();
    $('videoListSection').style.display = 'block';
    updateFacebookScanMetrics({ state: 'Đang khởi động', found: 0, domScanCount: 0, elapsedSeconds: 0 });
    setFacebookScanActive(true);
    showStatus('Đang quét Facebook bằng trình duyệt ẩn...', 'info');

    const result = await api?.scanFacebookPage?.({ pageUrl, maxVideos });
    if (!result?.success) {
      setFacebookScanActive(false);
      updateFacebookScanMetrics({ state: 'Lỗi', found: facebookScanUids.size });
      showStatus(result?.error || 'Không thể bắt đầu quét Facebook', 'err');
    }
  }

  async function cancelFacebookScan() {
    await api?.cancelFacebookScan?.();
    setFacebookScanActive(false);
    updateFacebookScanMetrics({ state: 'Đã dừng', found: facebookScanUids.size });
    showStatus(`Đã dừng quét Facebook, giữ lại ${facebookScanUids.size} link`, 'warn');
  }

  function handleFacebookUidsDiscovered(uids = []) {
    const scanToken = facebookMetadataScanToken;
    const newVideos = [];
    for (const rawUid of uids) {
      const uid = String(rawUid || '').trim();
      if (!/^\d+$/.test(uid)) continue;

      if (facebookScanUids.has(uid)) continue;

      facebookScanUids.add(uid);
      newVideos.push(makeFacebookBatchVideo(uid, batchVideos.length + newVideos.length));
    }

    if (!newVideos.length) return;
    batchVideos = [...batchVideos, ...newVideos];
    batchSelected = new Set(batchVideos.map((_, index) => index));
    renderBatch();
    $('videoListSection').style.display = 'block';
    updateFacebookScanMetrics({ state: 'Đang quét', found: batchVideos.length });
    showStatus(`Đã phát hiện ${batchVideos.length} link Facebook, đang nạp thông tin video...`, 'info');

    for (const video of newVideos) {
      enqueueFacebookMetadata(video.videoId, video.url, scanToken);
    }
  }

  function handleFacebookScanStatus(status = {}) {
    updateFacebookScanMetrics(status);

    if (status.state === 'stopped') {
      setFacebookScanActive(false);
      const found = Number(status.found) || facebookScanUids.size;
      const message = status.reason === 'limit-reached'
        ? `Đã quét đủ ${found} link Facebook, danh sách sẽ tiếp tục nạp thông tin nền`
        : `Đã dừng quét Facebook, tìm thấy ${found} link`;
      showStatus(message, found > 0 ? 'ok' : 'warn');
    }
  }


  function renderBatch() {
    return batchController.renderBatch();
  }

  function toggleBatchSelection(index) { return batchController.toggleBatchSelection(index); }
  function updateBatchCount() { return batchController.updateBatchCount(); }
  function batchSelectAll() { return batchController.batchSelectAll(); }
  function batchDeselectAll() { return batchController.batchDeselectAll(); }



  async function startBatchDownload() { return batchController.startBatchDownload(); }
  async function executeBatchDownload(selectedVideos, options = {}) { return batchController.executeBatchDownload(selectedVideos, options); }
  function cancelBatchDownload() { return batchController.cancelBatchDownload(); }
  async function retryFailedBatch() { return batchController.retryFailedBatch(); }


  function addHistory(entry) {
    return historyController.addHistory(entry);
  }


  function clearHistory() {
    return historyController.clearHistory();
  }


  function updateHistoryBadge() { return historyController.updateHistoryBadge(); }
  function renderHistory() { return historyController.renderHistory(); }


  function openHistoryItem(item) { return historyController.openHistoryItem(item); }


  async function loadHistory() { return historyController.loadHistory(); }
  async function saveHistory() { return historyController.saveHistory(); }



  async function openUpdateModal(prefetchedResult = null) { return updateController.openUpdateModal(prefetchedResult); }
  async function doUpdate() { return updateController.doUpdate(); }
  function closeUpdateModal() { return updateController.closeUpdateModal(); }
  function setUpdateStatus(message, type) { return updateController.setUpdateStatus(message, type); }
  function scheduleUpdateCheck() {
    return updateController.scheduleUpdateCheck();
  }

  function switchBatchSrc(mode) {
    return batchController.switchBatchSrc(mode);
  }



  function loadLinksFromTextarea() { return batchController.loadLinksFromTextarea(); }
  function loadLinksFromFile(input) { return batchController.loadLinksFromFile(input); }



  function showResultModal(total, ok, fail, folder, failedVideos = []) { return batchController.showResultModal(total, ok, fail, folder, failedVideos); }
  function closeResultModal() { return batchController.closeResultModal(); }
  function openResultFolder() { return batchController.openResultFolder(); }

  function formatDuration(seconds) { if (!seconds) return ''; const mins = Math.floor(seconds / 60); const secs = Math.floor(seconds % 60); return `${mins}:${String(secs).padStart(2, '0')}`; }

  const getBatchState = () => ({
    batchVideos,
    batchSelected,
    batchCancelled,
    lastBatchFolder,
    lastBatchFailedVideos,
  });

  const setBatchState = (partial = {}) => {
    if (Object.prototype.hasOwnProperty.call(partial, 'batchVideos')) batchVideos = partial.batchVideos;
    if (Object.prototype.hasOwnProperty.call(partial, 'batchSelected')) batchSelected = partial.batchSelected;
    if (Object.prototype.hasOwnProperty.call(partial, 'batchCancelled')) batchCancelled = partial.batchCancelled;
    if (Object.prototype.hasOwnProperty.call(partial, 'lastBatchFolder')) lastBatchFolder = partial.lastBatchFolder;
    if (Object.prototype.hasOwnProperty.call(partial, 'lastBatchFailedVideos')) lastBatchFailedVideos = partial.lastBatchFailedVideos;
  };

  const getHistoryState = () => history;
  const setHistoryState = nextHistory => { history = Array.isArray(nextHistory) ? nextHistory : []; };
  const getPendingAutoUpdate = () => pendingAutoUpdateResult;
  const setPendingAutoUpdate = value => { pendingAutoUpdateResult = value; };

  historyController = createHistoryController({
    api,
    $,
    getHistory: getHistoryState,
    setHistory: setHistoryState,
    switchTab,
    switchBatchSrc,
    syncHeaderInputState,
    showStatus,
  });

  batchController = createBatchController({
    api,
    $,
    getState: getBatchState,
    setState: setBatchState,
    persistUi,
    updateBatchRunSummary,
    maybeShowDeferredUpdatePrompt,
    addHistory,
    formatDuration,
    sleep,
    getInterVideoDelayMs,
    getBatchSourceMode: () => ui.batchSourceMode || 'channel',
    showStatus,
    ensureBatchAccess: () => ensureLicenseAccess('tai hang loat'),
  });

  updateController = createUpdateController({
    api,
    $,
    isSmokeRenderer,
    hasBusyDownloads,
    getPendingAutoUpdateResult: getPendingAutoUpdate,
    setPendingAutoUpdateResult: setPendingAutoUpdate,
    applyCaps,
  });


  return { boot, switchTab, toggleTheme, openSettingsModal, closeSettingsModal, openLicenseModal, closeLicenseModal, openDownloadCenterModal, closeDownloadCenterModal, openUpdateModal, closeUpdateModal, doUpdate, clearHistory, batchSelectAll, batchDeselectAll, switchBatchSrc, loadLinksFromTextarea, loadLinksFromFile, closeResultModal, openResultFolder };
})();

if (typeof window !== 'undefined') window.VIC = VIC;
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { VIC.boot().catch(() => {}); }, { once: true });
  else VIC.boot().catch(() => {});
}
