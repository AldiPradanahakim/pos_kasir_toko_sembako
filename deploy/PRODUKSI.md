# Deploy Produksi — VPS + Domain, Offline-First

Panduan ini mengasumsikan: **satu VPS Linux** (mis. Ubuntu 24.04, 2 vCPU / 2 GB RAM sudah cukup
untuk 1–3 perangkat kasir), **satu domain**, dan **tidak ada komputer server di toko**. Semua
perangkat (HP/tablet/laptop) membuka alamat yang sama lewat internet, dan tetap bisa berjualan
saat internet mati karena aplikasinya PWA offline-first.

## Bentuk sistemnya

```mermaid
flowchart LR
  subgraph toko["HP / Tablet / Laptop di toko"]
    PWA["Aplikasi (PWA)<br/>service worker + IndexedDB"]
    Q["Antrean transaksi<br/>Dexie pendingSales"]
  end
  subgraph vps["VPS"]
    CADDY["Caddy<br/>HTTPS :443"]
    NODE["Node 22<br/>:3000 API + frontend/dist"]
    PG[("PostgreSQL")]
  end
  PWA -- "online: /api/*" --> CADDY --> NODE --> PG
  PWA -. "offline: simpan lokal" .-> Q
  Q -. "online lagi: kirim berurutan" .-> CADDY
```

Satu proses Node menyajikan API **dan** hasil build frontend (`backend/src/app.js:47`), jadi tidak
ada CORS dan tidak ada dua alamat. Caddy hanya menambah HTTPS + kompresi di depannya.

## 1. Server & domain

| Kebutuhan | Nilai |
| --- | --- |
| OS | Ubuntu 24.04 LTS (atau Debian 12) |
| RAM/CPU | 2 GB / 2 vCPU (cukup untuk satu toko) |
| Disk | 25 GB |
| Port dibuka | 22, 80, 443 — **port 3000 tidak pernah dibuka** |
| DNS | `A` record `pos` → IP VPS (dan `AAAA` bila ada IPv6) |

HTTPS bukan pilihan gaya, tapi syarat teknis: service worker hanya aktif di secure context. Tanpa
HTTPS tidak ada cache offline dan aplikasi tidak bisa dipasang ke layar utama.

## 2. Pasang

```bash
# di VPS, sebagai user yang punya sudo
git clone <repo> /tmp/pos-hakim
cd /tmp/pos-hakim
sudo bash deploy/install-server.sh pos.tokohakim.id
```

Skrip itu memasang Node 22, PostgreSQL, Caddy, membuat user sistem `pos`, menyalin aplikasi ke
`/opt/pos-hakim`, build frontend, memasang service systemd + Caddyfile, jadwal backup, dan firewall.
Aman diulang.

Lalu tiga langkah manual:

```bash
sudo -u postgres psql -c "CREATE USER pos_hakim WITH PASSWORD 'PASSWORD_PANJANG';"
sudo -u postgres psql -c "CREATE DATABASE pos_hakim OWNER pos_hakim;"

sudo -u pos tee /opt/pos-hakim/backend/.env >/dev/null <<'EOF'
DATABASE_URL=postgres://pos_hakim:PASSWORD_PANJANG@127.0.0.1:5432/pos_hakim
HOST=127.0.0.1
PORT=3000
TZ=Asia/Jakarta
TOKEN_TTL_HOURS=720
LOGIN_MAKS_GAGAL=10
LOGIN_JENDELA_MENIT=15
EOF

sudo -u pos npm --prefix /opt/pos-hakim/backend run migrate
sudo -u pos npm --prefix /opt/pos-hakim/backend run seed
sudo systemctl restart pos-hakim
```

`HOST=127.0.0.1` membuat Node hanya bisa dihubungi Caddy dari dalam mesin. Langkah `seed` di atas
**mencetak password superadmin acak satu kali** — salin sebelum menutup terminal. Lalu buka
`https://pos.tokohakim.id` dan masuk dengan `superadmin` + password itu.

Kalau password masih "password" (instalasi lama), server menandai akun itu wajib ganti password saat
menyala, dan aplikasi hanya menampilkan form ganti password sampai selesai.

## 3. Pasang ke HP/tablet (bukan APK)

Buka alamat HTTPS di Chrome (Android) atau Safari (iPhone/iPad), lalu **Tambahkan ke layar utama**.
Aplikasi muncul dengan ikon sendiri, layar penuh, tanpa address bar.

Kalau benar-benar butuh berkas `.apk` untuk dibagikan, bungkus dengan Capacitor — tapi itu hanya
membungkus WebView yang sama, tetap butuh internet ke server yang sama, dan menambah proses build
Android yang harus diperbarui tiap rilis. Untuk kasir toko, PWA lebih murah dirawat.

## 4. Cara kerja offline

| Keadaan | Yang terjadi |
| --- | --- |
| Online | Transaksi langsung masuk server; master data (produk, harga, stok, pelanggan) disalin ke IndexedDB tiap 30 detik |
| Internet mati | Aplikasi tetap terbuka (service worker), jualan tetap jalan, struk tercetak, stok lokal ikut berkurang, transaksi masuk antrean `pendingSales` |
| Internet kembali | Antrean dikirim berurutan tiap 30 detik / saat event `online`, shift offline didaftarkan lebih dulu supaya uang masuk rekap tutup kas |

Syarat yang harus dipenuhi agar offline benar-benar bekerja:

1. Perangkat pernah **login saat online** minimal sekali, dan master data sudah pernah tertarik
   (buka `/kasir` sekali dalam keadaan online).
2. Aplikasi dipasang lewat **HTTPS** (bukan IP:3000) supaya service worker terpasang.
3. Jangan membersihkan data situs / "clear storage" di browser perangkat — itu menghapus cache
   offline dan antrean transaksi yang belum terkirim.

Yang **tidak** bisa dipakai offline: halaman yang butuh hitungan server (laporan, dashboard, kas
tutup dengan angka server, scan nota OCR yang mengunduh model pertama kali). Halaman itu akan
menampilkan pesan galat; kasir tetap bisa menjual.

## 5. Update rilis

```bash
# 1. ambil kode terbaru
cd /tmp/pos-hakim && sudo git pull

# 2. salin ke /opt (node_modules dan backend/.env tidak ikut tertimpa)
sudo rsync -a --exclude node_modules --exclude .git --exclude 'backend/.env' /tmp/pos-hakim/ /opt/pos-hakim/

# 3. dependensi + build + migrasi + restart
sudo -u pos npm ci --prefix /opt/pos-hakim/backend --omit=dev
sudo -u pos npm ci --prefix /opt/pos-hakim/frontend
sudo -u pos npm --prefix /opt/pos-hakim/frontend run build
sudo -u pos npm --prefix /opt/pos-hakim/backend run migrate
sudo systemctl restart pos-hakim
```

Service worker memakai `registerType: 'autoUpdate'`, jadi perangkat memakai versi baru pada
pembukaan berikutnya. Migrasi aman diulang (dicatat di tabel `_migrations`).

## 6. Backup & pemulihan

`/etc/cron.d/pos-backup` menjalankan `pg_dump` tiap 01:15 ke `/var/backups/pos`, menyimpan 30 hari.
Salin hasilnya keluar dari VPS (rclone/rsync ke Drive) — tanpa itu, VPS hilang = data hilang.

```bash
# pulihkan ke database kosong
gunzip -c /var/backups/pos/pos_hakim-2026-11-23.dump.gz | pg_restore -d pos_hakim --no-owner
```

**Uji backup secara berkala** — jangan menunggu sampai butuh:

```bash
sudo pos-uji-restore                    # memakai dump terbaru
sudo pos-uji-restore /path/ke/dump.gz   # atau dump tertentu
```

Skrip itu memulihkan dump ke database sementara (`pos_hakim_uji_restore`), membandingkan jumlah
baris tabel kunci dengan database asli, lalu menghapus database uji lagi. Database produksi tidak
disentuh. Keluar dengan kode 1 bila ada tabel yang tidak cocok.

## 7. Pengamanan & batas yang diketahui

- **Percobaan login dibatasi** di `/api/login`: 10 kegagalan per 15 menit per IP dan per username,
  lalu HTTP 429 dengan `Retry-After` (`backend/src/rateLimit.js`). Login yang berhasil mengosongkan
  hitungan. Ubah lewat `LOGIN_MAKS_GAGAL` / `LOGIN_JENDELA_MENIT` di `backend/.env`.
  Pembatas ini membaca `req.ip`, dan `app.js` sudah menyetel `trust proxy` untuk loopback — jadi di
  balik Caddy yang dihitung adalah IP klien asli, bukan `127.0.0.1` milik proxy.
- **Penjualan offline yang ditolak server tidak hilang.** Bila dua perangkat berjualan offline
  bersamaan dan stoknya tidak cukup untuk keduanya, yang kalah muncul di `/riwayat` dengan alasan
  penolakan dan tombol **Kirim Ulang**; lencana merah di header menunjuk ke sana. Setelah stok
  dikoreksi (atau superadmin menyalakan izin minus untuk produk itu), tombol itu mengirim transaksi
  yang sama dan struknya memperoleh nomor server.
- **Header keamanan dikirim aplikasi** (`backend/src/app.js`): CSP `default-src 'self'` **tanpa
  origin luar** (aset OCR dilayani dari `/ocr` di server ini), `nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, `Cache-Control: no-store` untuk `/api`, dan HSTS saat
  HTTPS. Caddy tidak perlu menambah header ini; jangan menambahkan CSP kedua di Caddyfile karena
  dua CSP akan saling mempersempit.
- Token login berumur 30 hari (`TOKEN_TTL_HOURS`). Selama perangkat tidak pernah online lebih dari
  itu, sesi offline tetap dipakai; begitu online dan token ditolak, kasir diminta login ulang.
