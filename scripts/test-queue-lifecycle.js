'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs-extra');
const { EventEmitter } = require('events');

const QueueService = require('../src/core/jobs/queue-service');
const socialDownloads = require('../src/core/platforms/social');

class FakeProcess extends EventEmitter {
  kill() {
    setImmediate(() => this.emit('close', 1));
  }
}

function createMemoryStore() {
  const memory = new Map();
  return {
    get: key => memory.get(key),
    set: (key, value) => memory.set(key, value),
    delete: key => memory.delete(key),
  };
}

function isExpectedQueueNoise(args) {
  return String(args[0] || '').startsWith('Download failed for dl_');
}

async function waitUntil(check, { timeoutMs = 4000, intervalMs = 20, message = 'Condition timed out' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(message);
}

async function main() {
  const tempRoot = path.join(path.resolve(__dirname, '..'), '.tmp-queue-lifecycle');
  await fs.remove(tempRoot).catch(() => {});
  await fs.ensureDir(tempRoot);

  const originalInstagram = socialDownloads.downloadInstagram;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  const plans = new Map();
  const attempts = new Map();

  console.error = (...args) => {
    if (isExpectedQueueNoise(args)) return;
    originalConsoleError(...args);
  };
  console.log = (...args) => {
    if (isExpectedQueueNoise(args)) return;
    originalConsoleLog(...args);
  };

  socialDownloads.downloadInstagram = (download, context) => {
    const key = download.title;
    const queuedPlan = plans.get(key) || ['success'];
    const attemptIndex = attempts.get(key) || 0;
    const outcome = queuedPlan[Math.min(attemptIndex, queuedPlan.length - 1)] || 'success';
    attempts.set(key, attemptIndex + 1);

    return new Promise((resolve, reject) => {
      const proc = new FakeProcess();
      context.trackActiveProcess(download.id, proc);

      proc.on('close', code => {
        if (download.status === 'paused') {
          reject(new Error('Download paused'));
          return;
        }
        if (download.status === 'cancelled') {
          reject(new Error('Download cancelled'));
          return;
        }
        if (outcome === 'fail' || code !== 0) {
          reject(new Error('Synthetic social failure'));
          return;
        }

        download.outputFile = path.join(download.outputPath, `${download.id}.mp4`);
        resolve(download);
      });

      if (outcome === 'hang') return;
      setTimeout(() => proc.emit('close', outcome === 'fail' ? 1 : 0), 30);
    });
  };

  try {
    const store = createMemoryStore();
    const dbPath = path.join(tempRoot, 'queue-lifecycle.db');
    const manager = new QueueService({
      store,
      rootDir: path.resolve(__dirname, '..'),
      dbPath,
    });

    plans.set('pause-resume', ['hang', 'success']);
    const pauseResumeId = manager.addToQueue({
      title: 'pause-resume',
      url: 'https://www.instagram.com/p/demo-pause/',
      outputPath: tempRoot,
      platform: 'instagram',
    });

    await waitUntil(() => manager.activeDownloads.has(pauseResumeId), { message: 'pause-resume never became active' });
    assert.equal(await manager.pauseDownload(pauseResumeId), true, 'pauseDownload should pause active social jobs');
    await waitUntil(() => manager.pausedDownloads.has(pauseResumeId), { message: 'paused job was not tracked as paused' });
    assert.equal(manager.resumeDownload(pauseResumeId), true, 'resumeDownload should requeue paused jobs');
    const pauseResumeDone = await manager.waitForCompletion(pauseResumeId, { timeoutMs: 3000 });
    assert.equal(pauseResumeDone.status, 'completed', 'paused job should complete after resume');

    plans.set('cancel-active', ['hang']);
    const cancelId = manager.addToQueue({
      title: 'cancel-active',
      url: 'https://www.instagram.com/p/demo-cancel/',
      outputPath: tempRoot,
      platform: 'instagram',
    });

    await waitUntil(() => manager.activeDownloads.has(cancelId), { message: 'cancel job never became active' });
    assert.equal(await manager.cancelDownload(cancelId), true, 'cancelDownload should cancel active social jobs');
    await waitUntil(() => !manager.activeDownloads.has(cancelId), { message: 'cancelled job stayed active' });
    assert.equal(manager.getDownloadStatus(cancelId), undefined, 'cancelled jobs should be removed from active snapshots');

    plans.set('retry-success', ['fail', 'success']);
    const retryId = manager.addToQueue({
      title: 'retry-success',
      url: 'https://www.instagram.com/p/demo-retry/',
      outputPath: tempRoot,
      platform: 'instagram',
    });

    const retryDone = await manager.waitForCompletion(retryId, { timeoutMs: 4000 });
    assert.equal(retryDone.status, 'completed', 'retried job should eventually complete');
    assert.equal(retryDone.retryCount, 1, 'retried job should record one retry');

    const snapshotDbPath = path.join(tempRoot, 'queue-recovery.db');
    const persistedStore = createMemoryStore();
    const persistedManager = new QueueService({
      store: persistedStore,
      rootDir: path.resolve(__dirname, '..'),
      dbPath: snapshotDbPath,
    });
    persistedManager.maxParallelDownloads = 1;

    plans.set('recovery-paused', ['hang', 'success']);
    const recoveryPausedId = persistedManager.addToQueue({
      title: 'recovery-paused',
      url: 'https://www.instagram.com/p/demo-recovery-paused/',
      outputPath: tempRoot,
      platform: 'instagram',
    });
    await waitUntil(() => persistedManager.activeDownloads.has(recoveryPausedId), { message: 'recovery paused job never became active' });
    assert.equal(await persistedManager.pauseDownload(recoveryPausedId), true, 'recovery paused job should pause');

    plans.set('recovery-queued', ['success']);
    const recoveryQueuedId = persistedManager.addToQueue({
      title: 'recovery-queued',
      url: 'https://www.instagram.com/p/demo-recovery-queued/',
      outputPath: tempRoot,
      platform: 'instagram',
      priority: -1,
    });
    await persistedManager.pauseDownload(recoveryQueuedId); // move second item out of active path and persist it as paused/queued candidate
    persistedManager.resumeDownload(recoveryQueuedId);
    const queuedStatus = persistedManager.getDownloadStatus(recoveryQueuedId);
    if (queuedStatus) queuedStatus.status = 'queued';
    persistedManager.queue = queuedStatus ? [queuedStatus] : [];
    persistedManager.activeDownloads.clear();
    persistedManager.activeProcesses.clear();
    persistedManager.persistSnapshot();

    const restoredManager = new QueueService({
      store: persistedStore,
      rootDir: path.resolve(__dirname, '..'),
      dbPath: snapshotDbPath,
    });
    const recoverable = restoredManager.getRecoverableSessionInfo();
    assert.equal(recoverable.hasRecoverable, true, 'restored manager should detect recoverable session');
    assert.equal(recoverable.total >= 2, true, 'restored manager should see queued and paused work');

    restoredManager.resumePendingSession();
    const resumedPaused = await restoredManager.waitForCompletion(recoveryPausedId, { timeoutMs: 4000 });
    const resumedQueued = await restoredManager.waitForCompletion(recoveryQueuedId, { timeoutMs: 4000 });
    assert.equal(resumedPaused.status, 'completed', 'restored paused job should complete after recovery');
    assert.equal(resumedQueued.status, 'completed', 'restored queued job should complete after recovery');

    plans.set('discard-paused', ['hang']);
    const discardManager = new QueueService({
      store: persistedStore,
      rootDir: path.resolve(__dirname, '..'),
      dbPath: path.join(tempRoot, 'queue-discard.db'),
    });
    const discardId = discardManager.addToQueue({
      title: 'discard-paused',
      url: 'https://www.instagram.com/p/demo-discard/',
      outputPath: tempRoot,
      platform: 'instagram',
    });
    await waitUntil(() => discardManager.activeDownloads.has(discardId), { message: 'discard job never became active' });
    await discardManager.pauseDownload(discardId);
    assert.equal(discardManager.getRecoverableSessionInfo().hasRecoverable, true, 'paused discard job should be recoverable');
    discardManager.discardPendingSession();
    assert.equal(discardManager.getRecoverableSessionInfo().hasRecoverable, false, 'discardPendingSession should clear recoverable jobs');

    console.log('queue lifecycle test ok');
  } finally {
    socialDownloads.downloadInstagram = originalInstagram;
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    await fs.remove(tempRoot).catch(() => {});
  }
}

main().catch(error => {
  console.error('queue lifecycle test failed:', error);
  process.exitCode = 1;
});
