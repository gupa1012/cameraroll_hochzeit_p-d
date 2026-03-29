# 🎊 Hochzeits-Galerie – Hosting-Anleitung

Schritt-für-Schritt: Die Galerie live bringen – günstig, einfach, ohne Datenverlust.

---

## Option A: Hetzner VPS (empfohlen) 🏆

**Kosten:** ab €3,29/Monat | **Daten:** immer sicher | **Aufwand:** ~20 Min.

Hetzner ist ein deutsches Unternehmen (DSGVO-konform), super günstig und zuverlässig.
Alle Bilder liegen auf deinem Server und gehen nie verloren.

### Schnellster Weg: Einmal Skript ausführen

Wenn du es maximal einfach willst, nutze direkt das Setup-Skript aus diesem Repo.

Auf dem frischen Ubuntu-Server nur diese Befehle ausführen:

```bash
ssh root@<deine-ip>
git clone https://github.com/gupa1012/cameraroll_hochzeit_p-d /root/hochzeit-setup
cd /root/hochzeit-setup
chmod +x setup-server.sh
sudo ./setup-server.sh
```

Das Skript fragt dich Schritt fuer Schritt nach:

- Zielverzeichnis der App
- Port
- Domain
- optional `www`
- E-Mail fuer Let's Encrypt

Und erledigt dann automatisch:

- Systempakete installieren
- Node.js 22 installieren
- PM2 installieren
- Repo kopieren oder klonen
- `npm install`
- Nginx konfigurieren
- PM2-Start einrichten
- optional HTTPS per Certbot

Wenn du diesen Weg nutzt, kannst du die meisten manuellen Schritte weiter unten ueberspringen.

---

### 1. Server bestellen

1. Account anlegen auf [hetzner.com](https://www.hetzner.com/cloud)
2. **New Server** klicken
   - Location: **Nuremberg** oder **Falkenstein**
   - Image: **Ubuntu 24.04**
   - Type: **CX22** (2 vCPU, 4 GB RAM) – reicht locker aus
   - SSH-Key: einen neuen hinzufügen (oder Passwort aktivieren)
3. Server erstellen → IP-Adresse notieren

---

### 2. Domain (optional, aber schön)

Auf [namecheap.com](https://www.namecheap.com) oder direkt bei [Hetzner](https://www.hetzner.com/domainregistration) eine Domain kaufen (z. B. `eure-hochzeit.de`, ~€10/Jahr).

> **Wichtig:** Ersetze `eure-hochzeit.de` in allen folgenden Beispielen immer durch deine echte Domain.

DNS-Eintrag setzen:
```
A  @  →  <deine-hetzner-ip>
```

---

### 3. Server einrichten

Per SSH verbinden:
```bash
ssh root@<deine-ip>
```

Einfachster Weg:
```bash
git clone https://github.com/gupa1012/cameraroll_hochzeit_p-d /root/hochzeit-setup
cd /root/hochzeit-setup
chmod +x setup-server.sh
sudo ./setup-server.sh
```

Nur wenn du alles manuell machen willst, folgen die Einzelschritte darunter.

Node.js installieren:
```bash
# Script zuerst herunterladen und kurz prüfen, bevor du es ausführst
curl -fsSLo /tmp/nodesource_setup.sh https://deb.nodesource.com/setup_22.x
less /tmp/nodesource_setup.sh
# wenn NodeSource später Prüfsummen oder Signaturen bereitstellt, diese zusätzlich prüfen
bash /tmp/nodesource_setup.sh
apt-get install -y nodejs
```

PM2 (Prozess-Manager – App startet automatisch nach Reboot):
```bash
npm install -g pm2
```

Nginx (als Reverse-Proxy für HTTPS):
```bash
apt install -y nginx certbot python3-certbot-nginx
```

---

### 4. App hochladen

Auf deinem lokalen Computer (im Projekt-Ordner):
```bash
# Alle Dateien auf den Server kopieren (ohne node_modules)
scp -r . root@<deine-ip>:/var/www/hochzeit
```

Oder via Git (empfohlen):
```bash
# Auf dem Server:
git clone https://github.com/gupa1012/cameraroll_hochzeit_p-d /var/www/hochzeit
```

---

### 5. Dependencies installieren & App starten

Wenn du das Skript verwendet hast, ist dieser Schritt bereits erledigt.

```bash
cd /var/www/hochzeit
npm install
pm2 start server.js --name "hochzeit" -- 
pm2 save
pm2 startup   # zeigt einen Befehl an, den du ausführen musst
```

Admin-Passwort am besten mit `.env`-Datei setzen (damit es nicht in Shell-History oder Prozesslisten landet):
```bash
cat > /var/www/hochzeit/.env << 'EOF'
PORT=3000
ADMIN_PASSWORD=mein-geheimes-passwort-hier
EOF
```

Hinweis:
Aktuell ist in diesem Projekt das Admin-Passwort direkt in [server.js](server.js) fest hinterlegt. Wenn du fuer Hosting wieder auf `.env` umstellen willst, sollte das vor Livegang noch zurueckgebaut werden.

Dann `server.js` so starten:
```bash
pm2 start server.js --name "hochzeit"
```

---

### 6. Nginx konfigurieren

Wenn du das Skript verwendet hast, ist auch dieser Schritt bereits erledigt.

```bash
nano /etc/nginx/sites-available/hochzeit
```

Inhalt:
```nginx
server {
    listen 80;
    server_name eure-hochzeit.de www.eure-hochzeit.de;
    # Oder: server_name <deine-ip>;

    client_max_body_size 200M;   # max. Upload-Größe

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }
}
```

Aktivieren:
```bash
ln -s /etc/nginx/sites-available/hochzeit /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

---

### 7. HTTPS (SSL) einrichten

Wenn du im Skript Domain und E-Mail eingibst, versucht das Skript HTTPS direkt mit einzurichten.

```bash
certbot --nginx -d eure-hochzeit.de -d www.eure-hochzeit.de
```

Fertig! Die App ist jetzt unter `https://eure-hochzeit.de` erreichbar. 🎉

---

### 8. Backup einrichten (sehr wichtig!)

Automatisches tägliches Backup auf Hetzner Object Storage (€0,023/GB):

```bash
# Hetzner Object Storage Bucket anlegen (im Hetzner Cloud-Panel)
# dann rclone installieren:
apt install -y rclone
rclone config  # Schritt für Schritt folgen (S3-kompatibel, Hetzner Storage Box)
```

Einfacherer Weg: Automatisches Hetzner-Server-Backup aktivieren (€0,80/Monat extra):
→ Hetzner Cloud Panel → Server → Backups → aktivieren ✓

---

## Option B: Railway.app (noch einfacher, aber teurer) 🚂

**Kosten:** ab $5/Monat (mit Volume) | **Aufwand:** ~10 Min.

> ⚠️ **Wichtig:** Railway hat ephemeren Storage – **Volume** ist Pflicht, sonst gehen Bilder verloren!

1. [railway.app](https://railway.app) – Account mit GitHub verbinden
2. **New Project** → **Deploy from GitHub Repo** → Repo auswählen
3. Im Railway-Dashboard: **Add Volume** → Mountpoint: `/app/uploads`
4. Environment Variables setzen:
   ```
   PORT=3000
   ADMIN_PASSWORD=dein-geheimes-passwort
   DB_PATH=/app/uploads/database.sqlite
   ```
5. Deploy klicken – fertig!

---

## Option C: Render.com (kostenlose Alternative) 🎨

**Kosten:** kostenlos (mit Einschränkungen) | **Aufwand:** ~10 Min.

> ⚠️ Kostenloser Plan: Server schläft nach 15 Min. Inaktivität. Mit **Disk** (kostenpflichtig) für persistente Daten.

---

## Checkliste vor der Hochzeit ✅

- [ ] Server läuft: `pm2 status` zeigt `online`
- [ ] Website aufgerufen und ein Testfoto hochgeladen
- [ ] Testfoto wieder gelöscht
- [ ] HTTPS funktioniert (🔒 im Browser)
- [ ] Backup aktiviert
- [ ] URL an Gäste kommuniziert (z. B. QR-Code auf Tisch)
- [ ] `MAX_FILE_MB=100` gesetzt (oder nach Bedarf anpassen)

---

## QR-Code erstellen

```bash
# QR-Code als PNG generieren (online):
# https://qr.io oder https://www.qrcode-monkey.com
# URL eingeben → herunterladen → ausdrucken
```

---

## Häufige Fragen

**Ist das eine native Handy-App?**
Nein – bewusst nicht. Es ist eine mobile-optimierte Webapp, die direkt im Smartphone-Browser läuft und sich dadurch viel entspannter für alle Gäste öffnen lässt.

**Können Gäste ohne Login hochladen?**
Ja! Die App identifiziert Geräte über eine eindeutige ID im Browser. Kein Konto nötig.

**Was passiert, wenn ein Gast den Browser-Cache löscht?**
Die Geräte-ID geht verloren. Der Gast kann seine alten Fotos nicht mehr löschen, aber neue hochladen. Du als Admin (mit `ADMIN_PASSWORD`) kannst alle oder ausgewählte Fotos löschen.

**Wie groß darf das Upload-Limit sein?**
Standardmäßig 100 MB pro Bild. Kann mit `MAX_FILE_MB=200` angepasst werden.

**Kann ich alle Fotos als ZIP herunterladen?**
Ja, direkt vom Server: `zip -r fotos.zip /var/www/hochzeit/uploads/`

**Wie viel Speicher brauche ich?**
Für 100 Gäste à 5 Fotos à 10 MB = ~5 GB. Der CX22-Server hat 40 GB Disk – mehr als genug.
