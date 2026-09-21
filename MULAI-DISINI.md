# MULAI DI SINI

Panduan terpendek: buka database, jalankan aplikasi. Penjelasan lengkap ada di `README.md`.

## 1. Buka pgAdmin

Start Menu → ketik `pgAdmin 4` → Enter.

pgAdmin Desktop **langsung masuk otomatis** — tidak perlu mengisi email atau password.

Kalau muncul permintaan **master password**: itu password pilihan Anda sendiri untuk brankas pgAdmin. Kalau lupa,
isi saja yang baru — server tetap bisa dibuka, hanya password-nya harus diketik ulang tiap kali.

## 2. Lihat database

Server **`POS Hakim`** sudah terdaftar — tinggal diklik. Di panel kiri, klik berurutan:

**`Servers`** → **`POS Hakim`** → **`Databases`** → **`pos_hakim`** → **`Schemas`** → **`public`** →
**`Tables`** → muncul **12 tabel**.

Saat pertama membuka **`POS Hakim`**, pgAdmin minta password: isi `pos_hakim_dev`, centang **Save password**.

Kalau pgAdmin sedang terbuka, **tutup lalu buka lagi** supaya entri itu muncul.

<details>
<summary>Kalau entri <b>POS Hakim</b> hilang — daftarkan ulang</summary>

> Jangan pakai entri `PostgreSQL 14` / `PostgreSQL 18` yang sudah ada: keduanya login sebagai `postgres`, password-nya tidak diketahui.

1. Klik kanan **`Servers`** → **`Register`** → **`Server…`**
2. Tab **General** → Name `POS Hakim`; tab **Connection** → Host `127.0.0.1`, Port `5433`, Maintenance database `pos_hakim`, Username `pos_hakim`, Password `pos_hakim_dev`, centang **Save password**
3. Klik **`Save`**

Atau lewat menu **Tools → Import/Export Servers**, pilih berkas `C:\Aplikasi\pgadmin-servers.json`.
</details>

## 3. Lihat isi tabel

Klik kanan **`pos_hakim`** → **`Query Tool`**, tempel ini, tekan **F5**:

```sql
SELECT * FROM settings;
SELECT * FROM units ORDER BY name;
SELECT * FROM products ORDER BY name;
SELECT * FROM product_units ORDER BY product_id, isi;
SELECT * FROM sales ORDER BY id DESC;
SELECT * FROM sale_items ORDER BY sale_id, id;
SELECT * FROM stock_movements ORDER BY id DESC;
```

`sales` dan `sale_items` = transaksi penjualan; `stock_movements` = riwayat keluar/masuk stok.

Isi tabelnya tergantung apa yang sudah dimasukkan lewat aplikasi. Kalau baru dipasang, semua tabel masih kosong.

## 4. Jalankan aplikasi

```
cd C:\Aplikasi\backend
npm start
```

Lalu buka browser: `http://localhost:3000`

Login: `superadmin` / `password`

Kalau `npm start` menampilkan `EADDRINUSE`, artinya server **sudah jalan** — langsung buka browser saja.

Kalau ada satuan yang terhapus, `npm run seed` mengembalikannya (aman diulang, data lain tidak ditimpa).
Kalau satuannya masih muncul di daftar tapi nonaktif, aktifkan lewat halaman `/satuan` (menu **Satuan**).

## 5. Mode pengembangan (opsional)

```
cd C:\Aplikasi\frontend
npm run dev
```

Buka `http://localhost:5173` — pakai `localhost`, **bukan** `127.0.0.1`.
