# PROMPT EKSEKUSI: POS Kasir "Toko Hakim"

Bangun aplikasi lengkap dari nol di `C:\Aplikasi`. Kerjakan sampai SEMUA kriteria di bagian **Definition of Done** lulus. Jangan berhenti di tengah dan jangan tanya balik — semua keputusan sudah dikunci di dokumen ini. Kalau ada detail kecil yang belum disebut, ambil pilihan paling sederhana yang konsisten dengan aturan di bawah.

---

## 1. Ringkasan produk
POS kasir untuk toko grosir sembako campuran (rokok, minuman, sembako). Menggantikan pencatatan tulis tangan. Fokus: kasir + stok + laporan dasar. Bukan akuntansi penuh.

## 2. Stack (dikunci, jangan ganti)
- Backend: **Laravel 11** (API + Sanctum token auth).
- Database: **PostgreSQL** (setup via pgAdmin, sertakan panduan di README).
- Frontend: **React 18 + Vite + TypeScript** SPA, terpisah dari backend (folder `frontend/`), komunikasi via REST JSON.
- PWA: `vite-plugin-pwa` (Workbox) untuk app-shell + runtime caching.
- Offline store: **Dexie** (IndexedDB).
- Cetak struk: HTML + CSS `@media print` (`@page { size: 58mm auto; margin: 0 }`) lalu `window.print()`. TIDAK pakai library ESC/POS.
- Styling: Tailwind CSS.
- Bahasa UI: Indonesia.

## 3. Prasyarat & verifikasi awal
Sebelum mulai, cek `php`, `composer`, `node`, `npm`, `psql` tersedia. Kalau belum ada, laporkan dengan jelas apa yang harus diinstal user, lalu lanjut bagian yang bisa dikerjakan. Jangan mengunduh installer sendiri.

## 4. Struktur folder
```
C:\Aplikasi\
  backend\      (Laravel)
  frontend\     (React PWA)
  README.md
```

## 5. Skema database (wajib, di backend)
- `users`: name, username (unik), password, role (`kasir`|`superadmin`), is_active, timestamps.
- `categories`: name (unik), is_active.
- `units`: name (unik), is_active. Contoh isi: pcs, renceng, pack, dus, slop, bal, karung, kg, 1/2 kg, 1/4 kg.
- `products`: name, category_id, base_unit (`pcs`|`gram`), barcode (nullable, unik), is_active.
- `product_units`: product_id, unit_id, isi (integer, jumlah dalam base_unit), harga_jual (integer rupiah), harga_modal (integer rupiah), barcode (nullable). Unik per (product_id, unit_id).
- `sales`: uuid (unik), no_struk (nullable sampai tersinkron), user_id, total, metode_bayar (`tunai`|`transfer`|`qris`), dibayar, kembalian, status (`selesai`|`dibatalkan`), alasan_batal (nullable), dibatalkan_oleh (nullable), created_at, synced_at.
- `sale_items`: sale_id, product_id, unit_id, unit_name (snapshot), qty, isi_snapshot, harga_snapshot, harga_modal_snapshot, harga_diubah (bool), alasan_ubah_harga (nullable).
- `stock_movements`: product_id, type (`masuk`|`keluar`|`penyesuaian`|`pembatalan`), qty_base (integer, boleh negatif), reference_type/reference_id (nullable, mis. sale), note (nullable), user_id, created_at.
- `settings`: key (unik), value. Untuk `toko_nama` (default "Toko Hakim"), `qris_image_path`, `alamat`, `telepon`.

Semua ID pakai auto-increment biasa KECUALI identitas sync yang memakai `uuid` pada `sales`. Semua uang = integer rupiah (tanpa desimal). Stok = integer di base_unit.

## 6. Aturan bisnis (kunci, harus benar)
1. Stok selalu dihitung dalam `base_unit` (pcs atau gram). Stok = SUM(`stock_movements.qty_base`).
2. Konversi otomatis memakai `isi` yang diinput user. Jual 2 dus (isi 40) => `stock_movements` keluar = -80 pcs.
3. Subtotal baris = `harga_snapshot` x `qty`. WAJIB otomatis.
4. Harga antar satuan TIDAK diturunkan otomatis. Tiap satuan punya `harga_jual` & `harga_modal` sendiri, diinput manual.
5. `1/2 kg` dan `1/4 kg` = satuan diskrit, qty bulat, `isi` dalam gram (500 / 250).
6. Isi & harga satuan diinput SEKALI saat buat/edit produk. Tidak diulang saat stok masuk atau transaksi.
7. Ubah harga saat transaksi: kasir boleh, TAPI wajib isi `alasan_ubah_harga`; catat di `sale_items`.
8. Kembalian dihitung pas sampai rupiah. Tidak ada pembulatan.
9. Batal transaksi:
   - Sebelum disimpan (masih keranjang): bebas edit/hapus item.
   - Setelah tersimpan: hanya "Batalkan Transaksi" penuh, wajib `alasan_batal`, hanya `superadmin` (atau kasir memasukkan PIN/username+password superadmin). Tidak ada edit sebagian.
   - Tidak dihapus; hanya `status=dibatalkan`. Stok dikembalikan lewat `stock_movements` tipe `pembatalan`.
10. Stok masuk: form "Tambah Stok" — pilih produk, pilih satuan, qty, otomatis konversi ke base_unit via `isi`. Tanpa supplier/PO/harga beli per pembelian.
11. Barcode: cari by barcode (scanner bertindak sebagai keyboard) DAN cari by nama/kategori.
12. QRIS: **QRIS statis dari bank**. Kasir pilih QRIS -> tampilkan gambar QR toko dari `settings.qris_image_path` -> kasir tandai lunas manual. Tidak ada payment gateway.
13. Offline:
    - `uuid` transaksi dibuat di perangkat (crypto.randomUUID).
    - Transaksi disimpan lokal lebih dulu, lalu diposting ke server.
    - Server idempotent: kalau `uuid` sudah ada, kembalikan data yang ada (jangan buat baru).
    - `no_struk` final diberikan server saat sync. Sebelum sync, perangkat menampilkan nomor sementara `OFF-<yyyymmddhhmmss>`.
    - `no_struk` server format: `INV-YYYYMMDD-####`, urut per hari, tidak bolong.
    - Offline sale tetap diterima walau stok jadi minus; tandai di laporan stok sebagai "minus, perlu dicek".
14. Tidak ada modul pelanggan, piutang, supplier, PO, retur, timbangan, pajak, WhatsApp, harga bertingkat.

## 7. Role & hak akses
- `kasir`: kasir, riwayat transaksi (lihat + cetak ulang), lihat stok, tambah stok.
- `superadmin`: semua kasir + CRUD produk/kategori/satuan/user, batalkan transaksi, pengaturan toko, laporan.

## 8. API endpoint (backend, prefix `/api`)
Auth:
- `POST /login` (username, password) -> token
- `POST /logout`
- `GET /me`

Master (superadmin untuk write):
- `GET|POST|PUT|DELETE /categories`
- `GET|POST|PUT|DELETE /units`
- `GET|POST|PUT|DELETE /products` (produk + array product_units dalam satu payload)
- `GET|POST|PUT|DELETE /users`

Stok:
- `GET /stock` (per produk: stok base_unit + tampilan enak dibaca, mis. "3 dus 12 pcs")
- `GET /stock/movements`
- `POST /stock/in` (product_id, unit_id, qty, note)

Transaksi:
- `POST /sales` (body termasuk `uuid`, items[], metode_bayar, dibayar) -> idempotent by uuid
- `GET /sales` (filter tanggal, status)
- `GET /sales/{id}`
- `POST /sales/{id}/cancel` (alasan, kredensial superadmin bila pemanggil kasir)

Sinkronisasi & master pull:
- `GET /sync/pull` -> categories, units, products+product_units, settings, stok terkini. Dipakai frontend untuk isi Dexie.

Laporan (superadmin):
- `GET /reports/daily?date=`
- `GET /reports/sales?from=&to=`
- `GET /reports/payment-methods?from=&to=`
- `GET /reports/profit?from=&to=` (laba kotor = sum((harga_snapshot - harga_modal_snapshot) * qty))
- `GET /reports/price-changes?from=&to=`

Pengaturan:
- `GET /settings`
- `PUT /settings` (toko_nama, alamat, telepon)
- `POST /settings/qris` (upload gambar)

## 9. Halaman frontend (React)
- `/login`
- `/kasir` — panel kiri: search + scan barcode, grid/hasil produk, pilih satuan, qty, tombol tambah. Panel kanan: keranjang (item, qty, harga, edit harga + alasan), total, pilih metode bayar, input dibayar, kembalian, tombol Simpan & Cetak. Indikator online/offline + jumlah transaksi menunggu sync.
- `/kasir/struk/:uuid` — tampilan struk siap cetak 58mm (header "Toko Hakim", no struk, tanggal, kasir, item, total, metode, dibayar, kembalian, footer terima kasih).
- `/riwayat` — daftar transaksi, filter tanggal/status, detail, cetak ulang, tombol batalkan (superadmin / kasir + kredensial superadmin).
- `/produk` — tabel produk, form buat/edit dengan baris satuan dinamis (unit, isi, harga jual, harga modal, barcode).
- `/kategori`, `/satuan` — CRUD sederhana.
- `/stok` — stok per produk + tombol Tambah Stok + riwayat pergerakan.
- `/laporan` — tab: harian, penjualan, metode bayar, laba kotor, perubahan harga.
- `/pengaturan` — nama toko, alamat, telepon, upload QRIS.
- `/users` — CRUD user (superadmin).
- Layout: sidebar sesuai role, tampilkan nama user & tombol logout.

## 10. Offline implementation (detail wajib)
- Dexie tables: `categories`, `units`, `products`, `productUnits`, `settings`, `pendingSales`, `cachedStock`.
- Saat app load & saat `online` event: panggil `/sync/pull`, timpa data Dexie.
- Semua halaman baca master data dari Dexie (bukan langsung API), supaya tetap jalan offline.
- Simpan transaksi: tulis ke `pendingSales` (status `pending`), langsung tampilkan struk sementara, lalu coba POST. Sukses -> hapus dari queue + simpan no_struk server. Gagal/offline -> biarkan di queue.
- Proses queue otomatis: saat event `online`, saat app dibuka, dan tiap 30 detik. Kirim berurutan. Idempotent by uuid.
- Service worker: precache app shell; runtime cache GET `/api/sync/pull` dan aset; jangan cache POST.
- Tampilkan banner "Offline — transaksi disimpan lokal" dan badge jumlah pending.

## 11. Non-fungsional
- Validasi server & client: qty > 0 integer, harga >= 0 integer, `isi` > 0, `dibayar >= total` untuk tunai.
- Timezone Asia/Jakarta.
- Password pakai bcrypt. Token Sanctum.
- `.env.example` untuk backend dengan koneksi `pgsql`.
- Jangan hardcode harga/isi/produk apa pun. Hanya seeder master dasar.

## 12. Seeder
- 1 superadmin: username `superadmin`, password `password` (wajib ganti, catat di README).
- Master `units` dasar: pcs, renceng, pack, dus, slop, bal, karung, kg, 1/2 kg, 1/4 kg.
- `settings`: toko_nama = "Toko Hakim".
- TIDAK ada seeder produk/kategori/harga.

## 13. Testing (wajib, tanpa framework tambahan di luar bawaan)
Backend feature test (Pest/PHPUnit bawaan Laravel) untuk:
1. Konversi stok: buat produk base pcs dengan satuan dus isi 40, jual 2 dus -> stok -80, movement tercatat.
2. Idempotensi sync: POST `/sales` dengan uuid sama dua kali -> hanya 1 sale dibuat.
3. Pembatalan: cancel sale -> stok kembali, status `dibatalkan`, `no_struk` tidak hilang.
4. Snapshot: ubah `harga_jual` produk setelah transaksi -> `sale_items` lama tidak berubah.
5. Hak akses: kasir tidak bisa akses endpoint superadmin (403).

Jalankan `php artisan test` dan pastikan hijau.

## 14. Definition of Done
- `composer install`, `npm install` sukses.
- Migrasi + seeder jalan di PostgreSQL: `php artisan migrate --seed`.
- `php artisan test` hijau.
- Login 2 role berfungsi, menu terpisah.
- Buat produk dengan 3 satuan (pcs, dus isi 40, bal isi 400) + harga, lalu transaksi campuran multi-satuan; stok berkurang tepat di base_unit.
- Ubah harga di keranjang tanpa alasan -> ditolak; dengan alasan -> tersimpan.
- Struk tampil dan bisa dicetak (CSS 58mm).
- Transaksi berhasil dibuat dengan internet/server dimatikan, tersimpan di queue, dan tersinkron tanpa duplikat saat online.
- Batal transaksi superadmin mengembalikan stok.
- QRIS statis tampil di layar kasir.
- `npm run build` sukses dan app bisa di-install sebagai PWA desktop (manifest + service worker valid).
- README berisi: setup PostgreSQL via pgAdmin, isi `.env`, migrate+seed, cara jalankan backend & frontend, cara build, cara install PWA ke desktop, kredensial default, dan cara ganti password.

## 15. Cara kerja yang diharapkan
Kerjakan berurutan: backend (migrasi, model, seeder, API, test) -> frontend (auth, layout, master data, kasir, struk, stok, laporan, pengaturan, users) -> offline (Dexie + queue + sync) -> PWA -> README. Setelah setiap tahap besar, jalankan test/build yang relevan. Di akhir, jalankan seluruh Definition of Done dan laporkan hasilnya satu per satu (lulus/gagal + bukti singkat).

## 16. DILARANG
- Jangan pakai Electron/Tauri; cukup PWA installable.
- Jangan integrasi Midtrans/payment gateway/verifikasi QRIS otomatis.
- Jangan buat fitur WhatsApp.
- Jangan buat modul pelanggan, piutang, supplier, PO, retur, timbangan, pajak, harga bertingkat.
- Jangan pakai library printer ESC/POS; cukup `window.print()`.
- Jangan taruh harga/isi/produk contoh di database produksi.
