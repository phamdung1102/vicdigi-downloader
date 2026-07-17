'use strict';

const crypto = require('crypto');

const APP_ID = 'vicdigi-downloader';
const TOKEN_PREFIX = 'VDL1';

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(padded, 'base64');
}

function parseToken(rawKey) {
  const parts = String(rawKey || '').trim().split('.');
  if (parts.length !== 3) return null;
  if (parts[0] !== TOKEN_PREFIX) return null;
  return {
    payloadEncoded: parts[1],
    signatureEncoded: parts[2],
  };
}

function createLicensePayload(options = {}) {
  const {
    machineId,
    customerName = '',
    email = '',
    durationMode = 'days',
    days = 365,
    issuedAt = new Date(),
    features = ['downloads'],
  } = options;

  if (!machineId) throw new Error('machineId là bắt buộc');
  if (!['days', 'lifetime'].includes(durationMode)) {
    throw new Error('durationMode phải là "days" hoặc "lifetime"');
  }

  const issuedDate = issuedAt instanceof Date ? issuedAt : new Date(issuedAt);
  if (Number.isNaN(issuedDate.getTime())) {
    throw new Error('issuedAt không hợp lệ');
  }

  const totalDays = durationMode === 'lifetime' ? null : Number.parseInt(days, 10);
  if (durationMode === 'days' && (!Number.isFinite(totalDays) || totalDays <= 0)) {
    throw new Error('Số ngày phải lớn hơn 0');
  }

  return {
    appId: APP_ID,
    machineId: String(machineId).trim(),
    customerName: String(customerName || '').trim(),
    email: String(email || '').trim(),
    issuedAt: issuedDate.toISOString(),
    expiresAt: durationMode === 'lifetime'
      ? null
      : new Date(issuedDate.getTime() + totalDays * 24 * 60 * 60 * 1000).toISOString(),
    plan: durationMode === 'lifetime' ? 'lifetime' : `${totalDays}-day`,
    features: Array.isArray(features) ? features : ['downloads'],
  };
}

function createLicenseToken(payload, privateKey) {
  if (!privateKey) throw new Error('Thiếu private key để ký license');
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signatureEncoded = base64UrlEncode(
    crypto.sign('sha256', Buffer.from(payloadEncoded), privateKey)
  );
  return `${TOKEN_PREFIX}.${payloadEncoded}.${signatureEncoded}`;
}

module.exports = {
  APP_ID,
  TOKEN_PREFIX,
  base64UrlDecode,
  base64UrlEncode,
  createLicensePayload,
  createLicenseToken,
  parseToken,
};
