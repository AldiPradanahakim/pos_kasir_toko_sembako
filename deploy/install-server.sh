#!/usr/bin/env bash
# Bootstrap sekali jalan untuk VPS Ubuntu 24.04 yang bersih.
#   sudo bash deploy/install-server.sh pos.tokohakim.id
#
# Aman diulang: paket yang sudah ada dilewati, isi /opt/pos-hakim disalin ulang
# (kecuali node_modules dan backend/.env, jadi rahasia Anda tidak tertimpa).
# Yang sengaja TIDAK dilakukan skrip ini: mengisi backend/.env, membuat user
# database, dan mengganti password superadmin — ketiganya berisi rahasia.
set -euo pipefail

DOMAIN="${1:?pakai: sudo bash deploy/install-server.sh <domain>}"
APP_DIR=/opt/pos-hakim
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export DEBIAN_FRONTEND=noninteractive
command -v rsync >/dev/null || { apt-get update && apt-get install -y rsync curl ca-certificates gnupg; }

if ! command -v node >/dev/null; then
	curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
	apt-get install -y nodejs
fi
command -v psql >/dev/null || apt-get install -y postgresql
if ! command -v caddy >/dev/null; then
	apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
	curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key |
		gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
		>/etc/apt/sources.list.d/caddy-stable.list
	apt-get update && apt-get install -y caddy
fi
command -v ufw >/dev/null || apt-get install -y ufw

# User sistem tanpa login: proses kasir tidak boleh berjalan sebagai root.
id pos >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin pos

mkdir -p "$APP_DIR"
rsync -a --exclude node_modules --exclude .git --exclude 'backend/.env' "$REPO_DIR"/ "$APP_DIR"/
chown -R pos:pos "$APP_DIR"

cd "$APP_DIR"
sudo -u pos npm ci
sudo -u pos npm ci --prefix backend --omit=dev
sudo -u pos npm ci --prefix frontend
sudo -u pos npm --prefix frontend run build

sed "s/pos\.tokohakim\.id/$DOMAIN/" "$APP_DIR/deploy/Caddyfile" >/etc/caddy/Caddyfile
cp "$APP_DIR/deploy/pos-hakim.service" /etc/systemd/system/pos-hakim.service
systemctl daemon-reload
systemctl enable --now caddy
systemctl enable pos-hakim

install -m 755 "$APP_DIR/deploy/backup.sh" /usr/local/bin/pos-backup
install -m 755 "$APP_DIR/deploy/uji-restore.sh" /usr/local/bin/pos-uji-restore
echo '15 1 * * * root /usr/local/bin/pos-backup' >/etc/cron.d/pos-backup

ufw allow OpenSSH
ufw allow 80,443/tcp
ufw --force enable

cat <<EOF

Terpasang di $APP_DIR. Langkah manual yang tersisa:

  1. Buat user + database PostgreSQL:
       sudo -u postgres psql -c "CREATE USER pos_hakim WITH PASSWORD 'PASSWORD_PANJANG';"
       sudo -u postgres psql -c "CREATE DATABASE pos_hakim OWNER pos_hakim;"
  2. Isi $APP_DIR/backend/.env  (DATABASE_URL, HOST=127.0.0.1, TZ=Asia/Jakarta)
  3. Terapkan skema lalu nyalakan:
       sudo -u pos npm --prefix $APP_DIR/backend run migrate
       sudo -u pos npm --prefix $APP_DIR/backend run seed
       sudo systemctl restart pos-hakim
  4. Buka https://$DOMAIN. Password superadmin dicetak oleh langkah migrate/seed di atas
     (dibuat acak, hanya ditampilkan sekali).
  5. Uji backup dengan: sudo pos-uji-restore
EOF
