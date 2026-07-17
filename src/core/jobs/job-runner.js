'use strict';

class JobRunner {
  constructor(queueService) {
    this.queueService = queueService;
  }

  enqueue(job) {
    return this.queueService.addToQueue(job);
  }

  pause(jobId) {
    return this.queueService.pauseDownload(jobId);
  }

  resume(jobId) {
    return this.queueService.resumeDownload(jobId);
  }

  cancel(jobId) {
    return this.queueService.cancelDownload(jobId);
  }

  snapshot() {
    return this.queueService.getAllDownloads();
  }
}

module.exports = { JobRunner };
