-- 007_pelanggan_bon_shift.sql — bon/piutang per pelanggan + buka-tutup kas per shift.
-- Tambahan murni (additive): tidak ada tabel/kolom lama yang diubah atau dihapus.

-- Pelanggan: identitas untuk bon. Bon boleh diketik bebas di kasir; baris di sini dibuat
-- otomatis dari nama itu (unik tanpa beda huruf besar/kecil), jadi tidak ada dua "Bu Ani".
CREATE TABLE customers (
  id         bigserial   PRIMARY KEY,
  nama       text        NOT NULL,
  telepon    text,
  catatan    text,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customers_nama_uniq ON customers (lower(nama));

ALTER TABLE sales ADD COLUMN customer_id bigint REFERENCES customers(id);

-- Piutang hasil bon menunjuk ke transaksi asalnya. Menghapus transaksi ikut menghapus
-- piutangnya: bon yang transaksinya dibatalkan tidak boleh tetap menagih pelanggan.
ALTER TABLE debts ADD COLUMN customer_id bigint REFERENCES customers(id);
ALTER TABLE debts ADD COLUMN sale_id     bigint REFERENCES sales(id) ON DELETE CASCADE;
CREATE INDEX debts_customer_idx ON debts (customer_id);
CREATE INDEX debts_sale_idx ON debts (sale_id);

-- Riwayat pelunasan: satu baris per pembayaran cicilan.
CREATE TABLE debt_payments (
  id         bigserial   PRIMARY KEY,
  debt_id    bigint      NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  jumlah     integer     NOT NULL CHECK (jumlah > 0),
  catatan    text,
  user_id    bigint      REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX debt_payments_debt_idx ON debt_payments (debt_id);

-- Shift kas: satu kasir satu shift terbuka pada satu waktu.
CREATE TABLE shifts (
  id           bigserial   PRIMARY KEY,
  user_id      bigint      NOT NULL REFERENCES users(id),
  dibuka_pada  timestamptz NOT NULL DEFAULT now(),
  modal_awal   integer     NOT NULL CHECK (modal_awal >= 0),
  ditutup_pada timestamptz,
  uang_fisik   integer     CHECK (uang_fisik >= 0),
  selisih      integer,
  catatan      text
);
CREATE UNIQUE INDEX shifts_satu_terbuka ON shifts (user_id) WHERE ditutup_pada IS NULL;
CREATE INDEX shifts_dibuka_idx ON shifts (dibuka_pada DESC);

-- Penjualan dan baris kas ikut menempel ke shift yang melayaninya, supaya uang fisik
-- yang dihitung saat tutup kas bisa dibandingkan dengan yang seharusnya ada.
ALTER TABLE sales      ADD COLUMN shift_id bigint REFERENCES shifts(id);
ALTER TABLE cash_flows ADD COLUMN shift_id bigint REFERENCES shifts(id);
CREATE INDEX sales_shift_idx ON sales (shift_id);
CREATE INDEX cash_flows_shift_idx ON cash_flows (shift_id);
