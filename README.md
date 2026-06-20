# Wedding Camera Roll

Mehrere private Hochzeitsspaces ohne klassische Userverwaltung. Jeder Gast-Space ist nur über einen geheimen Link oder QR-Code erreichbar. Zusätzlich gibt es ein getrenntes Betreiber-Backoffice für systemweite Eingriffe.

## Dokumentation

- Produkt- und Laufzeitübersicht: `README.md`
- Architektur und Datenmodell: `docs/architecture.md`
- Betrieb, SSH, Deploy, Backup und Restore: `docs/ops.md`
- Hetzner-Bootstrap für frische Server: `HOSTING.md`
- Moderierte Nutzer-Tests: `docs/usertest-checkliste.md`

## Aktueller Stand

- Root `/` ist die neue Landingpage.
- Neue private Gast-Spaces laufen standardmäßig unter `/p/:publicId/:guestToken`.
- Alte `/g/:publicId/:guestToken`-Links bleiben kompatibel.
- Das Betreiber-Backoffice läuft unter `/operator`.
- Spaces koennen im aktuellen MVP direkt ueber die Landingpage angelegt werden.
- Unter `/demo` wird bei jedem Aufruf ein sofort nutzbarer Demo-Space erzeugt.
- Ein Gast kann beim Upload optional Namen und Kommentar mitgeben.
- HEIC und HEIF werden im Galeriepfad für Browser-kompatible Vorschauen aufbereitet, Originaldateien bleiben unverändert.
- Stripe Checkout, Bestätigungsmail und transaktionale Kommunikation folgen später.

## Starten

1. `npm install`
2. `OPERATOR_PASSWORD=<dein-passwort> npm start`
3. Root unter `http://localhost:3000` öffnen
4. Auf der Landingpage einen Space anlegen oder unter `/demo` direkt ausprobieren
5. Optional unter `/operator` ins Betreiber-Backoffice gehen

## Wichtige Umgebungsvariablen

- `OPERATOR_PASSWORD` ist erforderlich und schützt `/operator`.
- `PORT` setzt den HTTP-Port, Standard ist `3000`.
- `HOST` setzt die Bind-Adresse, Standard ist `0.0.0.0`.
- `DB_PATH` überschreibt den Standardpfad der SQLite-Datei.
- `DATA_DIR` und `STORAGE_DIR` überschreiben die Standard-Laufzeitverzeichnisse.
- Ohne `MAX_FILE_MB` werden Originaldateien ohne serverseitiges Upload-Limit gespeichert.
- `MAX_FILE_MB=100` setzt bewusst wieder ein Upload-Limit pro Datei.
- `UPLOAD_REQUEST_TIMEOUT_MS=0` deaktiviert das Browser-Zeitlimit für große Uploads.
- `TRUST_PROXY=1` ist für finalen Betrieb hinter Nginx oder einem anderen Reverse Proxy gedacht.
- `RCLONE_REMOTE=<remote>:<ziel>` aktiviert den Cloud-Sync für ZIP-Exporte aus dem Brautpaar-Bereich.
- `RCLONE_EXPORT_PREFIX=wedding-camera-roll` setzt den Zielpräfix für Export-Sync.
- `EXPORT_SYNC_LABEL=Google Drive` benennt den Sync-Button im Brautpaar-Bereich um.
- `DEMO_SPACE_NAME` und `DEMO_OWNER_EMAIL` steuern die Demo-Space-Werte für `/demo`.
- Rate limits sind über `UPLOAD_LIMITER_MAX`, `DELETE_LIMITER_MAX`, `ADMIN_LIMITER_MAX`, `ADMIN_LOGIN_LIMITER_MAX`, `OPERATOR_LOGIN_LIMITER_MAX`, `OPERATOR_MUTATION_LIMITER_MAX`, `FILE_LIMITER_MAX` und `GUEST_ROUTE_LIMITER_MAX` überschreibbar.

## Oberflächen und Routen

Öffentliche und systemweite Einstiegspunkte:

- `/`
- `/demo`
- `/operator`
- `GET /api/health/live`
- `GET /api/health`

Self-serve und Operator:

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

Gast-Space unter `/p/:publicId/:guestToken` und kompatibel unter `/g/:publicId/:guestToken`:

- `GET /`
- `GET /api/config`
- `GET /api/photos`
- `GET /api/guest-access`
- `POST /api/upload`
- `DELETE /api/photos/:photoId`
- `GET /uploads/:filename`

Brautpaar-Bereich innerhalb eines Gast-Spaces:

- `GET /api/admin/session`
- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/photos`
- `GET /api/admin/guest-access`
- `GET /api/admin/qr-print`
- `GET /api/admin/export.zip`
- `POST /api/admin/export-sync`
- `POST /api/admin/delete-selected`
- `POST /api/admin/restore-selected`
- `POST /api/admin/delete-archived-selected`

## Laufzeitverhalten

- Originaldateien werden unverändert gespeichert.
- Gallery-Thumbnails werden separat als WebP erzeugt.
- Thumbnails respektieren EXIF-Orientierung und werden automatisch korrekt gedreht.
- Für HEIC und HEIF erzeugt der Server browserfreundliche Vorschauen aus den Originaldateien.
- Gast-Uploads speichern Geräte-ID, optionalen Namen, optionalen Kommentar und technische Upload-Metadaten.
- Gäste erkennen eigene Uploads über die Geräte-ID wieder.
- Archivieren ist ein Soft-Delete über `archived_at`; endgültiges Löschen entfernt Dateien erst aus dem Archiv heraus.
- Demo-Spaces werden bei jedem Aufruf von `/demo` neu erzeugt.
- Operator- und Space-Admin-Sessions laufen serverseitig mit einer TTL von 7 Tagen.

- `GET /api/health/live` liefert einen einfachen Liveness-Check
- `GET /api/health` prüft Datenbank sowie Schreibrechte auf den Laufzeitverzeichnissen
- Im Brautpaar-Bereich gibt es QR-Neuladen, Papeterie-Druckvorlage, ZIP-Export und optionalen Cloud-Sync

## Standardpfade des aktiven Multi-Space-MVP

- Datenbank: `data/platform.sqlite`
- Bilder und Thumbnails: `storage/spaces/<spaceId>/...`

## Brautpaar-Bereich

- Das Passwort wird beim Anlegen des Spaces direkt selbst festgelegt.
- Der private Link für Gäste und der QR-Code lassen sich jederzeit im Space erneut laden.
- ZIP-Export steht nur im Brautpaar-Bereich zur Verfügung.
- Optionaler Export-Sync erscheint nur, wenn `RCLONE_REMOTE` gesetzt ist.

Lasttest:

```bash
npm run loadtest -- --baseUrl http://localhost:3000 --uploads 40 --concurrency 8
```

Backup und Sync:

```bash
sudo bash ops/install-backup-timer.sh
```

Danach `/etc/default/wedding-camera-roll-backup` mit dem eigenen rclone-Remote fuellen und testweise den Service starten.

Restore-, SSH- und Deploy-Abläufe stehen gesammelt in `docs/ops.md`.

## Sicherheitsmodell

- Gastzugriffe nutzen lange zufällige Tokens statt erratbarer Slugs.
- Es gibt keine öffentliche Space-Liste und keine fortlaufenden IDs im Gastzugang.
- Geheime Space-Seiten senden `noindex`-Header.
- Space-Admins erhalten eigene Sessions pro Space.
- Das Betreiber-Backoffice ist getrennt und durch `OPERATOR_PASSWORD` geschützt.

## Weiterentwicklungsmöglichkeiten

- E-Mail-Versand beim Anlegen eines Spaces, zum Beispiel mit Link und Zugangsdaten an das Brautpaar.
- Sinnvolle Kandidaten dafür sind ein kleiner SMTP- oder Mail-API-Dienst wie Brevo, Resend oder Amazon SES.
- Für Produktion sollten dann SPF, DKIM und DMARC für `ourbigday.space` sauber gesetzt werden.
- Das kann später ergänzt werden, wenn der feste Versand-Flow wirklich gebraucht wird.

## Historischer Archivstand

Der bisherige Single-Space-Prototyp liegt archiviert unter `archive/single-space-prototype/`.
Er dient nur als Referenz und ist nicht Teil des aktiven Laufzeitpfads.
