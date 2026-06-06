# Architecture

## Scope

This repository contains the active multi-space Wedding Camera Roll runtime.
The archived single-space prototype under `archive/single-space-prototype/` is retained only as historical reference and is not part of the current runtime path.

## Product Surfaces

### Landing page

- Path: `/`
- Purpose: product presentation and self-serve space creation
- Additional shortcut: `/demo` creates a ready-to-use demo space and redirects directly into it

### Guest space

- Primary path: `/p/:publicId/:guestToken`
- Legacy-compatible path: `/g/:publicId/:guestToken`
- Purpose: guest uploads, gallery, guest share link, QR access
- Access model: no account, only possession of the long secret guest token

### Space admin area

- Lives inside each guest space under `/api/admin/...`
- Purpose: gallery moderation, archive/restore/delete, guest access tools, ZIP export, optional export sync
- Access model: per-space password with server-side session cookie

### Operator backoffice

- Path: `/operator`
- Purpose: cross-space administration
- Access model: `OPERATOR_PASSWORD` with separate server-side session cookie

## Security Model

- There is no public space directory.
- Guest access relies on long random tokens instead of readable slugs.
- Images and thumbnails are served only through the secret guest-space route or operator-authenticated routes.
- Secret pages send `X-Robots-Tag: noindex, nofollow, noarchive`.
- Space admin sessions and operator sessions are isolated from each other.
- Operator password reset for a space invalidates the previous admin password immediately.

## Roles

### Guest

- Can open exactly one known guest space
- Can upload photos with optional comment and optional uploader name
- Can delete own uploads using the device identifier recorded on upload
- Has no global account and no cross-space visibility

### Space admin

- Logs into a single space with the password defined at creation time or later reset by the operator
- Can inspect active and archived photos for that space
- Can archive, restore, and permanently delete archived photos
- Can load guest share URL, QR code, print view, ZIP export, and optional export sync

### Operator

- Logs into `/operator` with `OPERATOR_PASSWORD`
- Can create spaces, suspend/reactivate spaces, rotate guest links, reset admin passwords, and inspect uploads across spaces

## Runtime Components

### `server.js`

Owns the complete runtime:

- Express app and route registration
- SQLite schema initialization and prepared statements
- Session management for operator and space admins
- Space provisioning for self-serve, operator-created, and demo spaces
- Upload handling via `multer`
- Image processing via `sharp` and `heic-convert`
- ZIP export and optional `rclone` export sync
- Health checks and static page delivery

### `lib/gallery-core.js`

Owns shared core logic:

- environment parsing and defaults
- validation helpers for email, passwords, device IDs, and tokens
- upload metadata parsing
- rate-limit default definitions
- common formatting and hashing helpers

### Frontend templates

- `public/index.html`: landing page and self-serve creation flow
- `public/space.html`: guest upload UI, gallery, and embedded space-admin UI
- `public/operator.html`: operator login and multi-space management UI
- `public/app.css`: shared visual system

## Key Routes

### Public and monitoring

- `GET /`
- `GET /demo`
- `GET /operator`
- `GET /api/health/live`
- `GET /api/health`

### Self-serve and operator

- `POST /api/spaces`
- `GET /api/operator/session`
- `POST /api/operator/login`
- `POST /api/operator/logout`
- `GET /api/operator/spaces`
- `GET /api/operator/spaces/:spaceId/photos`
- `GET /api/operator/spaces/:spaceId/uploads/:filename`
- `POST /api/operator/spaces`
- `POST /api/operator/spaces/:spaceId/status`
- `POST /api/operator/spaces/:spaceId/rotate-guest-link`
- `POST /api/operator/spaces/:spaceId/reset-admin-password`

### Guest space

- `GET /p/:publicId/:guestToken/`
- `GET /p/:publicId/:guestToken/api/config`
- `GET /p/:publicId/:guestToken/api/photos`
- `GET /p/:publicId/:guestToken/api/guest-access`
- `POST /p/:publicId/:guestToken/api/upload`
- `DELETE /p/:publicId/:guestToken/api/photos/:photoId`
- `GET /p/:publicId/:guestToken/uploads/:filename`

The same guest-space routes are also mounted under `/g/:publicId/:guestToken/...` for legacy links.

### Space admin

- `GET /p/:publicId/:guestToken/api/admin/session`
- `POST /p/:publicId/:guestToken/api/admin/login`
- `POST /p/:publicId/:guestToken/api/admin/logout`
- `GET /p/:publicId/:guestToken/api/admin/photos`
- `GET /p/:publicId/:guestToken/api/admin/guest-access`
- `GET /p/:publicId/:guestToken/api/admin/qr-print`
- `GET /p/:publicId/:guestToken/api/admin/export.zip`
- `POST /p/:publicId/:guestToken/api/admin/export-sync`
- `POST /p/:publicId/:guestToken/api/admin/delete-selected`
- `POST /p/:publicId/:guestToken/api/admin/restore-selected`
- `POST /p/:publicId/:guestToken/api/admin/delete-archived-selected`

## Data Model

### `spaces`

Stores per-space identity and access state:

- `id`
- `public_id`
- `display_name`
- `owner_email`
- `status`
- `guest_token_hash`
- `admin_password_hash`
- `provision_source`
- `created_at`
- lifecycle timestamps such as `paid_at` and `suspended_at`

### `photos`

Stores file and moderation metadata:

- `id`
- `space_id`
- `filename`
- `original_name`
- `device_id`
- `comment`
- `uploader_summary`
- `uploader_info`
- `uploader_ip`
- `size`
- `uploaded_at`
- `archived_at`

Important behavior:

- archive is a soft-delete marker via `archived_at`
- originals remain on disk until explicitly deleted
- device ID drives the "own upload" behavior for guests

### Session tables

- `space_admin_sessions`: per-space admin sessions
- `operator_sessions`: operator backoffice sessions
- `checkout_sessions`: reserved for later payment integration

Session TTL is currently 7 days.

## Storage Layout

### Database and runtime files

- SQLite database: `data/platform.sqlite`
- export artifacts: `data/exports/`

### Per-space file storage

- originals: `storage/spaces/<spaceId>/uploads/`
- thumbnails and derived previews: `storage/spaces/<spaceId>/thumbs/`

## Upload and Image Pipeline

### Original uploads

- Originals are stored unchanged.
- Allowed client-side selection includes JPEG, PNG, GIF, WebP, AVIF, HEIC, and HEIF.
- The active upload metadata contains device identifier, optional comment, optional uploader name, browser info, and uploader IP.

### Derived images

- Gallery thumbnails are generated as WebP.
- Thumbnails are limited to 600x600 with `fit: inside` and no enlargement.
- EXIF orientation is respected through automatic rotation before thumbnail generation.
- HEIC and HEIF originals are converted through `heic-convert` into a browser-friendly pipeline before derived previews are generated.
- Browser preview files for HEIC and HEIF are generated as JPEG up to 2200x2200.

## Space Lifecycle

### Provision sources

Spaces can currently be created as:

- self-serve via the landing page
- operator-created via `/operator`
- demo spaces via `/demo`

### Statuses

- `active`
- `suspended`

A suspended space remains in the system but guest access should be treated as disabled by the runtime.

## Health and Readiness

- `GET /api/health/live` is the minimal liveness check.
- `GET /api/health` verifies database access and write access for the runtime directories.

## Archive Boundary

The old single-space prototype is intentionally preserved only under `archive/single-space-prototype/`.
Do not treat files such as legacy `uploads/` or `database.sqlite` at the repo root as part of the active multi-space architecture.
