-- 008_satuan_inisial.sql — inisial satuan untuk membaca nota tulisan kasir/pelanggan.
--
-- Kasir dan pelanggan menulis satuan singkat di daftar belanja: "2 (r) Beng Beng",
-- "3 P Indomie", "1 D Aqua". Tanpa kolom ini, singkatan itu hilang saat OCR dan barisnya
-- hanya terbaca sebagai nama barang dengan qty 1 — atau lebih buruk, "P" dianggap bagian nama.
--
-- `inisial` opsional dan UNIK tanpa beda huruf besar/kecil, supaya "p" tidak pernah
-- berarti dua satuan sekaligus (pack vs pcs). Isinya 1–4 huruf/angka saja; satuan pecahan
-- seperti "1/2 kg" dibiarkan kosong karena pengurai membuang angka dari nama barang lebih
-- dulu, sehingga "1/2" tidak akan pernah bisa dicocokkan.
--
-- Idempotent: aman dijalankan ulang.

ALTER TABLE units ADD COLUMN IF NOT EXISTS inisial text;

CREATE UNIQUE INDEX IF NOT EXISTS units_inisial_uniq
  ON units (lower(inisial))
  WHERE inisial IS NOT NULL;

-- Isi awal hanya untuk satuan bawaan; satuan buatan pemilik dibiarkan kosong dan bisa
-- diisi sendiri di halaman Satuan. Hanya mengisi yang masih NULL agar tidak menimpa pilihan.
UPDATE units SET inisial = v.inisial, updated_at = now()
  FROM (VALUES
    ('pcs', 'pc'), ('renceng', 'r'), ('pack', 'p'), ('dus', 'd'),
    ('slop', 'sl'), ('bal', 'b'), ('karung', 'kr'), ('kg', 'kg')
  ) AS v(nama, inisial)
 WHERE units.name = v.nama AND units.inisial IS NULL;
