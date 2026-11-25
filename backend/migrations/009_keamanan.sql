-- 009_keamanan.sql — audit log perubahan penting + penanda password wajib diganti.
--
-- `audit_logs` menjawab pertanyaan yang tidak bisa dijawab tabel transaksi: siapa mengubah
-- harga produk, siapa menghapus pembelian, dari alamat mana. Baris di sini TIDAK pernah
-- diubah atau dihapus oleh aplikasi (tidak ada endpoint UPDATE/DELETE untuknya), sehingga
-- jejaknya tetap ada walau data aslinya sudah dihapus.
--
-- `detail` disimpan sebagai jsonb supaya nilai sebelum/sesudah bisa dibaca tanpa kolom baru
-- tiap kali ada field yang diaudit.

CREATE TABLE IF NOT EXISTS audit_logs (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  user_id     bigint REFERENCES users(id) ON DELETE SET NULL,
  user_name   text,
  aksi        text NOT NULL,
  entitas     text NOT NULL,
  entitas_id  bigint,
  detail      jsonb,
  ip          text
);

CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entitas_idx ON audit_logs (entitas, entitas_id);
CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs (user_id, created_at DESC);

-- Password sementara (mis. dari seed atau reset oleh superadmin) bisa ditandai supaya
-- pemiliknya wajib menggantinya sebelum memakai aplikasi.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
