-- 004_tunai_saja.sql — pembayaran hanya tunai.
--
-- Pemilik toko hanya menerima uang tunai, jadi QRIS (dan transfer) dihapus dari sistem.
-- Data lama yang masih memakai metode lain dinormalkan ke 'tunai' SEBELUM aturan baru
-- dipasang, supaya transaksi lama tetap bisa dibaca laporan (tanpa ini migrasi gagal).
--
-- Murni additive terhadap data: tidak ada baris yang dihapus, hanya nilai metode_bayar
-- yang diseragamkan. Idempotent: aman dijalankan ulang.

UPDATE sales SET metode_bayar = 'tunai' WHERE metode_bayar <> 'tunai';

ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_metode_bayar_check;
ALTER TABLE sales ADD CONSTRAINT sales_metode_bayar_check CHECK (metode_bayar = 'tunai');

-- Pengaturan gambar QRIS tidak lagi bermakna.
DELETE FROM settings WHERE key = 'qris_image_path';
