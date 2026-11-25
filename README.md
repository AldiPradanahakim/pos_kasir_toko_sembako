# POS Kasir "Toko Hakim"

> **Baru pertama kali? Baca `MULAI-DISINI.md` — 3 langkah, tanpa basa-basi.**
> Dokumen ini penjelasan lengkapnya; `MULAI-DISINI.md` yang Anda butuhkan untuk sekadar membuka database dan menjalankan aplikasi.

## Apa ini

Aplikasi kasir (point of sale) untuk toko grosir sembako campuran — rokok, minuman, dan sembako.
Aplikasi ini menggantikan pencatatan tulis tangan: kasir melayani penjualan dan mencetak struk,
stok berkurang otomatis, dan pemilik toko bisa melihat laporan harian sampai laba kotor.
Fokusnya kasir + stok + laporan dasar, bukan akuntansi penuh.

Ada **dua peran** pengguna:

- **Kasir** — melayani penjualan di halaman `/kasir` (cari produk, scan barcode, pilih satuan, atur jumlah,
  masukkan uang tunai, cetak struk), melihat dan mencetak ulang riwayat transaksi, melihat stok,
  dan menambah stok masuk. Kasir juga boleh mengubah harga saat melayani, tapi wajib menuliskan alasannya.
  Di tabel keranjang, qty diubah langsung dengan tombol **−** dan **+** di barisnya (kotaknya kecil, 28px);
  mengetuk nama barang atau angka qty membuka pop up untuk mengubah qty/harga atau menghapus barangnya.
  Tiap baris bernomor di samping nama barangnya, dan nama pelanggan hanya menerima huruf.
  Kartu Pembayaran menampilkan **jumlah barang** dan **total qty** keranjang; angka yang sama
  tercetak di struk sebagai baris "Jumlah".
  Untuk pelanggan yang datang membawa **daftar belanja**, tombol **Scan Nota** di baris alat membaca
  foto/tangkapan layar nota itu (OCR di perangkat), lalu menampilkan barangnya — nama, jumlah, dan
  jenis/satuan seperti *renteng*, *pack*, *dus* — untuk diperiksa dan dicentang kasir. Singkatan juga
  dikenali selama inisialnya diisi di halaman Satuan: `2 (r) Beng Beng` terbaca dua renceng, `3 P Indomie`
  terbaca tiga pack. Harga yang dipakai adalah harga jual master produk, **bukan** angka di nota.
  Kasir membuka kas dengan **modal awal** dan menutupnya dengan **uang fisik yang dihitung**; sesudah
  ditutup, laporan penutupannya langsung terbuka sekali di layar kasir (modal, uang seharusnya, uang
  fisik, selisih, omzet) dan bisa dicetak. Riwayat seluruh kas ada di menu **Riwayat Kas** (`/kas`)
  yang khusus superadmin: kasir tidak melihat daftar kas kasir lain.
  Uang laci yang **dipakai selama shift** (beli barang dagangan, bayar ongkos, bayar tukang) dicatat
  lewat tombol **Kas Keluar** di layar kasir, wajib menyebut dipakai untuk apa. Jumlahnya langsung
  mengurangi *seharusnya di laci*, dan rinciannya (jam, keterangan, jumlah) ikut tercetak di laporan
  tutup kas — tanpa itu selisih kas selalu terlihat kurang sebesar uang yang sudah dibelanjakan.
  Salah catat bisa dibatalkan selama kas masih terbuka. **Retur penjualan** dan **pelunasan
  hutang/piutang** yang dilakukan kasir juga langsung menempel ke shift-nya, jadi uang yang keluar
  atau masuk lewat kedua menu itu ikut tercocokkan saat tutup kas.
  Semua kolom uang di aplikasi menampilkan titik ribuan saat diketik (`10.000`, `1.000`, `100.000`);
  angka yang dikirim ke server tetap digit murni.
  Kasir juga memegang menu **Retur**, **Hutang & Piutang**, dan **Pembelian**: mencatat barang
  kembali, mencatat/melunasi hutang-piutang, dan mencatat barang masuk dari supplier. Yang tetap
  milik superadmin adalah koreksinya — ubah nominal, hapus catatan, hapus pembelian — karena itu
  membalik stok dan kas yang sudah tercatat.
- **Superadmin** — semua yang bisa dilakukan kasir, ditambah mengelola produk/kategori/satuan/pengguna,
  termasuk mengisi **inisial** tiap satuan (`r` untuk renceng, `p` untuk pack, `d` untuk dus) yang dipakai
  membaca nota singkat dari kasir,
  menghapus transaksi dari riwayat, mengatur identitas toko, serta membuka halaman laporan dan
  **dashboard**. Superadmin juga yang menentukan, per produk, **satuan hitung** yang dipakai menampilkan
  stok (mis. "dus" untuk rokok) dan apakah produk itu **boleh dijual sampai stok minus**.

Penjualan yang membuat stok minus **ditolak** (pesannya menyebut sisa dan kebutuhan stok) sampai
superadmin menyalakan izin untuk produk itu di halaman stok. Stok masuk, pembelian, retur, dan stok
opname **tidak** butuh izin — barang yang benar-benar datang atau keluar tidak boleh diblokir.

Saat perangkat sedang offline, penjualan disimpan lokal lebih dulu dan dikirim ke server begitu
jaringan kembali. Bila server menolaknya (hampir selalu karena stok sudah diambil perangkat lain),
transaksi itu **tidak hilang**: barisnya muncul di `/riwayat` dengan alasan penolakan dan tombol
**Kirim Ulang**. Setelah penyebabnya dibereskan — stok dikoreksi, atau superadmin menyalakan izin
minus untuk produk itu — tombol tersebut mengirim transaksi yang sama tanpa perlu mengetik ulang,
dan struknya memperoleh nomor server. Lencana merah **"N ditolak server"** di header menuju halaman
itu, jadi penolakan tidak bisa terlewat.

Halaman dashboard menampilkan ringkasan penjualan, stok menipis, kas, hutang/piutang, dan **saran
pembelian** (produk yang stoknya tipis dibanding kecepatan jualnya) yang bisa diunduh sebagai CSV
untuk dibawa ke supplier.

Pembayaran **hanya tunai** — tidak ada QRIS maupun transfer, dan tidak ada gambar QR yang perlu diunggah.

Transaksi yang sudah tersimpan dan tercetak bersifat **final**: tidak ada tombol "Batalkan Transaksi"
di halaman riwayat. Satu-satunya koreksi adalah **Hapus Permanen**, dan tombol itu hanya muncul untuk
superadmin.

Aplikasi bisa tetap dipakai saat internet mati: transaksi disimpan dulu di perangkat, lalu dikirim ke server
secara otomatis saat online kembali — tanpa menghasilkan transaksi ganda.

Lencana **Online/Offline** di header tidak hanya membaca "apakah perangkat punya jaringan", tetapi juga
menembak `GET /api/health` tiap 15 detik. Jadi kalau komputer server mati sementara Wi-Fi toko masih
menyala, aplikasi tetap jujur menampilkan **Offline** — bukan Online yang menyesatkan sampai transaksi gagal.

---

## Keputusan Stack

- **Laravel 11 + Sanctum diganti Express 5 + `pg` (Node.js).** Spesifikasi awal mengunci Laravel, lalu di-override
  oleh pemilik proyek: *"kalau ada laravel ganti saja pakai react atau pakai yang lebih ringan dan responsif"*.
  Jadi PHP/Laravel dibuang seluruhnya — tidak ada `artisan`, tidak ada `composer`, dan tidak ada PHP yang dipakai.
- **Alasannya:** satu runtime Node untuk backend dan frontend, sehingga tidak perlu PHP-FPM + nginx + `composer install`.
  Instalasinya lebih kecil, lebih ringan, dan lebih cepat dijalankan. Token Sanctum diganti token bearer sendiri
  (32 byte acak; yang disimpan di database hanya sidik jarinya).
- **PostgreSQL tetap dipakai** (bukan MySQL/SQLite) karena skema dan aturan integritas datanya sudah dikunci di spesifikasi.
- **Frontend tetap React 18 + Vite + TypeScript**, ditambah Tailwind CSS untuk tampilan, **Dexie** (IndexedDB) untuk
  penyimpanan offline, dan `vite-plugin-pwa` supaya aplikasi bisa dipasang ke desktop.
- **Struk dicetak lewat `window.print()` dengan CSS `@page { size: 58mm auto }`** — tanpa library printer ESC/POS.
  Aplikasi juga **bukan** aplikasi desktop Electron/Tauri; cukup dipasang sebagai PWA.
- **Seluruh kebutuhan fungsional spesifikasi tetap dipenuhi 1:1:** skema tabel, aturan bisnis (konversi stok,
  snapshot harga, nomor struk tidak bolong, idempotensi sinkronisasi, penghapusan transaksi), semua endpoint `/api`,
  peran `kasir`/`superadmin`, dukungan offline, dan laporan.

---

## Prasyarat

- **Node.js versi 20 atau lebih baru** (diuji di v22.12.0), sudah termasuk `npm`.
- **PostgreSQL 14 atau 18** yang servicenya berjalan.
- Windows 10/11 (panduan ini memakai PowerShell/Command Prompt).
- pgAdmin **tidak wajib** — hanya alat bantu untuk melihat isi database secara visual.

Cara memeriksa semuanya sudah siap:

```powershell
node -v
npm -v
```

```powershell
# Melihat PostgreSQL mana yang berjalan dan di port berapa
Get-Service *postgres*
Get-NetTCPConnection -State Listen -LocalPort 5432,5433
```

Kalau `Get-NetTCPConnection` menampilkan port **5433**, berarti instance PostgreSQL 14 yang berjalan.
Kalau **5432**, berarti instance 18. Catat angkanya — nanti dipakai di langkah berikutnya.

---

## Setup PostgreSQL via pgAdmin

### 1. Buka pgAdmin 4

Lewat Start Menu: ketik **pgAdmin 4**. Atau jalankan langsung:

```
C:\Program Files\PostgreSQL\18\pgAdmin 4\runtime\pgAdmin4.exe
```

Saat pertama kali dibuka, pgAdmin Desktop menanyakan **master password**. Password ini adalah pilihan Anda sendiri
dan hanya berfungsi membuka brankas lokal pgAdmin (tempat menyimpan password server yang dicentang "Save password").
Master password ini **tidak berhubungan** dengan akun PostgreSQL maupun dengan akun login aplikasi POS.

> **Soal akun pgAdmin.** pgAdmin Desktop otomatis masuk sebagai akun bawaan `pgadmin4@pgadmin.org` dan tidak
> menyediakan pilihan untuk berganti akun — jadi **tidak ada email atau password pgAdmin yang perlu Anda isi**.
> Akun `aldi.pradana.hakim26@gmail.com` hanya berguna di **Server Mode**, dan Server Mode **tidak diperlukan**
> untuk memakai aplikasi ini.

### 2. Daftarkan server

> **Entri `POS Hakim` sudah terdaftar** di pgAdmin mesin ini — bagian ini hanya untuk pendaftaran ulang
> (mis. pgAdmin dipasang baru). Versi singkatnya ada di `MULAI-DISINI.md`.

> **Penting — jangan pakai server yang sudah ada di daftar.** pgAdmin sering menampilkan entri otomatis
> **`PostgreSQL 14`** dan **`PostgreSQL 18`**. Keduanya login sebagai user `postgres`, yang password-nya
> **tidak diketahui**, sehingga selalu gagal tersambung. Entri yang benar memakai user `pos_hakim` seperti
> di bawah. Versi singkat langkah ini ada di `MULAI-DISINI.md`.

Di panel kiri: klik kanan **`Servers`** → **`Register`** → **`Server…`**

- Tab **General**
  - Name: `POS Hakim`
- Tab **Connection**
  - Host name/address: `127.0.0.1`
  - Port: `5433` *(samakan dengan port PostgreSQL yang Anda temukan di bagian Prasyarat)*
  - Maintenance database: `pos_hakim`
  - Username: `pos_hakim`
  - Password: `pos_hakim_dev`
  - Centang **Save password**
- Klik **`Save`**

### 3. Periksa hasilnya

- **Melihat tabel:** `Servers` → `POS Hakim` → `Databases` → `pos_hakim` → `Schemas` → `public` → `Tables`.
  Setelah `npm run migrate` dijalankan, akan terlihat tabel: `_migrations`, `cash_flows`, `categories`,
  `debts`, `product_aliases`, `product_units`, `products`, `purchase_items`, `purchases`, `returns`,
  `sale_items`, `sales`, `settings`, `stock_movements`, `stock_opnames`, **`struk_counters_tahun`**,
  `tokens`, `units`, `users`.
  Nama yang benar untuk penghitung nomor struk adalah `struk_counters_tahun` (per tahun), bukan
  `struk_counters` — tabel lama itu sudah dibuang karena nomor per hari tidak cukup begitu satu hari
  tembus 999 struk. Kolom `products` bertambah `base_unit_id` (satuan hitung pilihan superadmin) dan
  `izin_minus` (boleh dijual sampai stok minus) sejak migrasi `006`.
- **Melihat data:** klik kanan `pos_hakim` → **`Query Tool`**, lalu jalankan misalnya:

  ```sql
  SELECT * FROM settings;
  SELECT * FROM units ORDER BY name;
  SELECT * FROM products ORDER BY name;
  ```

### 4. Kalau tidak mau lewat pgAdmin (lewat SQL)

Cukup pakai `psql` dari Command Prompt, dijalankan sebagai superuser PostgreSQL:

```sql
CREATE ROLE pos_hakim LOGIN CREATEDB PASSWORD 'pos_hakim_dev';
CREATE DATABASE pos_hakim      OWNER pos_hakim;
CREATE DATABASE pos_hakim_test OWNER pos_hakim;
```

Di PostgreSQL 14, tambahkan satu langkah lagi supaya `npm test` bisa membersihkan skema saat pengujian:

```sql
ALTER SCHEMA public OWNER TO pos_hakim;
GRANT ALL ON SCHEMA public TO pos_hakim;
```

### 5. Penting soal kredensial database

Kredensial `pos_hakim` / `pos_hakim_dev` di atas **hanya untuk pengembangan lokal di mesin ini**.
Untuk pemakaian nyata, password itu **WAJIB diganti**:

```sql
ALTER ROLE pos_hakim PASSWORD 'password-baru-yang-kuat';
```

Setelah diganti, sesuaikan juga `DATABASE_URL` dan `TEST_DATABASE_URL` di `backend\.env`.

> pgAdmin hanya alat bantu visual. Aplikasi **tidak** membutuhkan pgAdmin untuk berjalan — cukup service PostgreSQL.

---

## Instalasi & Menjalankan

**Langkah 0 — siapkan berkas pengaturan.** Berkas `backend\.env` berisi alamat dan password database,
dan sengaja **tidak** ikut disertakan (agar password tidak ikut tersebar). Buat salinannya sekali saja
dari contoh yang tersedia, lalu sesuaikan nomor portnya dengan port PostgreSQL Anda:

```
cd backend
copy .env.example .env
```

Buka `backend\.env` dengan Notepad dan pastikan barisnya sesuai kondisi mesin Anda — terutama **port**
(`5433` untuk PostgreSQL 14, `5432` untuk PostgreSQL 18):

```
DATABASE_URL=postgres://pos_hakim:pos_hakim_dev@127.0.0.1:5433/pos_hakim
TEST_DATABASE_URL=postgres://pos_hakim:pos_hakim_dev@127.0.0.1:5433/pos_hakim_test
PORT=3000
TZ=Asia/Jakarta
TOKEN_TTL_HOURS=720
```

Jalankan sisanya berurutan. **Terminal 1 — backend:**

```
cd backend
npm install
npm run migrate
npm run seed
npm start
```

Backend akan menampilkan `POS Toko Hakim API siap di http://127.0.0.1:3000/api`.

**Terminal 2 — frontend:**

```
cd frontend
npm install
npm run dev
```

Saat mode pengembangan, Vite berjalan di **`http://localhost:5173`** dan otomatis meneruskan permintaan
`/api` ke backend di `http://127.0.0.1:3000` (lihat `frontend/vite.config.ts`). Jadi buka:

```
http://localhost:5173
```

Aplikasi selalu memanggil alamat relatif (`/api/...`), sehingga alamat asalnya sama di mode pengembangan
maupun produksi.

---

## Build Produksi

```
cd frontend
npm run build
```

Setelah selesai, hasilnya ada di `frontend/dist`. Lalu jalankan backend:

```
cd backend
npm start
```

Backend akan menyajikan hasil build frontend tersebut sebagai aplikasi satu halaman (SPA) di **satu alamat**:

```
http://localhost:3000
```

Cukup alamat itu — tidak perlu menjalankan Vite lagi.

> **Menjalankan di server sungguhan (VPS + domain, tanpa komputer di toko):** lihat
> [`deploy/PRODUKSI.md`](deploy/PRODUKSI.md). Isinya skrip pasang sekali jalan
> (`deploy/install-server.sh`), unit systemd, Caddyfile HTTPS, backup harian, prosedur update,
> dan syarat agar jualan tetap jalan saat internet mati.

---

## Install PWA ke Desktop

Supaya bisa dibuka seperti aplikasi biasa (ada ikonnya sendiri, tanpa tampilan browser):

1. Pastikan aplikasi **sudah di-build** (bagian Build Produksi di atas) dan backend sedang berjalan.
2. Buka **`http://localhost:3000`** dengan **Chrome** atau **Edge**.
   Gunakan alamat `3000`, **bukan** `5173` — pada `5173` aplikasi belum punya service worker produksi.
3. Pasang aplikasinya, pilih salah satu cara:
   - Klik **ikon install** (bentuk layar dengan tanda panah ke bawah) di ujung kanan address bar, lalu **`Install`**;
   - atau buka menu **⋮** → **`Cast, save, and share`** → **`Install page as app`**;
   - atau di Edge: menu **…** → **`Apps`** → **`Install this site as an app`**.
4. Aplikasi akan terbuka di jendelanya sendiri dan ikonnya muncul di Start Menu.

**Syaratnya:** halaman harus diakses lewat **HTTPS atau `localhost`** (bukan alamat IP biasa) dan
**service worker harus aktif**. Service worker hanya dibuat saat `npm run build`, jadi PWA tidak akan
muncul kalau Anda memakai `npm run dev`. Untuk memasangnya di komputer lain di jaringan yang sama,
diperlukan HTTPS (misalnya lewat reverse proxy) atau akses tetap melalui `localhost` di komputer itu sendiri.

---

## Akun Pertama & Kebijakan Password

**Tidak ada password bawaan.** `npm run seed` membuat akun `superadmin` dengan password **acak 20
karakter** dan mencetaknya **satu kali** di terminal:

```
  ============================================================
  Password superadmin (hanya ditampilkan sekali): Kf7mQ2xLpR9tVw4nHc8Z
  Simpan di tempat aman, lalu ganti setelah masuk pertama.
  ============================================================
```

Salin sebelum menutup terminal. **Lupa password?** Tidak perlu menghapus data:

```
cd backend
npm run reset:password -- superadmin
```

Perintah itu membuat password acak baru untuk akun tersebut, mencetaknya sekali, dan menandai akun
itu wajib mengganti password saat masuk. Butuh akses ke database (`.env`), jadi tidak bisa dipakai
orang luar. Sesi lama akun itu langsung dicabut.

> **Username tidak peka huruf besar/kecil.** `superadmin`, `SuperAdmin`, dan `SUPERADMIN` semuanya
> masuk ke akun yang sama; keyboard HP yang mengapitalkan huruf pertama tidak lagi membuat login
> gagal. Password tetap peka huruf besar/kecil.

**Kebijakan password** (`backend/src/password.js`) berlaku untuk akun baru dan setiap perubahan:

| Aturan | Nilai |
| --- | --- |
| Panjang | minimal 10 karakter (maksimal 200) |
| Isi | harus ada huruf **dan** angka |
| Tidak boleh | sama dengan username, atau ada di daftar password umum (`password123`, `qwertyuiop`, …) |

Mengganti password **milik sendiri** wajib menyebut password lama, dan sesi lain milik akun itu
langsung dicabut. Reset oleh superadmin menandai akun **wajib ganti password**: sampai diganti,
hanya `GET /me`, `POST /logout`, dan ganti password sendiri yang diizinkan — layar aplikasinya
otomatis menampilkan form ganti password.

Password disimpan sebagai **bcrypt** (cost 10) dengan salt per akun, bukan teks biasa dan bukan
hash cepat seperti MD5/SHA.

**Sesi login** (`frontend/src/store.ts`):

- Kredensial **wajib diketik setiap aplikasi dibuka** — menutup browser/PWA lalu membukanya lagi
  (atau membuka tab baru) selalu kembali ke halaman login, walau token di perangkat masih sah.
  Tujuannya supaya siapa pun yang memegang perangkat tidak otomatis memakai sesi orang sebelumnya.
- **Muat ulang halaman** (F5) di tab yang sama tidak memaksa login ulang — sesi masih milik tab itu.
- **Saat perangkat tidak bisa menjangkau server** (tidak ada jaringan, atau VPS/PC kasir sedang
  mati), sesi tersimpan tetap dipakai: aplikasi terbuka dan kasir bisa melayani pembeli, lalu
  transaksinya menyusul saat server terjangkau lagi. Pemeriksaan `/me` diberi batas waktu 5 detik,
  jadi layar tidak menggantung menunggu server yang tidak menjawab.
  Perangkat yang **belum pernah** login tetap harus login saat online — tidak ada cara masuk offline
  tanpa token yang pernah diterbitkan server.
- Token yang **kedaluwarsa, dicabut, atau akun dinonaktifkan** langsung membuang sesi dan kembali ke
  halaman login. `npm run reset:data` juga mencabut semua token yang ada.
- Tombol **Keluar** menghapus token di perangkat sekaligus di server.
- **Percobaan login dibatasi**: 10 kegagalan dalam 15 menit mengunci alamat IP itu *dan* username
  yang ditebak (HTTP 429, `Retry-After`). Hanya kegagalan yang dihitung, dan login yang berhasil
  mengosongkan hitungan — jadi kasir yang sering buka-tutup aplikasi tidak pernah terkunci.
  Batasnya diatur di `backend/.env`: `LOGIN_MAKS_GAGAL` dan `LOGIN_JENDELA_MENIT`.
- Umur token di server **30 hari** (`TOKEN_TTL_HOURS` di `backend/.env`); token yang sudah kedaluwarsa
  dibersihkan otomatis setiap ada login baru.

**Kredensial database** (hanya untuk pengembangan lokal, lihat bagian Setup PostgreSQL di atas):
role `pos_hakim` / `pos_hakim_dev`, database `pos_hakim` dan `pos_hakim_test`.

---

## Batas Peran & Pengamanan

Yang **tidak** boleh dilakukan kasir, dan sudah ditolak server (bukan hanya disembunyikan di UI):

- membuka kas kasir lain (`GET /shifts/:id` → 403) atau melihat daftar kas semua kasir;
- mengubah/menghapus produk, pengguna, pembelian, retur, kas manual, transaksi, jejak audit;
- menaikkan perannya sendiri jadi superadmin (ganti password sendiri hanya boleh menyentuh password);
- melihat **harga kulak**: `harga_modal` dan `harga_modal_snapshot` hanya dikirim ke superadmin,
  termasuk di `/sync/pull` yang menyalin master data ke IndexedDB perangkat;
- memundurkan tanggal transaksi lebih dari **30 hari** (perangkat yang lama offline tetap diterima).

Lapisan lain:

| Lapisan | Isi |
| --- | --- |
| Header keamanan | CSP `default-src 'self'` **tanpa origin luar**, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `Permissions-Policy`, `Cache-Control: no-store` untuk `/api`, HSTS saat HTTPS |
| Token sesi | 32 byte acak dari `crypto.randomBytes`; server hanya menyimpan SHA-256-nya, 30 hari, dicabut saat logout / ganti password / akun dinonaktifkan |
| Password | bcrypt cost 10 dengan salt per akun; kebijakan minimal 10 karakter, huruf + angka, tidak boleh memuat username |
| Login | 10 gagal / 15 menit per IP **dan** per username; waktu balasan disamakan untuk username yang tidak ada (bcrypt umpan) supaya akun tidak bisa dipetakan |
| SQL | semua nilai lewat parameter `$1..$n`; nama tabel/kolom hanya dari konstanta di kode |
| CSV | sel yang dimulai `=`, `+`, `-`, `@` dinetralkan supaya tidak jadi rumus saat dibuka di Excel |
| Aset OCR | worker, core wasm, dan data bahasa dilayani dari `/ocr` di server sendiri — tidak ada kode pihak ketiga yang berjalan di origin aplikasi |
| Jejak audit | perubahan harga/produk/pengguna, hapus transaksi, koreksi kas, dan tutup kas tercatat di `audit_logs` (read-only, halaman `/audit`) |
| Sesi offline | hanya berlaku bila perangkat pernah login; token yang ditolak server (401) selalu memaksa login ulang |

Yang **belum** ada dan perlu diketahui: tidak ada 2FA, dan kasir yang memegang perangkat masih bisa
mencatat retur/kas keluar — keduanya terlihat di laporan, tutup kas, dan jejak audit, tetapi tidak
butuh persetujuan superadmin. Kalau toko butuh itu, berikutnya adalah alur persetujuan, bukan
pengamanan tambahan.

---

## Perintah Berguna

Semua perintah di bawah dijalankan di dalam folder `backend`, kecuali yang ditandai:

| Perintah | Kegunaan |
| --- | --- |
| `npm start` | Menjalankan server API di port 3000 |
| `npm run dev` | Menjalankan server dengan auto-restart saat berkas diubah |
| `npm run migrate` | Menerapkan skema database. **Aman diulang** — migrasi yang sudah pernah dijalankan akan dilewati |
| `npm run seed` | Mengisi data dasar: akun superadmin, 10 satuan, nama toko. **Aman diulang** — data yang sudah ada tidak ditimpa |
| `npm test` | Menjalankan pengujian otomatis backend (memakai database `pos_hakim_test`) |
| `npm run smoke` | Menguji alur lengkap dari login sampai laporan lewat HTTP sungguhan. Memakai database **`pos_hakim_test`**, bukan database toko, dan membersihkan datanya sendiri |
| `npm run reset:password -- <username>` | Membuat password acak baru untuk satu akun (tanpa menghapus data) dan menandainya wajib ganti saat masuk |
| `npm run reset:data` | **Menghapus seluruh data** dan mengembalikan database ke kondisi baru dipasang (lihat peringatan di bawah) |

Perintah frontend (dijalankan di folder `frontend`):

| Perintah | Kegunaan |
| --- | --- |
| `npm run dev` | Menjalankan Vite di port 5173 |
| `npm run build` | Build produksi ke `frontend/dist` (sekaligus memeriksa tipe TypeScript) |
| `npm run preview` | Melihat hasil build secara lokal |
| `npm run typecheck` | Memeriksa tipe TypeScript saja, tanpa build |

> `npm run migrate` dan `npm run seed` sama-sama **idempotent**: boleh dijalankan berkali-kali tanpa
> merusak data. `npm test` dan `npm run smoke` memakai database terpisah (`pos_hakim_test`) sehingga
> data toko tetap aman.
> Frontend belum memiliki skrip `test` (tidak ada di `frontend/package.json`); pemeriksaan frontend
> dilakukan lewat `npm run typecheck` dan `npm run build`.

### Mengosongkan data: `npm run reset:data`

Perintah ini mengembalikan database ke kondisi **baru dipasang**, tanpa menghapus skemanya:

- seluruh transaksi, produk, kategori, pergerakan stok, nomor struk, **pelanggan, dan shift kas** dihapus;
- pengaturan toko kembali ke awal (nama "Toko Hakim", alamat/telepon kosong);
- semua pengguna dihapus **kecuali** akun `superadmin` (password-nya tidak diubah);
- daftar satuan dikembalikan ke 10 satuan bawaan beserta **inisial**-nya;
- semua sesi login (token) dicabut.

> **PERINGATAN — perintah ini MENGHAPUS DATA PERMANEN.** Semua penjualan, produk, dan pengguna
> selain superadmin akan hilang dan tidak bisa dikembalikan. Jalankan hanya saat benar-benar ingin
> memulai dari nol, dan pastikan sudah ada cadangan bila toko sudah berjualan.
> Untuk mencegah kesalahan, perintah ini **menolak berjalan** pada database yang namanya tidak
> berakhiran `_test`. Bila memang ingin mengosongkan database toko, jalankan dengan `--force`:

```
cd backend
npm run reset:data -- --force
```

Setelah selesai, aplikasi siap dipakai dari nol — transaksi pertama akan bernomor `INV-<tahun>-000001`.
Karena semua produk ikut terhapus, **isi produk dulu** di halaman Produk (superadmin) sebelum melayani
penjualan; layar kasir memang kosong sampai ada produk.

---

## Troubleshooting

**1. Salah port PostgreSQL (5432 vs 5433)**
Di mesin ini bisa ada dua PostgreSQL sekaligus: instance 18 di port **5432** dan instance 14 di port **5433**.
Kalau aplikasi gagal konek (`password authentication failed` atau `ECONNREFUSED`), cek dulu mana yang benar-benar
berjalan:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 5432,5433
```

Lalu samakan angka port di dua tempat: `backend\.env` (pada `DATABASE_URL` dan `TEST_DATABASE_URL`) **dan**
pendaftaran server di pgAdmin. Ingat juga bahwa password superuser kedua instance bisa berbeda — memakai port
yang salah akan terlihat seperti password yang salah.

**2. `must be owner of schema public` (khusus PostgreSQL 14)**
Ini muncul saat `npm test` (yang membersihkan skema lebih dulu) dijalankan pada PostgreSQL 14, karena schema
`public` masih dimiliki superuser. Perbaikannya, jalankan sebagai superuser PostgreSQL pada database
`pos_hakim` **dan** `pos_hakim_test`:

```sql
ALTER SCHEMA public OWNER TO pos_hakim;
GRANT ALL ON SCHEMA public TO pos_hakim;
```

**3. Port 3000 atau 5173 sudah dipakai**
Gejalanya `EADDRINUSE`. Cari proses yang memakainya, lalu hentikan:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3000,5173 | Select-Object LocalPort,OwningProcess
Get-Process -Id <OwningProcess>
Stop-Process -Id <OwningProcess>
```

Kalau ingin memakai port lain untuk backend, ubah `PORT` di `backend\.env` — dan sesuaikan juga
`server.proxy` di `frontend/vite.config.ts` supaya keduanya tetap menunjuk ke alamat yang sama.

**4. Mengulang database dari nol**
Kalau data sudah kacau dan ingin memulai dari awal (misalnya karena salah memasukkan produk),
cara paling mudah adalah dari folder `backend`:

```
npm run reset:data -- --force
```

Perintah itu mengosongkan semua data tanpa menghapus skema, jadi tidak perlu migrasi ulang.
Lihat bagian **Perintah Berguna** di atas untuk rincian apa saja yang dihapus.

Kalau ingin sekaligus membangun ulang skemanya (misalnya setelah mengubah berkas migrasi),
jalankan sebagai superuser PostgreSQL pada database `pos_hakim`:

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
```

lalu bangun ulang dari folder `backend`:

```
npm run migrate
npm run seed
```

> **Perhatian:** kedua cara di atas **menghapus seluruh data** — produk, transaksi, dan pengguna akan
> hilang dan tidak bisa dikembalikan. Pastikan sudah ada cadangan bila data sudah dipakai berjualan.
> Setelah `DROP SCHEMA`, bila muncul lagi error `must be owner of schema public`, ulangi langkah
> `ALTER SCHEMA public OWNER TO pos_hakim;` pada poin 2 di atas.
# pos
