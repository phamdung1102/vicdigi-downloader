'use strict';

function shouldRetry(download, maxAttempts = 3) {
  return Number(download?.retryCount || 0) < maxAttempts;
}

function markForRetry(download, priority = 10) {
  return {
    ...download,
    retryCount: Number(download?.retryCount || 0) + 1,
    status: 'retrying',
    priority,
  };
}

module.exports = {
  markForRetry,
  shouldRetry,
};
