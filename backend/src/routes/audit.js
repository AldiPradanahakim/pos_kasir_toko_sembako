import express from 'express';
import { q } from '../db.js';
import { requireSuperadmin } from '../auth.js';
import { ApiError, toStr, dateOrNull, limitOf } from '../lib.js';

const router = express.Router();

/**
 * Jejak audit. Hanya superadmin: isinya memuat apa yang diubah siapa, termasuk perubahan
 * harga dan penghapusan transaksi.
 *
 * Read-only dengan sengaja — tidak ada endpoint untuk mengubah atau menghapus baris audit,
 * karena log yang bisa dirapikan oleh pelakunya tidak membuktikan apa pun.
 */
router.get('/audit-logs', requireSuperadmin, async (req, res) => {
  const from = dateOrNull(req.query.from);
  const to = dateOrNull(req.query.to);
  const aksi = toStr(req.query.aksi);
  const entitas = toStr(req.query.entitas);
  const cari = toStr(req.query.q);

  const { rows } = await q(
    `SELECT a.id, a.created_at, a.user_id, a.user_name, a.aksi, a.entitas, a.entitas_id,
            a.detail, a.ip
       FROM audit_logs a
      WHERE ($1::date IS NULL OR (a.created_at AT TIME ZONE 'Asia/Jakarta')::date >= $1)
        AND ($2::date IS NULL OR (a.created_at AT TIME ZONE 'Asia/Jakarta')::date <= $2)
        AND ($3::text IS NULL OR a.aksi ILIKE '%' || $3 || '%')
        AND ($4::text IS NULL OR a.entitas = $4)
        AND ($5::text IS NULL OR a.user_name ILIKE '%' || $5 || '%' OR a.aksi ILIKE '%' || $5 || '%'
             OR a.detail::text ILIKE '%' || $5 || '%')
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $6`,
    [from, to, aksi, entitas, cari, limitOf(req.query.limit, 200)],
  );
  res.json(rows);
});

/** Daftar aksi yang pernah tercatat, untuk mengisi pilihan filter. */
router.get('/audit-logs/aksi', requireSuperadmin, async (_req, res) => {
  const { rows } = await q('SELECT DISTINCT aksi FROM audit_logs ORDER BY aksi');
  res.json(rows.map((r) => r.aksi));
});

export default router;
