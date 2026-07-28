export const DEFAULTS = {
  theme: 'dark',
  batchSourceMode: 'channel',
  maxVideos: 10,
  parallelDownloads: 3,
  batchFormat: 'mp4',
  batchQuality: '1080p',
  batchSubs: 'no',
  selectedProfileId: 'balanced-1080',
};

export const MAX_BATCH_VIDEOS = 1000;
export const MIN_YOUTUBE_BATCH_DELAY_MS = 3000;
export const MAX_YOUTUBE_BATCH_DELAY_MS = 10000;

export const TEXT = {
  theme: {
    light: 'SANG',
    dark: 'TOI',
  },
  placeholders: {
    singleUrl: 'D\\u00e1n URL: YouTube / TikTok / Instagram / Facebook / Vimeo / magnet / .torrent...',
    batchUrl: 'D\\u00e1n URL k\\u00eanh ho\\u1eb7c danh s\\u00e1ch ph\\u00e1t YouTube...',
  },
  single: {
    getInfoIdle: 'L\\u1ea4Y TH\\u00d4NG TIN',
    getInfoLoading: '<span class="spin"></span> \\u0110ang l\\u1ea5y...',
    loadingInfo: '\\u0110ang l\\u1ea5y th\\u00f4ng tin video...',
    infoSuccess: title => `L\\u1ea5y info th\\u00e0nh c\\u00f4ng: ${title}`,
    selectFolder: '\\u0056ui l\\u00f2ng ch\\u1ecdn th\\u01b0 m\\u1ee5c l\\u01b0u',
    startVideo: '\\u0042\\u1eaft \\u0111\\u1ea7u t\\u1ea3i video...',
    videoProgress: (format, quality) => `\\u0110ang t\\u1ea3i ${format.toUpperCase()} ${quality}...`,
    videoDone: filePath => `T\\u1ea3i xong! File: ${filePath}`,
    subtitleProgress: '\\u0110ang t\\u1ea3i ph\\u1ee5 \\u0111\\u1ec1...',
    subtitleDone: count => `T\\u1ea3i xong ${count} file subtitle`,
    thumbnailProgress: '\\u0110ang t\\u1ea3i thumbnail...',
    thumbnailDone: filePath => `Thumbnail: ${filePath}`,
    author: author => `K\\u00eanh: ${author}`,
    views: views => `L\\u01b0\\u1ee3t xem: ${views}`,
    maxQuality: height => `T\\u1ed1i \\u0111a ${height}p`,
  },
  social: {
    cookiesSaved: '\\u0110\\u00e3 l\\u01b0u cookies.txt cho social download',
    cookiesCleared: '\\u0110\\u00e3 x\\u00f3a \\u0111\\u01b0\\u1eddng d\\u1eabn cookies.txt',
  },
  batch: {
    scanIdle: '<span>QU\\u00c9T</span>',
    scanLoading: '<span class="spin"></span> \\u0110ang qu\\u00e9t...',
    scanPrompt: '\\u0056ui l\\u00f2ng d\\u00e1n URL k\\u00eanh ho\\u1eb7c playlist v\\u00e0o \\u00f4 tr\\u00ean',
    scanFound: count => `T\\u00ecm th\\u1ea5y ${count} video`,
    scanRecovered: count => `Kh\\u00f4i ph\\u1ee5c \\u0111\\u01b0\\u1ee3c ${count} video t\\u1eeb k\\u1ebft qu\\u1ea3 qu\\u00e9t m\\u1ed9t ph\\u1ea7n`,
    selectFolder: '\\u0056ui l\\u00f2ng ch\\u1ecdn th\\u01b0 m\\u1ee5c l\\u01b0u',
    selectVideo: '\\u0043h\\u01b0a ch\\u1ecdn video n\\u00e0o',
    waitingNext: seconds => `\\u0110ang ch\\u1edd ${seconds}s tr\\u01b0\\u1edbc video ti\\u1ebfp theo`,
    stopped: done => `\\u0110\\u00e3 d\\u1eebng - t\\u1ea3i \\u0111\\u01b0\\u1ee3c ${done} video`,
    finishedWithErrors: (done, failed) => `Xong: ${done} th\\u00e0nh c\\u00f4ng, ${failed} th\\u1ea5t b\\u1ea1i`,
    finished: (done, folder) => `Ho\\u00e0n th\\u00e0nh! \\u0110\\u00e3 t\\u1ea3i ${done} video v\\u00e0o ${folder}`,
    cancelling: '\\u0110ang d\\u1eebng...',
    stoppedLabel: '\\u0110\\u00e3 d\\u1eebng',
    doneLabel: 'Ho\\u00e0n th\\u00e0nh',
    retryMissing: '\\u004b\\u0068\\u00f4ng c\\u00f3 video l\\u1ed7i \\u0111\\u1ec3 t\\u1ea3i l\\u1ea1i',
    linksMissing: 'Kh\\u00f4ng t\\u00ecm th\\u1ea5y URL h\\u1ee3p l\\u1ec7',
    linksLoaded: count => `\\u0110\\u00e3 t\\u1ea3i ${count} URL - t\\u1ea5t c\\u1ea3 \\u0111\\u00e3 \\u0111\\u01b0\\u1ee3c ch\\u1ecdn`,
    linksResolving: (done, total) => `\\u0110ang l\\u1ea5y th\\u00f4ng tin video ${done}/${total}...`,
    linksResolved: (resolved, total) => `\\u0110\\u00e3 l\\u1ea5y th\\u00f4ng tin ${resolved}/${total} URL`,
    fileLoaded: (count, name) => `\\u0110\\u00e3 import ${count} URL t\\u1eeb "${name}"`,
    fileNoValidUrls: 'File kh\\u00f4ng c\\u00f3 URL h\\u1ee3p l\\u1ec7',
    result: {
      successTitle: 'T\\u1ea3i xong',
      successSubtitle: (ok, total) => `${ok}/${total} video th\\u00e0nh c\\u00f4ng`,
      failTitle: 'T\\u1ea3i th\\u1ea5t b\\u1ea1i',
      failSubtitle: 'T\\u1ea5t c\\u1ea3 video \\u0111\\u1ec1u l\\u1ed7i',
      partialTitle: 'T\\u1ea3i xong (c\\u00f3 l\\u1ed7i)',
      partialSubtitle: (ok, fail) => `${ok} th\\u00e0nh c\\u00f4ng, ${fail} th\\u1ea5t b\\u1ea1i`,
    },
  },
  history: {
    clearConfirm: 'X\\u00f3a to\\u00e0n b\\u1ed9 l\\u1ecbch s\\u1eed t\\u1ea3i xu\\u1ed1ng?',
    restoredBatch: '\\u0110\\u00e3 n\\u1ea1p l\\u1ea1i l\\u1ecbch s\\u1eed t\\u1ea3i h\\u00e0ng lo\\u1ea1t',
    restoredSingle: '\\u0110\\u00e3 n\\u1ea1p l\\u1ea1i link t\\u1eeb l\\u1ecbch s\\u1eed',
  },
  update: {
    localMissing: '\\u0043\\u1ea7n thi\\u1ebft l\\u1eadp',
    title: 'C\\u1eadp nh\\u1eadt h\\u1ec7 th\\u1ed1ng',
    close: '\\u0110\\u00f3ng',
    downloading: '\\u0110ang t\\u1ea3i...',
    retry: 'Th\\u1eed l\\u1ea1i',
    hasUpdate: 'C\\u00f3 c\\u1eadp nh\\u1eadt h\\u1ec7 th\\u1ed1ng',
    doUpdate: 'C\\u1eadp nh\\u1eadt ngay',
    install: '\\u0043\\u00e0i \\u0111\\u1eb7t ngay',
    missingYtdlp: '\\u0043\\u1ea7n b\\u1ed5 sung th\\u00e0nh ph\\u1ea7n h\\u1ec7 th\\u1ed1ng',
    upToDate: '\\u0048\\u1ec7 th\\u1ed1ng \\u0111\\u00e3 \\u0111\\u01b0\\u1ee3c c\\u1eadp nh\\u1eadt',
    unavailable: '\\u004b\\u0068\\u00f4ng th\\u1ec3 ki\\u1ec3m tra c\\u1eadp nh\\u1eadt l\\u00fac n\\u00e0y',
    failed: message => `L\\u1ed7i: ${message}`,
    success: () => 'C\\u1eadp nh\\u1eadt h\\u1ec7 th\\u1ed1ng th\\u00e0nh c\\u00f4ng.',
  },
  session: {
    restored: 'Da khoi phuc phien tai dang do',
    discarded: 'Da bo phien tai cu chua hoan thanh',
    confirm: session => {
      const updatedAt = session.updatedAt ? `\\nLan cuoi: ${session.updatedAt}` : '';
      return (
        `Phat hien ${session.total} tac vu dang do.` +
        `\\n- Cho xu ly: ${session.queued}` +
        `\\n- Tam dung: ${session.paused}` +
        `${updatedAt}` +
        '\\n\\nBan co muon tiep tuc phien tai truoc khong?'
      );
    },
  },
  profiles: {
    none: 'Chua c\\u00f3 m\\u1eabu c\\u1ea5u h\\u00ecnh',
    descriptionFallback: 'Ch\\u1ecdn m\\u1eabu c\\u1ea5u h\\u00ecnh \\u0111\\u1ec3 \\u00e1p nhanh cho Video \\u0111\\u01a1n ho\\u1eb7c H\\u00e0ng lo\\u1ea1t.',
    savePrompt: dateLabel => `M\\u1eabu ${dateLabel}`,
    saveNamePrompt: 'T\\u00ean m\\u1eabu c\\u1ea5u h\\u00ecnh mu\\u1ed1n l\\u01b0u:',
    saveDescriptionPrompt: 'M\\u00f4 t\\u1ea3 ng\\u1eafn cho m\\u1eabu n\\u00e0y:',
    saveDescriptionFallback: 'M\\u1eabu c\\u1ea5u h\\u00ecnh t\\u00f9y ch\\u1ec9nh do b\\u1ea1n l\\u01b0u',
    saveFailed: 'Kh\\u00f4ng l\\u01b0u \\u0111\\u01b0\\u1ee3c m\\u1eabu c\\u1ea5u h\\u00ecnh n\\u00e0y',
    saveSuccess: name => `\\u0110\\u00e3 l\\u01b0u m\\u1eabu c\\u1ea5u h\\u00ecnh "${name}"`,
    deleteCustomOnly: 'Ch\\u1ec9 x\\u00f3a \\u0111\\u01b0\\u1ee3c m\\u1eabu t\\u00f9y ch\\u1ec9nh',
    deleteConfirm: name => `X\\u00f3a m\\u1eabu c\\u1ea5u h\\u00ecnh "${name}"?`,
    deleteFailed: 'Kh\\u00f4ng x\\u00f3a \\u0111\\u01b0\\u1ee3c m\\u1eabu c\\u1ea5u h\\u00ecnh n\\u00e0y',
    deleteSuccess: name => `\\u0110\\u00e3 x\\u00f3a m\\u1eabu c\\u1ea5u h\\u00ecnh "${name}"`,
    profileMissing: 'Kh\\u00f4ng t\\u00ecm th\\u1ea5y m\\u1eabu c\\u1ea5u h\\u00ecnh \\u0111\\u1ec3 \\u00e1p d\\u1ee5ng',
    applySingle: name => `\\u0110\\u00e3 \\u00e1p m\\u1eabu "${name}" cho Video \\u0111\\u01a1n`,
    applyBatch: name => `\\u0110\\u00e3 \\u00e1p m\\u1eabu "${name}" cho H\\u00e0ng lo\\u1ea1t`,
    persistenceFallback: 'D\\u1eef li\\u1ec7u t\\u00e1c v\\u1ee5 \\u0111ang \\u0111\\u01b0\\u1ee3c l\\u01b0u an to\\u00e0n.',
    persistenceActive: jobCount => `D\\u1eef li\\u1ec7u t\\u00e1c v\\u1ee5 \\u0111ang \\u0111\\u01b0\\u1ee3c b\\u1ea3o v\\u1ec7 · ${jobCount} t\\u00e1c v\\u1ee5.`,
  },
  downloadCenter: {
    retryFailed: 'Kh\\u00f4ng th\\u1ec3 th\\u1eed l\\u1ea1i t\\u00e1c v\\u1ee5 n\\u00e0y',
    retrySuccess: name => `\\u0110\\u00e3 \\u0111\\u01b0a "${name}" tr\\u1edf l\\u1ea1i h\\u00e0ng \\u0111\\u1ee3i`,
    cancelFailed: 'Kh\\u00f4ng th\\u1ec3 h\\u1ee7y t\\u00e1c v\\u1ee5 n\\u00e0y',
    cancelSuccess: name => `\\u0110\\u00e3 h\\u1ee7y "${name}"`,
    clearCompleted: '\\u0110\\u00e3 d\\u1ecdn danh s\\u00e1ch t\\u00e1c v\\u1ee5 ho\\u00e0n t\\u1ea5t',
    clearFailed: '\\u0110\\u00e3 d\\u1ecdn danh s\\u00e1ch t\\u00e1c v\\u1ee5 l\\u1ed7i',
    noFolder: 'Kh\\u00f4ng c\\u00f3 th\\u01b0 m\\u1ee5c \\u0111\\u1ec3 m\\u1edf',
    noOutput: 'Ch\\u01b0a c\\u00f3 file \\u0111\\u1ea7u ra cho t\\u00e1c v\\u1ee5 n\\u00e0y',
  },
  settings: {
    parallelSaved: count => `\\u0110\\u00e3 c\\u1eadp nh\\u1eadt ${count} lu\\u1ed3ng t\\u1ea3i song song`,
  },
  license: {
    emptyKey: 'Vui l\\u00f2ng d\\u00e1n kh\\u00f3a b\\u1ea3n quy\\u1ec1n v\\u00e0o \\u00f4 k\\u00edch ho\\u1ea1t',
    emptyCode: 'Vui l\\u00f2ng nh\\u1eadp m\\u00e3 k\\u00edch ho\\u1ea1t',
    activating: '\\u0110ang k\\u00edch ho\\u1ea1t online, vui l\\u00f2ng \\u0111\\u1ee3i\\u2026',
    activated: '\\u0110\\u00e3 k\\u00edch ho\\u1ea1t \\u1ee9ng d\\u1ee5ng th\\u00e0nh c\\u00f4ng',
    cleared: '\\u0110\\u00e3 x\\u00f3a th\\u00f4ng tin k\\u00edch ho\\u1ea1t tr\\u00ean m\\u00e1y n\\u00e0y',
    checked: '\\u0110\\u00e3 ki\\u1ec3m tra l\\u1ea1i tr\\u1ea1ng th\\u00e1i b\\u1ea3n quy\\u1ec1n',
    inactive: 'Ch\\u01b0a k\\u00edch ho\\u1ea1t \\u1ee9ng d\\u1ee5ng.',
    machineIdCopied: '\\u0110\\u00e3 sao ch\\u00e9p m\\u00e3 m\\u00e1y',
    reminder: '\\u1ee8ng d\\u1ee5ng ch\\u01b0a k\\u00edch ho\\u1ea1t. Vui l\\u00f2ng m\\u1edf m\\u1ee5c B\\u1ea3n quy\\u1ec1n v\\u00e0 nh\\u1eadp kh\\u00f3a b\\u1ea3n quy\\u1ec1n.',
    unconfigured: 'Ch\\u1ee9c n\\u0103ng b\\u1ea3n quy\\u1ec1n ch\\u01b0a \\u0111\\u01b0\\u1ee3c c\\u1ea5u h\\u00ecnh public key.',
    invalid: message => `License kh\\u00f4ng h\\u1ee3p l\\u1ec7: ${message}`,
    expired: expiresAt => `License \\u0111\\u00e3 h\\u1ebft h\\u1ea1n${expiresAt ? ` (${expiresAt})` : ''}`,
    active: (customerName, expiresAt) => (
      customerName
        ? `\\u0110\\u00e3 k\\u00edch ho\\u1ea1t cho ${customerName}${expiresAt ? ` - h\\u1ebft h\\u1ea1n ${expiresAt}` : ' - kh\\u00f4ng gi\\u1edbi h\\u1ea1n'}`
        : `\\u0110\\u00e3 k\\u00edch ho\\u1ea1t${expiresAt ? ` - h\\u1ebft h\\u1ea1n ${expiresAt}` : ' - kh\\u00f4ng gi\\u1edbi h\\u1ea1n'}`
    ),
    required: action => `C\\u1ea7n k\\u00edch ho\\u1ea1t b\\u1ea3n quy\\u1ec1n tr\\u01b0\\u1edbc khi ${action}.`,
    customerPending: 'Ch\\u01b0a c\\u00f3 th\\u00f4ng tin kh\\u00e1ch h\\u00e0ng',
    customerPendingHint: 'G\\u1eedi m\\u00e3 m\\u00e1y hi\\u1ec7n t\\u1ea1i \\u0111\\u1ec3 \\u0111\\u01b0\\u1ee3c c\\u1ea5p license \\u0111\\u00fang cho thi\\u1ebft b\\u1ecb n\\u00e0y.',
    expiryLifetime: 'Kh\\u00f4ng gi\\u1edbi h\\u1ea1n',
    expiryPending: 'Ch\\u01b0a k\\u00edch ho\\u1ea1t',
    stateActive: '\\u0110\\u00e3 k\\u00edch ho\\u1ea1t',
    stateInactive: 'Ch\\u01b0a k\\u00edch ho\\u1ea1t',
    stateExpired: '\\u0110\\u00e3 h\\u1ebft h\\u1ea1n',
    stateInvalid: 'Kh\\u00f4ng h\\u1ee3p l\\u1ec7',
    stateUnconfigured: 'Ch\\u01b0a c\\u1ea5u h\\u00ecnh',
    summaryInactive: 'Key n\\u00ean \\u0111\\u01b0\\u1ee3c t\\u1ea1o theo m\\u00e3 m\\u00e1y hi\\u1ec7n t\\u1ea1i v\\u00e0 c\\u00f3 th\\u1eddi h\\u1ea1n ho\\u1eb7c kh\\u00f4ng gi\\u1edbi h\\u1ea1n.',
    summaryConfigured: '\\u1ee8ng d\\u1ee5ng \\u0111ang x\\u00e1c th\\u1ef1c key ngo\\u1ea1i tuy\\u1ebfn b\\u1eb1ng public key. B\\u1ea1n c\\u00f3 th\\u1ec3 d\\u00f9ng chung v\\u1edbi License Admin n\\u1ebfu hai b\\u00ean c\\u00f9ng \\u0111\\u1ecbnh d\\u1ea1ng k\\u00fd.',
    summaryUnconfigured: 'H\\u00e3y thay file config/license-public.pem b\\u1eb1ng public key c\\u1ee7a h\\u1ec7 th\\u1ed1ng License Admin \\u0111\\u1ec3 b\\u1eadt k\\u00edch ho\\u1ea1t.',
  },
};

decodeTextTree(TEXT);

function decodeTextTree(value) {
  if (!value || typeof value !== 'object') return value;

  Object.keys(value).forEach(key => {
    const current = value[key];

    if (typeof current === 'string') {
      value[key] = decodeEscapedText(current);
      return;
    }

    if (typeof current === 'function') {
      value[key] = (...args) => {
        const result = current(...args);
        return typeof result === 'string' ? decodeEscapedText(result) : result;
      };
      return;
    }

    if (current && typeof current === 'object') {
      decodeTextTree(current);
    }
  });

  return value;
}

function decodeEscapedText(text) {
  return String(text || '')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}
