#!/usr/bin/env bash
# Uji apakah backup benar-benar bisa dipulihkan.
#
# Backup yang belum pernah direstorasi bukan backup — hanya harapan. Skrip ini memulihkan
# dump terbaru ke database SEMENTARA (tidak menyentuh database produksi), lalu membandingkan
# jumlah baris tabel kunci antara sumber dan hasil pulihan.
#
#   sudo bash deploy/uji-restore.sh
#   sudo bash deploy/uji-restore.sh /var/backups/pos/pos_hakim-2026-11-23.dump.gz
#
# Keluar dengan kode 1 bila ada tabel yang jumlahnya berbeda. Database uji selalu dihapus lagi.
set -euo pipefail

ENV_FILE=/opt/pos-hakim/backend/.env
DIR_BACKUP=/var/backups/pos
DB_UJI=pos_hakim_uji_restore

DUMP="${1:-$(ls -1t "$DIR_BACKUP"/pos_hakim-*.dump.gz 2>/dev/null | head -1)}"
[ -n "${DUMP:-}" ] || { echo "Tidak ada berkas dump di $DIR_BACKUP" >&2; exit 1; }
[ -f "$DUMP" ] || { echo "Berkas tidak ditemukan: $DUMP" >&2; exit 1; }

DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE" | head -1 | tr -d '\r')"
[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL tidak ada di $ENV_FILE" >&2; exit 1; }

# Ganti nama database pada URL agar menunjuk ke database uji.
URL_UJI="$(printf '%s' "$DATABASE_URL" | sed -E "s#/[^/?]+(\\?.*)?\$#/${DB_UJI}\\1#")"

TABEL=(users products product_units sales sale_items stock_movements cash_flows shifts debts returns)

echo "Dump   : $DUMP"
echo "Uji ke : $DB_UJI"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS $DB_UJI" >/dev/null
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE $DB_UJI" >/dev/null

if ! gunzip -c "$DUMP" | pg_restore --no-owner -d "$URL_UJI"; then
	echo "GAGAL: pg_restore melaporkan kesalahan." >&2
	psql "$DATABASE_URL" -qc "DROP DATABASE IF EXISTS $DB_UJI" >/dev/null || true
	exit 1
fi

hitung() { psql "$1" -tAc "SELECT count(*) FROM $2" 2>/dev/null || echo "?"; }

beda=0
printf '%-18s %10s %10s\n' TABEL ASLI PULIHAN
for t in "${TABEL[@]}"; do
	a="$(hitung "$DATABASE_URL" "$t")"
	b="$(hitung "$URL_UJI" "$t")"
	printf '%-18s %10s %10s\n' "$t" "$a" "$b"
	[ "$a" = "$b" ] || beda=1
done

psql "$DATABASE_URL" -qc "DROP DATABASE IF EXISTS $DB_UJI" >/dev/null

if [ "$beda" -ne 0 ]; then
	echo ""
	echo "HASIL: ADA PERBEDAAN — backup ini tidak utuh." >&2
	exit 1
fi
echo ""
echo "HASIL: semua tabel kunci cocok. Backup bisa dipulihkan."
