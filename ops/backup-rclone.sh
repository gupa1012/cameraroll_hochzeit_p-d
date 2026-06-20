#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/var/www/hochzeit}"
DATA_DIR="${DATA_DIR:-$APP_ROOT/data}"
STORAGE_DIR="${STORAGE_DIR:-$APP_ROOT/storage}"
EXPORTS_DIR="${EXPORTS_DIR:-$DATA_DIR/exports}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/wedding-camera-roll}"
LATEST_ROOT="$BACKUP_ROOT/latest"
LOCK_FILE="${LOCK_FILE:-/var/lock/wedding-camera-roll-backup.lock}"
WORK_DIR="${WORK_DIR:-/tmp/wedding-camera-roll-backup}"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

mkdir -p "$WORK_DIR" "$LATEST_ROOT" "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
flock -n 9 || {
  echo "Backup laeuft bereits, ueberspringe diesen Durchlauf."
  exit 0
}

if [[ ! -d "$DATA_DIR" ]]; then
  echo "DATA_DIR nicht gefunden: $DATA_DIR" >&2
  exit 1
fi

if [[ ! -d "$STORAGE_DIR" ]]; then
  echo "STORAGE_DIR nicht gefunden: $STORAGE_DIR" >&2
  exit 1
fi

mkdir -p "$LATEST_ROOT"

MANIFEST_PATH="$WORK_DIR/backup-manifest.json"
cat > "$MANIFEST_PATH" <<EOF
{
  "createdAt": "$TIMESTAMP",
  "appRoot": "$APP_ROOT",
  "dataDir": "$DATA_DIR",
  "storageDir": "$STORAGE_DIR",
  "exportsDir": "$EXPORTS_DIR",
  "backupRoot": "$BACKUP_ROOT",
  "hostname": "$(hostname)",
  "diskFreeHuman": "$(df -h "$APP_ROOT" | awk 'NR==2 {print $4}')"
}
EOF

install -m 0644 "$MANIFEST_PATH" "$LATEST_ROOT/backup-manifest.json"

rsync -a --delete --exclude "*.sqlite-shm" --exclude "*.sqlite-wal" "$DATA_DIR/" "$LATEST_ROOT/data/"
rsync -a --delete "$STORAGE_DIR/" "$LATEST_ROOT/storage/"

if [[ -d "$EXPORTS_DIR" ]]; then
  mkdir -p "$LATEST_ROOT/exports"
  rsync -a --delete "$EXPORTS_DIR/" "$LATEST_ROOT/exports/"
fi

echo "Backup abgeschlossen: $TIMESTAMP"
