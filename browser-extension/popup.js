const sendButton = document.getElementById('sendBtn');
const downloadButton = document.getElementById('downloadBtn');
const videoButtonEnabled = document.getElementById('videoButtonEnabled');
const status = document.getElementById('status');

chrome.storage.local.get({ videoButtonEnabled: true }, settings => {
  videoButtonEnabled.checked = settings.videoButtonEnabled !== false;
});

videoButtonEnabled.addEventListener('change', () => {
  chrome.storage.local.set({ videoButtonEnabled: videoButtonEnabled.checked });
});

async function send(action) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:\/\//i.test(tab.url)) {
    status.textContent = 'Trang hiện tại không phải liên kết web.';
    return;
  }
  status.textContent = action === 'download' ? 'Đang gửi lệnh tải…' : 'Đang mở Andrew Downloader…';
  chrome.tabs.update(tab.id, {
    url: `andrew-downloader://${action === 'download' ? 'download' : 'open'}?url=${encodeURIComponent(tab.url)}`,
  });
  window.close();
}

sendButton.addEventListener('click', () => send('open'));
downloadButton.addEventListener('click', () => send('download'));
