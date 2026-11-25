#!/usr/bin/env bash
# Backup harian database POS. Dipasang otomatis oleh deploy/install-server.sh sebagai
# /etc/cron.d/pos-backup (jalan 01:15 sebagai root).
#
# Kredensial diambil dari backend/.env yang sama dengan aplikasi, jadi tidak ada
# password kedua yang bisa basi. Simpan salinannya DI LUAR server ini (rclone ke
# Drive/OneDrive): backup yang hanya ada di mesin yang sama bukan backup.
set -euo pipefail

ENV_FILE=/opt/pos-hakim/backend/.env
TUJUAN=/var/backups/pos
SIMPAN_HARI=30

DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE" | head -1 | tr -d '\r')"
[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL tidak ada di $ENV_FILE" >&2; exit 1; }

mkdir -p "$TUJUAN"
pg_dump -Fc "$DATABASE_URL" | gzip >"$TUJUAN/pos_hakim-$(date +%F).dump.gz"
find "$TUJUAN" -name 'pos_hakim-*.dump.gz' -mtime +"$SIMPAN_HARI" -delete

# Pulihkan bila perlu (database kosong):
#   gunzip -c /var/backups/pos/pos_hakim-2026-11-23.dump.gz | pg_restore -d "$DATABASE_URL" --no-owner
