const SETTINGS_KEY = 'aiSeparationSettings.v1';

export function createAudioSeparationController({ api, $, storeGet, storeSet, showStatus }) {
  let settings = { modelFolder: '', outputFolder: '', input: '', mode: 'background', quality: 'balanced', format: 'wav', model: '', autoAfterDownload: false, autoAfterBatch: false, mergeVideo: false, mergeStem: 'Instrumental' };
  let models = [];
  let running = false;
  const autoQueue = [];

  const formatBytes = value => {
    const size = Number(value) || 0;
    if (!size) return '—';
    return size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(1)} GB` : `${(size / 1024 ** 2).toFixed(0)} MB`;
  };

  async function persist() {
    settings = {
      ...settings,
      input: $('aiInputFile')?.value || settings.input,
      modelFolder: $('aiModelFolder')?.value || settings.modelFolder,
      outputFolder: $('aiOutputFolder')?.value || settings.outputFolder,
      mode: $('aiMode')?.value || settings.mode,
      quality: $('aiQuality')?.value || settings.quality,
      format: $('aiFormat')?.value || settings.format,
      model: $('aiModel')?.value || settings.model,
      autoAfterDownload: Boolean($('autoSeparateAudio')?.checked),
      autoAfterBatch: Boolean($('autoSeparateBatch')?.checked),
      mergeVideo: Boolean($('aiMergeVideo')?.checked),
      mergeStem: $('aiMergeStem')?.value || 'Instrumental',
    };
    await storeSet(SETTINGS_KEY, settings);
  }

  async function initialize() {
    settings = { ...settings, ...((await storeGet(SETTINGS_KEY)) || {}) };
    for (const [id, value] of [['aiInputFile', settings.input], ['aiModelFolder', settings.modelFolder], ['aiOutputFolder', settings.outputFolder], ['aiMode', settings.mode], ['aiQuality', settings.quality], ['aiFormat', settings.format]]) {
      if ($(id) && value) $(id).value = value;
    }
    if ($('autoSeparateAudio')) $('autoSeparateAudio').checked = Boolean(settings.autoAfterDownload);
    if ($('autoSeparateBatch')) $('autoSeparateBatch').checked = Boolean(settings.autoAfterBatch);
    if ($('aiMergeVideo')) $('aiMergeVideo').checked = Boolean(settings.mergeVideo);
    if ($('aiMergeStem')) { $('aiMergeStem').value = settings.mergeStem || 'Instrumental'; $('aiMergeStem').disabled = !settings.mergeVideo; }
    api?.onAiSeparationProgress?.(payload => updateProgress(payload?.message || 'Đang xử lý…'));
    await refreshStatus();
  }

  async function refreshStatus() {
    const status = await api.getAiSeparationStatus?.($('aiModelFolder')?.value || settings.modelFolder);
    if (!$('aiModelFolder')?.value && status?.modelFolder) $('aiModelFolder').value = status.modelFolder;
    models = status?.models || [];
    $('aiEngineBadge').textContent = status?.engineReady ? 'Engine sẵn sàng' : status?.pythonReady ? 'Chưa cài engine' : 'Có thể tự thiết lập';
    $('aiEngineBadge').className = `ai-engine-badge ${status?.engineReady ? 'ready' : 'missing'}`;
    $('aiSetupBtn').textContent = status?.engineReady ? 'Cài đặt lại engine' : 'Tự động cài engine';
    renderModels();
    await persist();
  }

  function renderModels() {
    const select = $('aiModel');
    if (select) {
      const automatic = '<option value="">Tự chọn model phù hợp</option>';
      select.innerHTML = automatic + models.map(model => `<option value="${model.path}">${model.name} · ${model.architecture}</option>`).join('');
      if (settings.model && [...select.options].some(option => option.value === settings.model)) select.value = settings.model;
    }
    $('aiModelList').innerHTML = models.length
      ? models.map(model => `<div class="ai-model-item"><div><b>${model.name}</b><span>${model.architecture} · ${model.stems.join(', ')}</span></div><em>${formatBytes(model.size)}</em></div>`).join('')
      : '<div class="ai-model-empty">Chưa có model cục bộ. App sẽ tự tải model phù hợp khi chạy lần đầu.</div>';
    $('aiModelCount').textContent = `${models.length} model nhận diện`;
  }

  async function chooseInput() {
    const file = await api.selectMediaFile?.();
    if (!file) return;
    $('aiInputFile').value = file;
    if (!$('aiOutputFolder').value) $('aiOutputFolder').value = file.replace(/[\\/][^\\/]+$/, '');
    await persist();
  }

  async function chooseFolder(id) {
    const folder = await api.selectDownloadFolder?.();
    if (!folder) return;
    $(id).value = folder;
    await persist();
    if (id === 'aiModelFolder') await refreshStatus();
  }

  async function installEngine() {
    if (running) return;
    running = true;
    setBusy(true, 'Đang chuẩn bị cài engine AI…');
    try {
      await api.installAiSeparationEngine?.();
      showStatus('Cài engine AI thành công.', 'ok');
      await refreshStatus();
    } catch (error) {
      showStatus(error?.message || 'Không cài được engine AI.', 'err');
      updateProgress(error?.message || 'Cài đặt thất bại');
    } finally { running = false; setBusy(false); if (autoQueue.length) processAutoQueue(); }
  }

  async function scanModels() {
    models = await api.scanAiModels?.($('aiModelFolder').value) || [];
    renderModels();
    showStatus(`Đã nhận diện ${models.length} model AI.`, models.length ? 'ok' : 'info');
    await persist();
  }

  async function start() {
    if (running) return;
    await persist();
    if (!settings.input || !settings.outputFolder) return showStatus('Hãy chọn video và thư mục xuất.', 'warn');
    running = true;
    setBusy(true, 'Đang khởi tạo AI Music Separation…');
    try {
      await ensureEngine();
      const quality = settings.mode === 'stems4' ? 'stems4' : settings.quality;
      const result = await api.separateAudio?.({ ...settings, quality, modelDir: settings.modelFolder, outputDir: settings.outputFolder });
      updateProgress(result?.mergedVideo ? 'Hoàn tất. Track AI đã được ghép vào video mới.' : 'Hoàn tất. Các track đã được xuất.');
      showStatus('Tách nhạc AI hoàn tất.', 'ok');
      if (result?.outputDir) api.showSystemNotification?.({ title: 'Tách nhạc hoàn tất', body: 'Các track AI đã sẵn sàng.' });
    } catch (error) {
      updateProgress(error?.message || 'Tách nhạc thất bại');
      showStatus(error?.message || 'Tách nhạc thất bại.', 'err');
    } finally { running = false; setBusy(false); if (autoQueue.length) processAutoQueue(); }
  }

  async function ensureEngine() {
    const status = await api.getAiSeparationStatus?.(settings.modelFolder);
    if (status?.engineReady) return true;
    updateProgress('Đang tự thiết lập engine AI cho lần sử dụng đầu tiên…');
    await api.installAiSeparationEngine?.();
    await refreshStatus();
    return true;
  }

  async function enqueueDownloadedFile(filePath, outputFolder = '') {
    const input = String(filePath || '').trim();
    if (!input || !/\.(?:mp4|mkv|webm|mov|avi|mp3|wav|flac|m4a)$/i.test(input)) {
      showStatus('Video đã tải nhưng chưa xác định được đường dẫn file để tự tách nhạc.', 'warn');
      return false;
    }
    const baseFolder = outputFolder || input.replace(/[\\/][^\\/]+$/, '');
    const baseName = input.split(/[\\/]/).pop().replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*]+/g, '').slice(0, 90) || 'Video';
    autoQueue.push({ input, outputFolder: `${baseFolder}\\AI Stems\\${baseName}` });
    processAutoQueue().catch(error => showStatus(error?.message || 'Tự tách nhạc thất bại.', 'err'));
    return true;
  }

  async function processAutoQueue() {
    if (running || !autoQueue.length) return;
    running = true;
    setBusy(true, `Đang chuẩn bị tách nhạc tự động · còn ${autoQueue.length} video`);
    try {
      await ensureEngine();
      while (autoQueue.length) {
        const job = autoQueue.shift();
        await persist();
        const quality = settings.mode === 'stems4' ? 'stems4' : settings.quality;
        updateProgress(`Tự động tách: ${job.input.split(/[\\/]/).pop()} · còn ${autoQueue.length} video`);
        await api.separateAudio?.({ ...settings, input: job.input, outputDir: job.outputFolder, modelDir: settings.modelFolder, quality });
      }
      updateProgress('Đã hoàn tất hàng đợi tách nhạc tự động.');
      api.showSystemNotification?.({ title: 'Tách nhạc hoàn tất', body: 'Các track AI đã được xuất cùng thư mục video.' });
    } finally {
      running = false;
      setBusy(false);
      if (autoQueue.length) processAutoQueue();
    }
  }

  async function cancel() { await api.cancelAudioSeparation?.(); updateProgress('Đã yêu cầu dừng tác vụ.'); }
  function updateProgress(message) { if ($('aiProgressText')) $('aiProgressText').textContent = message; }
  function setBusy(busy, message = '') {
    $('aiStartBtn').disabled = busy;
    $('aiCancelBtn').style.display = busy ? '' : 'none';
    $('aiProgress').classList.toggle('running', busy);
    if (message) updateProgress(message);
  }

  function wire() {
    $('aiChooseInputBtn')?.addEventListener('click', chooseInput);
    $('aiChooseOutputBtn')?.addEventListener('click', () => chooseFolder('aiOutputFolder'));
    $('aiChooseModelFolderBtn')?.addEventListener('click', () => chooseFolder('aiModelFolder'));
    $('aiScanModelsBtn')?.addEventListener('click', scanModels);
    $('aiSetupBtn')?.addEventListener('click', installEngine);
    $('aiStartBtn')?.addEventListener('click', start);
    $('aiCancelBtn')?.addEventListener('click', cancel);
    ['aiMode', 'aiQuality', 'aiFormat', 'aiModel'].forEach(id => $(id)?.addEventListener('change', persist));
    $('autoSeparateAudio')?.addEventListener('change', persist);
    $('autoSeparateBatch')?.addEventListener('change', persist);
    $('aiMergeVideo')?.addEventListener('change', async () => { $('aiMergeStem').disabled = !$('aiMergeVideo').checked; await persist(); });
    $('aiMergeStem')?.addEventListener('change', persist);
  }

  return { initialize, wire, refreshStatus, enqueueDownloadedFile };
}
