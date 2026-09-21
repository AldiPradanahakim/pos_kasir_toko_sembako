# POS Toko Hakim — Backend

API POS (point of sale) untuk toko grosir sembako. Node.js ESM + Express 5 + PostgreSQL, SQL mentah tanpa ORM.

## Keputusan Stack

- **Laravel 11 + Sanctum diganti Express 5 + `pg`.** Spesifikasi awal (`PROMPT-POS.md`) mengunci Laravel, lalu di-override user: *"kalau ada laravel ganti saja pakai react atau pakai yang lebih ringan dan responsif"*. Jadi PHP/Laravel dibuang seluruhnya — tidak ada `artisan`, tidak ada `composer`, tidak ada PHP di mesin ini yang dipakai.
- **Alasan:** satu runtime Node untuk backend dan frontend (tidak perlu PHP-FPM + nginx + `composer install`), jejak instalasi lebih kecil, dan startup/waktu deploy jauh lebih ringan. Token Sanctum diganti token bearer sendiri: 32 byte acak, yang disimpan di database hanya hash SHA-256-nya.
- **PostgreSQL tetap** (bukan MySQL/SQLite) karena skema, tipe, dan aturan integritasnya sudah dikunci di spesifikasi.
- **React 18 + Vite + TypeScript tetap** untuk frontend — pemisahan `backend/` dan `frontend/` tidak berubah.
- **Semua kebutuhan fungsional spesifikasi dipetakan 1:1** ke stack baru: skema tabel, aturan bisnis (konversi stok, snapshot harga, no_struk tidak bolong, idempotensi sync, pembatalan), seluruh endpoint `/api`, role `kasir`/`superadmin`, dukungan offline, dan laporan. Tidak ada shim Laravel dan tidak ada implementasi PHP paralel.
- **Fitur lanjutan (migrasi `002_fitur_lengkap.sql`).** Larangan spesifikasi awal atas modul pelanggan/supplier/piutang dibatalkan oleh permintaan user, sehingga ditambahkan: buku kas (pemasukan & pengeluaran), pembelian dari supplier, retur penjualan & pembelian, hutang/piutang, stok opname, pemetaan alias OCR struk, nama pelanggan pada struk, hapus riwayat pesanan, dan seperangkat laporan lengkap (lihat bagian Endpoint). Migrasi ini murni **additive** — tidak ada tabel/kolom lama yang diubah atau dihapus.
- **Pembelian tanpa harga & omset khusus superadmin (migrasi `003_pembelian_tanpa_harga.sql`).** Pemilik toko mencatat pembelian hanya dengan produk + jumlah, jadi `purchase_items.harga_beli`/`subtotal` dibuat boleh `NULL`, `purchases.total` dapat `DEFAULT 0`, dan pembelian berhenti menulis buku kas. Sekaligus `GET /reports/omzet` yang dulu boleh dibaca kasir kini dipagari `requireSuperadmin`. Migrasi ini juga murni **additive**: tidak ada kolom yang dihapus dan tidak ada baris lama yang diubah.

- **Pembayaran hanya tunai (migrasi `004_tunai_saja.sql`).** Atas permintaan pemilik, QRIS dan transfer dihapus: `sales.metode_bayar` dibatasi `CHECK (metode_bayar = 'tunai')` (data lama dinormalkan lebih dulu), `POST /sales` menolak metode lain dengan 422, unggahan gambar QRIS beserta folder `storage/` dan penyajian `/uploads/**` dibuang, dan laporan `GET /reports/payment-methods` dihapus karena isinya hanya satu metode. Spesifikasi awal (`PROMPT-POS.md`) yang meminta QRIS statis karena itu sudah tidak berlaku.

## Prasyarat

- Node.js >= 20 (diuji di v22.12.0) dan npm >= 10.
- PostgreSQL 14 atau 18, service berjalan.
- Tidak butuh pgAdmin untuk menjalankan aplikasi — pgAdmin hanya alat bantu visual.

## Setup PostgreSQL via pgAdmin

1. **Buka pgAdmin 4.** Lewat Start Menu: ketik `pgAdmin 4`. Atau langsung jalankan
   `C:\Program Files\PostgreSQL\18\pgAdmin 4\runtime\pgAdmin4.exe`.
   Saat pertama kali membuka, pgAdmin meminta *master password* untuk membuka vault-nya; pakai akun pgAdmin yang sudah dibuat (email `aldi.pradana.hakim26@gmail.com`). Password pgAdmin disimpan terpisah dan sengaja **tidak** ditulis di README ini.

2. **Daftarkan server.** Di panel kiri, klik kanan `Servers` → `Register` → `Server…`
   - Tab **General** → Name: `POS Hakim`
   - Tab **Connection**
     - Host name/address: `127.0.0.1`
     - Port: `5433` (port instance PostgreSQL yang dipakai; lihat catatan port di bawah)
     - Maintenance database: `pos_hakim`
     - Username: `pos_hakim`
     - Password: `pos_hakim_dev`
     - Centang **Save password** → `Save`

3. **Cek hasilnya.** `Servers` → `POS Hakim` → `Databases` → `pos_hakim` → `Schemas` → `public` → `Tables`.
   Setelah `npm run migrate` dijalankan, tabel yang muncul: `_migrations`, `cash_flows`, `categories`,
   `debts`, `product_aliases`, `product_units`, `products`, `purchase_items`, `purchases`, `returns`,
   `sale_items`, `sales`, `settings`, `stock_movements`, `stock_opnames`, `struk_counters`, `tokens`,
   `units`, `users`.
   Untuk memeriksa data: klik kanan `pos_hakim` → `Query Tool`, lalu jalankan
   `SELECT * FROM settings;` atau `SELECT * FROM units ORDER BY name;`.

4. **Catatan port.** Instance PostgreSQL 18 default di `5432`, instance 14 default di `5433`. Cek yang benar-benar
   mendengarkan dengan `Get-NetTCPConnection -State Listen -LocalPort 5432,5433`. Port yang dipakai proyek ini
   ditulis di `.env` (`DATABASE_URL`), dan **harus sama** dengan yang diisi di pgAdmin.

5. **Membuat akun pgAdmin baru / reset password** lewat CLI resmi pgAdmin (jangan mengedit SQLite-nya langsung):
   ```
   & "C:\Program Files\PostgreSQL\18\pgAdmin 4\python\python.exe" "C:\Program Files\PostgreSQL\18\pgAdmin 4\web\setup.py" add_user "email@contoh.com" "password" --admin
   ```

## Konfigurasi `.env`

Salin `.env.example` menjadi `.env` lalu sesuaikan:

```
DATABASE_URL=postgres://pos_hakim:pos_hakim_dev@127.0.0.1:5433/pos_hakim
TEST_DATABASE_URL=postgres://pos_hakim:pos_hakim_dev@127.0.0.1:5433/pos_hakim_test
PORT=3000
TZ=Asia/Jakarta
TOKEN_TTL_HOURS=720
```

Membuat role dan database bila belum ada (jalankan sebagai superuser PostgreSQL):

```sql
CREATE ROLE pos_hakim LOGIN CREATEDB PASSWORD 'pos_hakim_dev';
CREATE DATABASE pos_hakim OWNER pos_hakim;
CREATE DATABASE pos_hakim_test OWNER pos_hakim;
```

## Migrasi & seed

```
npm install
npm run migrate      # menerapkan migrations/*.sql berurutan, idempotent lewat tabel _migrations
npm run seed         # idempotent: superadmin, 10 satuan dasar, settings.toko_nama
npm run seed:produk  # idempotent: 100 produk grosir + kategori & satuan yang dibutuhkannya
```

`npm run seed` **tidak** membuat kategori/produk/harga contoh — sesuai spesifikasi.

`npm run seed:produk` mengisi 100 produk grosir Indonesia (Rokok, Minuman, Makanan, Sembako,
Perawatan, Lain-lain) beserta 1–3 satuan per produk dengan isi dan harga yang masuk akal
(mis. Indomie Goreng pcs 3.500 / dus isi 40 132.000, Gudang Garam Surya bungkus 32.000 /
slop isi 10 305.000). Sifatnya:

- **Idempotent**, kuncinya **nama produk**: produk yang namanya sudah ada dilewati, jadi
  penjalanan kedua membuat 0 produk. Aman dijalankan berulang.
- **Tidak pernah mengubah atau menghapus** data yang sudah ada — termasuk `Sedaap Soto`,
  kategori `Makanan`/`Minuman`, dan satuan buatan pengguna. Kategori/satuan baru hanya
  ditambahkan bila belum ada.
- **Tidak mengisi stok** dan tidak membuat penjualan; stok diisi sendiri lewat halaman stok.
- Barcode diturunkan dari nama produk (sha256 → `899` + 10 digit), jadi stabil di setiap
  penjalanan dan tidak berubah walau urutan daftar diubah.
- Ringkasan yang dicetak: `produk dibuat: N, dilewati: M, satuan dibuat: K`.

### Backfill buku kas (`npm run backfill:kas`)

```
npm run backfill:kas
```

Fitur arus keuangan baru berlaku sejak migrasi `002_fitur_lengkap.sql`. Penjualan yang sudah ada
**sebelum** itu tidak punya baris `cash_flows`, sehingga omzet dan pemasukan kas tidak cocok untuk
data lama. Skrip ini menambalnya:

- Penjualan `selesai` yang belum punya baris kas `masuk`/`penjualan` dibuatkan satu baris sebesar
  `total`, bertanggal hari Jakarta dari `created_at` — sama seperti alur penjualan baru.
- Penjualan `dibatalkan` yang **punya** baris `masuk` tetapi belum punya penyeimbang dibuatkan
  baris `keluar`/`pembatalan`-nya (bertanggal penjualannya, supaya pasangan itu saling meniadakan
  di periode yang sama).

**Idempotent**: hanya MENAMBAH baris yang belum ada; baris `cash_flows` yang sudah ada tidak pernah
diubah atau dihapus, jadi aman dijalankan berulang. Melaporkan `dibuat: N, dilewati: M`.

Penjualan yang dibatalkan sengaja **tidak** diberi baris `masuk`. Omzet juga mengabaikan transaksi
`dibatalkan`, jadi memberi baris `masuk` pada transaksi batal akan membuat pemasukan kas lebih besar
dari omzet — persis ketidakcocokan yang ingin dihilangkan skrip ini. Transaksi batal menyumbang 0,
sama seperti netto sepasang baris masuk/keluar pada transaksi baru, sehingga saldo kas tetap benar.

Setelah dijalankan, dua hal ini harus sama:

```sql
-- pemasukan kas dari penjualan = omzet
SELECT COALESCE(SUM(jumlah), 0) FROM cash_flows WHERE tipe = 'masuk' AND kategori = 'penjualan';
SELECT COALESCE(SUM(total), 0)  FROM sales WHERE status = 'selesai';
```

dan untuk periode yang sama, `total` pada `GET /reports/omzet` sama dengan `total_masuk` pada
`GET /reports/cash-flow`.

Untuk mengosongkan kembali semua data transaksi dan produk tanpa menyentuh skema, pakai
`npm run reset:data` (lihat bagian Testing di bawah).

## Menjalankan

```
npm start         # http://127.0.0.1:3000/api
npm run dev       # mode watch
```

Bila `../frontend/dist` ada, backend otomatis menyajikan hasil build frontend sebagai SPA (termasuk
history fallback), sehingga produksi cukup satu origin.

## Testing

```
npm test            # migrasi ulang database tes, lalu node --test
npm run smoke       # uji end-to-end lewat HTTP sungguhan + database uji
npm run reset:data  # kosongkan data, kembalikan ke kondisi baru dipasang (perusak)
```

`npm test` memakai `TEST_DATABASE_URL` dan menjalankan `node --test` (bawaan Node, tanpa jest/vitest/supertest).

`npm run smoke` menjalankan server sendiri di port `3101` (ubah lewat `SMOKE_PORT`), menyiapkan skema dan
data seed database uji, lalu membersihkan datanya sendiri. Skrip ini menulis data sungguhan, jadi **selalu
memakai `TEST_DATABASE_URL`** dan menolak berjalan bila nama database-nya tidak berakhiran `_test` — database
produksi tidak pernah tersentuh.

`npm run reset:data` mengosongkan seluruh data transaksi dan produk lalu mengembalikan pengaturan, satuan,
dan akun superadmin ke kondisi seed, tanpa menghapus skema. Perintah ini **menolak berjalan** pada database
yang namanya tidak berakhiran `_test` kecuali diberi `--force`:

```
npm run reset:data            # untuk database uji
npm run reset:data -- --force # untuk database produksi (MENGHAPUS SEMUA DATA)
```

## Kredensial Default

- **Aplikasi:** `superadmin` / `password` (role `superadmin`). **WAJIB diganti.**
  Cara mengganti: login sebagai superadmin → halaman `/users` → ubah password, atau `PUT /api/users/:id` dengan
  field `password`. Alternatif: jalankan `npm run seed` (seed tidak menimpa password yang sudah ada), lalu ubah lewat `/users`.
- **Database:** role `pos_hakim` / `pos_hakim_dev` (LOGIN, CREATEDB), database `pos_hakim` dan `pos_hakim_test`.

## Endpoint

Semua di bawah prefix `/api`. Autentikasi: header `Authorization: Bearer <token>`. Error berbentuk
`{"error":"pesan"}` dengan status 401/403/404/422. Endpoint tulis butuh `superadmin` kecuali disebutkan lain.

| Grup | Endpoint |
| --- | --- |
| Auth | `POST /login`, `POST /logout`, `GET /me` |
| Master | `GET\|POST\|PUT\|DELETE /categories`, `/units`, `/products`, `/users` |
| Stok | `GET /stock`, `GET /stock/movements`, `POST /stock/in` (kasir boleh), `POST /stock/in/bulk` (kasir boleh), `GET\|POST /stock-opnames`, `GET /product-aliases` |
| Transaksi | `POST /sales` (kasir boleh), `GET /sales`, `GET /sales/:id`, `GET /sales/by-uuid/:uuid`, `POST /sales/:id/cancel`, `DELETE /sales/:id`, `POST /sales/purge` |
| Pembelian | `GET\|POST /purchases`, `GET\|DELETE /purchases/:id` |
| Keuangan | `GET\|POST /cash-flows`, `GET /cash-flows/summary`, `PUT\|DELETE /cash-flows/:id` |
| Retur & hutang | `GET\|POST /returns`, `DELETE /returns/:id`, `GET\|POST\|PUT\|DELETE /debts` |
| Sinkronisasi | `GET /sync/pull` |
| Laporan | `GET /reports/{omzet,daily,sales,profit,price-changes,umum,transactions,cash-flow,sales-by-category,purchases,modal,debts,profit-loss,returns,stock-flow}` (superadmin), `GET /reports/{stock-flow,cash-flow}.csv` (superadmin) |
| Pengaturan | `GET /settings`, `PUT /settings` |

Ringkasan bentuk respons yang tidak jelas dari namanya:

- `GET /reports/omzet` → `{hari_ini:{total,transaksi}, bulan_ini:{…}, tahun_ini:{…}, hari_ini_items}`,
  zona Asia/Jakarta, transaksi `dibatalkan` tidak dihitung. **Hanya superadmin** (dulu satu-satunya
  laporan yang boleh dibaca kasir; sekarang tidak lagi). Semua rute laporan memasang
  `requireSuperadmin` sendiri-sendiri; penjaga menyeluruh (`router.use`) di router yang dipasang
  di `/api` akan ikut memblokir router lain yang dipasang setelahnya, jadi pola itu tidak dipakai.
- `GET /cash-flows` → `{from,to,tipe,kategori,saldo_awal,masuk,keluar,saldo,rows[]}`; tiap baris
  membawa `saldo` berjalan, dan `rows` diurutkan menaik (tanggal, id) karena saldo berjalan hanya
  masuk akal secara kronologis.
- `POST /stock/in/bulk` → `{ok:true, applied:n, movements:[…]}`. Seluruh baris diterapkan dalam
  SATU transaksi: satu baris tidak sah ⇒ 422 dan tidak ada yang setengah masuk. Sekaligus
  meng-upsert `aliases[]` ke `product_aliases` (`ON CONFLICT (alias) DO UPDATE`).
- `POST /stock-opnames` → `{ok:true, applied:n, rows:[…]}`; `stok_fisik` dalam **base_unit**.
- `DELETE /sales/:id` → `{ok:true, deleted:n, restored_movements:n, restore_stock:bool}`;
  `POST /sales/purge` menambah `from`/`to` pada respons.
- Dua rute `.csv` mengirim `text/csv; charset=utf-8` dengan **BOM UTF-8** dan header
  `Content-Disposition: attachment; filename="arus-stok-<from>-<to>.csv"`. Isinya satu tabel persegi
  (semua baris punya jumlah kolom sama dengan tajuknya) supaya rapi dibuka di Excel: arus stok
  berakhir dengan baris `TOTAL`, sedangkan arus kas memakai kolom `Bagian` (`Saldo Awal`/`Harian`/
  `TOTAL`/`Kategori`) agar rincian kategori tidak tampak sebagai data nyasar. Perhatikan
  `fetch().text()` **membuang BOM** (perilaku decoding WHATWG) — periksa byte mentahnya bila
  BOM perlu diuji.

## Aturan bisnis yang dijaga server

- Stok selalu `SUM(stock_movements.qty_base)` dalam `base_unit` (pcs/gram). Jual 2 dus isi 40 → movement `keluar` −80.
- Subtotal baris = `harga_snapshot × qty`, dihitung server. Harga antar satuan tidak pernah diturunkan otomatis.
- Ubah harga saat transaksi boleh, tapi tanpa `alasan_ubah_harga` ditolak 422; `harga_diubah` diisi server.
- Pembayaran hanya **tunai**: `metode_bayar` selain `'tunai'` ditolak 422, dan kolomnya di database
  dibatasi `CHECK (metode_bayar = 'tunai')` (migrasi `004_tunai_saja.sql` menormalkan data lama).
- Kembalian pas sampai rupiah. `dibayar >= total` wajib.
- `no_struk` `INV-YYYYMMDD-####` diberikan server, urut dan tidak bolong per hari Jakarta (tabel `struk_counters`, dikunci dalam transaksi yang sama).
- Idempotensi offline: `POST /sales` dengan `uuid` yang sama mengembalikan transaksi yang sudah ada (`duplicate: true`), tidak membuat baris kedua.
- Pembatalan hanya penuh, wajib `alasan_batal`, superadmin atau kasir dengan kredensial superadmin. Transaksi tidak dihapus: `status='dibatalkan'`, `no_struk` tetap, stok dikembalikan lewat movement `pembatalan`.
- Stok minus dari penjualan offline tetap diterima dan ditandai `minus: true` di `GET /stock`.

### Hapus riwayat pesanan (superadmin)

- `DELETE /sales/:id` **menghapus permanen** transaksi beserta `sale_items`-nya. Berbeda dari
  pembatalan, barisnya benar-benar hilang dari database.
- Stok dikembalikan lewat movement `penyesuaian` sebesar `+total base_unit` transaksi itu, dengan
  catatan `Hapus transaksi <no_struk>`. **Hanya untuk transaksi berstatus `selesai`**: transaksi
  `dibatalkan` stoknya sudah kembali lewat movement `pembatalan`, jadi mengembalikannya lagi akan
  menggandakan stok.
- `?restore_stock=false` menghapus TANPA menyentuh stok (untuk membersihkan entri uji).
- `POST /sales/purge` body `{from, to, status?, restore_stock?}` menghapus massal per rentang
  tanggal dan mengembalikan `{deleted: n}`. Inilah yang dipakai tombol "hapus riwayat" di UI.
- **`struk_counters` sengaja TIDAK disentuh.** Nomor struk yang sudah keluar tidak pernah dipakai
  ulang, sehingga penomoran **tidak pernah bolong secara surut**: menghapus transaksi nomor 3 dari
  hari ini tidak membuat transaksi nomor 4 bergeser, dan transaksi berikutnya tetap 5. Riwayat
  nomor struk karena itu tetap utuh walau barisnya sudah dihapus.
- Baris kas milik transaksi itu (`ref_type='sale'`) ikut dihapus, termasuk baris penyeimbang
  `pembatalan`, supaya buku kas tidak menyisakan entri yatim.

### Buku kas (arus keuangan)

- Setiap penjualan baru menulis satu baris `cash_flows` `tipe='masuk'`, `kategori='penjualan'`,
  `ref_type='sale'` sebesar total transaksi — **di dalam transaksi database yang sama**, jadi buku
  kas tidak pernah beda dengan penjualannya. `tanggal` memakai hari Jakarta dari `created_at`
  (penting untuk transaksi offline bertanggal lampau).
- Pembatalan **tidak** menghapus baris kas penjualan; ia menulis baris lawan `tipe='keluar'`,
  `kategori='pembatalan'` pada hari pembatalan, sehingga jejaknya kelihatan dan saldo tetap benar.
- **Pembelian tidak menulis baris kas.** Sejak pembelian tidak memakai harga (migrasi `003`),
  tidak ada uang yang berpindah saat barang masuk, jadi `POST /purchases` hanya menulis stok.
  Pembelian lama (sebelum `003`) yang masih punya baris `tipe='keluar'`, `kategori='pembelian'`,
  `ref_type='purchase'` tetap terbaca di buku kas dan ikut terhapus bersama pembeliannya.
- Retur menulis kas lawannya: retur penjualan `keluar`/`retur_penjualan`, retur pembelian
  `masuk`/`retur_pembelian`.
- `PUT`/`DELETE /cash-flows/:id` **menolak** baris otomatis (yang punya `ref_type`) dengan 422:
  nilainya diturunkan dari transaksi asalnya, jadi mengubahnya di sini akan membuat buku kas beda
  dengan transaksinya. Yang bisa diubah hanya baris manual.
- `jumlah` wajib > 0 (aturan CHECK), jadi transaksi bernilai 0 tidak menghasilkan baris kas.
- Penjualan yang dibuat **sebelum** migrasi `002` tidak punya baris kas; jalankan
  `npm run backfill:kas` sekali untuk melengkapinya (lihat bagian Backfill buku kas).

### Pembelian, retur, dan opname

- **Pembelian tidak memakai harga** (migrasi `003_pembelian_tanpa_harga.sql`): pemilik toko hanya
  mencatat nama produk dan jumlah yang dibeli dari supplier. Body `POST /purchases` adalah
  `{tanggal?, supplier?, note?, items:[{product_id, unit_id, qty}]}`; `harga_beli` per item masih
  **diterima tapi diabaikan** (klien lama tidak error), `total` selalu `0`, dan
  `purchase_items.harga_beli`/`subtotal` disimpan `NULL`.
- `POST /purchases` menaikkan stok lewat movement `masuk` (`qty_base = isi_snapshot × qty`) dengan
  catatan `Pembelian <supplier>` — semuanya dalam SATU transaksi. Tidak ada baris `cash_flows`
  yang ditulis.
- `DELETE /purchases/:id` membalik stok dengan `penyesuaian` negatif, menyapu baris kas warisan
  milik pembelian itu bila ada (tidak ada baris pun bukan error), lalu menghapus barisnya.
- Retur penjualan menambah stok (`masuk`), retur pembelian mengurangi stok (`keluar`).
- Stok opname membandingkan stok sistem dengan hitungan fisik; `selisih != 0` langsung menulis
  movement `penyesuaian`. `stok_fisik` dalam base_unit.
- `GET /reports/stock-flow` memakai rentang untuk kolom `masuk`/`keluar`/`penyesuaian`, tetapi
  `saldo_akhir` dihitung dari **seluruh riwayat** sampai akhir periode — stok adalah akumulasi,
  jadi saldo yang dihitung per periode akan selalu salah.

### Laporan

- `GET /reports/purchases` berbasis **qty**, bukan uang (migrasi `003`): responsnya
  `{from, to, qty, qty_base, jumlah_transaksi, total, by_supplier[], by_product[]}`. `qty` adalah
  jumlah satuan yang dibeli, `qty_base` konversinya ke base_unit, `jumlah_transaksi` banyaknya
  dokumen pembelian; baris `by_supplier`/`by_product` membawa `qty` dan `qty_base` juga. Field
  `total` dipertahankan untuk klien lama — pembelian baru bernilai 0, hanya pembelian warisan yang
  masih menyumbang.
- `GET /reports/umum` dan `GET /reports/profit-loss` membaca uang pembelian dari `cash_flows`,
  bukan dari `purchases.total`, jadi pembelian baru (yang tidak menulis kas) otomatis menyumbang 0
  dan tidak ada angka yang dihitung dua kali.
- `GET /reports/modal` menghitung `modal_tersimpan` dari stok saat ini (`stok_base × harga_modal`
  per base unit, memakai satuan dengan isi TERKECIL agar pembulatannya paling kecil) dan
  `modal_terjual` dari `harga_modal_snapshot` pada periode.
- `GET /reports/profit-loss` mengurangi laba kotor dengan pengeluaran operasional
  (kas keluar selain `pembelian` dan `pembatalan`). Pembatalan sengaja tidak dihitung: transaksi
  yang dibatalkan sudah dikeluarkan dari omzet, jadi mengurangi uangnya lagi akan menghitung dua
  kali.
- Nama pelanggan pada `sales.nama_pelanggan` bersifat opsional, dan hanya dipakai untuk laporan —
  tidak ada modul pelanggan.
