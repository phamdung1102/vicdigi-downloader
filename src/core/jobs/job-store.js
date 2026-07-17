'use strict';

const SNAPSHOT_KEY = 'jobSnapshots';

class JobStore {
  constructor(settingsStore) {
    this.settingsStore = settingsStore;
  }

  load() {
    const snapshot = this.settingsStore?.get?.(SNAPSHOT_KEY, null);
    return this._normalizeSnapshot(snapshot);
  }

  save(snapshot) {
    if (!this.settingsStore?.set) return;
    this.settingsStore.set(SNAPSHOT_KEY, this._normalizeSnapshot(snapshot));
  }

  clear() {
    this.settingsStore?.delete?.(SNAPSHOT_KEY);
  }

  _normalizeSnapshot(snapshot) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    return {
      queue: Array.isArray(source.queue) ? source.queue : [],
      active: Array.isArray(source.active) ? source.active : [],
      paused: Array.isArray(source.paused) ? source.paused : [],
      completed: Array.isArray(source.completed) ? source.completed : [],
      failed: Array.isArray(source.failed) ? source.failed : [],
      updatedAt: source.updatedAt || null,
    };
  }
}

module.exports = { JobStore, SNAPSHOT_KEY };
