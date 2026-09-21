-- 002_fitur_lengkap.sql — fitur lanjutan POS Toko Hakim.
-- Tambahan murni (additive): tidak ada tabel/kolom lama yang diubah atau dihapus.
-- Uang = integer rupiah. Stok = integer dalam base_unit. Id = bigserial.

-- Nama pelanggan opsional pada struk (dipakai laporan & riwayat).
ALTER TABLE sales ADD COLUMN nama_pelanggan text;

-- Pemetaan teks struk OCR -> produk, supaya pembelian berulang cocok otomatis.
-- Diisi saat pengguna mengonfirmasi hasil OCR.
CREATE TABLE product_aliases (
  id         bigserial   PRIMARY KEY,
  product_id bigint      NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  alias      text        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_aliases_product_idx ON product_aliases (product_id);

-- Buku kas: satu baris per peristiwa uang masuk/keluar.
CREATE TABLE cash_flows (
  id         bigserial   PRIMARY KEY,
  tanggal    date        NOT NULL,
  tipe       text        NOT NULL CHECK (tipe IN ('masuk', 'keluar')),
  kategori   text        NOT NULL,
  jumlah     integer     NOT NULL CHECK (jumlah > 0),
  keterangan text,
  ref_type   text,
  ref_id     bigint,
  user_id    bigint      REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cash_flows_tanggal_idx ON cash_flows (tanggal);
CREATE INDEX cash_flows_tipe_idx ON cash_flows (tipe);
CREATE INDEX cash_flows_kategori_idx ON cash_flows (kategori);
CREATE INDEX cash_flows_ref_idx ON cash_flows (ref_type, ref_id);
CREATE INDEX cash_flows_user_idx ON cash_flows (user_id);

-- Pembelian dari supplier (barang masuk + foto struk disimpan di sisi klien).
CREATE TABLE purchases (
  id         bigserial   PRIMARY KEY,
  tanggal    date        NOT NULL,
  supplier   text,
  total      integer     NOT NULL DEFAULT 0 CHECK (total >= 0),
  note       text,
  user_id    bigint      NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  void       boolean     NOT NULL DEFAULT false
);
CREATE INDEX purchases_tanggal_idx ON purchases (tanggal);
CREATE INDEX purchases_user_idx ON purchases (user_id);

-- Snapshot: isi & harga beli dibekukan saat pembelian dibuat.
CREATE TABLE purchase_items (
  id           bigserial PRIMARY KEY,
  purchase_id  bigint    NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id   bigint    NOT NULL REFERENCES products(id),
  unit_id      bigint    NOT NULL REFERENCES units(id),
  unit_name    text      NOT NULL,
  qty          integer   NOT NULL CHECK (qty > 0),
  isi_snapshot integer   NOT NULL CHECK (isi_snapshot > 0),
  harga_beli   integer   NOT NULL CHECK (harga_beli >= 0),
  subtotal     integer   NOT NULL CHECK (subtotal >= 0)
);
CREATE INDEX purchase_items_purchase_idx ON purchase_items (purchase_id);
CREATE INDEX purchase_items_product_idx ON purchase_items (product_id);

-- Hutang (kita yang berhutang) dan piutang (pelanggan yang berhutang).
CREATE TABLE debts (
  id          bigserial   PRIMARY KEY,
  tipe        text        NOT NULL CHECK (tipe IN ('utang', 'piutang')),
  pihak       text        NOT NULL,
  jumlah      integer     NOT NULL CHECK (jumlah > 0),
  dibayar     integer     NOT NULL DEFAULT 0 CHECK (dibayar >= 0),
  jatuh_tempo date,
  keterangan  text,
  status      text        NOT NULL DEFAULT 'belum' CHECK (status IN ('belum', 'lunas')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  user_id     bigint      REFERENCES users(id)
);
CREATE INDEX debts_tipe_idx ON debts (tipe);
CREATE INDEX debts_status_idx ON debts (status);
CREATE INDEX debts_user_idx ON debts (user_id);

-- Retur penjualan (barang kembali dari pembeli) dan retur pembelian (dikembalikan ke supplier).
CREATE TABLE returns (
  id         bigserial   PRIMARY KEY,
  tipe       text        NOT NULL CHECK (tipe IN ('penjualan', 'pembelian')),
  ref_id     bigint,
  product_id bigint      NOT NULL REFERENCES products(id),
  unit_id    bigint      NOT NULL REFERENCES units(id),
  qty        integer     NOT NULL CHECK (qty > 0),
  jumlah     integer     NOT NULL CHECK (jumlah >= 0),
  alasan     text        NOT NULL,
  user_id    bigint      REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX returns_product_idx ON returns (product_id);
CREATE INDEX returns_tipe_idx ON returns (tipe);
CREATE INDEX returns_created_idx ON returns (created_at DESC);

-- Stok opname: perbandingan stok sistem vs hitungan fisik.
CREATE TABLE stock_opnames (
  id          bigserial   PRIMARY KEY,
  product_id  bigint      NOT NULL REFERENCES products(id),
  stok_sistem integer     NOT NULL,
  stok_fisik  integer     NOT NULL,
  selisih     integer     NOT NULL,
  catatan     text,
  user_id     bigint      REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_opnames_product_idx ON stock_opnames (product_id);
CREATE INDEX stock_opnames_created_idx ON stock_opnames (created_at DESC);
