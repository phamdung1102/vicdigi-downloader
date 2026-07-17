'use strict';

const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const subtitleConverter = require('../../../subtitle-converter');
const { extractVideoId } = require('../../utils');
const { spawnYtDlp, withCommonArgs } = require('../../ytdlp-client');

const FORMAT_SELECTORS = {
  '4k': '(bv*[height<=2160][vcodec^=avc1][ext=mp4]+ba[ext=m4a])/(bv*[height<=2160][ext=mp4]+ba[ext=m4a])/(bv*[height<=2160]+ba)/best[height<=2160]',
  '1440p': '(bv*[height<=1440][vcodec^=avc1][ext=mp4]+ba[ext=m4a])/(bv*[height<=1440][ext=mp4]+ba[ext=m4a])/(bv*[height<=1440]+ba)/best[height<=1440]',
  '1080p': '(bv*[height<=1080][vcodec^=avc1][ext=mp4]+ba[ext=m4a])/(bv*[height<=1080][ext=mp4]+ba[ext=m4a])/(bv*[height<=1080]+ba)/best[height<=1080]',
  '720p': '(bv*[height<=720][vcodec^=avc1][ext=mp4]+ba[ext=m4a])/(bv*[height<=720][ext=mp4]+ba[ext=m4a])/(bv*[height<=720]+ba)/best[height<=720]',
  '480p': '(bv*[height<=480][ext=mp4]+ba[ext=m4a])/(bv*[height<=480]+ba)/best[height<=480]',
  '360p': '(bv*[height<=360][ext=mp4]+ba[ext=m4a])/(bv*[height<=360]+ba)/best[height<=360]',
  default: 'bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/best[ext=mp4]/best',
};

const LANG_MAP = {
  auto: 'en,vi,en-US,vi-VN,en-GB',
  en: 'en,en-US,en-GB,en-AU,en-CA',
  vi: 'vi,vi-VN,vi-VI',
};

const FORMAT_EXT_MAP = {
  srt: ['.srt'],
  txt: ['.txt'],
  both: ['.srt', '.txt'],
};

async function downloadThumbnail(opts) {
  const { url, outputPath, videoInfo = null } = opts;
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('\u004b\u0068\u00f4ng th\u1ec3 tr\u00edch xu\u1ea5t Video ID');

  await fs.ensureDir(outputPath);
  const timestamp = Date.now();
  const filePath = path.join(outputPath, `thumbnail_${videoId}_${timestamp}.jpg`);
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  if (videoInfo?.thumbnail) {
    const ok = await downloadImage(videoInfo.thumbnail, filePath, userAgent);
    if (ok) return { success: true, filePath };
  }

  const urls = [
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/default.jpg`,
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  ];

  for (const imageUrl of urls) {
    const ok = await downloadImage(imageUrl, filePath, userAgent);
    if (ok) return { success: true, filePath };
  }

  const infoPath = path.join(outputPath, `thumbnail_info_${videoId}_${timestamp}.txt`);
  await fs.writeFile(infoPath,
    `Thumbnail \u006b\u0068\u00f4ng t\u1ea3i \u0111\u01b0\u1ee3c\nVideo ID: ${videoId}\nURL: ${url}\nTh\u1eddi gian: ${new Date().toLocaleString('vi-VN')}`,
    'utf8');
  return { success: true, filePath: infoPath, note: '\u004b\u0068\u00f4ng t\u1ea3i \u0111\u01b0\u1ee3c \u1ea3nh thumbnail.' };
}

async function realDownload(url, outputPath, format, quality, onProgress, appDir) {
  return new Promise((resolve, reject) => {
    const formatSelector = format === 'mp3'
      ? 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio'
      : (FORMAT_SELECTORS[quality] || FORMAT_SELECTORS.default);

    const args = withCommonArgs([
      '--format', formatSelector,
      '--output', path.join(outputPath, '%(title)s.%(ext)s'),
      '--no-playlist', '--newline',
      '--merge-output-format', 'mp4',
      '--concurrent-fragments', '4',
      '--retries', '3', '--fragment-retries', '3',
      '--no-write-subs', '--no-write-auto-subs',
    ]);

    if (format === 'mp3') {
      args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '192K');
    } else {
      args.push('--embed-metadata');
    }
    args.push(url);

    const process = spawnYtDlp(args, { appDir });
    let outputFile = '';
    let lastPercent = 0;

    process.stdout.on('data', data => {
      const text = data.toString();
      const match = text.match(/(\d+\.?\d*)%/);
      if (match) {
        const percent = Math.min(100, parseFloat(match[1]));
        if (percent > lastPercent) {
          lastPercent = percent;
          onProgress(Math.round(percent));
        }
      }
      const destination = text.match(/\[download\] Destination: (.+)/);
      if (destination) outputFile = destination[1].trim();
    });

    process.stderr.on('data', data => console.log('[yt-dlp stderr]', data.toString()));
    process.on('close', code => {
      if (code === 0) {
        onProgress(100);
        resolve({ success: true, filePath: outputFile || outputPath });
      } else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });
    process.on('error', reject);
  });
}

async function mockDownload(url, outputPath, format, quality, onProgress) {
  const id = extractVideoId(url) || 'demo';
  const extension = format === 'mp3' ? 'mp3' : 'mp4';
  const filePath = path.join(outputPath, `demo_${id}_${quality}_${Date.now()}.${extension}`);
  for (let percent = 0; percent <= 100; percent += Math.random() * 6 + 2) {
    await new Promise(resolve => setTimeout(resolve, 80));
    onProgress(Math.min(100, Math.round(percent)));
  }
  await fs.writeFile(filePath, `DEMO ${format.toUpperCase()} | ${url} | ${quality}`, 'utf8');
  return { success: true, filePath };
}

async function realSubtitle(url, outputPath, language, format, appDir) {
  const languages = LANG_MAP[language] || language;
  const tempDir = path.join(outputPath, `_sub_tmp_${Date.now()}`);
  const allowedExtensions = FORMAT_EXT_MAP[format] || ['.srt'];

  await fs.ensureDir(tempDir);
  await fs.ensureDir(outputPath);

  const args = withCommonArgs([
    '--write-subs', '--write-auto-subs',
    '--sub-langs', languages,
    '--sub-format', 'vtt/best',
    '--skip-download',
    '--output', path.join(tempDir, 'subtitle'),
    '--no-warnings',
    url,
  ]);

  await new Promise(resolve => {
    const process = spawnYtDlp(args, { appDir, cwd: tempDir });
    process.on('close', () => resolve());
    process.on('error', () => resolve());
    setTimeout(() => { process.kill(); resolve(); }, 45000);
  });

  await new Promise(resolve => setTimeout(resolve, 800));

  const allFiles = await fs.readdir(tempDir);
  let vttFiles = allFiles.filter(file => file.endsWith('.vtt'));

  if (!vttFiles.length) {
    await fs.remove(tempDir).catch(() => {});
    throw new Error('\u004b\u0068\u00f4ng t\u00ecm th\u1ea5y subtitle cho video n\u00e0y.');
  }

  vttFiles.sort((a, b) => {
    const aAuto = a.includes('auto');
    const bAuto = b.includes('auto');
    if (aAuto === bAuto) return 0;
    return aAuto ? 1 : -1;
  });

  const results = [];

  for (const vttFile of vttFiles.slice(0, 2)) {
    const vttPath = path.join(tempDir, vttFile);
    const stat = await fs.stat(vttPath).catch(() => null);
    if (!stat || stat.size === 0) continue;

    const langMatch = vttFile.match(/\.([a-zA-Z-]+)\.vtt$/i);
    let detectedLang = langMatch ? langMatch[1].toLowerCase() : language;
    if (detectedLang.includes('auto')) detectedLang = 'auto';
    else if (detectedLang.startsWith('en')) detectedLang = 'en';
    else if (detectedLang.startsWith('vi')) detectedLang = 'vi';

    let converted = [];
    try {
      converted = subtitleConverter.convertSubtitleFile(vttPath, format);
    } catch (error) {
      console.log('[download-service] Converter failed for', vttFile, ':', error.message);
      continue;
    }

    for (const item of converted) {
      const extension = path.extname(item.path).toLowerCase();
      if (!allowedExtensions.includes(extension)) {
        await fs.remove(item.path).catch(() => {});
        console.log(`[download-service] Dropped unwanted ${extension} (format=${format}): ${path.basename(item.path)}`);
        continue;
      }

      const destName = `subtitle.${detectedLang}${extension}`;
      const destPath = path.join(outputPath, destName);

      try {
        await fs.move(item.path, destPath, { overwrite: true });
        const destStat = await fs.stat(destPath).catch(() => null);
        if (!destStat || destStat.size === 0) {
          await fs.remove(destPath).catch(() => {});
          continue;
        }
        results.push({ format: item.format.toLowerCase(), filePath: destPath });
      } catch (error) {
        console.log('[download-service] Move failed:', error.message);
      }
    }
  }

  await fs.remove(tempDir).catch(() => {});

  if (!results.length) {
    throw new Error('\u004b\u0068\u00f4ng th\u1ec3 convert subtitle. H\u00e3y th\u1eed ng\u00f4n ng\u1eef ho\u1eb7c video kh\u00e1c.');
  }

  return {
    success: true,
    files: results,
    message: `\u0054\u1ea3i subtitle th\u00e0nh c\u00f4ng (${results.length} file)`,
  };
}

async function mockSubtitle(url, outputPath, language, format) {
  const id = extractVideoId(url) || 'demo';
  const files = [];
  const allowedExtensions = FORMAT_EXT_MAP[format] || ['.srt'];

  if (allowedExtensions.includes('.srt')) {
    const filePath = path.join(outputPath, `demo_${id}.${language}.srt`);
    await fs.writeFile(filePath,
      `1\n00:00:01,000 --> 00:00:05,000\nDemo SRT subtitle\n\n2\n00:00:05,000 --> 00:00:10,000\nVideo: ${url}`,
      'utf8');
    files.push({ format: 'srt', filePath });
  }
  if (allowedExtensions.includes('.txt')) {
    const filePath = path.join(outputPath, `demo_${id}.${language}.txt`);
    await fs.writeFile(filePath, `Demo TXT subtitle\nVideo: ${url}`, 'utf8');
    files.push({ format: 'txt', filePath });
  }
  return { success: true, files, message: 'Demo subtitle created' };
}

async function downloadImage(url, destination, userAgent) {
  try {
    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout: 15000,
      headers: { 'User-Agent': userAgent, Accept: 'image/*', Referer: 'https://www.youtube.com/' },
      validateStatus: status => status === 200,
    });
    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(destination);
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    const stat = await fs.stat(destination);
    if (stat.size > 1000) return true;
    await fs.remove(destination);
    return false;
  } catch (_) {
    return false;
  }
}

async function safeDownloadVideo(opts, onProgress, caps, appDir) {
  const { url, outputPath, format = 'mp4', quality = '720p' } = opts;
  await fs.ensureDir(outputPath);
  if (caps?.ytdlp) {
    return realDownload(url, outputPath, format, quality, onProgress, appDir);
  }
  return mockDownload(url, outputPath, format, quality, onProgress);
}

async function safeDownloadSubtitle(opts, caps, appDir) {
  const { url, outputPath, language = 'auto', format = 'srt' } = opts;
  await fs.ensureDir(outputPath);
  if (caps?.ytdlp) {
    return realSubtitle(url, outputPath, language, format, appDir);
  }
  return mockSubtitle(url, outputPath, language, format);
}

module.exports = {
  downloadSubtitle: safeDownloadSubtitle,
  downloadThumbnail,
  downloadVideo: safeDownloadVideo,
};
