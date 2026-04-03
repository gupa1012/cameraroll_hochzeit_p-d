'use strict';

const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_MAX_COMMENT_LENGTH = 500;
const DEFAULT_UPLOAD_REQUEST_TIMEOUT_MS = 0;
const MIN_ADMIN_PASSWORD_LENGTH = 8;
const MAX_ADMIN_PASSWORD_LENGTH = 80;
const DEFAULT_RATE_LIMITS = Object.freeze({
  upload: 1000,
  delete: 300,
  admin: 600,
  adminLogin: 40,
  operatorLogin: 40,
  operatorMutation: 300,
  file: 2000,
  guestRoute: 5000
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{6,}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getMaxFileMb(value) {
  const rawValue = String(value || '').trim().toLowerCase();
  if (!rawValue || rawValue === '0' || rawValue === 'none' || rawValue === 'unlimited') {
    return null;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
}

function getUploadLimitLabel(maxFileMb) {
  if (!maxFileMb) return 'Originaldatei ohne Uploadlimit';
  return `${maxFileMb} MB je Bild`;
}

function getTrustProxySetting(value) {
  if (value === undefined || value === null || String(value).trim() === '') return false;
  if (value === 'true') return 1;

  const numericValue = Number(value);
  if (Number.isInteger(numericValue) && numericValue >= 0) {
    return numericValue;
  }

  return String(value);
}

function getPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function getRateLimitMax(value, fallback) {
  const parsed = getPositiveInteger(value, fallback);
  return parsed === 0 ? Number.MAX_SAFE_INTEGER : parsed;
}

function getUploadRequestTimeoutMs(value) {
  return getPositiveInteger(value, DEFAULT_UPLOAD_REQUEST_TIMEOUT_MS);
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function assertWritableDirectory(dirPath) {
  ensureDirectory(dirPath);
  const probePath = path.join(dirPath, `.write-test-${process.pid}-${Date.now()}`);
  fs.writeFileSync(probePath, 'ok');
  fs.unlinkSync(probePath);
}

function getNetworkUrls(port) {
  const interfaces = os.networkInterfaces();
  const urls = [];

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      urls.push(`http://${address.address}:${port}`);
    }
  }

  return [...new Set(urls)];
}

function nowIso() {
  return new Date().toISOString();
}

function hashValue(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function compareSecret(rawValue, hashedValue) {
  if (!rawValue || !hashedValue) return false;

  const expected = Buffer.from(hashedValue, 'hex');
  const received = Buffer.from(hashValue(rawValue), 'hex');
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

function randomToken(size = 24) {
  return randomBytes(size).toString('base64url');
}

function randomPublicId() {
  return randomToken(6);
}

function randomPassword(length = 16) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  let output = '';

  for (let index = 0; index < length; index += 1) {
    output += alphabet[bytes[index] % alphabet.length];
  }

  return output;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeDisplayName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase().slice(0, 200);
}

function isValidDeviceId(value) {
  return UUID_PATTERN.test(String(value || '').trim());
}

function isSafeToken(value) {
  return SAFE_TOKEN_PATTERN.test(String(value || '').trim());
}

function isValidEmail(value) {
  return EMAIL_PATTERN.test(normalizeEmail(value));
}

function isValidAdminPassword(value) {
  const rawValue = String(value || '');
  return rawValue.length >= MIN_ADMIN_PASSWORD_LENGTH && rawValue.length <= MAX_ADMIN_PASSWORD_LENGTH;
}

function getCommentValue(value, maxCommentLength = DEFAULT_MAX_COMMENT_LENGTH) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxCommentLength);
}

function parseCookies(rawCookieHeader) {
  const cookies = {};

  for (const part of String(rawCookieHeader || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const name = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!name) continue;
    cookies[name] = decodeURIComponent(value);
  }

  return cookies;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');

  return parts.join('; ');
}

function getSpacePath(publicId, guestToken) {
  return `/p/${encodeURIComponent(publicId)}/${encodeURIComponent(guestToken)}`;
}

function getSpaceAdminCookiePath(publicId, guestToken) {
  return `${getSpacePath(publicId, guestToken)}/api/admin`;
}

function getUploaderMetadata(value, req) {
  let parsed = {};

  if (typeof value === 'string' && value.trim()) {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = {};
    }
  }

  const browser = typeof parsed.browser === 'string' ? parsed.browser.trim().slice(0, 80) : '';
  const osName = typeof parsed.os === 'string' ? parsed.os.trim().slice(0, 80) : '';
  const device = typeof parsed.device === 'string' ? parsed.device.trim().slice(0, 80) : '';
  const language = typeof parsed.language === 'string' ? parsed.language.trim().slice(0, 32) : '';
  const timezone = typeof parsed.timezone === 'string' ? parsed.timezone.trim().slice(0, 64) : '';
  const platform = typeof parsed.platform === 'string' ? parsed.platform.trim().slice(0, 64) : '';
  const vendor = typeof parsed.vendor === 'string' ? parsed.vendor.trim().slice(0, 64) : '';
  const screen = typeof parsed.screen === 'string' ? parsed.screen.trim().slice(0, 32) : '';
  const userAgent = (req.get('User-Agent') || '').slice(0, 400);
  const ip = String(req.ip || req.socket?.remoteAddress || '').slice(0, 80);

  const summaryParts = [device, browser, osName].filter(Boolean);
  const summary = summaryParts.join(' · ').slice(0, 160);

  return {
    summary,
    info: JSON.stringify({
      browser,
      os: osName,
      device,
      language,
      timezone,
      platform,
      vendor,
      screen,
      userAgent
    }),
    ip
  };
}

function buildAppConfig({ env = process.env, rootDir }) {
  const ROOT_DIR = rootDir;
  const PORT = getPositiveInteger(env.PORT, 3000);
  const HOST = String(env.HOST || '0.0.0.0').trim() || '0.0.0.0';
  const PUBLIC_DIR = String(env.PUBLIC_DIR || path.join(ROOT_DIR, 'public'));
  const DATA_DIR = String(env.DATA_DIR || path.join(ROOT_DIR, 'data'));
  const STORAGE_DIR = String(env.STORAGE_DIR || path.join(ROOT_DIR, 'storage'));
  const SPACES_DIR = path.join(STORAGE_DIR, 'spaces');
  const DB_PATH = String(env.DB_PATH || path.join(DATA_DIR, 'platform.sqlite'));

  return {
    PORT,
    HOST,
    ROOT_DIR,
    PUBLIC_DIR,
    DATA_DIR,
    STORAGE_DIR,
    SPACES_DIR,
    DB_PATH,
    MAX_COMMENT_LENGTH: DEFAULT_MAX_COMMENT_LENGTH,
    MAX_FILE_MB: getMaxFileMb(env.MAX_FILE_MB),
    UPLOAD_REQUEST_TIMEOUT_MS: getUploadRequestTimeoutMs(env.UPLOAD_REQUEST_TIMEOUT_MS),
    OPERATOR_PASSWORD: String(env.OPERATOR_PASSWORD || '').trim(),
    TRUST_PROXY: getTrustProxySetting(env.TRUST_PROXY),
    rateLimits: {
      upload: getRateLimitMax(env.UPLOAD_LIMITER_MAX, DEFAULT_RATE_LIMITS.upload),
      delete: getRateLimitMax(env.DELETE_LIMITER_MAX, DEFAULT_RATE_LIMITS.delete),
      admin: getRateLimitMax(env.ADMIN_LIMITER_MAX, DEFAULT_RATE_LIMITS.admin),
      adminLogin: getRateLimitMax(env.ADMIN_LOGIN_LIMITER_MAX, DEFAULT_RATE_LIMITS.adminLogin),
      operatorLogin: getRateLimitMax(env.OPERATOR_LOGIN_LIMITER_MAX, DEFAULT_RATE_LIMITS.operatorLogin),
      operatorMutation: getRateLimitMax(env.OPERATOR_MUTATION_LIMITER_MAX, DEFAULT_RATE_LIMITS.operatorMutation),
      file: getRateLimitMax(env.FILE_LIMITER_MAX, DEFAULT_RATE_LIMITS.file),
      guestRoute: getRateLimitMax(env.GUEST_ROUTE_LIMITER_MAX, DEFAULT_RATE_LIMITS.guestRoute)
    }
  };
}

module.exports = {
  DEFAULT_MAX_COMMENT_LENGTH,
  MAX_ADMIN_PASSWORD_LENGTH,
  MIN_ADMIN_PASSWORD_LENGTH,
  DEFAULT_RATE_LIMITS,
  DEFAULT_UPLOAD_REQUEST_TIMEOUT_MS,
  assertWritableDirectory,
  buildAppConfig,
  compareSecret,
  ensureDirectory,
  escapeHtml,
  getCommentValue,
  getMaxFileMb,
  getNetworkUrls,
  getSpaceAdminCookiePath,
  getSpacePath,
  getTrustProxySetting,
  getUploadLimitLabel,
  getUploaderMetadata,
  getUploadRequestTimeoutMs,
  hashValue,
  isValidAdminPassword,
  isSafeToken,
  isValidDeviceId,
  isValidEmail,
  normalizeDisplayName,
  normalizeEmail,
  nowIso,
  parseCookies,
  randomPassword,
  randomPublicId,
  randomToken,
  serializeCookie
};