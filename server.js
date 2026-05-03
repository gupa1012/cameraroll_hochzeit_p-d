'use strict';

const express = require('express');
const multer = require('multer');
const { DatabaseSync } = require('node:sqlite');
const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const archiver = require('archiver');
const {
  assertWritableDirectory,
  buildAppConfig,
  compareSecret,
  ensureDirectory,
  escapeHtml,
  getCommentValue,
  getNetworkUrls,
  getSpacePath,
  getUploadLimitLabel,
  getUploaderMetadata,
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
} = require('./lib/gallery-core');

const appConfig = buildAppConfig({ env: process.env, rootDir: __dirname });
const {
  PORT,
  HOST,
  ROOT_DIR,
  PUBLIC_DIR,
  DATA_DIR,
  STORAGE_DIR,
  SPACES_DIR,
  DB_PATH,
  MAX_COMMENT_LENGTH,
  MAX_FILE_MB,
  UPLOAD_REQUEST_TIMEOUT_MS,
  OPERATOR_PASSWORD,
  TRUST_PROXY,
  rateLimits
} = appConfig;
const INDEX_PATH = path.join(PUBLIC_DIR, 'index.html');
const SPACE_PAGE_PATH = path.join(PUBLIC_DIR, 'space.html');
const OPERATOR_PAGE_PATH = path.join(PUBLIC_DIR, 'operator.html');
const THEME_BACKGROUND_PATH = path.join(ROOT_DIR, 'Generated Image March 29, 2026 - 9_05PM.png');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SPACE_STATUS_ACTIVE = 'active';
const SPACE_STATUS_SUSPENDED = 'suspended';
const NOINDEX_VALUE = 'noindex, nofollow, noarchive';
const EXPORTS_DIR = path.join(DATA_DIR, 'exports');
const DEMO_SPACE_NAME = String(process.env.DEMO_SPACE_NAME || 'Demo Hochzeit').trim() || 'Demo Hochzeit';
const DEMO_OWNER_EMAIL = String(process.env.DEMO_OWNER_EMAIL || 'demo@example.invalid').trim() || 'demo@example.invalid';
const EXPORT_SYNC_ENABLED = Boolean(String(process.env.RCLONE_REMOTE || '').trim());
const EXPORT_SYNC_LABEL = String(process.env.EXPORT_SYNC_LABEL || 'Google Drive / Cloud Sync').trim() || 'Google Drive / Cloud Sync';
const EXPORT_SYNC_REMOTE = String(process.env.RCLONE_REMOTE || '').trim();
const EXPORT_SYNC_PREFIX = String(process.env.RCLONE_EXPORT_PREFIX || 'wedding-camera-roll').trim().replace(/^\/+|\/+$/g, '');

function renderTemplate(filePath, replacements = {}) {
  let html = fs.readFileSync(filePath, 'utf8');
  for (const [key, value] of Object.entries(replacements)) {
    html = html.replaceAll(`__${key}__`, String(value));
  }
  return html;
}

function setNoIndex(res) {
  res.set('X-Robots-Tag', NOINDEX_VALUE);
}

function getRequestBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function getSpaceUrl(req, publicId, guestToken) {
  return `${getRequestBaseUrl(req)}${getSpacePath(publicId, guestToken)}`;
}

function getCurrentSpaceBasePath(req) {
  return req.baseUrl || getSpacePath(req.space.public_id, req.guestToken);
}

function getCurrentSpaceAdminCookiePath(req) {
  return `${getCurrentSpaceBasePath(req)}/api/admin`;
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

async function buildSpaceAccessPayload(req, extraFields = {}) {
  const guestUrl = `${getRequestBaseUrl(req)}${getCurrentSpaceBasePath(req)}`;
  const qrCodeDataUrl = await createQrCodeDataUrl(guestUrl);

  return {
    guestPath: getCurrentSpaceBasePath(req),
    guestUrl,
    qrCodeDataUrl,
    qrPrintUrl: `${getCurrentSpaceBasePath(req)}/api/admin/qr-print`,
    ...extraFields
  };
}

function createPrintableQrHtml({ spaceName, guestUrl, qrCodeDataUrl }) {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(spaceName)} - QR Druckvorlage</title>
  <style>
    body { margin: 0; font-family: Georgia, 'Times New Roman', serif; color: #43352f; background: #f8f3ee; }
    .sheet { min-height: 100vh; display: grid; place-items: center; padding: 32px; }
    .card { width: min(760px, 100%); padding: 40px; background: white; border-radius: 28px; box-shadow: 0 20px 60px rgba(67, 53, 47, 0.12); border: 1px solid rgba(67, 53, 47, 0.08); }
    .eyebrow { display: inline-block; padding: 8px 14px; border-radius: 999px; background: #f5ebe3; color: #8a7067; font: 700 12px/1.2 'Segoe UI', sans-serif; text-transform: uppercase; letter-spacing: 0.12em; }
    h1 { margin: 18px 0 10px; font-size: 40px; font-weight: 400; }
    p { margin: 0; font: 16px/1.7 'Segoe UI', sans-serif; color: #7b6a62; }
    .layout { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 28px; align-items: center; margin-top: 28px; }
    .qr-box { display: grid; gap: 16px; justify-items: center; padding: 22px; border-radius: 22px; background: #fcfaf8; border: 1px solid rgba(67, 53, 47, 0.08); }
    .qr-box img { width: 100%; max-width: 280px; padding: 14px; background: white; border-radius: 18px; border: 1px solid rgba(67, 53, 47, 0.08); }
    .link-box { padding: 18px; border-radius: 18px; background: #fcfaf8; border: 1px solid rgba(67, 53, 47, 0.08); word-break: break-word; font: 600 14px/1.6 'Segoe UI', sans-serif; }
    .actions { margin-top: 28px; display: flex; gap: 12px; flex-wrap: wrap; }
    button { border: 0; border-radius: 999px; padding: 12px 18px; background: linear-gradient(135deg, #dbafb5, #f2cb87); color: #43352f; font: 700 14px 'Segoe UI', sans-serif; cursor: pointer; }
    @media print { .sheet { padding: 0; } .card { box-shadow: none; border: 0; border-radius: 0; width: 100%; min-height: 100vh; } .actions { display: none; } }
    @media (max-width: 720px) { .layout { grid-template-columns: 1fr; } .card { padding: 24px; } h1 { font-size: 30px; } }
  </style>
</head>
<body>
  <div class="sheet">
    <article class="card">
      <span class="eyebrow">Papeterie Vorlage</span>
      <h1>${escapeHtml(spaceName)}</h1>
      <p>Privater Link nur für eure Gäste. QR-Code scannen, Bilder direkt im Browser hochladen und den gemeinsamen Event-Feed live ansehen.</p>
      <div class="layout">
        <div>
          <div class="link-box">${escapeHtml(guestUrl)}</div>
        </div>
        <div class="qr-box">
          <img src="${qrCodeDataUrl}" alt="QR-Code für den privaten Gastzugang">
          <strong>Jetzt scannen und hochladen</strong>
        </div>
      </div>
      <div class="actions">
        <button type="button" onclick="window.print()">Jetzt drucken</button>
      </div>
    </article>
  </div>
</body>
</html>`;
}

function sanitizeFilename(value, fallback = 'space') {
  const normalized = normalizeDisplayName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return normalized || fallback;
}

function createManifest(space, photos) {
  return JSON.stringify({
    exportedAt: nowIso(),
    space: {
      id: space.id,
      publicId: space.public_id,
      displayName: space.display_name,
      ownerEmail: space.owner_email,
      status: space.status,
      provisionSource: space.provision_source,
      createdAt: space.created_at
    },
    photos: photos.map(photo => ({
      id: photo.id,
      filename: photo.filename,
      originalName: photo.original_name,
      comment: photo.comment,
      uploadedAt: photo.uploaded_at,
      archivedAt: photo.archived_at,
      size: photo.size,
      uploaderSummary: photo.uploader_summary,
      uploaderIp: photo.uploader_ip
    }))
  }, null, 2);
}

function createZipArchiveStream({ space, photos }) {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const { uploadsDir, thumbsDir } = getSpaceDirectories(space.id);

  if (fs.existsSync(uploadsDir)) {
    archive.directory(uploadsDir, 'originale');
  }
  if (fs.existsSync(thumbsDir)) {
    archive.directory(thumbsDir, 'vorschaubilder');
  }

  archive.append(createManifest(space, photos), { name: 'manifest.json' });
  return archive;
}

async function writeZipArchiveToFile({ space, photos, outputPath }) {
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = createZipArchiveStream({ space, photos });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    const finalized = archive.finalize();
    if (finalized && typeof finalized.then === 'function') {
      finalized.catch(reject);
    }
  });

  return outputPath;
}

async function syncExportArchive(outputPath, remotePath) {
  await new Promise((resolve, reject) => {
    execFile('rclone', ['copyto', outputPath, `${EXPORT_SYNC_REMOTE}:${remotePath}`], error => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
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
ensureDirectory(EXPORTS_DIR);
assertWritableDirectory(DATA_DIR);
assertWritableDirectory(STORAGE_DIR);
assertWritableDirectory(SPACES_DIR);
assertWritableDirectory(EXPORTS_DIR);

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
const stmtListAllPhotosForExport = db.prepare(`
  SELECT id, filename, original_name, comment, uploaded_at, archived_at, size, uploader_summary, uploader_ip
  FROM photos
  WHERE space_id = ?
  ORDER BY uploaded_at DESC
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

function createSpaceRecord({ displayName, ownerEmail, provisionSource = 'operator', adminPassword }) {
  let publicId = randomPublicId();
  while (stmtGetSpaceByPublicId.get(publicId)) {
    publicId = randomPublicId();
  }

  const guestToken = randomToken(12);
  const resolvedAdminPassword = adminPassword || randomPassword(14);
  const spaceId = uuidv4();

  stmtCreateSpace.run({
    id: spaceId,
    public_id: publicId,
    display_name: displayName,
    owner_email: ownerEmail,
    status: SPACE_STATUS_ACTIVE,
    guest_token_hash: hashValue(guestToken),
    admin_password_hash: hashValue(resolvedAdminPassword),
    provision_source: provisionSource,
    paid_at: null
  });

  getSpaceDirectories(spaceId);

  return {
    id: spaceId,
    publicId,
    guestToken,
    adminPassword: resolvedAdminPassword
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
  max: rateLimits.upload,
  message: { error: 'Zu viele Uploads. Bitte warte einen Moment.' },
  standardHeaders: true,
  legacyHeaders: false
});
const deleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: rateLimits.delete,
  message: { error: 'Zu viele Anfragen. Bitte warte einen Moment.' },
  standardHeaders: true,
  legacyHeaders: false
});
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: rateLimits.admin,
  message: { error: 'Zu viele Admin-Anfragen. Bitte kurz warten.' },
  standardHeaders: true,
  legacyHeaders: false
});
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: rateLimits.adminLogin,
  message: { error: 'Zu viele Login-Versuche. Bitte kurz warten.' },
  standardHeaders: true,
  legacyHeaders: false
});
const operatorLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: rateLimits.operatorLogin,
  message: { error: 'Zu viele Operator-Login-Versuche. Bitte kurz warten.' },
  standardHeaders: true,
  legacyHeaders: false
});
const operatorMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: rateLimits.operatorMutation,
  message: { error: 'Zu viele Änderungen. Bitte kurz warten.' },
  standardHeaders: true,
  legacyHeaders: false
});
const fileLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: rateLimits.file,
  message: 'Too many requests',
  standardHeaders: true,
  legacyHeaders: false
});
const guestRouteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: rateLimits.guestRoute,
  message: { error: 'Zu viele Anfragen auf diesen Space. Bitte kurz warten.' },
  standardHeaders: true,
  legacyHeaders: false
});

const app = express();
app.set('trust proxy', TRUST_PROXY);
app.use(express.json());
app.use(express.static(PUBLIC_DIR, { index: false }));

function getReadinessReport() {
  const checks = {
    database: { ok: false, path: DB_PATH },
    dataDir: { ok: false, path: DATA_DIR },
    storageDir: { ok: false, path: STORAGE_DIR },
    spacesDir: { ok: false, path: SPACES_DIR }
  };

  try {
    db.prepare('SELECT 1 AS ok').get();
    checks.database.ok = true;
  } catch (error) {
    checks.database.error = error.message;
  }

  for (const entry of [checks.dataDir, checks.storageDir, checks.spacesDir]) {
    try {
      assertWritableDirectory(entry.path);
      entry.ok = true;
    } catch (error) {
      entry.error = error.message;
    }
  }

  return {
    ok: Object.values(checks).every(entry => entry.ok),
    uptimeSeconds: Math.round(process.uptime()),
    uploadLimitMb: MAX_FILE_MB,
    uploadRequestTimeoutMs: UPLOAD_REQUEST_TIMEOUT_MS,
    checks
  };
}

app.get('/api/health/live', (_req, res) => {
  res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()) });
});

app.get('/api/health', (_req, res) => {
  const report = getReadinessReport();
  res.status(report.ok ? 200 : 503).json(report);
});

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

app.get('/demo', (_req, res) => {
  const createdSpace = createSpaceRecord({
    displayName: DEMO_SPACE_NAME,
    ownerEmail: DEMO_OWNER_EMAIL,
    provisionSource: 'demo'
  });

  res.redirect(302, getSpacePath(createdSpace.publicId, createdSpace.guestToken));
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
  const adminPassword = String(req.body?.adminPassword || '');

  if (displayName.length < 3) {
    return res.status(400).json({ error: 'Bitte gib einen aussagekräftigen Namen für euren Space an.' });
  }
  if (!isValidEmail(ownerEmail)) {
    return res.status(400).json({ error: 'Bitte gib eine gültige E-Mail-Adresse an.' });
  }
  if (!isValidAdminPassword(adminPassword)) {
    return res.status(400).json({ error: 'Bitte vergib ein Passwort mit mindestens 8 Zeichen für euren Brautpaar-Bereich.' });
  }

  try {
    const createdSpace = createSpaceRecord({
      displayName,
      ownerEmail,
      provisionSource: 'self-serve',
      adminPassword
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
  const adminPassword = String(req.body?.adminPassword || '');

  if (displayName.length < 3) {
    return res.status(400).json({ error: 'Bitte gib einen aussagekräftigen Space-Namen an.' });
  }
  if (!isValidEmail(ownerEmail)) {
    return res.status(400).json({ error: 'Bitte gib eine gültige E-Mail-Adresse an.' });
  }
  if (!isValidAdminPassword(adminPassword)) {
    return res.status(400).json({ error: 'Bitte vergib ein Passwort mit mindestens 8 Zeichen für den Brautpaar-Bereich.' });
  }

  try {
    const createdSpace = createSpaceRecord({
      displayName,
      ownerEmail,
      provisionSource: 'operator',
      adminPassword
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

  const guestToken = randomToken(12);
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
    UPLOAD_LIMIT_LABEL: escapeHtml(getUploadLimitLabel(MAX_FILE_MB)),
    MAX_COMMENT_LENGTH: MAX_COMMENT_LENGTH
  }));
});

guestRouter.get('/api/config', (req, res) => {
  setNoIndex(res);
  res.json({
    space: {
      displayName: req.space.display_name,
      publicId: req.space.public_id,
      status: req.space.status,
      provisionSource: req.space.provision_source
    },
    uploadLimitLabel: getUploadLimitLabel(MAX_FILE_MB),
    maxFileMb: MAX_FILE_MB,
    maxCommentLength: MAX_COMMENT_LENGTH,
    uploadRequestTimeoutMs: UPLOAD_REQUEST_TIMEOUT_MS,
    exportSyncEnabled: EXPORT_SYNC_ENABLED,
    exportSyncLabel: EXPORT_SYNC_LABEL,
    demoMode: req.space.provision_source === 'demo'
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

guestRouter.get('/api/guest-access', async (req, res, next) => {
  setNoIndex(res);

  try {
    res.json(await buildSpaceAccessPayload(req));
  } catch (error) {
    next(error);
  }
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
    path: getCurrentSpaceAdminCookiePath(req),
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
    path: getCurrentSpaceAdminCookiePath(req),
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

guestRouter.get('/api/admin/guest-access', adminLimiter, requireSpaceAdmin, async (req, res, next) => {
  setNoIndex(res);

  try {
    res.json(await buildSpaceAccessPayload(req));
  } catch (error) {
    next(error);
  }
});

guestRouter.get('/api/admin/qr-print', adminLimiter, requireSpaceAdmin, async (req, res, next) => {
  setNoIndex(res);

  try {
    const payload = await buildSpaceAccessPayload(req);
    res.type('html').send(createPrintableQrHtml({
      spaceName: req.space.display_name,
      guestUrl: payload.guestUrl,
      qrCodeDataUrl: payload.qrCodeDataUrl
    }));
  } catch (error) {
    next(error);
  }
});

guestRouter.get('/api/admin/export.zip', adminLimiter, requireSpaceAdmin, async (req, res, next) => {
  setNoIndex(res);

  try {
    const photos = stmtListAllPhotosForExport.all(req.space.id);
    const exportName = `${sanitizeFilename(req.space.display_name)}-${req.space.public_id}.zip`;
    const archive = createZipArchiveStream({ space: req.space, photos });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${exportName}"`);
    archive.on('error', next);
    archive.pipe(res);
    const finalized = archive.finalize();
    if (finalized && typeof finalized.then === 'function') {
      finalized.catch(next);
    }
  } catch (error) {
    next(error);
  }
});

guestRouter.post('/api/admin/export-sync', adminLimiter, requireSpaceAdmin, async (req, res, next) => {
  setNoIndex(res);

  if (!EXPORT_SYNC_ENABLED) {
    return res.status(503).json({ error: 'Cloud-Sync ist auf diesem Server noch nicht konfiguriert.' });
  }

  try {
    const photos = stmtListAllPhotosForExport.all(req.space.id);
    const exportName = `${sanitizeFilename(req.space.display_name)}-${req.space.public_id}-${Date.now()}.zip`;
    const outputPath = path.join(EXPORTS_DIR, exportName);
    const remotePath = [EXPORT_SYNC_PREFIX, sanitizeFilename(req.space.display_name), exportName].filter(Boolean).join('/');

    await writeZipArchiveToFile({ space: req.space, photos, outputPath });
    await syncExportArchive(outputPath, remotePath);

    res.json({
      success: true,
      exportName,
      syncLabel: EXPORT_SYNC_LABEL,
      remotePath: `${EXPORT_SYNC_REMOTE}:${remotePath}`
    });
  } catch (error) {
    next(error);
  }
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

app.use('/p/:publicId/:guestToken', guestRouter);
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

const server = app.listen(PORT, HOST, () => {
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

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Beende Server nach ${signal} ...`);

  server.close(() => {
    try {
      db.close();
    } catch (error) {
      console.error('Fehler beim Schliessen der Datenbank:', error.message);
      process.exitCode = 1;
    }
    process.exit();
  });

  setTimeout(() => {
    console.error('Server konnte nicht rechtzeitig beendet werden. Erzwinge Exit.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));