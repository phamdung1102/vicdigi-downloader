function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function createNode(tag, options = {}) {
  const {
    className,
    text,
    attrs = {},
    dataset = {},
    children = [],
  } = options;

  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;

  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(key, value);
  }

  for (const [key, value] of Object.entries(dataset)) {
    node.dataset[key] = value;
  }

  children.filter(Boolean).forEach(child => node.appendChild(child));
  return node;
}

export function renderEmptyState(container, icon, text) {
  clearNode(container);
  container.appendChild(
    createNode('div', {
      className: 'empty',
      children: [
        createNode('div', { className: 'empty-icon', text: icon }),
        createNode('p', { text }),
      ],
    }),
  );
}

export function renderQualityPills(container, formats = []) {
  clearNode(container);

  formats
    .filter(format => format.height > 0)
    .forEach(format => {
      container.appendChild(
        createNode('span', {
          className: `q-pill ${format.height >= 1080 ? 'hi' : ''}`.trim(),
          text: format.quality,
        }),
      );
    });
}

export function renderBatchList(container, videos, selectedIndexes, onToggle, formatDuration) {
  clearNode(container);

  if (!videos.length) {
    renderEmptyState(container, '📭', 'Không tìm thấy video');
    return;
  }

  videos.forEach((video, index) => {
    const isSelected = selectedIndexes.has(index);
    const row = createNode('div', {
      className: `vi ${isSelected ? 'sel' : ''}`.trim(),
      dataset: { idx: String(index) },
    });

    row.addEventListener('click', () => onToggle(index));

    const checkbox = createNode('input', {
      className: 'vi-cb',
      attrs: { type: 'checkbox' },
    });
    checkbox.checked = isSelected;
    checkbox.addEventListener('click', event => event.stopPropagation());
    checkbox.addEventListener('change', () => onToggle(index));

    const thumbnailPlaceholder = createNode('div', {
      className: 'vi-thumb-placeholder',
      attrs: { 'aria-hidden': 'true' },
      children: [createNode('span', { className: 'vi-thumb-play' })],
    });
    const thumbnail = createNode('img', {
      className: 'vi-thumb',
      attrs: {
        alt: '',
        loading: 'lazy',
      },
    });
    const thumbnailWrap = createNode('div', {
      className: 'vi-thumb-wrap',
      children: [thumbnailPlaceholder, thumbnail],
    });
    const thumbnailUrl = String(video.thumbnail || '').trim();
    if (thumbnailUrl) thumbnail.src = thumbnailUrl;
    else thumbnail.style.display = 'none';
    thumbnail.addEventListener('load', () => {
      thumbnail.style.display = 'block';
      thumbnailPlaceholder.style.display = 'none';
    });
    thumbnail.addEventListener('error', () => {
      thumbnail.removeAttribute('src');
      thumbnail.style.display = 'none';
      thumbnailPlaceholder.style.display = 'grid';
    });

    const info = createNode('div', {
      className: 'vi-info',
      children: [
        createNode('div', {
          className: 'vi-name',
          text: video.title || 'Không rõ tiêu đề',
        }),
        createNode('div', {
          className: 'vi-meta',
          text: [video.author || '', formatDuration(video.duration)].filter(Boolean).join(' · '),
        }),
      ],
    });

    const quality = createNode('span', {
      className: 'vi-q',
      text: `${video.maxQuality || 720}p`,
    });

    row.appendChild(checkbox);
    row.appendChild(thumbnailWrap);
    row.appendChild(info);
    row.appendChild(quality);
    container.appendChild(row);
  });
}

export function renderHistoryList(container, historyItems, actions = {}) {
  clearNode(container);

  if (!historyItems.length) {
    renderEmptyState(container, '📭', 'Chưa có lịch sử tải xuống');
    return;
  }

  historyItems.forEach(item => {
    const historyItem = createNode('div', {
      className: 'history-item',
      attrs: {
        role: 'button',
        tabindex: '0',
        title: item.url || (Array.isArray(item.urls) ? item.urls[0] : '') || '',
      },
      children: [
        createNode('span', {
          className: 'hi-badge',
          text: item.type || 'video',
        }),
        createNode('div', {
          className: 'hi-main',
          children: [
            createNode('div', {
              className: 'hi-title',
              text: item.title || item.url || 'Không rõ tiêu đề',
            }),
            createNode('div', {
              className: 'hi-sub',
              text: item.url || (Array.isArray(item.urls) && item.urls.length
                ? `${item.urls.length} URL đã lưu`
                : (item.folder || '')),
            }),
          ],
        }),
        createNode('span', {
          className: 'hi-date',
          text: item.date || '',
        }),
      ],
    });

    historyItem.addEventListener('click', () => actions.onSelect?.(item));
    historyItem.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        actions.onSelect?.(item);
      }
    });
    container.appendChild(historyItem);
  });
}

export function renderDownloadCenterJobs(container, groups = {}, actions = {}) {
  clearNode(container);

  const sections = [
    { key: 'active', label: 'Đang tải', items: groups.active || [] },
    { key: 'queued', label: 'Chờ xử lý', items: groups.queued || [] },
    { key: 'paused', label: 'Tạm dừng', items: groups.paused || [] },
    { key: 'failed', label: 'Lỗi', items: groups.failed || [] },
    { key: 'completed', label: 'Hoàn tất', items: groups.completed || [] },
  ].filter(section => section.items.length);

  if (!sections.length) {
    renderEmptyState(container, '🧭', 'Chưa có tác vụ nào trong Trung tâm tải xuống');
    return;
  }

  sections.forEach(section => {
    const block = createNode('div', { className: 'dc-block' });
    block.appendChild(createNode('div', {
      className: 'dc-block-title',
      text: `${section.label} (${section.items.length})`,
    }));

    section.items.forEach(item => {
      const status = String(item.status || section.key);
      const statusLabels = {
        downloading: 'Đang tải',
        retrying: 'Đang thử lại',
        queued: 'Chờ xử lý',
        paused: 'Tạm dừng',
        failed: 'Lỗi',
        completed: 'Hoàn tất',
      };
      const metaParts = [
        item.platform || '',
        statusLabels[status] || status,
        item.progress !== undefined ? `${Math.round(item.progress || 0)}%` : '',
        item.downloadSpeedText || formatSpeed(item.downloadSpeed),
        item.etaText ? `còn ${item.etaText}` : '',
      ].filter(Boolean);

      const actionNodes = [];
      if (status === 'failed') {
        actionNodes.push(actionButton('Thử lại', () => actions.onRetry?.(item)));
        actionNodes.push(actionButton('Chi tiết', () => actions.onDetails?.(item)));
      }
      if (status === 'paused') {
        actionNodes.push(actionButton('Tiếp tục', () => actions.onResume?.(item)));
      }
      if (['downloading', 'retrying'].includes(status)) {
        actionNodes.push(actionButton('Tạm dừng', () => actions.onPause?.(item)));
      }
      if (status === 'queued') {
        actionNodes.push(actionButton('Ưu tiên', () => actions.onPrioritize?.(item)));
      }
      if (['queued', 'downloading', 'retrying', 'paused'].includes(status)) {
        actionNodes.push(actionButton('Hủy', () => actions.onCancel?.(item), 'danger'));
      }
      if (item.outputFile) {
        actionNodes.push(actionButton('Hiện file', () => actions.onRevealFile?.(item)));
        actionNodes.push(actionButton('Mở file', () => actions.onOpenFile?.(item)));
      }
      if (item.outputPath) {
        actionNodes.push(actionButton('Mở thư mục', () => actions.onOpenFolder?.(item)));
      }

      const row = createNode('div', {
          className: `dc-row ${status}`.trim(),
          dataset: { jobId: String(item.id || '') },
          children: [
            createNode('div', {
              className: 'dc-row-main',
              children: [
                createNode('div', {
                  className: 'dc-row-title',
                  text: item.title || item.url || item.id || 'Tác vụ tải xuống',
                }),
                createNode('div', {
                  className: 'dc-row-meta',
                  text: metaParts.join(' · '),
                }),
                ['downloading', 'retrying'].includes(status)
                  ? createProgressBar(item.progress || 0)
                  : null,
              ],
            }),
            createNode('div', {
              className: 'dc-row-actions',
              children: actionNodes,
            }),
          ],
        });
      if (status === 'queued') {
        row.draggable = true;
        row.title = 'Kéo để thay đổi thứ tự tải';
        row.addEventListener('dragstart', event => {
          event.dataTransfer?.setData('text/plain', String(item.id || ''));
          row.classList.add('dragging');
        });
        row.addEventListener('dragend', () => row.classList.remove('dragging'));
        row.addEventListener('dragover', event => event.preventDefault());
        row.addEventListener('drop', event => {
          event.preventDefault();
          const sourceId = event.dataTransfer?.getData('text/plain');
          if (sourceId && sourceId !== String(item.id)) actions.onReorder?.(sourceId, item.id);
        });
      }
      block.appendChild(row);
    });

    container.appendChild(block);
  });
}

function createProgressBar(percent) {
  const safe = Math.max(0, Math.min(100, Number(percent || 0)));
  const fill = createNode('div', { className: 'dc-row-progress-fill' });
  fill.style.width = `${safe}%`;
  return createNode('div', {
    className: 'dc-row-progress',
    children: [fill],
  });
}

function formatSpeed(bytesPerSecond) {
  const value = Number(bytesPerSecond || 0);
  if (!value) return '';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index ? 1 : 0)} ${units[index]}`;
}

function actionButton(label, handler, kind = 'ghost') {
  const button = createNode('button', {
    className: `btn ${kind === 'danger' ? 'btn-danger' : 'btn-ghost'} btn-xs`,
    text: label,
    attrs: { type: 'button' },
  });
  button.addEventListener('click', handler);
  return button;
}
