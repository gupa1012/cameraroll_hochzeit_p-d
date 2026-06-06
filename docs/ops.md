# Operations

## Purpose

This document is the day-2 operations reference for administering the Hetzner-hosted server over SSH from a local machine.
Bootstrap steps for a fresh machine stay in `HOSTING.md`.
This file covers deploy, verification, backup, restore, and routine administration.

## Server Model

Verified target layout:

- app root: `/var/www/hochzeit`
- app user: `hochzeit`
- SSH admin user: `patgs`
- process manager: PM2 user service `pm2-hochzeit`
- reverse proxy: Nginx forwarding to `127.0.0.1:3000`
- runtime data: `/var/www/hochzeit/data` and `/var/www/hochzeit/storage`

## SSH Access

### Assumptions

- SSH key login is enabled for `patgs`
- root SSH login is disabled
- password login is disabled
- `patgs` has sudo rights

### Connect from a local machine

```bash
ssh patgs@<server-ip>
```

If you use a specific key:

```bash
ssh -i ~/.ssh/<keyfile> patgs@<server-ip>
```

### Basic verification after login

```bash
hostname
whoami
pwd
systemctl is-active nginx
sudo -u hochzeit -H pm2 status
curl -fsS http://127.0.0.1:3000/api/health/live
curl -fsS http://127.0.0.1:3000/api/health
```

## Routine App Administration

### Process status

```bash
sudo -u hochzeit -H pm2 status
sudo -u hochzeit -H pm2 logs hochzeit --lines 100
sudo -u hochzeit -H pm2 restart hochzeit
sudo -u hochzeit -H pm2 save
```

### Nginx status

```bash
sudo systemctl status nginx
sudo nginx -t
sudo systemctl reload nginx
```

### Inspect runtime files

```bash
sudo ls -la /var/www/hochzeit
sudo ls -la /var/www/hochzeit/data
sudo ls -la /var/www/hochzeit/storage
sudo du -sh /var/www/hochzeit/data /var/www/hochzeit/storage
```

### Inspect environment and start script

```bash
sudo ls -l /var/www/hochzeit/.env /var/www/hochzeit/start-hochzeit.sh
sudo sed -n '1,120p' /var/www/hochzeit/start-hochzeit.sh
```

Do not print secrets from `.env` into shared logs unless necessary.

## Deploy from This Repository over SSH

### Recommended deploy shape

The fast path is direct copy from the local repo to the Hetzner server, followed by dependency install and PM2 restart.
Because `/var/www/hochzeit` is owned by `hochzeit`, use `patgs` with `sudo` for write operations.

### Option A: `rsync` deploy

From the local repo root:

```bash
rsync -avz \
  --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude data \
  --exclude storage \
  . patgs@<server-ip>:/tmp/hochzeit-deploy/
```

Then on the server:

```bash
ssh patgs@<server-ip> '
  sudo mkdir -p /var/www/hochzeit &&
  sudo rsync -a --delete --exclude data --exclude storage /tmp/hochzeit-deploy/ /var/www/hochzeit/ &&
  sudo chown -R hochzeit:hochzeit /var/www/hochzeit &&
  cd /var/www/hochzeit &&
  sudo -u hochzeit -H npm install --omit=dev &&
  sudo -u hochzeit -H pm2 restart hochzeit
'
```

### Option B: one-off file changes

```bash
scp README.md patgs@<server-ip>:/tmp/
ssh patgs@<server-ip> 'sudo mv /tmp/README.md /var/www/hochzeit/README.md && sudo chown hochzeit:hochzeit /var/www/hochzeit/README.md'
```

### Post-deploy validation

```bash
ssh patgs@<server-ip> '
  cd /var/www/hochzeit &&
  sudo -u hochzeit -H pm2 status &&
  curl -fsS http://127.0.0.1:3000/api/health/live &&
  curl -fsS http://127.0.0.1:3000/api/health
'
```

Also confirm externally:

- `http://<server-ip>/`
- `http://<server-ip>/api/health/live`

## Backup Setup

The repository already contains the backup scripts:

- `ops/backup-rclone.sh`
- `ops/install-backup-timer.sh`
- `ops/backup-rclone.env.example`

### Install the systemd timer on the server

```bash
cd /var/www/hochzeit
sudo bash ops/install-backup-timer.sh
```

This installs:

- `/usr/local/bin/wedding-camera-roll-backup`
- `/etc/default/wedding-camera-roll-backup`
- `wedding-camera-roll-backup.service`
- `wedding-camera-roll-backup.timer`

### Configure backup environment

Edit:

- `/etc/default/wedding-camera-roll-backup`

Expected values:

- `APP_ROOT=/var/www/hochzeit`
- `DATA_DIR=/var/www/hochzeit/data`
- `STORAGE_DIR=/var/www/hochzeit/storage`
- `EXPORTS_DIR=/var/www/hochzeit/data/exports`
- `RCLONE_REMOTE=<configured-remote>:<bucket-or-path>`
- `RCLONE_PREFIX=wedding-camera-roll`

### Test backup manually

```bash
sudo systemctl start wedding-camera-roll-backup.service
sudo systemctl status wedding-camera-roll-backup.service
sudo systemctl status wedding-camera-roll-backup.timer
journalctl -u wedding-camera-roll-backup.service -n 100 --no-pager
```

## Backup Behavior

`ops/backup-rclone.sh` currently does the following:

- writes a backup manifest JSON with timestamp and disk-free info
- syncs `data/` into `latest/data`
- syncs `storage/` into `latest/storage`
- syncs `data/exports/` into `latest/exports` if present
- writes changed or deleted previous files into `history/<timestamp>/...`
- excludes SQLite WAL and SHM sidecar files from backup copies

This means the backup target contains:

- a current mirror under `latest/`
- point-in-time history under `history/<timestamp>/`

## Restore Procedure

There was no formal restore runbook before; use this one.

### Restore to a fresh directory first

Never restore directly into the live app paths before inspecting the downloaded files.

```bash
mkdir -p /tmp/hochzeit-restore
rclone copy <remote>:wedding-camera-roll/latest/data /tmp/hochzeit-restore/data
rclone copy <remote>:wedding-camera-roll/latest/storage /tmp/hochzeit-restore/storage
```

If exports are needed:

```bash
rclone copy <remote>:wedding-camera-roll/latest/exports /tmp/hochzeit-restore/exports
```

### Stop the app before live restore

```bash
ssh patgs@<server-ip> 'sudo -u hochzeit -H pm2 stop hochzeit'
```

### Restore onto the live server

```bash
ssh patgs@<server-ip> '
  sudo rsync -a /tmp/hochzeit-restore/data/ /var/www/hochzeit/data/ &&
  sudo rsync -a /tmp/hochzeit-restore/storage/ /var/www/hochzeit/storage/ &&
  sudo chown -R hochzeit:hochzeit /var/www/hochzeit/data /var/www/hochzeit/storage &&
  sudo -u hochzeit -H pm2 start hochzeit
'
```

### Validate after restore

```bash
ssh patgs@<server-ip> '
  sudo -u hochzeit -H pm2 status &&
  curl -fsS http://127.0.0.1:3000/api/health/live &&
  curl -fsS http://127.0.0.1:3000/api/health
'
```

Then verify through the browser that:

- the landing page loads
- an existing guest space opens
- uploads and thumbnails still work

## Health Checks and Monitoring

### Endpoints

- `GET /api/health/live`: minimal liveness
- `GET /api/health`: readiness with database and writable-directory checks

### Manual checks

```bash
curl -i http://127.0.0.1:3000/api/health/live
curl -i http://127.0.0.1:3000/api/health
curl -i http://<server-ip>/api/health/live
curl -i http://<server-ip>/api/health
```

### What to monitor externally

- HTTP 200 on `/api/health/live`
- HTTP 200 on `/api/health`
- remaining disk space on `/var/www/hochzeit`
- PM2 process state
- Nginx process state
- success of `wedding-camera-roll-backup.service`

## Useful Incident Commands

### Disk pressure

```bash
df -h
sudo du -sh /var/www/hochzeit/*
sudo du -sh /var/www/hochzeit/storage/spaces/* | sort -h
```

### SQLite presence

```bash
sudo ls -lh /var/www/hochzeit/data/platform.sqlite*
```

### Restart full web stack

```bash
sudo -u hochzeit -H pm2 restart hochzeit
sudo systemctl restart nginx
```

## Production Checklist before a Real Event

- landing page reachable externally
- guest upload tested from a phone on mobile data
- `/api/health/live` and `/api/health` return 200
- enough free disk for expected upload volume
- backup timer enabled and a test run completed successfully
- operator login verified
- space admin login verified
- ZIP export verified
- optional export sync verified if `RCLONE_REMOTE` is configured
