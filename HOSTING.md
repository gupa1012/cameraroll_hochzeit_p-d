# Hochzeits-Galerie - Hosting auf Hetzner

Diese Datei ist ab jetzt nur noch die Arbeitsgrundlage fuer Hetzner-Server.
Andere Hoster, generische Alternativen und manuelle Einzelschritte sind bewusst entfernt.
Der Standardfall ist: frischer Hetzner-Server, Einrichtung ueber Copilot, danach Betrieb ueber denselben Ablauf.

Fuer den laufenden Betrieb nach dem Bootstrap gilt:

- SSH-, Deploy-, Backup- und Restore-Ablaufe stehen in `docs/ops.md`.
- Architektur- und Laufzeitfakten stehen in `docs/architecture.md` und `README.md`.

## Zielbild

- Hetzner Cloud VPS mit Ubuntu 24.04
- App unter `/var/www/hochzeit`
- Nginx als Reverse Proxy vor `127.0.0.1:3000`
- PM2-Service `pm2-hochzeit`
- Linux-App-User `hochzeit`
- SSH-Admin-User `patgs`
- Daten in `data/` und `storage/`
- Betreiber-Passwort in `/var/www/hochzeit/.env`

## Wichtige Vorgabe fuer Neuaufbau

Beim Neuaufsetzen fragt Copilot das Betreiber-Passwort immer aktiv ab.
Es wird bewusst nicht automatisch als lange Zufallszeichenfolge erzeugt.
Die App erwartet diesen Wert in `OPERATOR_PASSWORD`.

## Rebuild-Ablauf ueber Copilot

Copilot fuehrt den kompletten Serveraufbau direkt auf dem Hetzner-Server aus.
Die Standardreihenfolge ist:

1. SSH-Zugang mit vorhandenem Key herstellen.
2. Basispakete, Node.js 22, Nginx und PM2 installieren.
3. Repo nach `/var/www/hochzeit` bringen.
4. `.env` und `start-hochzeit.sh` schreiben.
5. App-User `hochzeit` anlegen und Besitzrechte setzen.
6. App mit PM2 als `hochzeit` starten.
7. Nginx als IP-Bootstrap auf Port 80 vorschalten.
8. SSH haerten, Updates einspielen, rebooten und validieren.

## Eingaben, die Copilot beim Rebuild einholen soll

- Server-IP
- SSH-Key-Pfad
- gewuenschtes `OPERATOR_PASSWORD`
- optional spaeter: Domain und Let's-Encrypt-E-Mail fuer HTTPS

## Verifizierter Hetzner-Stand

Der aktuell verifizierte Aufbau sieht so aus:

- App-Verzeichnis: `/var/www/hochzeit`
- App-User: `hochzeit`
- SSH-Admin: `patgs`
- PM2-Dienst: `pm2-hochzeit`
- Nginx-Serverblock: `default_server` auf Port 80
- Proxy-Ziel: `http://127.0.0.1:3000`
- `.env`: Modus `600`, Besitzer `hochzeit:hochzeit`
- `start-hochzeit.sh`: Modus `750`, Besitzer `hochzeit:hochzeit`
- Root-SSH deaktiviert
- Passwort-Login per SSH deaktiviert

## Erwartete Konfigurationsdateien auf dem Server

### `/var/www/hochzeit/.env`

Minimaler Stand fuer den IP-Bootstrap:

```env
PORT=3000
HOST=127.0.0.1
OPERATOR_PASSWORD=<vom-user-abgefragt>
UPLOAD_REQUEST_TIMEOUT_MS=0
EXPORT_SYNC_LABEL=Google Drive
```

Hinweise:

- `OPERATOR_PASSWORD` wird immer beim Neuaufbau vom Nutzer festgelegt.
- `MAX_FILE_MB` bleibt ungesetzt, wenn Originaldateien ohne Uploadlimit erlaubt sein sollen.
- `TRUST_PROXY=1` wird erst gesetzt, sobald der Reverse-Proxy dauerhaft finalisiert ist.

### `/var/www/hochzeit/start-hochzeit.sh`

Das Startskript laedt `.env` und startet danach die App:

```bash
#!/usr/bin/env bash
set -a
if [ -f "$(dirname "$0")/.env" ]; then
    . "$(dirname "$0")/.env"
fi
set +a
cd "$(dirname "$0")"
exec node server.js
```

### Nginx fuer den IP-Bootstrap

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 0;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_request_buffering off;
        proxy_connect_timeout 60s;
        proxy_send_timeout 900s;
        proxy_read_timeout 900s;
    }
}
```

## Was Copilot nach dem Rebuild prueft

- `http://<server-ip>/` liefert die App statt der Nginx-Default-Seite.
- `http://<server-ip>/api/health/live` liefert HTTP 200.
- `pm2-hochzeit` ist aktiviert und aktiv.
- Der Prozess laeuft als User `hochzeit`.
- `nginx` ist aktiv.
- `patgs` kann sich per Key anmelden.
- `root`-SSH ist gesperrt.

## HTTPS-Folgearbeit

Sobald eine Domain vorhanden ist, erweitert Copilot den Hetzner-Stand um:

- `server_name` mit echter Domain
- Certbot / Let's Encrypt
- `TRUST_PROXY=1` in `/var/www/hochzeit/.env`
- anschliessenden Neustart der App

Der verifizierte Live-Stand mit `ourbigday.space` und `www.ourbigday.space` ist inzwischen auf dem Server aktiv.
Das Zertifikat wurde direkt per Certbot auf dem Hetzner-Host ausgestellt und ist unter `/etc/letsencrypt/live/ourbigday.space/` hinterlegt.
Die Nginx-TLS-Konfiguration wurde auf `TLSv1.2` und `TLSv1.3` reduziert und `server_tokens` deaktiviert.
Zusätzlich ist UFW aktiv und erlaubt nur `22/tcp`, `80/tcp` und `443/tcp` von außen.

## Offene To-dos nach dem IP-Bootstrap

- [x] Domain auf die Server-IP zeigen lassen.
- [x] HTTPS mit Certbot aktivieren.
- [ ] `TRUST_PROXY=1` in `/var/www/hochzeit/.env` setzen.
- [ ] Firewall-Regeln bewusst setzen, z. B. nur `22`, `80` und `443` erlauben.
- [ ] Backup-Timer plus externes Ziel fuer `data/` und `storage/` aktivieren.
- [ ] Monitoring fuer `/api/health/live` und `/api/health` einrichten.

## Betrieb vor einer Hochzeit

Vor einem echten Event laesst Copilot mindestens diese Punkte gegen den Live-Server pruefen:

- Erreichbarkeit der Startseite
- erfolgreicher Testupload vom Handy
- Health-Endpunkte
- genug freier Speicherplatz
- Backups aktiv
- Lasttest mit mehreren parallelen Uploads

## Backup und Monitoring

Der Zielzustand fuer produktiven Betrieb auf Hetzner bleibt:

- Hetzner-Server-Backups aktiv
- zusaetzlicher Backup-Job fuer `data/` und `storage/`
- externes Monitoring fuer `/api/health/live` und `/api/health`
- optionaler Export-Sync per `rclone`

Die konkrete Ausfuehrung fuer Backup-Timer, Restore und SSH-Administration ist in `docs/ops.md` zusammengezogen, damit `HOSTING.md` nur noch den Bootstrap eines frischen Servers beschreibt.