'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  buildAppConfig,
  compareSecret,
  getCommentValue,
  getMaxFileMb,
  getSpaceAdminCookiePath,
  getSpacePath,
  getTrustProxySetting,
  getUploadLimitLabel,
  getUploadRequestTimeoutMs,
  hashValue,
  isValidAdminPassword,
  isSafeToken,
  isValidDeviceId,
  isValidEmail,
  normalizeDisplayName,
  normalizeEmail,
  parseCookies,
  randomPassword,
  serializeCookie
} = require('../lib/gallery-core');

test('getMaxFileMb handles unlimited and numeric values', () => {
  assert.equal(getMaxFileMb(undefined), null);
  assert.equal(getMaxFileMb('0'), null);
  assert.equal(getMaxFileMb('unlimited'), null);
  assert.equal(getMaxFileMb('200'), 200);
  assert.equal(getMaxFileMb('abc'), null);
});

test('upload labels describe unlimited original uploads clearly', () => {
  assert.equal(getUploadLimitLabel(null), 'Originaldatei ohne Uploadlimit');
  assert.equal(getUploadLimitLabel(150), '150 MB je Bild');
});

test('trust proxy and upload timeout parsing are robust', () => {
  assert.equal(getTrustProxySetting(undefined), false);
  assert.equal(getTrustProxySetting('true'), 1);
  assert.equal(getTrustProxySetting('2'), 2);
  assert.equal(getTrustProxySetting('loopback'), 'loopback');
  assert.equal(getUploadRequestTimeoutMs(undefined), 0);
  assert.equal(getUploadRequestTimeoutMs('-5'), 0);
  assert.equal(getUploadRequestTimeoutMs('900000'), 900000);
});

test('hashing and secret comparison stay deterministic', () => {
  const hash = hashValue('secret-value');
  assert.equal(hash.length, 64);
  assert.equal(compareSecret('secret-value', hash), true);
  assert.equal(compareSecret('wrong-value', hash), false);
});

test('normalization and validation helpers sanitize user input', () => {
  assert.equal(normalizeDisplayName('  Anna   &   Ben  '), 'Anna & Ben');
  assert.equal(normalizeEmail('  Test@Example.COM '), 'test@example.com');
  assert.equal(isValidEmail('test@example.com'), true);
  assert.equal(isValidEmail('invalid-address'), false);
  assert.equal(isSafeToken('AbCdEf1234_-'), true);
  assert.equal(isSafeToken('short'), false);
  assert.equal(isSafeToken('shorter'), true);
  assert.equal(isValidAdminPassword('1234567'), false);
  assert.equal(isValidAdminPassword('12345678'), true);
  assert.equal(isValidDeviceId('463fe0dc-891d-473e-bf52-be454fcb0b2b'), true);
  assert.equal(isValidDeviceId('not-a-uuid'), false);
});

test('comment and cookie helpers preserve expected semantics', () => {
  assert.equal(getCommentValue('  Hallo Welt  ', 5), 'Hallo');
  assert.deepEqual(parseCookies('a=1; b=hello%20world'), { a: '1', b: 'hello world' });
  assert.equal(
    serializeCookie('session', 'abc 123', { httpOnly: true, sameSite: 'Lax', path: '/demo', maxAge: 60 }),
    'session=abc%20123; Max-Age=60; Path=/demo; HttpOnly; SameSite=Lax'
  );
});

test('space path helpers generate stable admin cookie paths', () => {
  assert.equal(getSpacePath('spacePublicId', 'guestToken1234'), '/p/spacePublicId/guestToken1234');
  assert.equal(
    getSpaceAdminCookiePath('spacePublicId', 'guestToken1234'),
    '/p/spacePublicId/guestToken1234/api/admin'
  );
});

test('password generator avoids ambiguous characters', () => {
  const password = randomPassword(32);
  assert.equal(password.length, 32);
  assert.match(password, /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]+$/);
});

test('buildAppConfig supports isolated test directories and rate-limit overrides', () => {
  const rootDir = path.resolve(__dirname, '..');
  const config = buildAppConfig({
    rootDir,
    env: {
      PORT: '4567',
      HOST: '127.0.0.1',
      DATA_DIR: path.join(rootDir, '.tmp-test-data'),
      STORAGE_DIR: path.join(rootDir, '.tmp-test-storage'),
      MAX_FILE_MB: '0',
      UPLOAD_REQUEST_TIMEOUT_MS: '1200000',
      UPLOAD_LIMITER_MAX: '0',
      OPERATOR_PASSWORD: 'demo-pass'
    }
  });

  assert.equal(config.PORT, 4567);
  assert.equal(config.HOST, '127.0.0.1');
  assert.equal(config.MAX_FILE_MB, null);
  assert.equal(config.UPLOAD_REQUEST_TIMEOUT_MS, 1200000);
  assert.equal(config.OPERATOR_PASSWORD, 'demo-pass');
  assert.equal(config.rateLimits.upload, Number.MAX_SAFE_INTEGER);
  assert.equal(config.DB_PATH, path.join(config.DATA_DIR, 'platform.sqlite'));
});