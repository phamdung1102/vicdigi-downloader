'use strict';

class SettingsStore {
  constructor(store) {
    this.store = store || null;
  }

  get(key, fallback = null) {
    if (!this.store?.get) return fallback;
    const value = this.store.get(key);
    return value === undefined ? fallback : value;
  }

  set(key, value) {
    this.store?.set?.(key, value);
  }

  delete(key) {
    this.store?.delete?.(key);
  }
}

module.exports = { SettingsStore };
