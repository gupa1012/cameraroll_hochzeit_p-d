#!/usr/bin/env bash

set -Eeuo pipefail

APP_NAME="hochzeit"
APP_USER="hochzeit"
APP_DIR="/var/www/hochzeit"
REPO_URL="https://github.com/gupa1012/cameraroll_hochzeit_p-d.git"
APP_PORT="3000"

log() {
  printf '\n==> %s\n' "$*"
}

warn() {
  printf '\n[WARN] %s\n' "$*"
}

fail() {
  printf '\n[FEHLER] %s\n' "$*" >&2
  exit 1
}

ensure_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail "Bitte als root oder per sudo ausfuehren."
  fi
}

ensure_ubuntu() {
  if [[ ! -f /etc/os-release ]]; then
    fail "Konnte das Betriebssystem nicht erkennen. Erwartet wird Ubuntu auf Hetzner."
  fi

  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    fail "Dieses Skript ist nur fuer Ubuntu auf Hetzner vorgesehen. Gefunden: ${PRETTY_NAME:-unbekannt}."
  fi
}

ask_secret_twice() {
  local prompt="$1"
  local first
  local second

  while true; do
    read -r -s -p "$prompt: " first
    printf '\n'
    read -r -s -p "$prompt wiederholen: " second
    printf '\n'

    if [[ -z "$first" ]]; then
      printf 'Der Wert darf nicht leer sein.\n'
      continue
    fi

    if [[ ${#first} -lt 8 ]]; then
      printf 'Bitte mindestens 8 Zeichen verwenden.\n'
      continue
    fi

    if [[ "$first" != "$second" ]]; then
      printf 'Die Eingaben stimmen nicht ueberein.\n'
      continue
    fi

    printf '%s' "$first"
    return 0
  done
}

install_base_packages() {
  log "Systempakete installieren"
  apt-get update
  apt-get install -y curl ca-certificates gnupg git rsync nginx
}

install_node_if_needed() {
  if command -v node >/dev/null 2>&1; then
    local node_major
    node_major="$(node -p "process.versions.node.split('.')[0]")"
    if [[ "$node_major" -ge 22 ]]; then
      log "Node.js $(node -v) ist bereits geeignet"
      return
    fi
  fi

  log "Node.js 22 installieren"
  curl -fsSLo /tmp/nodesource_setup.sh https://deb.nodesource.com/setup_22.x
  bash /tmp/nodesource_setup.sh
  apt-get install -y nodejs
}

install_pm2_if_needed() {
  if command -v pm2 >/dev/null 2>&1; then
    log "PM2 ist bereits installiert"
    return
  fi

  log "PM2 installieren"
  npm install -g pm2
}

prepare_app_source() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  mkdir -p "$APP_DIR"

  if [[ -f "$script_dir/package.json" && -f "$script_dir/server.js" ]]; then
    log "Projektdateien nach $APP_DIR kopieren"
    rsync -a \
      --exclude node_modules \
      --exclude .git \
      "$script_dir/" "$APP_DIR/"
    return
  fi

  if [[ -d "$APP_DIR/.git" ]]; then
    log "Bestehendes Repo aktualisieren"
    git -C "$APP_DIR" pull --ff-only
    return
  fi

  log "Repo klonen"
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
}

install_app_dependencies() {
  log "Node-Abhaengigkeiten installieren"
  cd "$APP_DIR"
  npm install --omit=dev
  mkdir -p uploads uploads/_thumbs
}

ensure_app_user() {
  if id -u "$APP_USER" >/dev/null 2>&1; then
    return
  fi

  log "Linux-App-User anlegen"
  adduser --disabled-password --gecos '' "$APP_USER"
}

write_env_file() {
  local operator_password="$1"

  log ".env schreiben"
  cat > "$APP_DIR/.env" <<EOF
PORT=$APP_PORT
HOST=127.0.0.1
OPERATOR_PASSWORD=$operator_password
UPLOAD_REQUEST_TIMEOUT_MS=0
EXPORT_SYNC_LABEL=Google Drive
EOF
}

write_start_script() {
  log "Startskript schreiben"
  cat > "$APP_DIR/start-hochzeit.sh" <<'EOF'
#!/usr/bin/env bash
set -a
if [ -f "$(dirname "$0")/.env" ]; then
    . "$(dirname "$0")/.env"
fi
set +a
cd "$(dirname "$0")"
exec node server.js
EOF
}

write_nginx_config() {
  log "Nginx fuer IP-Bootstrap konfigurieren"
  cat > "/etc/nginx/sites-available/$APP_NAME" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 0;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_request_buffering off;
        proxy_connect_timeout 60s;
        proxy_send_timeout 900s;
        proxy_read_timeout 900s;
    }
}
EOF

  ln -sfn "/etc/nginx/sites-available/$APP_NAME" "/etc/nginx/sites-enabled/$APP_NAME"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable nginx
  systemctl restart nginx
}

start_app_with_pm2() {
  log "Besitzrechte setzen und App als $APP_USER starten"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  chmod 600 "$APP_DIR/.env"
  chmod 750 "$APP_DIR/start-hochzeit.sh"

  su -s /bin/bash "$APP_USER" -c "cd '$APP_DIR' && pm2 delete '$APP_NAME' >/dev/null 2>&1 || true && pm2 start ./start-hochzeit.sh --name '$APP_NAME' && pm2 save"

  if pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" >/tmp/pm2-startup.txt 2>/tmp/pm2-startup.err; then
    if systemctl list-unit-files | grep -q '^pm2-hochzeit.service'; then
      systemctl enable pm2-hochzeit
      systemctl restart pm2-hochzeit
    fi
  else
    warn "PM2 startup konnte nicht vollautomatisch eingerichtet werden. Details stehen in /tmp/pm2-startup.err."
  fi
}

show_summary() {
  log "Bootstrap abgeschlossen"
  printf 'URL: http://<server-ip>/\n'
  printf 'App-Verzeichnis: %s\n' "$APP_DIR"
  printf 'App-User: %s\n' "$APP_USER"
  printf 'Naechster Schritt ueber Copilot: SSH haerten, Updates einspielen, rebooten, validieren.\n'
}

main() {
  local operator_password

  ensure_root
  ensure_ubuntu

  printf 'Hetzner Bootstrap fuer Wedding Camera Roll\n'
  printf 'Dieses Skript richtet nur den IP-Bootstrap ein. HTTPS und SSH-Hardening folgen danach ueber Copilot.\n\n'

  operator_password="$(ask_secret_twice 'Operator-Passwort festlegen')"

  install_base_packages
  install_node_if_needed
  install_pm2_if_needed
  prepare_app_source
  install_app_dependencies
  ensure_app_user
  write_env_file "$operator_password"
  write_start_script
  write_nginx_config
  start_app_with_pm2
  show_summary
}

main "$@"