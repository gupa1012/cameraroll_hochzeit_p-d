#!/usr/bin/env bash

set -Eeuo pipefail

APP_NAME="hochzeit"
DEFAULT_APP_DIR="/var/www/hochzeit"
DEFAULT_REPO_URL="https://github.com/gupa1012/cameraroll_hochzeit_p-d.git"
DEFAULT_PORT="3000"

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

ask() {
  local prompt="$1"
  local default_value="${2:-}"
  local answer

  if [[ -n "$default_value" ]]; then
    read -r -p "$prompt [$default_value]: " answer
    printf '%s' "${answer:-$default_value}"
  else
    read -r -p "$prompt: " answer
    printf '%s' "$answer"
  fi
}

ask_yes_no() {
  local prompt="$1"
  local default_value="$2"
  local answer

  while true; do
    read -r -p "$prompt [$default_value]: " answer
    answer="${answer:-$default_value}"
    case "${answer,,}" in
      y|yes|j|ja) return 0 ;;
      n|no|nein) return 1 ;;
      *) printf 'Bitte j oder n eingeben.\n' ;;
    esac
  done
}

ensure_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail "Bitte mit sudo oder als root ausfuehren. Beispiel: sudo bash setup-server.sh"
  fi
}

ensure_ubuntu() {
  if [[ ! -f /etc/os-release ]]; then
    fail "Konnte das Betriebssystem nicht erkennen. Das Skript erwartet Ubuntu 24.04 oder aehnlich."
  fi

  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    warn "Getestet ist das Skript fuer Ubuntu. Gefunden: ${PRETTY_NAME:-unbekannt}."
    ask_yes_no "Trotzdem fortfahren?" "n" || exit 1
  fi
}

install_base_packages() {
  log "Systempakete installieren"
  apt-get update
  apt-get install -y curl ca-certificates gnupg git rsync nginx certbot python3-certbot-nginx
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
  local target_dir="$1"
  local repo_url="$2"
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  mkdir -p "$target_dir"

  if [[ -f "$script_dir/package.json" && -f "$script_dir/server.js" ]]; then
    if ask_yes_no "Aktuellen Ordner als App-Quelle verwenden?" "j"; then
      log "Projektdateien nach $target_dir kopieren"
      rsync -a \
        --exclude node_modules \
        --exclude uploads \
        --exclude database.sqlite \
        --exclude .git \
        "$script_dir/" "$target_dir/"
      return
    fi
  fi

  if [[ -d "$target_dir/.git" ]]; then
    log "Bestehendes Git-Repo aktualisieren"
    git -C "$target_dir" pull --ff-only
  else
    if [[ -n "$(find "$target_dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
      warn "$target_dir ist nicht leer und wird fuer das Repo verwendet."
      ask_yes_no "Fortfahren?" "n" || exit 1
    fi
    log "Repo klonen"
    rm -rf "$target_dir"
    git clone "$repo_url" "$target_dir"
  fi
}

install_app_dependencies() {
  local target_dir="$1"
  log "Node-Abhaengigkeiten installieren"
  cd "$target_dir"
  npm install --omit=dev
  mkdir -p uploads uploads/_thumbs
}

write_nginx_config() {
  local app_dir="$1"
  local domain="$2"
  local with_www="$3"
  local port="$4"
  local server_names="_"

  if [[ -n "$domain" ]]; then
    server_names="$domain"
    if [[ "$with_www" == "yes" ]]; then
      server_names="$server_names www.$domain"
    fi
  fi

  log "Nginx konfigurieren"
  cat > /etc/nginx/sites-available/$APP_NAME <<EOF
server {
    listen 80;
    server_name $server_names;

    client_max_body_size 200M;

    location / {
        proxy_pass http://127.0.0.1:$port;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
    }
}
EOF

  ln -sfn /etc/nginx/sites-available/$APP_NAME /etc/nginx/sites-enabled/$APP_NAME
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable nginx
  systemctl reload nginx
}

configure_firewall_if_needed() {
  if ! command -v ufw >/dev/null 2>&1; then
    return
  fi

  if ! ufw status | grep -q "Status: active"; then
    return
  fi

  log "UFW fuer Nginx freigeben"
  ufw allow 'Nginx Full'
}

start_app_with_pm2() {
  local target_dir="$1"
  local port="$2"

  log "App mit PM2 starten"
  cd "$target_dir"
  pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
  PORT="$port" HOST="127.0.0.1" pm2 start server.js --name "$APP_NAME" --update-env
  pm2 save

  if ! pm2 startup systemd -u root --hp /root >/tmp/pm2-startup.txt 2>/tmp/pm2-startup.err; then
    warn "PM2 startup konnte nicht vollautomatisch gesetzt werden."
  fi
}

setup_https_if_requested() {
  local domain="$1"
  local with_www="$2"
  local email="$3"

  if [[ -z "$domain" ]]; then
    warn "Keine Domain angegeben. HTTPS wird uebersprungen; Zugriff erfolgt ueber die Server-IP."
    return
  fi

  if [[ -z "$email" ]]; then
    warn "Keine E-Mail fuer Let's Encrypt angegeben. HTTPS wird uebersprungen."
    return
  fi

  log "HTTPS mit Let's Encrypt einrichten"
  local certbot_args=(-d "$domain")
  if [[ "$with_www" == "yes" ]]; then
    certbot_args+=(-d "www.$domain")
  fi

  certbot --nginx --non-interactive --agree-tos --redirect -m "$email" "${certbot_args[@]}"
}

show_summary() {
  local port="$1"
  local domain="$2"
  local app_dir="$3"

  log "Fertig"
  printf 'App-Verzeichnis: %s\n' "$app_dir"
  printf 'Lokale URL: http://<server-ip>:%s\n' "$port"
  if [[ -n "$domain" ]]; then
    printf 'Domain-URL: http://%s\n' "$domain"
    printf 'Wenn HTTPS erfolgreich war: https://%s\n' "$domain"
  fi
  printf 'PM2-Status: pm2 status\n'
  printf 'Logs: pm2 logs %s\n' "$APP_NAME"
  printf 'Hinweis: Das Admin-Passwort ist aktuell in server.js fest hinterlegt.\n'
}

main() {
  ensure_root
  ensure_ubuntu

  local app_dir
  local repo_url
  local domain
  local email=""
  local port
  local with_www="no"

  printf 'Hochzeits-Galerie Server-Setup\n'
  printf 'Das Skript installiert Node.js, PM2, Nginx und startet die App.\n\n'

  app_dir="$(ask "Zielverzeichnis fuer die App" "$DEFAULT_APP_DIR")"
  repo_url="$(ask "Git-Repo URL (nur falls geklont werden soll)" "$DEFAULT_REPO_URL")"
  port="$(ask "App-Port" "$DEFAULT_PORT")"
  domain="$(ask "Domain (leer lassen fuer nur Server-IP)")"
  if [[ -n "$domain" ]]; then
    if ask_yes_no "Auch www.$domain einrichten?" "j"; then
      with_www="yes"
    fi
    email="$(ask "E-Mail fuer Let's Encrypt")"
  fi

  install_base_packages
  install_node_if_needed
  install_pm2_if_needed
  prepare_app_source "$app_dir" "$repo_url"
  install_app_dependencies "$app_dir"
  start_app_with_pm2 "$app_dir" "$port"
  write_nginx_config "$app_dir" "$domain" "$with_www" "$port"
  configure_firewall_if_needed
  setup_https_if_requested "$domain" "$with_www" "$email"
  show_summary "$port" "$domain" "$app_dir"
}

main "$@"