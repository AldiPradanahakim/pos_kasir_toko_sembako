-- 001_init.sql — skema awal POS Toko Hakim
-- Uang = integer rupiah (tanpa desimal). Stok = integer dalam base_unit.

CREATE TABLE users (
  id         bigserial PRIMARY KEY,
  name       text        NOT NULL,
  username   text        NOT NULL UNIQUE,
  password   text        NOT NULL,
  role       text        NOT NULL CHECK (role IN ('kasir', 'superadmin')),
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Token bearer: yang disimpan hanya sha256 dari token mentah.
CREATE TABLE tokens (
  id         bigserial   PRIMARY KEY,
  user_id    bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX tokens_user_idx ON tokens (user_id);

CREATE TABLE categories (
  id         bigserial   PRIMARY KEY,
  name       text        NOT NULL UNIQUE,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE units (
  id         bigserial   PRIMARY KEY,
  name       text        NOT NULL UNIQUE,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id          bigserial   PRIMARY KEY,
  name        text        NOT NULL,
  category_id bigint      REFERENCES categories(id),
  base_unit   text        NOT NULL CHECK (base_unit IN ('pcs', 'gram')),
  barcode     text        UNIQUE,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- isi = jumlah base_unit dalam 1 satuan ini. Harga tidak pernah diturunkan otomatis.
CREATE TABLE product_units (
  id          bigserial   PRIMARY KEY,
  product_id  bigint      NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_id     bigint      NOT NULL REFERENCES units(id),
  isi         integer     NOT NULL CHECK (isi > 0),
  harga_jual  integer     NOT NULL CHECK (harga_jual >= 0),
  harga_modal integer     NOT NULL CHECK (harga_modal >= 0),
  barcode     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, unit_id)
);
CREATE INDEX product_units_product_idx ON product_units (product_id);

-- no_struk NULL sampai server memberi nomor; dibatalkan tidak pernah dihapus.
CREATE TABLE sales (
  id              bigserial   PRIMARY KEY,
  uuid            text        NOT NULL UNIQUE,
  no_struk        text        UNIQUE,
  user_id         bigint      NOT NULL REFERENCES users(id),
  total           integer     NOT NULL CHECK (total >= 0),
  metode_bayar    text        NOT NULL CHECK (metode_bayar IN ('tunai', 'transfer', 'qris')),
  dibayar         integer     NOT NULL,
  kembalian       integer     NOT NULL,
  status          text        NOT NULL DEFAULT 'selesai' CHECK (status IN ('selesai', 'dibatalkan')),
  alasan_batal    text,
  dibatalkan_oleh bigint      REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  synced_at       timestamptz
);
CREATE INDEX sales_created_idx ON sales (created_at DESC);
CREATE INDEX sales_status_idx ON sales (status);

-- Snapshot: baris ini tidak boleh berubah walau harga master diubah.
CREATE TABLE sale_items (
  id                   bigserial PRIMARY KEY,
  sale_id              bigint    NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id           bigint    NOT NULL REFERENCES products(id),
  unit_id              bigint    NOT NULL REFERENCES units(id),
  unit_name            text      NOT NULL,
  qty                  integer   NOT NULL CHECK (qty > 0),
  isi_snapshot         integer   NOT NULL CHECK (isi_snapshot > 0),
  harga_snapshot       integer   NOT NULL CHECK (harga_snapshot >= 0),
  harga_modal_snapshot integer   NOT NULL CHECK (harga_modal_snapshot >= 0),
  harga_diubah         boolean   NOT NULL DEFAULT false,
  alasan_ubah_harga    text
);
CREATE INDEX sale_items_sale_idx ON sale_items (sale_id);

CREATE TABLE stock_movements (
  id             bigserial   PRIMARY KEY,
  product_id     bigint      NOT NULL REFERENCES products(id),
  type           text        NOT NULL CHECK (type IN ('masuk', 'keluar', 'penyesuaian', 'pembatalan')),
  qty_base       integer     NOT NULL,
  reference_type text,
  reference_id   bigint,
  note           text,
  user_id        bigint      REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_product_idx ON stock_movements (product_id);
CREATE INDEX stock_movements_created_idx ON stock_movements (created_at DESC);

CREATE TABLE settings (
  key   text PRIMARY KEY,
  value text
);

-- Nomor struk tidak bolong: baris ini dikunci & dinaikkan di dalam transaksi penjualan.
CREATE TABLE struk_counters (
  day  date    PRIMARY KEY,
  last integer NOT NULL DEFAULT 0
);
