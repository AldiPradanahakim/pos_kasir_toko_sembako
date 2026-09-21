-- 003_pembelian_tanpa_harga.sql — pembelian tanpa harga beli.
--
-- Pemilik toko mencatat barang masuk dari supplier hanya dengan nama produk dan jumlah;
-- tidak ada harga beli. Karena itu `harga_beli` dan `subtotal` tidak lagi wajib diisi,
-- dan `total` pembelian selalu 0.
--
-- Murni additive: tidak ada kolom/tabel yang dihapus dan tidak ada baris lama yang diubah.
-- Pembelian lama tetap menyimpan harga dan totalnya; pembelian baru menyimpan NULL/0.
-- Semua perintah di bawah idempotent (DROP NOT NULL / SET DEFAULT aman diulang).

ALTER TABLE purchase_items ALTER COLUMN harga_beli DROP NOT NULL;
ALTER TABLE purchase_items ALTER COLUMN subtotal   DROP NOT NULL;
ALTER TABLE purchases     ALTER COLUMN total       SET DEFAULT 0;
ALTER TABLE purchases     ALTER COLUMN total       DROP NOT NULL;
