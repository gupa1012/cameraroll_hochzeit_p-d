# System Overview

## Zielbild

Die Anwendung ist ein Multi-Space-System fuer private Event-Galerien.
Jede Feier bekommt einen eigenen geschlossenen Space mit getrenntem Gastzugang und eigenem Brautpaar-Bereich.

## Oberflaechen

### 1. Landingpage

- Pfad: `/`
- Zweck: Produkt erklaeren, Vertrauen aufbauen, Self-Service-Anlage eines neuen Spaces
- Hauptaktion: `Hochzeit anlegen`

### 2. Gast-Space

- Pfad: `/g/:publicId/:guestToken`
- Zweck: Gaeste laden Fotos hoch und sehen die Galerie
- Zugriff: nur ueber geheimen Link oder QR-Code

### 3. Betreiber-Backoffice

- Pfad: `/operator`
- Zweck: systemweite Verwaltung aller Spaces
- Zugriff: ueber `OPERATOR_PASSWORD`

## Sitemap

### Oeffentliche Seiten

- `/`
- `/operator`
- `/g/:publicId/:guestToken`

### Operator-API

- `POST /api/operator/login`
- `POST /api/operator/logout`
- `GET /api/operator/session`
- `GET /api/operator/spaces`
- `POST /api/operator/spaces`
- `POST /api/operator/spaces/:spaceId/status`
- `POST /api/operator/spaces/:spaceId/rotate-guest-link`
- `POST /api/operator/spaces/:spaceId/reset-admin-password`
- `GET /api/operator/spaces/:spaceId/photos`
- `GET /api/operator/spaces/:spaceId/uploads/:filename`

### Self-Service-API

- `POST /api/spaces`

### Gast-Space-API

- `GET /g/:publicId/:guestToken/api/config`
- `GET /g/:publicId/:guestToken/api/photos`
- `POST /g/:publicId/:guestToken/api/upload`
- `DELETE /g/:publicId/:guestToken/api/photos/:photoId`
- `GET /g/:publicId/:guestToken/uploads/:filename`

### Brautpaar-Bereich-API

- `POST /g/:publicId/:guestToken/api/admin/login`
- `POST /g/:publicId/:guestToken/api/admin/logout`
- `GET /g/:publicId/:guestToken/api/admin/session`
- `GET /g/:publicId/:guestToken/api/admin/photos`
- `POST /g/:publicId/:guestToken/api/admin/delete-selected`
- `POST /g/:publicId/:guestToken/api/admin/restore-selected`
- `POST /g/:publicId/:guestToken/api/admin/delete-archived-selected`

## High-Level Module

## Backend

### `server.js`

Zentrale Serverdatei mit folgenden Verantwortungen:

- Konfiguration von `PORT`, `HOST`, `DB_PATH`, `TRUST_PROXY`, `OPERATOR_PASSWORD`
- Initialisierung der SQLite-Datenbank
- Anlegen der Tabellen fuer Spaces, Fotos und Sessions
- Routing fuer Landingpage, Spaces und Backoffice
- Space-Provisionierung fuer Self-Service und Betreiber
- Session-Handling fuer Betreiber und Brautpaar-Bereich
- Upload-Verarbeitung mit `multer`
- Bildableitung fuer Thumbnails mit `sharp`
- Dateiauslieferung fuer Uploads und Thumbnails

## Frontend

### `public/index.html`

- Landingpage und Self-Service-Anlage
- Trust-Signale, FAQ, Success-State nach Space-Anlage

### `public/space.html`

- Upload-Zone fuer Gaeste
- Galerieansicht
- Brautpaar-Bereich fuer Moderation und Archiv

### `public/operator.html`

- Betreiber-Login
- Space-Uebersicht
- Space-Anlage, Statuswechsel, Link-Rotation, Passwort-Reset

### `public/app.css`

- Gemeinsame Gestaltung fuer Landingpage, Space und Backoffice

## Datenmodell

### `spaces`

- Stammdaten eines Spaces
- enthalt `display_name`, `owner_email`, `public_id`, `guest_token_hash`, `admin_password_hash`, `status`

### `photos`

- Metadaten der hochgeladenen Dateien
- enthaelt Dateiname, Kommentar, Device-ID, Uploader-Metadaten, Groesse und Archivstatus

### `space_admin_sessions`

- serverseitige Session fuer den Brautpaar-Bereich innerhalb eines Spaces

### `operator_sessions`

- serverseitige Session fuer das Betreiber-Backoffice

### `checkout_sessions`

- vorbereitet fuer spaeteren Stripe-Flow

## Lokale Speicherung im Entwicklungsbetrieb

Ja, die Datenbank ist lokal bereits aktiv.

### Datenbankpfad

- `data/platform.sqlite`

Die Datei wird lokal auf deinem Rechner im Projektordner verwendet und bei Bedarf automatisch erstellt.

### Dateispeicher

- Originale Uploads: `storage/spaces/<spaceId>/uploads/`
- Thumbnails: `storage/spaces/<spaceId>/thumbs/`

### Was lokal gespeichert wird

- Space-Stammdaten in SQLite
- Foto-Metadaten in SQLite
- Betreiber- und Brautpaar-Sessions in SQLite
- Bilddateien direkt im Dateisystem unter `storage/spaces/`

## Wichtige Abgrenzung zum alten Prototypen

Der aktuelle Multi-Space-MVP nutzt **nicht** mehr den alten Single-Space-Stand als Laufzeitbasis.

Alte Artefakte, die weiterhin im Repo liegen, aber fuer den neuen Laufzeitpfad nicht relevant sind:

- `database.sqlite`
- `uploads/`
- `archive/single-space-prototype/`

## Entwicklungsstatus

Bereits vorhanden:

- Self-Service-Anlage eines Spaces
- Geheime Gast-Links
- Betreiber-Backoffice
- Brautpaar-Bereich pro Space
- Lokaler Dateispeicher und lokale SQLite-Datenbank

Noch ausstehend:

- Stripe-Zahlung im Create-Flow
- Bestaetigungsmail
- QR-Code-Erzeugung nach Anlage
- weitere Hosting-Dokumentation fuer Produktion