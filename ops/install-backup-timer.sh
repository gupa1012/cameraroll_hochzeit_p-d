#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Bitte als root oder mit sudo ausfuehren." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_SCRIPT="/usr/local/bin/wedding-camera-roll-backup"
ENV_FILE="/etc/default/wedding-camera-roll-backup"
SERVICE_FILE="/etc/systemd/system/wedding-camera-roll-backup.service"
TIMER_FILE="/etc/systemd/system/wedding-camera-roll-backup.timer"

install -m 0755 "$SCRIPT_DIR/backup-rclone.sh" "$TARGET_SCRIPT"

if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<'EOF'
APP_ROOT=/var/www/hochzeit
DATA_DIR=/var/www/hochzeit/data
STORAGE_DIR=/var/www/hochzeit/storage
EXPORTS_DIR=/var/www/hochzeit/data/exports
RCLONE_REMOTE=hetzner-s3:hochzeit-backups
RCLONE_PREFIX=wedding-camera-roll
EOF
  chmod 0640 "$ENV_FILE"
fi

cat > "$SERVICE_FILE" <<'EOF'
[Unit]
Description=Wedding Camera Roll Backup
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/default/wedding-camera-roll-backup
ExecStart=/usr/local/bin/wedding-camera-roll-backup
EOF

cat > "$TIMER_FILE" <<'EOF'
[Unit]
Description=Run Wedding Camera Roll Backup every 10 minutes

[Timer]
OnCalendar=*:0/10
Persistent=true
Unit=wedding-camera-roll-backup.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now wedding-camera-roll-backup.timer

echo "Backup-Timer installiert."
echo "Bitte pruefe zuerst $ENV_FILE und fuehre dann testweise aus:"
echo "  systemctl start wedding-camera-roll-backup.service"
echo "Status pruefen:"
echo "  systemctl status wedding-camera-roll-backup.timer"