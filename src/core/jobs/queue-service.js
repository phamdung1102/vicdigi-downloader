'use strict';

const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const { EventBus } = require('../events/event-bus');
const { JobStore } = require('./job-store');
const { markForRetry, shouldRetry } = require('./retry-policy');
const { SettingsStore } = require('../persistence/settings-store');
const { SqlitePersistence } = require('../persistence/sqlite');
const { detectPlatform } = require('../platforms/detect-platform');
const { recordYtDlpError } = require('../../diagnostics');
const { resolveYtDlpPath } = require('../../ytdlp-client');
const socialDownloads = require('../platforms/social');

class QueueService extends EventBus {
  constructor(options = {}) {
    super();
    this.queue = [];
    this.activeDownloads = new Map();
    this.pausedDownloads = new Map();
    this.completedDownloads = new Map();
    this.failedDownloads = new Map();
    this.maxParallelDownloads = 3;
    this.retryAttempts = 3;
    this.downloadStates = new Map();
    this.activeProcesses = new Map();
    this.MAX_HISTORY = 100;
    this._persistTimer = null;
    this.store = options.store || null;
    this.rootDir = options.rootDir || path.resolve(__dirname, '..', '..', '..');
    this.dbPath = options.dbPath || path.join(this.rootDir, '.vicdigi-v7.db');
    this.settingsStore = new SettingsStore(this.store);
    this.jobStore = new JobStore(this.settingsStore);
    this.sqlite = new SqlitePersistence(this.dbPath);
    this.lastSnapshotUpdatedAt = null;
    this.restorePersistedJobs();
  }

  restorePersistedJobs() {
    const snapshot = this.sqlite.loadSnapshot() || this.jobStore.load();
    this.lastSnapshotUpdatedAt = snapshot?.updatedAt || null;
    const revive = (items, status) => items.map(item => ({
      ...item,
      status: item.status === 'downloading' ? 'queued' : (item.status || status),
      progress: Number(item.progress || 0),
    }));

    this.queue = revive(snapshot.queue, 'queued');
    revive(snapshot.active, 'queued').forEach(item => this.queue.push({ ...item, status: 'queued' }));
    revive(snapshot.paused, 'paused').forEach(item => this.pausedDownloads.set(item.id, item));
    revive(snapshot.completed, 'completed').forEach(item => this.completedDownloads.set(item.id, item));
    revive(snapshot.failed, 'failed').forEach(item => this.failedDownloads.set(item.id, item));
    this.sortQueue();
  }

  persistSnapshot() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    this.jobStore.save({
      queue: this.queue,
      active: Array.from(this.activeDownloads.values()),
      paused: Array.from(this.pausedDownloads.values()),
      completed: Array.from(this.completedDownloads.values()),
      failed: Array.from(this.failedDownloads.values()),
      updatedAt: new Date().toISOString(),
    });
    this.sqlite.saveSnapshot({
      queue: this.queue,
      active: Array.from(this.activeDownloads.values()),
      paused: Array.from(this.pausedDownloads.values()),
      completed: Array.from(this.completedDownloads.values()),
      failed: Array.from(this.failedDownloads.values()),
      updatedAt: new Date().toISOString(),
    });
  }

  schedulePersistSnapshot(delay = 250) {
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this.persistSnapshot();
    }, delay);
  }

  trackActiveProcess(downloadId, process) {
    this.activeProcesses.set(downloadId, process);
    const cleanup = () => {
      if (this.activeProcesses.get(downloadId) === process) {
        this.activeProcesses.delete(downloadId);
      }
    };
    process.on('close', cleanup);
    process.on('error', cleanup);
  }

  async stopActiveHandle(downloadId, reason = 'cancel') {
    const process = this.activeProcesses.get(downloadId);
    if (process) {
      try { process.kill('SIGTERM'); } catch (_) {}
      this.activeProcesses.delete(downloadId);
    }

  }

  emitProgress(download, output) {
    const progressMatch = output.match(/(\d+\.?\d*)%/);
    if (!progressMatch) return;

    download.progress = parseFloat(progressMatch[1]);
    const speedMatch = output.match(/at\s+([0-9.]+\s*[KMGTP]?i?B\/s)/i);
    const etaMatch = output.match(/ETA\s+([0-9:]+)/i);
    if (speedMatch) download.downloadSpeedText = speedMatch[1].replace(/\s+/g, ' ');
    if (etaMatch) download.etaText = etaMatch[1];
    this.emit('download-progress', {
      id: download.id,
      progress: download.progress,
    });
    this.schedulePersistSnapshot();
  }

  emitStructuredProgress(download, payload = {}) {
    const percent = Number(payload.percent || 0);
    download.progress = Math.max(0, Math.min(100, percent));
    if (payload.downloadedBytes !== undefined) download.downloadedBytes = payload.downloadedBytes;
    if (payload.totalBytes !== undefined) download.totalBytes = payload.totalBytes;
    if (payload.downloadSpeed !== undefined) download.downloadSpeed = payload.downloadSpeed;
    if (payload.peers !== undefined) download.peers = payload.peers;
    if (payload.fileCount !== undefined) download.fileCount = payload.fileCount;

    this.emit('download-progress', {
      id: download.id,
      progress: download.progress,
      downloadedBytes: download.downloadedBytes || 0,
      totalBytes: download.totalBytes || 0,
      downloadSpeed: download.downloadSpeed || 0,
      peers: download.peers || 0,
      fileCount: download.fileCount || 0,
    });
    this.schedulePersistSnapshot();
  }

  addToQueue(downloadInfo) {
    const duplicateUrl = String(downloadInfo.url || '').trim();
    const pending = [
      ...this.queue,
      ...this.activeDownloads.values(),
      ...this.pausedDownloads.values(),
    ].find(item => String(item.url || '').trim() === duplicateUrl);
    if (pending) return pending.id;

    const downloadId = this.generateDownloadId();
    const download = {
      id: downloadId,
      url: downloadInfo.url,
      outputPath: downloadInfo.outputPath,
      format: downloadInfo.format || 'mp4',
      quality: downloadInfo.quality || '720p',
      platform: downloadInfo.platform || detectPlatform(downloadInfo.url),
      title: downloadInfo.title || 'Unknown',
      thumbnail: downloadInfo.thumbnail || null,
      status: 'queued',
      progress: 0,
      retryCount: 0,
      clipStartSeconds: downloadInfo.clipStartSeconds,
      clipEndSeconds: downloadInfo.clipEndSeconds,
      timestamp: Date.now(),
      priority: downloadInfo.priority || 0,
    };

    this.queue.push(download);
    this.sortQueue();
    this.emit('download-added', download);
    this.persistSnapshot();
    this.processQueue();
    return downloadId;
  }

  sortQueue() {
    this.queue.sort((a, b) => b.priority - a.priority);
  }

  reorderDownload(downloadId, beforeDownloadId) {
    const fromIndex = this.queue.findIndex(item => item.id === downloadId);
    const toIndex = this.queue.findIndex(item => item.id === beforeDownloadId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return false;

    const [download] = this.queue.splice(fromIndex, 1);
    const targetIndex = this.queue.findIndex(item => item.id === beforeDownloadId);
    this.queue.splice(targetIndex, 0, download);
    this.queue.forEach((item, index) => {
      item.priority = this.queue.length - index;
    });
    this.emit('download-queue-reordered', { downloadId, beforeDownloadId });
    this.persistSnapshot();
    return true;
  }

  async processQueue() {
    if (this.activeDownloads.size >= this.maxParallelDownloads) return;

    const nextDownload = this.queue.shift();
    if (!nextDownload) return;

    this.activeDownloads.set(nextDownload.id, nextDownload);
    nextDownload.status = 'downloading';
    this.emit('download-started', nextDownload);
    this.persistSnapshot();

    try {
      await this.executeDownload(nextDownload);
      nextDownload.status = 'completed';
      this.activeDownloads.delete(nextDownload.id);
      this.pausedDownloads.delete(nextDownload.id);
      this.activeProcesses.delete(nextDownload.id);
      if (this.completedDownloads.size >= this.MAX_HISTORY) {
        const firstKey = this.completedDownloads.keys().next().value;
        this.completedDownloads.delete(firstKey);
      }
      this.completedDownloads.set(nextDownload.id, nextDownload);
      this.emit('download-completed', nextDownload);
      this.persistSnapshot();
    } catch (error) {
      if (nextDownload.status === 'paused') {
        this.activeDownloads.delete(nextDownload.id);
        this.activeProcesses.delete(nextDownload.id);
        this.downloadStates.delete(nextDownload.id);
        if (!this.pausedDownloads.has(nextDownload.id)) {
          this.pausedDownloads.set(nextDownload.id, nextDownload);
        }
        this.persistSnapshot();
        this.processQueue();
        return;
      }

      if (nextDownload.status === 'cancelled') {
        this.activeDownloads.delete(nextDownload.id);
        this.activeProcesses.delete(nextDownload.id);
        this.downloadStates.delete(nextDownload.id);
        this.persistSnapshot();
        this.processQueue();
        return;
      }

      console.error(`Download failed for ${nextDownload.id}:`, error);
      recordYtDlpError(`queue-service:${nextDownload.platform}`, error);

      if (shouldRetry(nextDownload, this.retryAttempts)) {
        Object.assign(nextDownload, markForRetry(nextDownload));
        this.emit('download-retry', nextDownload);
        this.queue.unshift(nextDownload);
        this.activeDownloads.delete(nextDownload.id);
        this.activeProcesses.delete(nextDownload.id);
        this.persistSnapshot();
      } else {
        nextDownload.status = 'failed';
        nextDownload.error = error.message;
        this.activeDownloads.delete(nextDownload.id);
        this.pausedDownloads.delete(nextDownload.id);
        this.activeProcesses.delete(nextDownload.id);
        this.downloadStates.delete(nextDownload.id);
        if (this.failedDownloads.size >= this.MAX_HISTORY) {
          const firstKey = this.failedDownloads.keys().next().value;
          this.failedDownloads.delete(firstKey);
        }
        this.failedDownloads.set(nextDownload.id, nextDownload);
        this.emit('download-failed', nextDownload);
        this.persistSnapshot();
      }
    }

    this.processQueue();
  }

  async executeDownload(download) {
    switch (download.platform) {
      case 'youtube':
        return this.downloadYouTube(download);
      case 'instagram':
        return this.downloadInstagram(download);
      case 'tiktok':
        return this.downloadTikTok(download);
      case 'facebook':
        return this.downloadFacebook(download);
      case 'twitter':
        return this.downloadTwitter(download);
      case 'vimeo':
        return this.downloadVimeo(download);
      default:
        throw new Error(`Unsupported platform: ${download.platform}`);
    }
  }

  getSocialContext() {
    return {
      rootDir: this.rootDir,
      trackActiveProcess: (downloadId, process) => this.trackActiveProcess(downloadId, process),
      emitProgress: (download, output) => this.emitProgress(download, output),
      getCookieFile: () => this.getCookieFilePath(),
    };
  }

  getCookieFilePath() {
    const configuredPath = this.settingsStore.get('socialCookiesPath');
    if (configuredPath && fs.existsSync(configuredPath)) return configuredPath;
    return null;
  }

  async downloadYouTube(download) {
    if (download.status === 'cancelled') throw new Error('Download was cancelled');

    const outputTemplate = path.join(download.outputPath, '%(title)s.%(ext)s');
    const stateFile = path.join(download.outputPath, `.${download.id}.state`);
    const partialFile = this.downloadStates.get(download.id)?.partialFile;
    const baseArgs = [
      '--format', this.getFormatSelector(download.quality, download.format),
      '--output', outputTemplate,
      '--print', 'after_move:filepath',
      '--no-playlist', '--newline', '--no-check-certificates',
      '--concurrent-fragments', '8', '--buffer-size', '32K', '--http-chunk-size', '10M',
      '--retries', '10', '--fragment-retries', '10',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    ];
    if (partialFile && fs.existsSync(partialFile)) baseArgs.push('--continue');
    if (download.format === 'mp3') baseArgs.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '192K');

    // Public clients are always attempted first. Cookies are an optional last
    // resort only when the user has explicitly selected a cookies.txt file.
    const attempts = [
      { name: 'YouTube public', args: [] },
      { name: 'YouTube web/mobile fallback', args: ['--extractor-args', 'youtube:player_client=web_safari,mweb,android_vr'] },
      { name: 'YouTube embedded fallback', args: ['--extractor-args', 'youtube:player_client=tv_embedded,web'] },
    ];
    const cookieFile = this.getCookieFilePath();
    if (cookieFile) attempts.push({ name: 'YouTube cookies.txt fallback', args: ['--cookies', cookieFile] });

    const cleanupState = keepForResume => {
      if (!keepForResume && fs.existsSync(stateFile)) fs.removeSync(stateFile);
      if (!keepForResume) this.downloadStates.delete(download.id);
    };
    const failures = [];

    for (const attempt of attempts) {
      if (download.status === 'paused') {
        cleanupState(true);
        throw new Error('Download paused');
      }
      if (download.status === 'cancelled') {
        cleanupState(false);
        throw new Error('Download cancelled');
      }

      try {
        const outputFile = await new Promise((resolve, reject) => {
          const proc = spawn(resolveYtDlpPath(this.rootDir), [...attempt.args, ...baseArgs, download.url]);
          let resolvedFile = '';
          let stderr = '';
          this.trackActiveProcess(download.id, proc);

          proc.stdout.on('data', data => {
            const output = data.toString();
            this.emitProgress(download, output);
            const destination = output.match(/\[download\] Destination: (.+)/);
            const merged = output.match(/\[(?:Merger|VideoConvertor|Fixup\w*)\].*?"([^"]+)"/i);
            const printed = output.split(/\r?\n/).map(line => line.trim()).find(line => path.isAbsolute(line));
            resolvedFile = printed || merged?.[1] || destination?.[1]?.trim() || resolvedFile;
            if (destination?.[1]) {
              const state = { partialFile: `${destination[1].trim()}.part`, outputFile: destination[1].trim() };
              this.downloadStates.set(download.id, state);
              fs.writeJsonSync(stateFile, state);
            }
          });
          proc.stderr.on('data', data => { stderr += data.toString(); });
          proc.once('error', reject);
          proc.once('close', code => {
            if (code === 0) resolve(resolvedFile);
            else reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
          });
        });

        cleanupState(false);
        download.outputFile = outputFile;
        this.persistSnapshot();
        return download;
      } catch (error) {
        if (download.status === 'paused') {
          cleanupState(true);
          throw new Error('Download paused');
        }
        if (download.status === 'cancelled') {
          cleanupState(false);
          throw new Error('Download cancelled');
        }
        failures.push(`${attempt.name}: ${error.message || error}`);
      }
    }

    cleanupState(false);
    const details = failures.at(-1) || 'Không lấy được dữ liệu video.';
    if (/sign in to confirm|not a bot/i.test(details)) {
      throw new Error('YouTube tạm yêu cầu xác minh truy cập. App đã thử các client công khai nhưng chưa vượt qua; hãy đợi một lúc hoặc đổi mạng rồi tải lại.');
    }
    throw new Error(`YouTube tải thất bại: ${details.substring(0, 500)}`);
  }

  async downloadInstagram(download) {
    return socialDownloads.downloadInstagram(download, this.getSocialContext());
  }

  async downloadTikTok(download) {
    return socialDownloads.downloadTikTok(download, this.getSocialContext());
  }

  async downloadFacebook(download) {
    return socialDownloads.downloadFacebook(download, this.getSocialContext());
  }

  async downloadTwitter(download) {
    const args = [
      '--format', 'best',
      '--output', path.join(download.outputPath, '%(title)s.%(ext)s'),
      download.url,
    ];

    return new Promise((resolve, reject) => {
      const process = spawn(resolveYtDlpPath(this.rootDir), args);
      this.trackActiveProcess(download.id, process);

      process.stdout.on('data', data => {
        this.emitProgress(download, data.toString());
      });

      process.on('close', code => {
        if (code === 0) resolve(download);
        else reject(new Error(`Twitter download failed with code ${code}`));
      });

      process.on('error', reject);
    });
  }

  async downloadVimeo(download) {
    const args = [
      '--format', 'best',
      '--output', path.join(download.outputPath, '%(title)s.%(ext)s'),
      '--referer', 'https://vimeo.com/',
      download.url,
    ];

    return new Promise((resolve, reject) => {
      const process = spawn(resolveYtDlpPath(this.rootDir), args);
      this.trackActiveProcess(download.id, process);

      process.stdout.on('data', data => {
        this.emitProgress(download, data.toString());
      });

      process.on('close', code => {
        if (code === 0) resolve(download);
        else reject(new Error(`Vimeo download failed with code ${code}`));
      });

      process.on('error', reject);
    });
  }

  async pauseDownload(downloadId) {
    const download = this.activeDownloads.get(downloadId);
    if (!download) return false;

    download.status = 'paused';
    await this.stopActiveHandle(downloadId, 'pause');
    this.activeDownloads.delete(downloadId);
    this.pausedDownloads.set(downloadId, download);
    this.emit('download-paused', download);
    this.persistSnapshot();
    this.processQueue();
    return true;
  }

  resumeDownload(downloadId) {
    const download = this.pausedDownloads.get(downloadId) ||
      this.activeDownloads.get(downloadId) ||
      this.failedDownloads.get(downloadId);

    if (!download) return false;

    download.status = 'queued';
    download.priority = 10;
    this.pausedDownloads.delete(downloadId);
    this.failedDownloads.delete(downloadId);
    this.queue.unshift(download);
    this.persistSnapshot();
    this.processQueue();
    return true;
  }

  retryDownload(downloadId) {
    return this.resumeDownload(downloadId);
  }

  async pauseAllDownloads() {
    const ids = Array.from(this.activeDownloads.keys());
    let count = 0;
    for (const id of ids) {
      if (await this.pauseDownload(id)) count += 1;
    }
    return count;
  }

  resumeAllDownloads() {
    const ids = Array.from(this.pausedDownloads.keys());
    let count = 0;
    ids.forEach(id => {
      if (this.resumeDownload(id)) count += 1;
    });
    return count;
  }

  prioritizeDownload(downloadId) {
    const index = this.queue.findIndex(download => download.id === downloadId);
    if (index < 0) return false;
    const [download] = this.queue.splice(index, 1);
    download.priority = Math.max(100, Number(download.priority || 0) + 10);
    this.queue.unshift(download);
    this.emit('download-prioritized', download);
    this.persistSnapshot();
    return true;
  }

  async cancelDownload(downloadId) {
    const queueIndex = this.queue.findIndex(download => download.id === downloadId);
    if (queueIndex !== -1) {
      const removed = this.queue.splice(queueIndex, 1)[0];
      removed.status = 'cancelled';
      this.emit('download-cancelled', removed);
      this.persistSnapshot();
      return true;
    }

    const active = this.activeDownloads.get(downloadId);
    if (active) {
      active.status = 'cancelled';
      await this.stopActiveHandle(downloadId, 'cancel');
      this.activeDownloads.delete(downloadId);
      this.pausedDownloads.delete(downloadId);
      this.emit('download-cancelled', active);
      this.persistSnapshot();
      return true;
    }

    const paused = this.pausedDownloads.get(downloadId);
    if (paused) {
      paused.status = 'cancelled';
      this.pausedDownloads.delete(downloadId);
      this.emit('download-cancelled', paused);
      this.persistSnapshot();
      return true;
    }

    return false;
  }

  clearCompleted() {
    this.completedDownloads.clear();
    this.emit('completed-cleared');
    this.persistSnapshot();
  }

  clearFailed() {
    this.failedDownloads.clear();
    this.emit('failed-cleared');
    this.persistSnapshot();
  }

  getDownloadStatus(downloadId) {
    return this.activeDownloads.get(downloadId) ||
      this.pausedDownloads.get(downloadId) ||
      this.completedDownloads.get(downloadId) ||
      this.failedDownloads.get(downloadId) ||
      this.queue.find(download => download.id === downloadId);
  }

  waitForCompletion(downloadId, options = {}) {
    const { timeoutMs = 0 } = options;

    return new Promise((resolve, reject) => {
      let timer = null;

      const cleanup = () => {
        this.removeListener('download-completed', onCompleted);
        this.removeListener('download-failed', onFailed);
        this.removeListener('download-cancelled', onCancelled);
        this.removeListener('download-paused', onPaused);
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };

      const finish = (error, status) => {
        cleanup();
        if (error) {
          reject(error);
          return;
        }
        resolve(status);
      };

      const resolveFromStatus = () => {
        const status = this.getDownloadStatus(downloadId);
        if (!status) return false;

        if (status.status === 'completed') {
          finish(null, status);
          return true;
        }
        if (status.status === 'failed') {
          finish(new Error(status.error || 'Download failed'));
          return true;
        }
        if (status.status === 'cancelled') {
          finish(new Error('Download cancelled'));
          return true;
        }
        if (status.status === 'paused') {
          finish(new Error('Download paused'));
          return true;
        }
        return false;
      };

      const onCompleted = status => {
        if (status?.id === downloadId) finish(null, status);
      };
      const onFailed = status => {
        if (status?.id === downloadId) finish(new Error(status.error || 'Download failed'));
      };
      const onCancelled = status => {
        if (status?.id === downloadId) finish(new Error('Download cancelled'));
      };
      const onPaused = status => {
        if (status?.id === downloadId) finish(new Error('Download paused'));
      };

      this.on('download-completed', onCompleted);
      this.on('download-failed', onFailed);
      this.on('download-cancelled', onCancelled);
      this.on('download-paused', onPaused);

      if (resolveFromStatus()) return;

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          finish(new Error('Download timeout'));
        }, timeoutMs);
      }
    });
  }

  getAllDownloads() {
    return {
      active: Array.from(this.activeDownloads.values()),
      paused: Array.from(this.pausedDownloads.values()),
      queued: this.queue,
      completed: Array.from(this.completedDownloads.values()),
      failed: Array.from(this.failedDownloads.values()),
    };
  }

  getPersistenceStatus() {
    return {
      snapshotStore: 'electron-store',
      sqlite: this.sqlite.getStatus(),
    };
  }

  getRecoverableSessionInfo() {
    const queued = this.queue.length;
    const paused = this.pausedDownloads.size;
    const restoredActive = this.queue.filter(download => download.progress > 0).length;
    const total = queued + paused;
    return {
      hasRecoverable: total > 0,
      queued,
      paused,
      total,
      restoredActive,
      updatedAt: this.lastSnapshotUpdatedAt,
    };
  }

  resumePendingSession() {
    const pausedIds = Array.from(this.pausedDownloads.keys());
    pausedIds.forEach(downloadId => this.resumeDownload(downloadId));
    const slots = Math.max(1, this.maxParallelDownloads);
    for (let index = 0; index < slots; index++) {
      this.processQueue();
    }
    return this.getRecoverableSessionInfo();
  }

  discardPendingSession() {
    this.queue = [];
    this.pausedDownloads.clear();
    this.activeDownloads.clear();
    this.activeProcesses.forEach(process => {
      try { process.kill('SIGTERM'); } catch (_) {}
    });
    this.activeProcesses.clear();
    this.downloadStates.clear();
    this.persistSnapshot();
    return this.getRecoverableSessionInfo();
  }

  // Gọi khi app thoát: dừng mọi tiến trình con để không bỏ lại
  // yt-dlp chạy mồ côi, và chốt snapshot cuối cùng ngay lập tức.
  shutdown() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    this.activeProcesses.forEach(process => {
      try { process.kill('SIGTERM'); } catch (_) {}
    });
    this.activeProcesses.clear();
    try { this.persistSnapshot(); } catch (_) {}
  }

  setMaxParallelDownloads(max) {
    this.maxParallelDownloads = Math.max(1, Math.min(10, max));
    this.persistSnapshot();
    this.processQueue();
  }

  generateDownloadId() {
    return `dl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getFormatSelector(quality, format) {
    if (format === 'mp3') {
      return 'bestaudio[ext=m4a]/bestaudio';
    }

    switch (quality) {
      case '4k':
      case '2160p':
        return 'bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=2160]+bestaudio/best[height<=2160]/bestvideo+bestaudio/best';
      case '1440p':
        return 'bestvideo[height<=1440][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1440]+bestaudio/best[height<=1440]/bestvideo[height<=1080]+bestaudio/best';
      case '1080p':
        return 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
      case '720p':
        return 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best';
      case '480p':
        return 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]/best';
      case '360p':
        return 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=360]+bestaudio/best[height<=360]/best';
      case 'best':
      case 'highest':
        return 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best';
      default:
        return 'bestvideo+bestaudio/best';
    }
  }

  static detectPlatform(url) {
    return detectPlatform(url);
  }
}

module.exports = QueueService;
