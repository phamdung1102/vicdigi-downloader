// ============================================================
// activation-tracker.js — Gửi tín hiệu kích hoạt/sử dụng về
// Google Sheet của chủ app (qua Google Apps Script Web App).
//
// Endpoint đặt trong config/telemetry.json — để rỗng là TẮT hẳn.
// Nguyên tắc: fire-and-forget, lỗi mạng không được ảnh hưởng app.
// Setup phía Google: xem TRACKING_GUIDE.md + tools/activation-sheet/Code.gs
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'config', 'telemetry.json');
const HEARTBEAT_STORE_KEY = 'telemetry.lastHeartbeatDate';

let _endpoint; // undefined = chưa đọc config; null = tắt

function getEndpoint() {
  if (_endpoint !== undefined) return _endpoint;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const url = String(raw.endpoint || '').trim();
    _endpoint = url.startsWith('https://') ? url : null;
  } catch (_) {
    _endpoint = null;
  }
  return _endpoint;
}

function getAppVersion() {
  try { return require('electron').app.getVersion(); } catch (_) {}
  try { return require('../../../package.json').version; } catch (_) {}
  return 'unknown';
}

async function sendEvent(event, licenseStatus, extra = {}) {
  const endpoint = getEndpoint();
  if (!endpoint) return false;

  const license = licenseStatus?.license || {};
  const payload = {
    event,
    machineId: licenseStatus?.machineId || license.machineId || '',
    customerName: license.customerName || '',
    email: license.email || '',
    plan: license.plan || '',
    licenseStatus: licenseStatus?.status || '',
    issuedAt: license.issuedAt || null,
    expiresAt: license.expiresAt || null,
    appVersion: getAppVersion(),
    timestamp: new Date().toISOString(),
    ...extra,
  };

  try {
    await axios.post(endpoint, payload, {
      timeout: 8000,
      headers: { 'Content-Type': 'application/json' },
    });
    return true;
  } catch (error) {
    console.log('[activation-tracker] Gửi thất bại (bỏ qua):', error.message);
    return false;
  }
}

/** Gọi ngay sau khi kích hoạt license thành công. */
function trackActivation(licenseStatus) {
  return sendEvent('activate', licenseStatus);
}

/**
 * Gọi lúc app khởi động: báo "máy này còn đang dùng".
 * Chỉ gửi khi license active và tối đa 1 lần/ngày (dedupe qua store).
 */
async function trackDailyHeartbeat(licenseStatus, store) {
  if (!licenseStatus?.valid) return false;
  if (!getEndpoint()) return false;

  const today = new Date().toISOString().slice(0, 10);
  try { if (store?.get?.(HEARTBEAT_STORE_KEY) === today) return false; } catch (_) {}

  const sent = await sendEvent('heartbeat', licenseStatus);
  if (sent) {
    try { store?.set?.(HEARTBEAT_STORE_KEY, today); } catch (_) {}
  }
  return sent;
}

module.exports = { trackActivation, trackDailyHeartbeat };
