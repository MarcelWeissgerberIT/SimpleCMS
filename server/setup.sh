#!/usr/bin/env bash
# SimpleCMS One — guided server setup (Ubuntu 24.04 / Debian 12, run as root).
#
#   curl -fsSL https://raw.githubusercontent.com/MarcelWeissgerberIT/SimpleCMS/main/server/setup.sh -o setup.sh
#   bash setup.sh
#
# Asks a few questions, installs Docker, writes server/.env (SECRET and DATA_KEY generated here, never shown
# again except DATA_KEY once for your password manager), checks DNS and starts the server with HTTPS.
# Safe to run again: an existing .env keeps its SECRET and DATA_KEY. Details: docs/SELF_HOSTING.md
set -euo pipefail

REPO="https://github.com/MarcelWeissgerberIT/SimpleCMS.git"
DIR="/opt/simplecms"
ENV_FILE="$DIR/server/.env"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*"; exit 1; }
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }

# ask "question" "default" → answer (default on Enter)
ask() {
  local q="$1" def="${2:-}" a
  if [ -n "$def" ]; then read -r -p "$q [$def]: " a </dev/tty; else read -r -p "$q: " a </dev/tty; fi
  printf '%s' "${a:-$def}"
}
# ask_secret "question" → answer (not echoed)
ask_secret() {
  local q="$1" a
  read -r -s -p "$q: " a </dev/tty
  echo >&2
  printf '%s' "$a"
}
yes_no() {
  local a
  a="$(ask "$1 (j/n · y/n)" "${2:-j}")"
  case "$a" in [jJyY]*) return 0 ;; *) return 1 ;; esac
}
urlencode() { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"; }
env_get() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }

[ "$(id -u)" -eq 0 ] || fail "Bitte als root ausführen / please run as root (ssh root@<server-ip>)."
command -v apt-get >/dev/null || fail "Dieses Skript braucht Ubuntu oder Debian / needs Ubuntu or Debian."

echo
bold "SimpleCMS One — Server einrichten / server setup"
note "Fragen mit [Vorgabe] übernimmst du mit Enter. Answers in [brackets] are the default — press Enter."
echo

# ---------------------------------------------------------------- 1. packages + Docker
bold "1/6 Pakete / packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl openssl python3 dnsutils unattended-upgrades ca-certificates >/dev/null
ok "git, curl, openssl, dig, automatische Sicherheitsupdates / automatic security updates"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  note "Docker wird installiert (1–2 Minuten) / installing Docker …"
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1 || fail "Docker-Installation fehlgeschlagen / Docker install failed. Läuft der Server als KVM-VPS? (Container-Tarife können kein Docker.)"
fi
docker info >/dev/null 2>&1 || fail "Docker läuft nicht / Docker is not running (systemctl status docker)."
ok "Docker $(docker --version | awk '{print $3}' | tr -d ,)"
# the first build needs ~2 GB of memory: small servers get a swap file
MEM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
if [ "$MEM_MB" -lt 2500 ] && [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  ok "2 GB Swap angelegt (${MEM_MB} MB RAM) / swap file added"
fi

# ---------------------------------------------------------------- 2. code
bold "2/6 Code"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull -q --ff-only || warn "git pull ging nicht / failed — ich nutze den vorhandenen Stand / using the current checkout"
else
  git clone -q "$REPO" "$DIR"
fi
ok "$DIR"

# ---------------------------------------------------------------- 3. questions
bold "3/6 Einstellungen / settings"
DOMAIN="$(ask "Domain für den Server / domain (z. B. / e.g. cloud.example.com)" "$(env_get DOMAIN | sed 's/^cloud.example.com$//')")"
[ -n "$DOMAIN" ] || fail "Ohne Domain geht es nicht / a domain is required."
ADMIN_EMAILS="$(ask "Deine E-Mail-Adresse (Admin) / your email (admin)" "$(env_get ADMIN_EMAILS)")"
[ -n "$ADMIN_EMAILS" ] || fail "Eine Admin-Adresse wird gebraucht / an admin email is required."

echo
note "Wer darf ein Konto anlegen? / Who may create an account?"
note "  invite  — nur mit Einladung oder Registrierungslink (empfohlen) / invitation or registration link only (recommended)"
note "  open    — jede E-Mail-Adresse / any email address"
note "  domains:firma.de — Adressen dieser Domains / addresses at these domains"
SIGNUP_DEF="$(env_get SIGNUP)"
SIGNUP="$(ask "Anmeldung / sign-up" "${SIGNUP_DEF:-invite}")"

echo
SMTP_URL="$(env_get SMTP_URL)"
MAIL_FROM="$(env_get MAIL_FROM)"
if [ -n "$SMTP_URL" ] && ! yes_no "E-Mail-Versand ist schon eingerichtet. Neu eingeben? / Mail is set up. Enter it again?" n; then
  ok "E-Mail-Versand bleibt / mail settings kept"
elif yes_no "E-Mail-Versand für die Anmelde-Links einrichten? / Set up mail for sign-in links?" j; then
  note "Beispiel STRATO-Postfach / example: Server smtp.strato.de · Port 587 · Benutzer = die volle Postfach-Adresse"
  SMTP_HOST="$(ask "SMTP-Server" "smtp.strato.de")"
  SMTP_PORT="$(ask "Port (587 = STARTTLS, 465 = TLS)" "587")"
  SMTP_USER="$(ask "Benutzer / user (meist die E-Mail-Adresse / usually the address)" "")"
  SMTP_PASS="$(ask_secret "Passwort des Postfachs / mailbox password (unsichtbar / hidden)")"
  [ -n "$SMTP_USER" ] && [ -n "$SMTP_PASS" ] || fail "Benutzer und Passwort werden gebraucht / user and password are required."
  SCHEME=smtp; [ "$SMTP_PORT" = "465" ] && SCHEME=smtps
  SMTP_URL="$SCHEME://$(urlencode "$SMTP_USER"):$(urlencode "$SMTP_PASS")@$SMTP_HOST:$SMTP_PORT"
  FROM_ADDR="$(ask "Absender-Adresse / sender address" "$SMTP_USER")"
  MAIL_FROM="One Cloud <$FROM_ADDR>"
  unset SMTP_PASS
else
  SMTP_URL=""
  [ -n "$MAIL_FROM" ] || MAIL_FROM="SimpleCMS One <no-reply@$DOMAIN>"
  warn "Ohne E-Mail stehen die Anmelde-Links nur im Server-Log / without mail, sign-in links only appear in the log:"
  note "docker compose -f $DIR/server/docker-compose.yml logs one | grep link="
fi
[ -n "$MAIL_FROM" ] || MAIL_FROM="One Cloud <no-reply@$DOMAIN>"

# ---------------------------------------------------------------- 4. keys + .env
bold "4/6 Schlüssel und .env / keys and .env"
SECRET="$(env_get SECRET)"
DATA_KEY="$(env_get DATA_KEY)"
NEW_KEY=0
if [ -z "$SECRET" ]; then SECRET="$(openssl rand -hex 32)"; ok "SECRET erzeugt / generated"; else ok "SECRET bleibt / kept"; fi
if [ -z "$DATA_KEY" ]; then DATA_KEY="$(openssl rand -base64 32)"; NEW_KEY=1; ok "DATA_KEY erzeugt / generated"; else ok "DATA_KEY bleibt / kept"; fi

umask 077
cat >"$ENV_FILE" <<EOF
# Written by server/setup.sh — see .env.example for every option.
DOMAIN=$DOMAIN
SECRET=$SECRET
DATA_KEY=$DATA_KEY
SMTP_URL=$SMTP_URL
MAIL_FROM="$MAIL_FROM"
SIGNUP=$SIGNUP
ADMIN_EMAILS=$ADMIN_EMAILS
MAX_UPLOAD_MB=25
EOF
chmod 600 "$ENV_FILE"
ok "$ENV_FILE (nur root lesbar / readable by root only)"

if [ "$NEW_KEY" = "1" ]; then
  echo
  bold "WICHTIG / IMPORTANT — DATA_KEY"
  note "Ohne diesen Schlüssel sind deine Daten und Backups nicht lesbar."
  note "Without this key your data and backups cannot be read."
  note "Kopiere ihn JETZT in deinen Passwort-Manager (markieren, ⌘C / Ctrl+Shift+C):"
  echo
  printf '    \033[1m%s\033[0m\n' "$DATA_KEY"
  echo
  while [ "$(ask "Gespeichert? Tippe ok / Saved? type ok" "")" != "ok" ]; do :; done
  clear || true
  ok "DATA_KEY gesichert / saved (er steht auch in $ENV_FILE)"
fi
unset SECRET DATA_KEY

# ---------------------------------------------------------------- 5. DNS + firewall
bold "5/6 DNS und Firewall"
IP4="$(curl -4 -fsS --max-time 5 https://api.ipify.org || true)"
note "Öffentliche IPv4 dieses Servers / this server's public IPv4: ${IP4:-unbekannt / unknown}"
while true; do
  RESOLVED="$(dig +short A "$DOMAIN" | tail -1)"
  if [ -n "$IP4" ] && [ "$RESOLVED" = "$IP4" ]; then ok "$DOMAIN → $RESOLVED"; break; fi
  warn "$DOMAIN zeigt auf / points to: ${RESOLVED:-nichts / nothing}"
  note "Leg beim Domain-Anbieter einen A-Eintrag an / create an A record:  $DOMAIN → ${IP4:-<server-ip>}"
  if ! yes_no "Nochmal prüfen? (n = trotzdem weiter) / check again? (n = continue anyway)" j; then
    warn "HTTPS klappt erst, wenn der DNS-Eintrag stimmt / HTTPS works once DNS is right."
    break
  fi
  sleep 10
done
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
  ok "ufw: 22, 80, 443 offen / open"
fi
note "Bei STRATO zusätzlich in der Server-Firewall TCP 22, 80, 443 freigeben / also open them in your hoster's firewall."

# ---------------------------------------------------------------- 6. start
bold "6/6 Start (der erste Bau dauert ein paar Minuten / the first build takes a few minutes)"
cd "$DIR/server"
docker compose up -d --build
note "Warte auf den Server / waiting for the server …"
for i in $(seq 1 60); do
  if curl -fsS --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1; then
    echo
    ok "Läuft / running: https://$DOMAIN/app/"
    note "Melde dich dort mit $ADMIN_EMAILS an. / Sign in there with $ADMIN_EMAILS."
    [ -z "$SMTP_URL" ] && note "Anmelde-Link / sign-in link: docker compose -f $DIR/server/docker-compose.yml logs one | grep link="
    note "Logs: docker compose -f $DIR/server/docker-compose.yml logs -f one"
    note "Update später / later: bash $DIR/server/setup.sh"
    exit 0
  fi
  sleep 5
done
warn "Noch keine Antwort über HTTPS / no HTTPS answer yet. Prüfe / check:"
note "docker compose -f $DIR/server/docker-compose.yml ps"
note "docker compose -f $DIR/server/docker-compose.yml logs caddy   (Zertifikat / certificate — DNS + Ports 80/443?)"
note "docker compose -f $DIR/server/docker-compose.yml logs one"
exit 1
