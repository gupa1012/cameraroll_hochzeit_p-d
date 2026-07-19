#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/var/www/hochzeit}"
DATA_DIR="${DATA_DIR:-$APP_ROOT/data}"
STORAGE_DIR="${STORAGE_DIR:-$APP_ROOT/storage}"
EXPORTS_DIR="${EXPORTS_DIR:-$DATA_DIR/exports}"
LOCK_FILE="${LOCK_FILE:-/var/lock/wedding-camera-roll-backup.lock}"
WORK_DIR="${WORK_DIR:-/tmp/wedding-camera-roll-backup}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
RCLONE_PREFIX="${RCLONE_PREFIX:-wedding-camera-roll}"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if [[ -z "$RCLONE_REMOTE" ]]; then
  echo "RCLONE_REMOTE ist nicht konfiguriert." >&2
  exit 1
fi

if ! command -v rclone >/dev/null 2>&1; then
  echo "rclone ist nicht installiert oder nicht im PATH." >&2
  exit 1
fi

RCLONE_PREFIX="${RCLONE_PREFIX#/}"
RCLONE_PREFIX="${RCLONE_PREFIX%/}"
REMOTE_LATEST="${RCLONE_REMOTE%/}/${RCLONE_PREFIX}/latest"

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
  "remoteLatest": "$REMOTE_LATEST",
  "hostname": "$(hostname)",
  "diskFreeHuman": "$(df -h "$APP_ROOT" | awk 'NR==2 {print $4}')"
}
EOF

rclone sync "$DATA_DIR/" "$REMOTE_LATEST/data" \
  --exclude "*.sqlite-shm" \
  --exclude "*.sqlite-wal"
rclone sync "$STORAGE_DIR/" "$REMOTE_LATEST/storage"

if [[ -d "$EXPORTS_DIR" ]]; then
  rclone sync "$EXPORTS_DIR/" "$REMOTE_LATEST/exports"
else
  rclone purge "$REMOTE_LATEST/exports" || true
fi

rclone copyto "$MANIFEST_PATH" "$REMOTE_LATEST/backup-manifest.json"

echo "Offsite-Backup abgeschlossen: $TIMESTAMP"
