'use strict';

const express = require('express');
const multer = require('multer');
const { DatabaseSync } = require('node:sqlite');
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const STORAGE_DIR = path.join(ROOT_DIR, 'storage');
const SPACES_DIR = path.join(STORAGE_DIR, 'spaces');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'platform.sqlite');
const INDEX_PATH = path.join(PUBLIC_DIR, 'index.html');
const SPACE_PAGE_PATH = path.join(PUBLIC_DIR, 'space.html');
const OPERATOR_PAGE_PATH = path.join(PUBLIC_DIR, 'operator.html');
const THEME_BACKGROUND_PATH = path.join(ROOT_DIR, 'Generated Image March 29, 2026 - 9_05PM.png');
const OPERATOR_PASSWORD = String(process.env.OPERATOR_PASSWORD || '').trim();
const MAX_COMMENT_LENGTH = 500;
const MAX_FILE_MB = getMaxFileMb(process.env.MAX_FILE_MB);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{10,}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SPACE_STATUS_ACTIVE = 'active';
const SPACE_STATUS_SUSPENDED = 'suspended';
const NOINDEX_VALUE = 'noindex, nofollow, noarchive';
const TRUST_PROXY = getTrustProxySetting(process.env.TRUST_PROXY);

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

function getUploadLimitLabel() {
  if (!MAX_FILE_MB) return 'Ohne Uploadlimit';
  return `${MAX_FILE_MB} MB je Bild`;
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

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
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
  return randomToken(9);
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

function renderTemplate(filePath, replacements = {}) {
  let html = fs.readFileSync(filePath, 'utf8');
  for (const [key, value] of Object.entries(replacements)) {
    html = html.replaceAll(`__${key}__`, String(value));
  }
  return html;
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

function getCommentValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, MAX_COMMENT_LENGTH);
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

function setNoIndex(res) {
  res.set('X-Robots-Tag', NOINDEX_VALUE);
}

function getRequestBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function getSpacePath(publicId, guestToken) {
  return `/g/${encodeURIComponent(publicId)}/${encodeURIComponent(guestToken)}`;
}

function getSpaceUrl(req, publicId, guestToken) {
  return `${getRequestBaseUrl(req)}${getSpacePath(publicId, guestToken)}`;
}

async function createQrCodeDataUrl(value) {
  return QRCode.toDataURL(value, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
    color: {
      dark: '#5d534d',
      light: '#0000'
    }
  });
}

async function buildGuestAccessPayload(req, publicId, guestToken, extraFields = {}) {
  const guestPath = getSpacePath(publicId, guestToken);
  const guestUrl = getSpaceUrl(req, publicId, guestToken);
  const qrCodeDataUrl = await createQrCodeDataUrl(guestUrl);

  return {
    guestPath,
    guestUrl,
    qrCodeDataUrl,
    ...extraFields
  };
}

function getSpaceAdminCookiePath(publicId, guestToken) {
  return `${getSpacePath(publicId, guestToken)}/api/admin`;
}

function getSpaceDirectories(spaceId) {
  const root = path.join(SPACES_DIR, spaceId);
  const uploadsDir = path.join(root, 'uploads');
  const thumbsDir = path.join(root, 'thumbs');

  ensureDirectory(root);
  ensureDirectory(uploadsDir);
  ensureDirectory(thumbsDir);

  return { root, uploadsDir, thumbsDir };
}

function getPhotoFilePath(spaceId, filename) {
  return path.join(getSpaceDirectories(spaceId).uploadsDir, filename);
}

function getThumbFilePath(spaceId, filename) {
  return path.join(getSpaceDirectories(spaceId).thumbsDir, `${filename}.webp`);
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

async function ensureThumb(spaceId, filename) {
  const thumbPath = getThumbFilePath(spaceId, filename);
  if (fs.existsSync(thumbPath)) return thumbPath;

  const sourcePath = getPhotoFilePath(spaceId, filename);
  if (!fs.existsSync(sourcePath)) return null;

  try {
    await sharp(sourcePath)
      .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(thumbPath);
    return thumbPath;
  } catch (error) {
    console.error('Thumbnail error:', error.message);
    return null;
  }
}

function deletePhotoFiles(photo) {
  const filePath = getPhotoFilePath(photo.space_id, photo.filename);
  const thumbPath = getThumbFilePath(photo.space_id, photo.filename);

  fs.unlink(filePath, error => {
    if (error && error.code !== 'ENOENT') {
      console.error('Datei konnte nicht gelöscht werden:', error.message);
    }
  });

  fs.unlink(thumbPath, error => {
    if (error && error.code !== 'ENOENT') {
      console.error('Thumbnail konnte nicht gelöscht werden:', error.message);
    }
  });
}

ensureDirectory(DATA_DIR);
ensureDirectory(STORAGE_DIR);
ensureDirectory(SPACES_DIR);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
db.exec(`
  CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    guest_token_hash TEXT NOT NULL,
    admin_password_hash TEXT NOT NULL,
    provision_source TEXT NOT NULL DEFAULT 'operator',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME,
    suspended_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT,
    device_id TEXT NOT NULL,
    comment TEXT DEFAULT '',
    uploader_summary TEXT DEFAULT '',
    uploader_info TEXT DEFAULT '',
    uploader_ip TEXT DEFAULT '',
    archived_at DATETIME,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    size INTEGER,
    FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS space_admin_sessions (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS operator_sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS checkout_sessions (
    id TEXT PRIMARY KEY,
    space_id TEXT,
    owner_email TEXT,
    amount_cents INTEGER,
    provider TEXT,
    provider_session_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_spaces_public_id ON spaces(public_id);
  CREATE INDEX IF NOT EXISTS idx_spaces_owner_email ON spaces(owner_email);
  CREATE INDEX IF NOT EXISTS idx_spaces_status ON spaces(status);
  CREATE INDEX IF NOT EXISTS idx_photos_space_id ON photos(space_id);
  CREATE INDEX IF NOT EXISTS idx_photos_space_archived ON photos(space_id, archived_at);
  CREATE INDEX IF NOT EXISTS idx_space_admin_sessions_space_id ON space_admin_sessions(space_id);
`);

const stmtCreateSpace = db.prepare(`
  INSERT INTO spaces (id, public_id, display_name, owner_email, status, guest_token_hash, admin_password_hash, provision_source, paid_at)
  VALUES (:id, :public_id, :display_name, :owner_email, :status, :guest_token_hash, :admin_password_hash, :provision_source, :paid_at)
`);
const stmtGetSpaceByPublicId = db.prepare('SELECT * FROM spaces WHERE public_id = ?');
const stmtGetSpaceById = db.prepare('SELECT * FROM spaces WHERE id = ?');
const stmtListSpaces = db.prepare(`
  SELECT
    s.id,
    s.public_id,
    s.display_name,
    s.owner_email,
    s.status,
    s.provision_source,
    s.created_at,
    s.paid_at,
    s.suspended_at,
    (SELECT COUNT(*) FROM photos p WHERE p.space_id = s.id AND p.archived_at IS NULL) AS active_photo_count,
    (SELECT COUNT(*) FROM photos p WHERE p.space_id = s.id AND p.archived_at IS NOT NULL) AS archived_photo_count,
    COALESCE((SELECT SUM(size) FROM photos p WHERE p.space_id = s.id), 0) AS storage_usage_bytes
  FROM spaces s
  ORDER BY s.created_at DESC
`);
const stmtUpdateSpaceStatus = db.prepare(`
  UPDATE spaces
  SET status = :status,
      suspended_at = :suspended_at
  WHERE id = :id
`);
const stmtUpdateGuestTokenHash = db.prepare('UPDATE spaces SET guest_token_hash = ? WHERE id = ?');
const stmtUpdateAdminPasswordHash = db.prepare('UPDATE spaces SET admin_password_hash = ? WHERE id = ?');
const stmtInsertPhoto = db.prepare(`
  INSERT INTO photos (id, space_id, filename, original_name, device_id, comment, uploader_summary, uploader_info, uploader_ip, size)
  VALUES (:id, :space_id, :filename, :original_name, :device_id, :comment, :uploader_summary, :uploader_info, :uploader_ip, :size)
`);
const stmtListActivePhotos = db.prepare(`
  SELECT id, filename, original_name, comment, uploaded_at, size, device_id
  FROM photos
  WHERE space_id = ? AND archived_at IS NULL
  ORDER BY uploaded_at DESC
`);
const stmtListAdminActivePhotos = db.prepare(`
  SELECT id, filename, original_name, comment, uploaded_at, size, device_id, uploader_summary, uploader_info, uploader_ip, archived_at
  FROM photos
  WHERE space_id = ? AND archived_at IS NULL
  ORDER BY uploaded_at DESC
`);
const stmtListAdminArchivedPhotos = db.prepare(`
  SELECT id, filename, original_name, comment, uploaded_at, size, device_id, uploader_summary, uploader_info, uploader_ip, archived_at
  FROM photos
  WHERE space_id = ? AND archived_at IS NOT NULL
  ORDER BY archived_at DESC, uploaded_at DESC
`);
const stmtGetPhotoByIdAndSpace = db.prepare('SELECT * FROM photos WHERE id = ? AND space_id = ?');
const stmtDeletePhotoByIdAndSpace = db.prepare('DELETE FROM photos WHERE id = ? AND space_id = ?');
const stmtArchivePhotoByIdAndSpace = db.prepare('UPDATE photos SET archived_at = CURRENT_TIMESTAMP WHERE id = ? AND space_id = ? AND archived_at IS NULL');
const stmtRestorePhotoByIdAndSpace = db.prepare('UPDATE photos SET archived_at = NULL WHERE id = ? AND space_id = ? AND archived_at IS NOT NULL');
const stmtCreateSpaceAdminSession = db.prepare(`
  INSERT INTO space_admin_sessions (id, space_id, token_hash, expires_at)
  VALUES (:id, :space_id, :token_hash, :expires_at)
`);
const stmtGetSpaceAdminSession = db.prepare(`
  SELECT *
  FROM space_admin_sessions
  WHERE token_hash = ? AND space_id = ?
`);
const stmtTouchSpaceAdminSession = db.prepare('UPDATE space_admin_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?');
const stmtDeleteSpaceAdminSession = db.prepare('DELETE FROM space_admin_sessions WHERE token_hash = ? AND space_id = ?');
const stmtDeleteAllSpaceAdminSessions = db.prepare('DELETE FROM space_admin_sessions WHERE space_id = ?');
const stmtCreateOperatorSession = db.prepare(`
  INSERT INTO operator_sessions (id, token_hash, expires_at)
  VALUES (:id, :token_hash, :expires_at)
`);
const stmtGetOperatorSession = db.prepare('SELECT * FROM operator_sessions WHERE token_hash = ?');
const stmtTouchOperatorSession = db.prepare('UPDATE operator_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?');
const stmtDeleteOperatorSession = db.prepare('DELETE FROM operator_sessions WHERE token_hash = ?');
const stmtDeleteExpiredOperatorSessions = db.prepare('DELETE FROM operator_sessions WHERE expires_at < ?');
const stmtDeleteExpiredSpaceAdminSessions = db.prepare('DELETE FROM space_admin_sessions WHERE expires_at < ?');

function cleanupExpiredSessions() {
  const now = Date.now();
  stmtDeleteExpiredOperatorSessions.run(now);
  stmtDeleteExpiredSpaceAdminSessions.run(now);
}

function buildSpaceSummary(space) {
  return {
    id: space.id,
    publicId: space.public_id,
    displayName: space.display_name,
    ownerEmail: space.owner_email,
    status: space.status,
    provisionSource: space.provision_source,
    createdAt: space.created_at,
    paidAt: space.paid_at,
    suspendedAt: space.suspended_at,
    activePhotoCount: Number(space.active_photo_count || 0),
    archivedPhotoCount: Number(space.archived_photo_count || 0),
    storageUsageBytes: Number(space.storage_usage_bytes || 0)
  };
}

function createSpaceRecord({ displayName, ownerEmail, provisionSource = 'operator' }) {
  let publicId = randomPublicId();
  while (stmtGetSpaceByPublicId.get(publicId)) {
    publicId = randomPublicId();
  }

  const guestToken = randomToken(24);
  const adminPassword = randomPassword(14);
  const spaceId = uuidv4();

  stmtCreateSpace.run({
    id: spaceId,
    public_id: publicId,
    display_name: displayName,
    owner_email: ownerEmail,
    status: SPACE_STATUS_ACTIVE,
    guest_token_hash: hashValue(guestToken),
    admin_password_hash: hashValue(adminPassword),
    provision_source: provisionSource,
    paid_at: null
  });

  getSpaceDirectories(spaceId);

  return {
    id: spaceId,
    publicId,
    guestToken,
    adminPassword
  };
}

const uploadOptions = {
  storage: multer.diskStorage({
    destination: (req, _file, callback) => {
      callback(null, getSpaceDirectories(req.space.id).uploadsDir);
    },
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase() || '.jpg';
      callback(null, `${uuidv4()}${extension}`);
    }
  }),
  fileFilter: (_req, file, callback) => {
    const allowedMime = /^image\/(jpeg|jpg|png|gif|webp|heic|heif|avif)$/i.test(file.mimetype);
    const allowedExtension = /\.(jpg|jpeg|png|gif|webp|heic|heif|avif)$/i.test(file.originalname);
    if (allowedMime || allowedExtension) {
      callback(null, true);
      return;
    }
    callback(new Error('Nur Bilder erlaubt (JPEG, PNG, GIF, WebP, HEIC).'));
  }
};

if (MAX_FILE_MB) {
  uploadOptions.limits = { fileSize: MAX_FILE_MB * 1024 * 1024 };
}

const upload = multer(uploadOptions);

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Zu viele Uploads. Bitte warte einen Moment.' },
  standardHeaders: true,
  legacyHeaders: false
});
const deleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Zu viele Anfragen. Bitte warte einen Moment.' },
  standardHeaders: true,
  legacyHeaders: false
});
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 80,
  message: { error: 'Zu viele Admin-Anfragen. Bitte kurz warten.' },
  standardHeaders: true,
  legacyHeaders: false
});
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Zu viele Login-Versuche. Bitte kurz warten.' },
  standardHeaders: true,
  legacyHeaders: false
});
const operatorLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Zu viele Operator-Login-Versuche. Bitte kurz warten.' },
  standardHeaders: true,
  legacyHeaders: false
});
const operatorMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Zu viele Änderungen. Bitte kurz warten.' },
  standardHeaders: true,
  legacyHeaders: false
});
const fileLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  message: 'Too many requests',
  standardHeaders: true,
  legacyHeaders: false
});
const guestRouteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Zu viele Anfragen auf diesen Space. Bitte kurz warten.' },
  standardHeaders: true,
  legacyHeaders: false
});

const app = express();
app.set('trust proxy', TRUST_PROXY);
app.use(express.json());
app.use(express.static(PUBLIC_DIR, { index: false }));

app.get('/theme-background.png', (_req, res) => {
  res.sendFile(THEME_BACKGROUND_PATH);
});

function getOperatorSession(req) {
  cleanupExpiredSessions();
  const cookies = parseCookies(req.headers.cookie);
  const rawToken = cookies.operator_session || '';
  if (!rawToken) return null;

  const session = stmtGetOperatorSession.get(hashValue(rawToken));
  if (!session || session.expires_at < Date.now()) return null;

  stmtTouchOperatorSession.run(session.id);
  return session;
}

function getSpaceAdminSession(req, spaceId) {
  cleanupExpiredSessions();
  const cookies = parseCookies(req.headers.cookie);
  const rawToken = cookies.space_admin_session || '';
  if (!rawToken) return null;

  const session = stmtGetSpaceAdminSession.get(hashValue(rawToken), spaceId);
  if (!session || session.expires_at < Date.now()) return null;

  stmtTouchSpaceAdminSession.run(session.id);
  return session;
}

function requireOperator(req, res, next) {
  const session = getOperatorSession(req);
  if (!session) {
    setNoIndex(res);
    return res.status(401).json({ error: 'Operator-Anmeldung erforderlich.' });
  }
  req.operatorSession = session;
  next();
}

function requireSpaceAdmin(req, res, next) {
  const session = getSpaceAdminSession(req, req.space.id);
  if (!session) {
    setNoIndex(res);
    return res.status(401).json({ error: 'Admin-Anmeldung für diesen Space erforderlich.' });
  }
  req.spaceAdminSession = session;
  next();
}

function resolveGuestSpace(req, res, next) {
  const publicId = String(req.params.publicId || '').trim();
  const guestToken = String(req.params.guestToken || '').trim();

  setNoIndex(res);
  res.set('Cache-Control', 'private, no-store');

  if (!isSafeToken(publicId) || !isSafeToken(guestToken)) {
    return res.status(404).send('Not found');
  }

  const space = stmtGetSpaceByPublicId.get(publicId);
  if (!space || !compareSecret(guestToken, space.guest_token_hash) || space.status !== SPACE_STATUS_ACTIVE) {
    return res.status(404).send('Not found');
  }

  req.space = space;
  req.guestToken = guestToken;
  next();
}

function listSpacePhotos(spaceId, scope) {
  if (scope === 'archived') {
    return stmtListAdminArchivedPhotos.all(spaceId);
  }
  return stmtListAdminActivePhotos.all(spaceId);
}

app.get('/', (_req, res) => {
  res.type('html').sendFile(INDEX_PATH);
});

app.get('/operator', (_req, res) => {
  setNoIndex(res);
  res.type('html').sendFile(OPERATOR_PAGE_PATH);
});

app.get('/api/operator/session', (req, res) => {
  const session = getOperatorSession(req);
  if (!session) {
    setNoIndex(res);
    return res.status(401).json({ error: 'Keine aktive Operator-Session.' });
  }
  setNoIndex(res);
  res.json({ success: true });
});

app.post('/api/operator/login', operatorLoginLimiter, (req, res) => {
  setNoIndex(res);

  if (!OPERATOR_PASSWORD) {
    return res.status(503).json({ error: 'OPERATOR_PASSWORD ist noch nicht gesetzt.' });
  }

  const password = String(req.body?.password || '');
  if (!compareSecret(password, hashValue(OPERATOR_PASSWORD))) {
    return res.status(401).json({ error: 'Falsches Operator-Passwort.' });
  }

  cleanupExpiredSessions();
  const rawToken = randomToken(32);
  stmtCreateOperatorSession.run({
    id: uuidv4(),
    token_hash: hashValue(rawToken),
    expires_at: Date.now() + SESSION_TTL_MS
  });

  res.setHeader('Set-Cookie', serializeCookie('operator_session', rawToken, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/api/operator',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    secure: req.secure
  }));

  res.json({ success: true });
});

app.post('/api/operator/logout', (req, res) => {
  setNoIndex(res);
  const cookies = parseCookies(req.headers.cookie);
  const rawToken = cookies.operator_session || '';
  if (rawToken) {
    stmtDeleteOperatorSession.run(hashValue(rawToken));
  }

  res.setHeader('Set-Cookie', serializeCookie('operator_session', '', {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/api/operator',
    maxAge: 0,
    secure: req.secure
  }));
  res.json({ success: true });
});

app.get('/api/operator/spaces', requireOperator, (_req, res) => {
  setNoIndex(res);
  const spaces = stmtListSpaces.all().map(buildSpaceSummary);
  res.json({ spaces });
});

app.get('/api/operator/spaces/:spaceId/photos', requireOperator, (req, res) => {
  setNoIndex(res);
  const space = stmtGetSpaceById.get(req.params.spaceId);
  if (!space) return res.status(404).json({ error: 'Space nicht gefunden.' });

  const scope = req.query.scope === 'archived' ? 'archived' : 'active';
  const photos = listSpacePhotos(space.id, scope);
  res.json({
    space: buildSpaceSummary({ ...space, active_photo_count: 0, archived_photo_count: 0, storage_usage_bytes: 0 }),
    scope,
    photos
  });
});

app.get('/api/operator/spaces/:spaceId/uploads/:filename', requireOperator, fileLimiter, async (req, res) => {
  setNoIndex(res);

  const space = stmtGetSpaceById.get(req.params.spaceId);
  if (!space) return res.status(404).send('Not found');

  const filename = req.params.filename;
  if (filename.includes('..') || filename.includes('/')) {
    return res.status(400).send('Bad request');
  }

  if (req.query.thumb === '1') {
    const thumbPath = await ensureThumb(space.id, filename);
    if (thumbPath) return res.sendFile(thumbPath);
  }

  const filePath = getPhotoFilePath(space.id, filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

app.post('/api/spaces', operatorMutationLimiter, async (req, res, next) => {
  const displayName = normalizeDisplayName(req.body?.displayName);
  const ownerEmail = normalizeEmail(req.body?.ownerEmail);

  if (displayName.length < 3) {
    return res.status(400).json({ error: 'Bitte gib einen aussagekräftigen Namen für euren Space an.' });
  }
  if (!EMAIL_PATTERN.test(ownerEmail)) {
    return res.status(400).json({ error: 'Bitte gib eine gültige E-Mail-Adresse an.' });
  }

  try {
    const createdSpace = createSpaceRecord({
      displayName,
      ownerEmail,
      provisionSource: 'self-serve'
    });

    res.status(201).json({
      success: true,
      ...(await buildGuestAccessPayload(req, createdSpace.publicId, createdSpace.guestToken, {
        adminPassword: createdSpace.adminPassword,
        ownerEmail,
        displayName
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/operator/spaces', requireOperator, operatorMutationLimiter, async (req, res, next) => {
  setNoIndex(res);

  const displayName = normalizeDisplayName(req.body?.displayName);
  const ownerEmail = normalizeEmail(req.body?.ownerEmail);

  if (displayName.length < 3) {
    return res.status(400).json({ error: 'Bitte gib einen aussagekräftigen Space-Namen an.' });
  }
  if (!EMAIL_PATTERN.test(ownerEmail)) {
    return res.status(400).json({ error: 'Bitte gib eine gültige E-Mail-Adresse an.' });
  }

  try {
    const createdSpace = createSpaceRecord({
      displayName,
      ownerEmail,
      provisionSource: 'operator'
    });

    const storedSpace = stmtGetSpaceById.get(createdSpace.id);
    res.status(201).json({
      space: buildSpaceSummary({ ...storedSpace, active_photo_count: 0, archived_photo_count: 0, storage_usage_bytes: 0 }),
      ...(await buildGuestAccessPayload(req, createdSpace.publicId, createdSpace.guestToken, {
        adminPassword: createdSpace.adminPassword
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/operator/spaces/:spaceId/status', requireOperator, operatorMutationLimiter, (req, res) => {
  setNoIndex(res);

  const space = stmtGetSpaceById.get(req.params.spaceId);
  if (!space) return res.status(404).json({ error: 'Space nicht gefunden.' });

  const nextStatus = req.body?.status === SPACE_STATUS_SUSPENDED ? SPACE_STATUS_SUSPENDED : SPACE_STATUS_ACTIVE;
  stmtUpdateSpaceStatus.run({
    id: space.id,
    status: nextStatus,
    suspended_at: nextStatus === SPACE_STATUS_SUSPENDED ? nowIso() : null
  });

  res.json({ success: true, status: nextStatus });
});

app.post('/api/operator/spaces/:spaceId/rotate-guest-link', requireOperator, operatorMutationLimiter, async (req, res, next) => {
  setNoIndex(res);

  const space = stmtGetSpaceById.get(req.params.spaceId);
  if (!space) return res.status(404).json({ error: 'Space nicht gefunden.' });

  const guestToken = randomToken(24);
  stmtUpdateGuestTokenHash.run(hashValue(guestToken), space.id);

  try {
    res.json({
      success: true,
      ...(await buildGuestAccessPayload(req, space.public_id, guestToken))
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/operator/spaces/:spaceId/reset-admin-password', requireOperator, operatorMutationLimiter, (req, res) => {
  setNoIndex(res);

  const space = stmtGetSpaceById.get(req.params.spaceId);
  if (!space) return res.status(404).json({ error: 'Space nicht gefunden.' });

  const adminPassword = randomPassword(14);
  stmtUpdateAdminPasswordHash.run(hashValue(adminPassword), space.id);
  stmtDeleteAllSpaceAdminSessions.run(space.id);

  res.json({ success: true, adminPassword });
});

const guestRouter = express.Router({ mergeParams: true });
guestRouter.use(guestRouteLimiter);
guestRouter.use(resolveGuestSpace);

guestRouter.get('/', (req, res) => {
  res.type('html').send(renderTemplate(SPACE_PAGE_PATH, {
    SPACE_NAME: escapeHtml(req.space.display_name),
    UPLOAD_LIMIT_LABEL: escapeHtml(getUploadLimitLabel()),
    MAX_COMMENT_LENGTH: MAX_COMMENT_LENGTH
  }));
});

guestRouter.get('/api/config', (req, res) => {
  setNoIndex(res);
  res.json({
    space: {
      displayName: req.space.display_name,
      publicId: req.space.public_id,
      status: req.space.status
    },
    uploadLimitLabel: getUploadLimitLabel(),
    maxFileMb: MAX_FILE_MB,
    maxCommentLength: MAX_COMMENT_LENGTH
  });
});

guestRouter.get('/api/photos', (req, res) => {
  setNoIndex(res);
  const deviceId = String(req.get('X-Device-Id') || '').trim();
  const isValidCurrentDevice = isValidDeviceId(deviceId);
  const photos = stmtListActivePhotos.all(req.space.id).map(photo => ({
    id: photo.id,
    filename: photo.filename,
    original_name: photo.original_name,
    comment: photo.comment,
    uploaded_at: photo.uploaded_at,
    size: photo.size,
    isOwn: isValidCurrentDevice && photo.device_id === deviceId
  }));
  res.json(photos);
});

guestRouter.get('/api/admin/session', (req, res) => {
  setNoIndex(res);
  const session = getSpaceAdminSession(req, req.space.id);
  if (!session) {
    return res.status(401).json({ error: 'Keine aktive Space-Admin-Session.' });
  }
  res.json({ success: true });
});

guestRouter.post('/api/admin/login', adminLoginLimiter, (req, res) => {
  setNoIndex(res);

  const password = String(req.body?.password || '');
  if (!compareSecret(password, req.space.admin_password_hash)) {
    return res.status(401).json({ error: 'Falsches Admin-Passwort.' });
  }

  cleanupExpiredSessions();
  const rawToken = randomToken(32);
  stmtCreateSpaceAdminSession.run({
    id: uuidv4(),
    space_id: req.space.id,
    token_hash: hashValue(rawToken),
    expires_at: Date.now() + SESSION_TTL_MS
  });

  res.setHeader('Set-Cookie', serializeCookie('space_admin_session', rawToken, {
    httpOnly: true,
    sameSite: 'Lax',
    path: getSpaceAdminCookiePath(req.space.public_id, req.guestToken),
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    secure: req.secure
  }));

  res.json({ success: true });
});

guestRouter.post('/api/admin/logout', (req, res) => {
  setNoIndex(res);
  const cookies = parseCookies(req.headers.cookie);
  const rawToken = cookies.space_admin_session || '';
  if (rawToken) {
    stmtDeleteSpaceAdminSession.run(hashValue(rawToken), req.space.id);
  }

  res.setHeader('Set-Cookie', serializeCookie('space_admin_session', '', {
    httpOnly: true,
    sameSite: 'Lax',
    path: getSpaceAdminCookiePath(req.space.public_id, req.guestToken),
    maxAge: 0,
    secure: req.secure
  }));

  res.json({ success: true });
});

guestRouter.get('/api/admin/photos', adminLimiter, requireSpaceAdmin, (req, res) => {
  setNoIndex(res);
  const scope = req.query.scope === 'archived' ? 'archived' : 'active';
  res.json(listSpacePhotos(req.space.id, scope));
});

guestRouter.post('/api/upload', uploadLimiter, upload.single('photo'), async (req, res) => {
  setNoIndex(res);

  if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen.' });

  const deviceId = (req.body.device_id || '').trim();
  if (!isValidDeviceId(deviceId)) {
    fs.unlink(req.file.path, error => {
      if (error && error.code !== 'ENOENT') {
        console.error('Upload-Datei konnte nicht bereinigt werden:', error.message);
      }
    });
    return res.status(400).json({ error: 'Ungültige Geräte-ID. Bitte Seite neu laden und erneut versuchen.' });
  }

  const uploaderMetadata = getUploaderMetadata(req.body.uploader_info, req);
  const photo = {
    id: uuidv4(),
    space_id: req.space.id,
    filename: req.file.filename,
    original_name: req.file.originalname,
    device_id: deviceId,
    comment: getCommentValue(req.body.comment),
    uploader_summary: uploaderMetadata.summary,
    uploader_info: uploaderMetadata.info,
    uploader_ip: uploaderMetadata.ip,
    size: req.file.size
  };

  stmtInsertPhoto.run(photo);
  ensureThumb(req.space.id, photo.filename).catch(() => {});

  res.status(201).json({
    id: photo.id,
    filename: photo.filename,
    original_name: photo.original_name,
    comment: photo.comment,
    size: photo.size
  });
});

guestRouter.delete('/api/photos/:photoId', deleteLimiter, (req, res) => {
  setNoIndex(res);

  const photo = stmtGetPhotoByIdAndSpace.get(req.params.photoId, req.space.id);
  if (!photo) return res.status(404).json({ error: 'Foto nicht gefunden.' });

  const deviceId = String(req.get('X-Device-Id') || '').trim();
  const adminSession = getSpaceAdminSession(req, req.space.id);
  const isOwner = photo.device_id === deviceId;

  if (!isOwner && !adminSession) {
    return res.status(403).json({ error: 'Nicht berechtigt.' });
  }

  deletePhotoFiles(photo);
  stmtDeletePhotoByIdAndSpace.run(photo.id, req.space.id);
  res.json({ success: true });
});

guestRouter.post('/api/admin/delete-selected', adminLimiter, requireSpaceAdmin, (req, res) => {
  setNoIndex(res);

  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.filter(id => typeof id === 'string' && id.trim())
    : [];

  if (!ids.length) {
    return res.status(400).json({ error: 'Keine Fotos ausgewählt.' });
  }

  let archived = 0;
  for (const id of ids) {
    const photo = stmtGetPhotoByIdAndSpace.get(id, req.space.id);
    if (!photo || photo.archived_at) continue;
    stmtArchivePhotoByIdAndSpace.run(id, req.space.id);
    archived += 1;
  }

  res.json({ success: true, archived });
});

guestRouter.post('/api/admin/restore-selected', adminLimiter, requireSpaceAdmin, (req, res) => {
  setNoIndex(res);

  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.filter(id => typeof id === 'string' && id.trim())
    : [];

  if (!ids.length) {
    return res.status(400).json({ error: 'Keine Fotos ausgewählt.' });
  }

  let restored = 0;
  for (const id of ids) {
    const photo = stmtGetPhotoByIdAndSpace.get(id, req.space.id);
    if (!photo || !photo.archived_at) continue;
    stmtRestorePhotoByIdAndSpace.run(id, req.space.id);
    restored += 1;
  }

  res.json({ success: true, restored });
});

guestRouter.post('/api/admin/delete-archived-selected', adminLimiter, requireSpaceAdmin, (req, res) => {
  setNoIndex(res);

  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.filter(id => typeof id === 'string' && id.trim())
    : [];

  if (!ids.length) {
    return res.status(400).json({ error: 'Keine Fotos ausgewählt.' });
  }

  let deleted = 0;
  for (const id of ids) {
    const photo = stmtGetPhotoByIdAndSpace.get(id, req.space.id);
    if (!photo || !photo.archived_at) continue;
    deletePhotoFiles(photo);
    stmtDeletePhotoByIdAndSpace.run(id, req.space.id);
    deleted += 1;
  }

  res.json({ success: true, deleted });
});

guestRouter.get('/uploads/:filename', fileLimiter, async (req, res) => {
  const filename = req.params.filename;
  if (filename.includes('..') || filename.includes('/')) {
    return res.status(400).send('Bad request');
  }

  if (req.query.thumb === '1') {
    const thumbPath = await ensureThumb(req.space.id, filename);
    if (thumbPath) return res.sendFile(thumbPath);
  }

  const filePath = getPhotoFilePath(req.space.id, filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

app.use('/g/:publicId/:guestToken', guestRouter);

app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: MAX_FILE_MB ? `Datei zu groß. Maximum: ${MAX_FILE_MB} MB.` : 'Datei zu groß.' });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message || 'Upload konnte nicht verarbeitet werden.' });
  }
  if (err.message && /nur bilder erlaubt/i.test(err.message)) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: err.message || 'Serverfehler' });
});

app.listen(PORT, HOST, () => {
  console.log(`Mehrspace-Galerie läuft auf http://localhost:${PORT}`);
  console.log(`Datenbank: ${DB_PATH}`);
  if (HOST === '0.0.0.0') {
    const networkUrls = getNetworkUrls(PORT);
    if (networkUrls.length) {
      console.log('Im lokalen WLAN erreichbar unter:');
      for (const url of networkUrls) {
        console.log(`  ${url}`);
      }
    }
  }
  if (OPERATOR_PASSWORD) {
    console.log('Operator-Backoffice ist aktiv.');
  } else {
    console.log('Operator-Backoffice ist deaktiviert, bis OPERATOR_PASSWORD gesetzt ist.');
  }
});