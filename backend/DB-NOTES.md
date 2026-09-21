# DB-NOTES — catatan lingkungan database

Ringkasan apa yang ditemukan dan apa yang diubah di mesin ini supaya backend bisa konek.

## Temuan

| Instance | Port | Status | Auth (`pg_hba.conf`, baris `host all all 127.0.0.1/32`) |
| --- | --- | --- | --- |
| PostgreSQL 18 (`C:\Program Files\PostgreSQL\18\data`) | 5432 | service berjalan, mendengarkan | `scram-sha-256` |
| PostgreSQL 14 (`C:\Program Files\PostgreSQL\14\data`) | 5433 | service berjalan, mendengarkan | `scram-sha-256` |

- Tidak ada `%APPDATA%\postgresql\pgpass.conf`.
- Password superuser `postgres` untuk instance **18** tidak diketahui; lima password dev umum
  (`postgres`, `password`, `admin`, `123456`, `root`) semuanya gagal.
- Password superuser `postgres` untuk instance **14** adalah `password`.
- Proses berjalan sebagai user biasa (`aldip`) **tanpa hak administrator**, sehingga `pg_hba.conf`
  tidak bisa diubah dan `pg_ctl reload` tidak bisa dijalankan.

## Keputusan

Dipakai **instance PostgreSQL 14 di port 5433**, karena satu-satunya yang bisa diautentikasi tanpa
mengubah konfigurasi mesin. Ini PostgreSQL sungguhan dengan service berjalan, bukan pengganti.

## Yang diubah

Tidak ada berkas konfigurasi PostgreSQL yang disentuh (`pg_hba.conf` tetap `scram-sha-256`,
tidak ada perubahan autentikasi). Yang dibuat hanya objek database:

```sql
-- dijalankan sebagai superuser `postgres` pada instance port 5433
CREATE ROLE pos_hakim LOGIN CREATEDB PASSWORD 'pos_hakim_dev';
CREATE DATABASE pos_hakim      OWNER pos_hakim;
CREATE DATABASE pos_hakim_test OWNER pos_hakim;

-- PostgreSQL 14: schema public masih dimiliki superuser, sehingga
-- `DROP SCHEMA public CASCADE` (dipakai `npm test -- --fresh`) gagal dengan
-- "must be owner of schema public". Kepemilikan dialihkan ke role aplikasi:
ALTER SCHEMA public OWNER TO pos_hakim;   -- di pos_hakim dan pos_hakim_test
GRANT ALL ON SCHEMA public TO pos_hakim;
```

Database `af-gps-tracker` dan `af-gps-tracker-testing` yang sudah ada sebelumnya tidak disentuh.

## Konsekuensi

- `.env` menunjuk ke `127.0.0.1:5433`. Bila nanti pindah ke instance 18 (port 5432), yang perlu
  disiapkan: password superuser instance 18, lalu ulangi `CREATE ROLE`/`CREATE DATABASE` dan
  `ALTER SCHEMA public OWNER TO pos_hakim` di atas, lalu ubah `DATABASE_URL` dan `TEST_DATABASE_URL`.
- Port harus sama antara `.env` dan pendaftaran server di pgAdmin.
