#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/var/www/hochzeit}"
DATA_DIR="${DATA_DIR:-$APP_ROOT/data}"
STORAGE_DIR="${STORAGE_DIR:-$APP_ROOT/storage}"
EXPORTS_DIR="${EXPORTS_DIR:-$DATA_DIR/exports}"
RCLONE_REMOTE="${RCLONE_REMOTE:?Setze RCLONE_REMOTE, z. B. hetzner-s3:hochzeit-backups oder gdrive:hochzeit-backups}"
RCLONE_PREFIX="${RCLONE_PREFIX:-wedding-camera-roll}"
LOCK_FILE="${LOCK_FILE:-/var/lock/wedding-camera-roll-backup.lock}"
WORK_DIR="${WORK_DIR:-/tmp/wedding-camera-roll-backup}"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
LATEST_ROOT="$RCLONE_REMOTE:$RCLONE_PREFIX/latest"
HISTORY_ROOT="$RCLONE_REMOTE:$RCLONE_PREFIX/history/$TIMESTAMP"

mkdir -p "$WORK_DIR" "$(dirname "$LOCK_FILE")"
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

MANIFEST_PATH="$WORK_DIR/backup-manifest.json"
cat > "$MANIFEST_PATH" <<EOF
{
  "createdAt": "$TIMESTAMP",
  "appRoot": "$APP_ROOT",
  "dataDir": "$DATA_DIR",
  "storageDir": "$STORAGE_DIR",
  "exportsDir": "$EXPORTS_DIR",
  "hostname": "$(hostname)",
  "diskFreeHuman": "$(df -h "$APP_ROOT" | awk 'NR==2 {print $4}')"
}
EOF

rclone copyto "$MANIFEST_PATH" "$LATEST_ROOT/backup-manifest.json"
rclone copyto "$MANIFEST_PATH" "$HISTORY_ROOT/backup-manifest.json"

rclone sync "$DATA_DIR" "$LATEST_ROOT/data" \
  --backup-dir "$HISTORY_ROOT/data" \
  --exclude "*.sqlite-shm" \
  --exclude "*.sqlite-wal"

rclone sync "$STORAGE_DIR" "$LATEST_ROOT/storage" \
  --backup-dir "$HISTORY_ROOT/storage"

if [[ -d "$EXPORTS_DIR" ]]; then
  rclone sync "$EXPORTS_DIR" "$LATEST_ROOT/exports" \
    --backup-dir "$HISTORY_ROOT/exports"
fi

echo "Backup abgeschlossen: $TIMESTAMP"