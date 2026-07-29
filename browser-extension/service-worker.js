const MENU_ID = 'send-to-andrew-downloader';

function buildAndrewUrl(url, action = 'open') {
  const host = action === 'download' ? 'download' : 'open';
  return `andrew-downloader://${host}?url=${encodeURIComponent(url)}`;
}

async function sendToAndrew(url, tabId, action = 'open') {
  if (!/^https?:\/\//i.test(String(url || ''))) return;
  if (Number.isInteger(tabId)) {
    await chrome.tabs.update(tabId, { url: buildAndrewUrl(url, action) });
  } else {
    await chrome.tabs.create({ url: buildAndrewUrl(url, action) });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Mở bằng Andrew Downloader',
      contexts: ['page', 'link', 'video'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  sendToAndrew(info.linkUrl || info.srcUrl || info.pageUrl, tab?.id);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['SEND_CURRENT_TAB', 'QUICK_DOWNLOAD'].includes(message?.type)) return false;
  const action = message.type === 'QUICK_DOWNLOAD' ? 'download' : 'open';
  sendToAndrew(message.url, sender?.tab?.id, action).then(() => sendResponse({ success: true }));
  return true;
});
