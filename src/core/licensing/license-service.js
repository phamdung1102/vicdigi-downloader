'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { APP_ID, base64UrlDecode, parseToken } = require('./license-token');

const LICENSE_STORE_KEY = 'license.activation';
const TRIAL_STORE_KEY = 'license.trial';
const TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000;
const PUBLIC_KEY_PATH = path.join(__dirname, '..', '..', '..', 'config', 'license-public.pem');
const PLACEHOLDER_MARKER = 'REPLACE_WITH_YOUR_BASE64_PUBLIC_KEY';

class LicenseService {
  constructor(store) {
    this.store = store || null;
    this._machineId = null;
    this._statusCache = null;
    this._statusCacheAt = 0;
  }

  // Bản cache của getStatus() cho các check lặp lại (mỗi IPC request).
  // TTL ngắn để license hết hạn/bị gỡ vẫn được phát hiện nhanh.
  getStatusCached(ttlMs = 30000) {
    const now = Date.now();
    if (this._statusCache && now - this._statusCacheAt < ttlMs) return this._statusCache;
    this._statusCache = this.getStatus();
    this._statusCacheAt = now;
    return this._statusCache;
  }

  _invalidateStatusCache() {
    this._statusCache = null;
    this._statusCacheAt = 0;
  }

  getStatus() {
    const machineId = this.getMachineId();
    const publicKey = this.getPublicKey();
    const stored = this.store?.get?.(LICENSE_STORE_KEY) || null;

    if (!publicKey) {
      return {
        activated: false,
        valid: false,
        configured: false,
        machineId,
        status: 'unconfigured',
        license: null,
        message: 'Licensing chua duoc cau hinh public key.',
      };
    }

    if (!stored?.rawKey) return this.getTrialStatus(machineId);

    return this.verifyLicenseKey(stored.rawKey, { machineId, publicKey });
  }

  activate(rawKey) {
    const machineId = this.getMachineId();
    const publicKey = this.getPublicKey();

    if (!publicKey) {
      return {
        activated: false,
        valid: false,
        configured: false,
        machineId,
        status: 'unconfigured',
        license: null,
        message: 'Licensing chua duoc cau hinh public key.',
      };
    }

    const result = this.verifyLicenseKey(rawKey, { machineId, publicKey });
    if (!result.valid) return result;

    this.store?.set?.(LICENSE_STORE_KEY, {
      rawKey: String(rawKey || '').trim(),
      license: result.license,
      activatedAt: new Date().toISOString(),
    });

    this._invalidateStatusCache();
    return this.getStatus();
  }

  clear() {
    this.store?.delete?.(LICENSE_STORE_KEY);
    this._invalidateStatusCache();
    return this.getStatus();
  }

  getTrialStatus(machineId = this.getMachineId()) {
    const now = Date.now();
    let trial = this.store?.get?.(TRIAL_STORE_KEY) || null;
    const startedAt = Date.parse(trial?.startedAt || '');
    const lastSeenAt = Date.parse(trial?.lastSeenAt || '');
    const belongsToMachine = trial?.machineId === machineId;

    if (!trial || !Number.isFinite(startedAt) || !belongsToMachine) {
      trial = {
        machineId,
        startedAt: new Date(now).toISOString(),
        lastSeenAt: new Date(now).toISOString(),
      };
      this.store?.set?.(TRIAL_STORE_KEY, trial);
    } else if (Number.isFinite(lastSeenAt) && now < lastSeenAt - 5 * 60 * 1000) {
      trial.clockRollbackDetected = true;
      this.store?.set?.(TRIAL_STORE_KEY, trial);
    } else {
      trial.lastSeenAt = new Date(Math.max(now, lastSeenAt || now)).toISOString();
      this.store?.set?.(TRIAL_STORE_KEY, trial);
    }

    const trialStartedAt = Date.parse(trial.startedAt);
    const expiresAtMs = trialStartedAt + TRIAL_DURATION_MS;
    const valid = !trial.clockRollbackDetected && now < expiresAtMs;
    return {
      activated: false,
      valid,
      configured: true,
      machineId,
      status: valid ? 'trial' : 'trial-expired',
      license: {
        customerName: 'Dùng thử 3 ngày',
        email: '',
        plan: 'trial-3-days',
        issuedAt: new Date(trialStartedAt).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
        machineId,
        features: ['all'],
      },
      trial: {
        startedAt: new Date(trialStartedAt).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
        remainingMs: Math.max(0, expiresAtMs - now),
      },
      message: valid
        ? 'Đang dùng thử đầy đủ tính năng trong 3 ngày.'
        : (trial.clockRollbackDetected ? 'Dùng thử đã khóa do thời gian hệ thống bị thay đổi.' : 'Thời gian dùng thử 3 ngày đã kết thúc.'),
    };
  }

  verifyLicenseKey(rawKey, { machineId, publicKey } = {}) {
    const currentMachineId = machineId || this.getMachineId();
    const activePublicKey = publicKey || this.getPublicKey();
    const token = String(rawKey || '').trim();

    if (!token) {
      return {
        activated: false,
        valid: false,
        configured: !!activePublicKey,
        machineId: currentMachineId,
        status: 'invalid',
        license: null,
        message: 'License key rong.',
      };
    }

    const parsed = parseToken(token);
    if (!parsed) {
      return {
        activated: false,
        valid: false,
        configured: !!activePublicKey,
        machineId: currentMachineId,
        status: 'invalid',
        license: null,
        message: 'License key khong dung dinh dang VDL1.',
      };
    }

    try {
      const isSignatureValid = crypto.verify(
        'sha256',
        Buffer.from(parsed.payloadEncoded),
        activePublicKey,
        base64UrlDecode(parsed.signatureEncoded)
      );

      if (!isSignatureValid) {
        return invalidStatus(currentMachineId, 'Chu ky license khong hop le.', !!activePublicKey);
      }

      const payload = JSON.parse(base64UrlDecode(parsed.payloadEncoded).toString('utf8'));
      if (payload.appId !== APP_ID) {
        return invalidStatus(currentMachineId, 'License key khong danh cho app nay.', !!activePublicKey);
      }
      if (payload.machineId !== currentMachineId) {
        return invalidStatus(currentMachineId, 'License key khong dung voi ma may hien tai.', !!activePublicKey);
      }

      const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
      if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        return invalidStatus(currentMachineId, 'Ngay het han trong license khong hop le.', !!activePublicKey);
      }

      const status = expiresAt && expiresAt.getTime() < Date.now() ? 'expired' : 'active';
      const valid = status === 'active';

      return {
        activated: valid,
        valid,
        configured: !!activePublicKey,
        machineId: currentMachineId,
        status,
        license: {
          customerName: payload.customerName || '',
          email: payload.email || '',
          plan: payload.plan || '',
          issuedAt: payload.issuedAt || null,
          expiresAt: payload.expiresAt || null,
          machineId: payload.machineId,
          features: Array.isArray(payload.features) ? payload.features : [],
        },
        message: valid ? 'License hop le.' : 'License da het han.',
      };
    } catch (error) {
      return invalidStatus(currentMachineId, error.message || 'Khong doc duoc license key.', !!activePublicKey);
    }
  }

  getMachineId() {
    if (this._machineId) return this._machineId;
    const rawMachineId = [
      readWindowsMachineGuid(),
      os.hostname(),
      os.arch(),
      os.platform(),
    ].filter(Boolean).join('|');

    const digest = crypto.createHash('sha256').update(rawMachineId || 'vicdigi-fallback').digest('hex').toUpperCase();
    const groups = digest.slice(0, 16).match(/.{1,4}/g) || ['0000', '0000', '0000', '0000'];
    this._machineId = `VIC-${groups.join('-')}`;
    return this._machineId;
  }

  getPublicKey() {
    try {
      const pem = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8').trim();
      if (!pem || pem.includes(PLACEHOLDER_MARKER)) return null;
      return pem;
    } catch (_) {
      return null;
    }
  }
}

function invalidStatus(machineId, message, configured) {
  return {
    activated: false,
    valid: false,
    configured: !!configured,
    machineId,
    status: 'invalid',
    license: null,
    message,
  };
}

function readWindowsMachineGuid() {
  if (process.platform !== 'win32') return null;
  try {
    const output = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
    return match?.[1]?.trim() || null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  APP_ID,
  LicenseService,
};
