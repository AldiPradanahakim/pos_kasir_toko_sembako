-- 006_satuan_hitung_dan_izin_minus.sql — satuan hitung per produk + izin jual stok kosong.
--
-- `base_unit_id` = satuan yang dipakai superadmin untuk menghitung/menampilkan stok
-- (mis. "dus" untuk rokok). Disimpan sebagai referensi ke `units`, bukan teks, supaya
-- ganti nama satuan tidak membuat tampilan produk itu basi. NULL = belum dipilih:
-- server jatuh ke satuan dengan `isi` terbesar milik produk itu, jadi produk lama tetap
-- tampil wajar tanpa perlu diisi ulang.
--
-- `izin_minus` = izin menjual saat stok kosong/akan minus, diberikan superadmin per produk.
-- Default false: penjualan yang membuat stok minus ditolak 422 sampai superadmin
-- memberinya izin. Pembelian/stok masuk tidak terpengaruh — barang masuk selalu boleh.
--
-- Idempotent: aman dijalankan ulang.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS base_unit_id bigint REFERENCES units(id),
  ADD COLUMN IF NOT EXISTS izin_minus   boolean NOT NULL DEFAULT false;
