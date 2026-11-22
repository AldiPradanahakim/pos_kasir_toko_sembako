-- 005_nomor_struk_tahunan.sql — nomor struk per tahun, tanpa tanggal di dalam nomornya.
--
-- Nomor lama `INV-YYYYMMDD-####` memuat tanggal, padahal tanggal sudah tercetak di
-- barisnya sendiri di struk, dan 4 digit tidak cukup: satu hari bisa ratusan transaksi
-- sedangkan satu tahun pasti ribuan. Nomor baru `INV-<tahun>-<6 digit>` — urut per tahun
-- Jakarta, muat sampai 999.999 transaksi setahun.
--
-- Struk lama tidak terpengaruh: nomornya tersimpan sebagai teks di `sales`, dan format
-- barunya berbeda (tanpa tanggal), jadi tidak mungkin bertabrakan dengan yang lama.
--
-- Idempotent: aman dijalankan ulang.

DROP TABLE IF EXISTS struk_counters;

CREATE TABLE IF NOT EXISTS struk_counters_tahun (
  tahun integer PRIMARY KEY,
  last  integer NOT NULL DEFAULT 0
);
