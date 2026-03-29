'use strict';

const express = require('express');
const multer  = require('multer');
const { DatabaseSync } = require('node:sqlite');
const { timingSafeEqual } = require('node:crypto');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const sharp   = require('sharp');
const rateLimit = require('express-rate-limit');

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT        = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const THUMBS_DIR  = path.join(__dirname, 'uploads', '_thumbs');
const DB_PATH     = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.ADMIN_KEY || '';
const MAX_FILE_MB = parseInt(process.env.MAX_FILE_MB || '100', 10);
const MAX_COMMENT_LENGTH = 500;

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
    uploaded_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    size         INTEGER
  );
`);

const photoColumns = db.prepare(`PRAGMA table_info(photos)`).all();
if (!photoColumns.some(column => column.name === 'comment')) {
  db.exec(`ALTER TABLE photos ADD COLUMN comment TEXT DEFAULT ''`);
}

const stmtInsert  = db.prepare(`INSERT INTO photos (id, filename, original_name, device_id, comment, size)
                                VALUES (:id, :filename, :original_name, :device_id, :comment, :size)`);
const stmtAll     = db.prepare(`SELECT id, filename, original_name, comment, uploaded_at, size FROM photos ORDER BY uploaded_at DESC`);
const stmtAllFull = db.prepare(`SELECT * FROM photos ORDER BY uploaded_at DESC`);
const stmtGetById = db.prepare(`SELECT * FROM photos WHERE id = ?`);
const stmtDelete  = db.prepare(`DELETE FROM photos WHERE id = ?`);

// ─── Express ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
  return String(value || '').trim().slice(0, MAX_COMMENT_LENGTH);
}

function isAdminPasswordValid(password) {
  if (!ADMIN_PASSWORD || typeof password !== 'string') return false;
  const expected = Buffer.from(ADMIN_PASSWORD);
  const received = Buffer.from(password);
  if (expected.length !== received.length) return false;
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
  fs.unlink(filePath,  () => {});
  fs.unlink(thumbPath, () => {});
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
app.get('/api/photos', (_req, res) => {
  const photos = stmtAll.all();
  res.json(photos);
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
  if (!deviceId || deviceId.length < 8) {
    // clean up
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Ungültige Geräte-ID.' });
  }

  const photo = {
    id:            uuidv4(),
    filename:      req.file.filename,
    original_name: req.file.originalname,
    device_id:     deviceId,
    comment,
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

  let deleted = 0;
  for (const id of ids) {
    const photo = stmtGetById.get(id);
    if (!photo) continue;
    deletePhotoFiles(photo);
    stmtDelete.run(id);
    deleted++;
  }

  res.json({ success: true, deleted });
});

app.delete('/api/admin/delete-all', adminLimiter, requireAdmin, (_req, res) => {
  const photos = stmtAllFull.all();
  for (const photo of photos) {
    deletePhotoFiles(photo);
    stmtDelete.run(photo.id);
  }
  res.json({ success: true, deleted: photos.length });
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
app.listen(PORT, () => {
  console.log(`✨ Hochzeits-Galerie läuft auf http://localhost:${PORT}`);
  if (ADMIN_PASSWORD) console.log('🔐 Admin-Passwort ist gesetzt.');
});
