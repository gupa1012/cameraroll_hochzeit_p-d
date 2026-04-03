# Wedding Camera Roll

Mehrere private Hochzeitsspaces ohne klassische Userverwaltung. Jeder Gast-Space ist nur über einen geheimen Link oder QR-Code erreichbar. Zusätzlich gibt es ein getrenntes Betreiber-Backoffice für systemweite Eingriffe.

## Aktueller Stand

- Root `/` ist die neue Landingpage.
- Neue private Gast-Spaces laufen standardmäßig unter `/p/:publicId/:guestToken`.
- Alte `/g/:publicId/:guestToken`-Links bleiben kompatibel.
- Das Betreiber-Backoffice läuft unter `/operator`.
- Spaces koennen im aktuellen MVP direkt ueber die Landingpage angelegt werden.
- Unter `/demo` wird bei jedem Aufruf ein sofort nutzbarer Demo-Space erzeugt.
- Stripe Checkout, Bestätigungsmail und QR-Code-Provisionierung folgen im nächsten Ausbau.

## Starten

1. `npm install`
2. `OPERATOR_PASSWORD=<dein-passwort> npm start`
3. Root unter `http://localhost:3000` öffnen
4. Auf der Landingpage einen Space anlegen oder unter `/demo` direkt ausprobieren
5. Optional unter `/operator` ins Betreiber-Backoffice gehen

Optional:

- Ohne `MAX_FILE_MB` werden Originaldateien ohne serverseitiges Upload-Limit gespeichert
- `MAX_FILE_MB=100` setzt bewusst wieder ein Upload-Limit
- `DB_PATH=/pfad/zur/db.sqlite` überschreibt den Standardpfad
- `DATA_DIR=/pfad/zum/data-verzeichnis` und `STORAGE_DIR=/pfad/zum/storage-verzeichnis` überschreiben die Standardpfade
- `UPLOAD_REQUEST_TIMEOUT_MS=0` deaktiviert das Browser-Zeitlimit fuer grosse Uploads
- `RCLONE_REMOTE=<remote>:<ziel>` aktiviert den Cloud-Sync fuer ZIP-Exporte aus dem Brautpaar-Bereich
- `EXPORT_SYNC_LABEL=Google Drive` benennt den Sync-Button im Brautpaar-Bereich um
- `TRUST_PROXY=1` für Betrieb hinter genau einem Reverse Proxy wie Nginx

Monitoring:

- `GET /api/health/live` liefert einen einfachen Liveness-Check
- `GET /api/health` prüft Datenbank sowie Schreibrechte auf den Laufzeitverzeichnissen
- Im Brautpaar-Bereich gibt es QR-Neuladen, Papeterie-Druckvorlage, ZIP-Export und optionalen Cloud-Sync

Standardpfade des neuen MVP:

- Datenbank: `data/platform.sqlite`
- Bilder und Thumbnails: `storage/spaces/<spaceId>/...`

Upload-Verhalten:

- Originaldateien werden unverändert gespeichert.
- Nur Vorschaubilder werden separat als WebP-Thumbnails erzeugt.

Brautpaar-Bereich:

- Das Passwort wird beim Anlegen des Spaces direkt selbst festgelegt.
- Der private Link fuer Gaeste und der QR-Code lassen sich jederzeit im Space erneut laden.
- ZIP-Export steht nur im Brautpaar-Bereich zur Verfügung.

Lasttest:

```bash
npm run loadtest -- --baseUrl http://localhost:3000 --uploads 40 --concurrency 8
```

Backup und Sync:

```bash
sudo bash ops/install-backup-timer.sh
```

Danach `/etc/default/wedding-camera-roll-backup` mit dem eigenen rclone-Remote fuellen und testweise den Service starten.

## Sicherheitsmodell

- Gastzugriffe nutzen lange zufällige Tokens statt erratbarer Slugs.
- Es gibt keine öffentliche Space-Liste und keine fortlaufenden IDs im Gastzugang.
- Geheime Space-Seiten senden `noindex`-Header.
- Space-Admins erhalten eigene Sessions pro Space.
- Das Betreiber-Backoffice ist getrennt und durch `OPERATOR_PASSWORD` geschützt.

## Fallback des alten Prototyps

Der bisherige Single-Space-Prototyp liegt archiviert unter `archive/single-space-prototype/`.

Zusätzliche Doku:

- `docs/prototype-fallback.md`
- `docs/mvp-architecture.md`
- `docs/system-overview.md`

Damit bleibt ein klarer Rückfallstand im Repo erhalten, während die neue Plattform schrittweise ausgebaut wird.
