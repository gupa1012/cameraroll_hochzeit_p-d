'use strict';

const express = require('express');
const multer  = require('multer');
const { DatabaseSync } = require('node:sqlite');
const { createHash, timingSafeEqual } = require('node:crypto');
const os      = require('node:os');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const sharp   = require('sharp');
const rateLimit = require('express-rate-limit');

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT        = process.env.PORT || 3000;
const HOST        = process.env.HOST || '0.0.0.0';
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const THUMBS_DIR  = path.join(__dirname, 'uploads', '_thumbs');
const DB_PATH     = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
const ADMIN_PASSWORD = '090392';
const parsedMaxFileMb = parseInt(process.env.MAX_FILE_MB || '100', 10);
const MAX_COMMENT_LENGTH = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INDEX_PATH   = path.join(__dirname, 'public', 'index.html');
const THEME_BACKGROUND_PATH = path.join(__dirname, 'Generated Image March 29, 2026 - 9_05PM.png');

function getMaxFileMb(value) {
  if (!Number.isFinite(value) || value <= 0 || value > 500) return 100;
  return value;
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

const MAX_FILE_MB = getMaxFileMb(parsedMaxFileMb);

// ─── Setup directories ────────────────────────────────────────────────────────
[UPLOADS_DIR, THUMBS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── Database ─────────────────────────────────────────────────────────────────
const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS photos (
    id           TEXT PRIMARY KEY,
    filename     TEXT NOT NULL,
    original_name TEXT,
    device_id    TEXT NOT NULL,
    comment      TEXT DEFAULT '',
    uploader_summary TEXT DEFAULT '',
    uploader_info TEXT DEFAULT '',
    uploader_ip TEXT DEFAULT '',
    archived_at  DATETIME,
    uploaded_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    size         INTEGER
  );
`);

const tableColumns = db.prepare(`PRAGMA table_info(photos)`).all();
if (!tableColumns.some(column => column.name === 'comment')) {
  db.exec(`ALTER TABLE photos ADD COLUMN comment TEXT DEFAULT ''`);
}
if (!tableColumns.some(column => column.name === 'archived_at')) {
  db.exec(`ALTER TABLE photos ADD COLUMN archived_at DATETIME`);
}
if (!tableColumns.some(column => column.name === 'uploader_summary')) {
  db.exec(`ALTER TABLE photos ADD COLUMN uploader_summary TEXT DEFAULT ''`);
}
if (!tableColumns.some(column => column.name === 'uploader_info')) {
  db.exec(`ALTER TABLE photos ADD COLUMN uploader_info TEXT DEFAULT ''`);
}
if (!tableColumns.some(column => column.name === 'uploader_ip')) {
  db.exec(`ALTER TABLE photos ADD COLUMN uploader_ip TEXT DEFAULT ''`);
}

const stmtInsert  = db.prepare(`INSERT INTO photos (id, filename, original_name, device_id, comment, uploader_summary, uploader_info, uploader_ip, size)
                                VALUES (:id, :filename, :original_name, :device_id, :comment, :uploader_summary, :uploader_info, :uploader_ip, :size)`);
const stmtAllActive = db.prepare(`SELECT id, filename, original_name, comment, uploaded_at, size
                                  FROM photos
                                  WHERE archived_at IS NULL
                                  ORDER BY uploaded_at DESC`);
const stmtAdminAllActive = db.prepare(`SELECT id, filename, original_name, comment, uploaded_at, size, device_id, uploader_summary, uploader_info, uploader_ip, archived_at
                                       FROM photos
                                       WHERE archived_at IS NULL
                                       ORDER BY uploaded_at DESC`);
const stmtAdminAllArchived = db.prepare(`SELECT id, filename, original_name, comment, uploaded_at, size, device_id, uploader_summary, uploader_info, uploader_ip, archived_at
                                         FROM photos
                                         WHERE archived_at IS NOT NULL
                                         ORDER BY archived_at DESC, uploaded_at DESC`);
const stmtGetById = db.prepare(`SELECT * FROM photos WHERE id = ?`);
const stmtDelete  = db.prepare(`DELETE FROM photos WHERE id = ?`);
const stmtArchive = db.prepare(`UPDATE photos SET archived_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NULL`);
const stmtRestore = db.prepare(`UPDATE photos SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL`);

// ─── Express ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.get('/theme-background.png', (_req, res) => {
  res.sendFile(THEME_BACKGROUND_PATH);
});

function renderIndexHtml() {
  return fs.readFileSync(INDEX_PATH, 'utf8')
    .replaceAll('__MAX_FILE_MB__', String(MAX_FILE_MB))
    .replaceAll('__MAX_COMMENT_LENGTH__', String(MAX_COMMENT_LENGTH));
}

// ─── Multer ───────────────────────────────────────────────────────────────────
const ALLOWED_MIME = /^image\/(jpeg|jpg|png|gif|webp|heic|heif|avif)$/i;
const ALLOWED_EXT  = /\.(jpg|jpeg|png|gif|webp|heic|heif|avif)$/i;

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const okMime = ALLOWED_MIME.test(file.mimetype);
    const okExt  = ALLOWED_EXT.test(file.originalname);
    if (okMime || okExt) {
      cb(null, true);
    } else {
      cb(new Error('Nur Bilder erlaubt (JPEG, PNG, GIF, WebP, HEIC)'));
    }
  }
});

// ─── Thumbnail helper ─────────────────────────────────────────────────────────
async function ensureThumb(filename) {
  const thumbPath = path.join(THUMBS_DIR, filename + '.webp');
  if (fs.existsSync(thumbPath)) return thumbPath;

  const srcPath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(srcPath)) return null;

  try {
    await sharp(srcPath)
      .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(thumbPath);
    return thumbPath;
  } catch (err) {
    console.error('Thumbnail error:', err.message);
    return null;
  }
}

function getCommentValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, MAX_COMMENT_LENGTH);
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

function isValidDeviceId(value) {
  return UUID_PATTERN.test(String(value || '').trim());
}

function isAdminPasswordValid(password) {
  if (!ADMIN_PASSWORD || typeof password !== 'string') return false;
  const expected = createHash('sha256').update(ADMIN_PASSWORD).digest();
  const received = createHash('sha256').update(password).digest();
  return timingSafeEqual(expected, received);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'Admin-Passwort ist noch nicht gesetzt.' });
  }
  const password = req.get('X-Admin-Password') || req.body?.password || '';
  if (!isAdminPasswordValid(password)) {
    return res.status(401).json({ error: 'Falsches Admin-Passwort.' });
  }
  next();
}

function deletePhotoFiles(photo) {
  const filePath  = path.join(UPLOADS_DIR, photo.filename);
  const thumbPath = path.join(THUMBS_DIR, photo.filename + '.webp');
  fs.unlink(filePath, err => {
    if (err && err.code !== 'ENOENT') console.error('Datei konnte nicht gelöscht werden:', err.message);
  });
  fs.unlink(thumbPath, err => {
    if (err && err.code !== 'ENOENT') console.error('Thumbnail konnte nicht gelöscht werden:', err.message);
  });
}

// ─── Rate limiters ────────────────────────────────────────────────────────────
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 60,                     // max 60 uploads per window per IP
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

const fileLimiter = rateLimit({
  windowMs: 60 * 1000,         // 1 minute
  max: 200,                    // max 200 file requests per minute per IP
  message: 'Too many requests',
  standardHeaders: true,
  legacyHeaders: false
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/photos – list all
app.get('/', (_req, res) => {
  res.type('html').send(renderIndexHtml());
});

app.get('/api/photos', (_req, res) => {
  const photos = stmtAllActive.all();
  res.json(photos);
});

app.get('/api/admin/photos', adminLimiter, requireAdmin, (req, res) => {
  const scope = req.query.scope === 'archived' ? 'archived' : 'active';
  const photos = scope === 'archived'
    ? stmtAdminAllArchived.all()
    : stmtAdminAllActive.all();
  res.json(photos);
});

app.get('/api/config', (_req, res) => {
  res.json({
    maxFileMb: MAX_FILE_MB,
    maxCommentLength: MAX_COMMENT_LENGTH
  });
});

app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'Admin-Passwort ist noch nicht gesetzt.' });
  }
  if (!isAdminPasswordValid(req.body?.password || '')) {
    return res.status(401).json({ error: 'Falsches Admin-Passwort.' });
  }
  res.json({ success: true });
});

// POST /api/upload – upload a photo
app.post('/api/upload', uploadLimiter, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen.' });

  const deviceId = (req.body.device_id || '').trim();
  const comment = getCommentValue(req.body.comment);
  const uploaderMetadata = getUploaderMetadata(req.body.uploader_info, req);
  if (!isValidDeviceId(deviceId)) {
    // clean up
    fs.unlink(req.file.path, err => {
      if (err && err.code !== 'ENOENT') console.error('Upload-Datei konnte nicht bereinigt werden:', err.message);
    });
    return res.status(400).json({ error: 'Ungültige Geräte-ID. Bitte Seite neu laden und erneut versuchen.' });
  }

  const photo = {
    id:            uuidv4(),
    filename:      req.file.filename,
    original_name: req.file.originalname,
    device_id:     deviceId,
    comment,
    uploader_summary: uploaderMetadata.summary,
    uploader_info: uploaderMetadata.info,
    uploader_ip: uploaderMetadata.ip,
    size:          req.file.size
  };

  stmtInsert.run(photo);

  // generate thumb in background (don't block response)
  ensureThumb(photo.filename).catch(() => {});

  res.json({
    id:            photo.id,
    filename:      photo.filename,
    original_name: photo.original_name,
    comment:       photo.comment,
    size:          photo.size
  });
});

// DELETE /api/photos/:id – delete a photo
app.delete('/api/photos/:id', deleteLimiter, (req, res) => {
  const deviceId = (req.get('X-Device-Id') || '').trim();
  const photo    = stmtGetById.get(req.params.id);

  if (!photo) return res.status(404).json({ error: 'Foto nicht gefunden.' });

  const isOwner = photo.device_id === deviceId;
  const isAdmin = isAdminPasswordValid(req.get('X-Admin-Password') || '');

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: 'Nicht berechtigt.' });
  }

  deletePhotoFiles(photo);
  stmtDelete.run(photo.id);
  res.json({ success: true });
});

app.post('/api/admin/delete-selected', adminLimiter, requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.filter(id => typeof id === 'string' && id.trim())
    : [];

  if (!ids.length) {
    return res.status(400).json({ error: 'Keine Fotos ausgewählt.' });
  }

  let archived = 0;
  for (const id of ids) {
    const photo = stmtGetById.get(id);
    if (!photo || photo.archived_at) continue;
    stmtArchive.run(id);
    archived++;
  }

  res.json({ success: true, archived });
});

app.post('/api/admin/restore-selected', adminLimiter, requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.filter(id => typeof id === 'string' && id.trim())
    : [];

  if (!ids.length) {
    return res.status(400).json({ error: 'Keine Fotos ausgewählt.' });
  }

  let restored = 0;
  for (const id of ids) {
    const photo = stmtGetById.get(id);
    if (!photo || !photo.archived_at) continue;
    stmtRestore.run(id);
    restored++;
  }

  res.json({ success: true, restored });
});

app.post('/api/admin/delete-archived-selected', adminLimiter, requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.filter(id => typeof id === 'string' && id.trim())
    : [];

  if (!ids.length) {
    return res.status(400).json({ error: 'Keine Fotos ausgewählt.' });
  }

  let deleted = 0;
  for (const id of ids) {
    const photo = stmtGetById.get(id);
    if (!photo || !photo.archived_at) continue;
    deletePhotoFiles(photo);
    stmtDelete.run(id);
    deleted++;
  }

  res.json({ success: true, deleted });
});

// GET /uploads/:filename?thumb=1 – serve original or thumbnail
app.get('/uploads/:filename', fileLimiter, async (req, res) => {
  const filename = req.params.filename;

  // Security: prevent path traversal
  if (filename.includes('..') || filename.includes('/')) {
    return res.status(400).send('Bad request');
  }

  if (req.query.thumb === '1') {
    const thumb = await ensureThumb(filename);
    if (thumb) return res.sendFile(thumb);
    // fall through to original if thumb generation fails
  }

  const filePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `Datei zu groß. Maximum: ${MAX_FILE_MB} MB.` });
  }
  console.error(err);
  res.status(500).json({ error: err.message || 'Serverfehler' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, HOST, () => {
  console.log(`✨ Hochzeits-Galerie läuft auf http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') {
    const networkUrls = getNetworkUrls(PORT);
    if (networkUrls.length) {
      console.log('📱 Im lokalen WLAN erreichbar unter:');
      for (const url of networkUrls) {
        console.log(`   ${url}`);
      }
    }
  } else {
    console.log(`🌐 Netzwerk-Bindung: http://${HOST}:${PORT}`);
  }
  if (ADMIN_PASSWORD) console.log('🔐 Admin-Passwort ist gesetzt.');
  if (!ADMIN_PASSWORD) console.log('ℹ️ Admin-Bereich bleibt deaktiviert, bis ADMIN_PASSWORD gesetzt ist.');
});
