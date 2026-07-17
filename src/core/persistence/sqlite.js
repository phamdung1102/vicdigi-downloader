'use strict';

const fs = require('fs-extra');
const path = require('path');

// Driver ưu tiên: better-sqlite3 (hoạt động trong Electron sau khi rebuild),
// phụ: node:sqlite (Node >= 22.5, dùng khi chạy script test bằng Node hệ thống).
let createDatabase = null;
let driverName = null;

try {
  const BetterSqlite3 = require('better-sqlite3');
  createDatabase = dbPath => new BetterSqlite3(dbPath);
  driverName = 'better-sqlite3';
} catch (_) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    createDatabase = dbPath => new DatabaseSync(dbPath);
    driverName = 'node:sqlite';
  } catch (_) {
    createDatabase = null;
  }
}

class SqlitePersistence {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.enabled = !!createDatabase;
  }

  init() {
    if (!this.enabled) return null;
    if (this.db) return this.db;

    fs.ensureDirSync(path.dirname(this.dbPath));
    this.db = createDatabase(this.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS job_snapshots (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        snapshot_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        status TEXT,
        platform TEXT,
        title TEXT,
        output_path TEXT,
        output_file TEXT,
        progress REAL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);
    return this.db;
  }

  loadSnapshot() {
    if (!this.enabled) return null;
    const db = this.init();
    const row = db.prepare('SELECT snapshot_json FROM job_snapshots WHERE id = 1').get();
    if (!row?.snapshot_json) return null;
    try {
      return JSON.parse(row.snapshot_json);
    } catch (_) {
      return null;
    }
  }

  saveSnapshot(snapshot) {
    if (!this.enabled) return false;
    const db = this.init();
    const now = new Date().toISOString();
    const payload = JSON.stringify(snapshot || {});
    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO job_snapshots (id, snapshot_json, updated_at)
        VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          snapshot_json = excluded.snapshot_json,
          updated_at = excluded.updated_at
      `).run(payload, now);

      db.prepare('DELETE FROM jobs').run();
      const insertJob = db.prepare(`
        INSERT INTO jobs (
          job_id, status, platform, title, output_path, output_file, progress, updated_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const job of flattenSnapshotJobs(snapshot)) {
        insertJob.run(
          job.id,
          job.status || '',
          job.platform || '',
          job.title || '',
          job.outputPath || '',
          job.outputFile || '',
          Number(job.progress || 0),
          now,
          JSON.stringify(job),
        );
      }

      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
    return true;
  }

  getRecentJobs(limit = 100) {
    if (!this.enabled) return [];
    const db = this.init();
    const rows = db.prepare(`
      SELECT payload_json
      FROM jobs
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit);

    return rows
      .map(row => {
        try { return JSON.parse(row.payload_json); } catch (_) { return null; }
      })
      .filter(Boolean);
  }

  getStatus() {
    if (!this.enabled) {
      return {
        enabled: false,
        driver: null,
        dbPath: this.dbPath,
        jobCount: 0,
        message: 'SQLite driver unavailable in current Electron runtime; using store fallback.',
      };
    }
    const db = this.init();
    const row = db.prepare('SELECT COUNT(*) AS count FROM jobs').get();
    return {
      enabled: true,
      driver: driverName,
      dbPath: this.dbPath,
      jobCount: row?.count || 0,
    };
  }
}

function flattenSnapshotJobs(snapshot = {}) {
  const groups = ['queue', 'active', 'paused', 'completed', 'failed'];
  const jobs = [];
  groups.forEach(group => {
    const items = Array.isArray(snapshot[group]) ? snapshot[group] : [];
    items.forEach(item => jobs.push(item));
  });
  return jobs;
}

module.exports = {
  SqlitePersistence,
};
