# Wedding Camera Roll

Mehrere private Hochzeitsspaces ohne klassische Userverwaltung. Jeder Gast-Space ist nur über einen geheimen Link oder QR-Code erreichbar. Zusätzlich gibt es ein getrenntes Betreiber-Backoffice für systemweite Eingriffe.

## Aktueller Stand

- Root `/` ist die neue Landingpage.
- Geheime Gast-Spaces laufen unter `/g/:publicId/:guestToken`.
- Das Betreiber-Backoffice läuft unter `/operator`.
- Spaces koennen im aktuellen MVP direkt ueber die Landingpage angelegt werden.
- Stripe Checkout, Bestätigungsmail und QR-Code-Provisionierung folgen im nächsten Ausbau.

## Starten

1. `npm install`
2. `OPERATOR_PASSWORD=<dein-passwort> npm start`
3. Root unter `http://localhost:3000` öffnen
4. Auf der Landingpage einen Space anlegen
5. Optional unter `/operator` ins Betreiber-Backoffice gehen

Optional:

- `MAX_FILE_MB=100` setzt das Upload-Limit
- `DB_PATH=/pfad/zur/db.sqlite` überschreibt den Standardpfad
- `TRUST_PROXY=1` für Betrieb hinter genau einem Reverse Proxy wie Nginx

Standardpfade des neuen MVP:

- Datenbank: `data/platform.sqlite`
- Bilder und Thumbnails: `storage/spaces/<spaceId>/...`

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
