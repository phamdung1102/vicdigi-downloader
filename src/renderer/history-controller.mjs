import { renderHistoryList } from './renderers.mjs';
import { TEXT } from './messages.mjs';

export function createHistoryController(deps) {
  const {
    api,
    $,
    getHistory,
    setHistory,
    switchTab,
    switchBatchSrc,
    syncHeaderInputState,
    showStatus,
  } = deps;

  function addHistory(entry) {
    const nextEntry = {
      ...entry,
      date: new Date().toLocaleString('vi-VN', { hour12: false }),
    };
    const nextHistory = [nextEntry, ...getHistory()];
    if (nextHistory.length > 100) nextHistory.length = 100;
    setHistory(nextHistory);
    saveHistory();
    updateHistoryBadge();
  }

  function clearHistory() {
    if (!window.confirm(TEXT.history.clearConfirm)) return;
    setHistory([]);
    saveHistory();
    updateHistoryBadge();
    renderHistory();
  }

  function updateHistoryBadge() {
    const count = getHistory().length;
    $('historyBadge').textContent = count;
    $('historyTotal').textContent = count;
  }

  function renderHistory() {
    renderHistoryList($('historyList'), getHistory(), { onSelect: openHistoryItem });
  }

  function openHistoryItem(item) {
    if (!item) return;

    if (item.type === 'batch') {
      switchTab('batch');
      const canRestoreUrls = Array.isArray(item.urls) && item.urls.length > 0;
      const batchMode = canRestoreUrls ? 'links' : (item.sourceMode || 'channel');
      switchBatchSrc(batchMode);
      if (item.folder) $('batchFolderInput').value = item.folder;

      if (canRestoreUrls) {
        $('batchLinksInput').value = item.urls.join('\n');
        $('linkCount').textContent = `${item.urls.length} URL`;
      } else if (item.url) {
        $('urlInput').value = item.url;
      }

      syncHeaderInputState();
      showStatus(TEXT.history.restoredBatch, 'ok');
      return;
    }

    switchTab('single');
    if (item.url) $('urlInput').value = item.url;
    if (item.folder) $('folderInput').value = item.folder;
    syncHeaderInputState();
    showStatus(TEXT.history.restoredSingle, 'ok');
  }

  async function loadHistory() {
    let nextHistory = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const stored = await api?.storeGet?.('downloadHistory');
        nextHistory = Array.isArray(stored)
          ? stored
          : (typeof stored === 'string' ? (stored ? JSON.parse(stored) : []) : []);
        break;
      } catch (_) {
        await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
    setHistory(nextHistory);
    updateHistoryBadge();
  }

  async function saveHistory() {
    try { await api?.storeSet?.('downloadHistory', getHistory()); } catch (_) {}
  }

  return {
    addHistory,
    clearHistory,
    updateHistoryBadge,
    renderHistory,
    openHistoryItem,
    loadHistory,
    saveHistory,
  };
}
