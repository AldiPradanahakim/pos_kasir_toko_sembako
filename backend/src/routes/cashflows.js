import express from 'express';
import { q, tx } from '../db.js';
import { requireSuperadmin } from '../auth.js';
import {
  ApiError, toInt, toStr, dateOrNull, monthStartJakarta, todayJakarta,
} from '../lib.js';

const router = express.Router();
const TIPE = ['masuk', 'keluar'];

// Buku kas = uang: kasir tidak boleh melihat, apalagi menulis. Penjaga dipasang
// per rute (bukan router.use) supaya tidak ikut memblokir router lain di /api.

/** Rentang default: bulan berjalan, sama seperti laporan lain. */
function range(req) {
  return {
    from: dateOrNull(req.query.from) ?? monthStartJakarta(),
    to: dateOrNull(req.query.to) ?? todayJakarta(),
  };
}

const ROW_COLS = `cf.id, to_char(cf.tanggal, 'YYYY-MM-DD') AS tanggal, cf.tipe, cf.kategori,
                  cf.jumlah, cf.keterangan, cf.ref_type, cf.ref_id, cf.created_at,
                  u.name AS user_name`;

/**
 * GET /cash-flows — daftar baris kas + saldo berjalan.
 * Urutan menaik (tanggal, id) karena saldo berjalan hanya masuk akal secara kronologis.
 * `saldo` mengikuti filter yang dipakai, dan `saldo_awal` adalah saldo sebelum `from`.
 */
router.get('/cash-flows', requireSuperadmin, async (req, res) => {
  const { from, to } = range(req);
  const tipe = toStr(req.query.tipe);
  const kategori = toStr(req.query.kategori);
  if (tipe && !TIPE.includes(tipe)) throw new ApiError(422, "tipe harus 'masuk' atau 'keluar'");

  const filter = `($1::date IS NULL OR cf.tanggal >= $1)
                  AND ($2::date IS NULL OR cf.tanggal <= $2)
                  AND ($3::text IS NULL OR cf.tipe = $3)
                  AND ($4::text IS NULL OR cf.kategori = $4)`;

  const { rows } = await q(
    `SELECT ${ROW_COLS}
       FROM cash_flows cf
       LEFT JOIN users u ON u.id = cf.user_id
      WHERE ${filter}
      ORDER BY cf.tanggal, cf.id`,
    [from, to, tipe, kategori],
  );

  const { rows: opening } = await q(
    `SELECT COALESCE(SUM(CASE WHEN tipe = 'masuk' THEN jumlah ELSE -jumlah END), 0) AS saldo
       FROM cash_flows cf
      WHERE ($1::date IS NULL OR cf.tanggal < $1)
        AND ($2::text IS NULL OR cf.tipe = $2)
        AND ($3::text IS NULL OR cf.kategori = $3)`,
    [from, tipe, kategori],
  );

  let saldo = Number(opening[0].saldo);
  let masuk = 0;
  let keluar = 0;
  const out = rows.map((r) => {
    if (r.tipe === 'masuk') masuk += r.jumlah;
    else keluar += r.jumlah;
    saldo += r.tipe === 'masuk' ? r.jumlah : -r.jumlah;
    return { ...r, saldo };
  });

  res.json({ from, to, tipe, kategori, saldo_awal: Number(opening[0].saldo), masuk, keluar, saldo, rows: out });
});

/** Ringkasan periode + rincian per kategori. */
router.get('/cash-flows/summary', requireSuperadmin, async (req, res) => {
  const { from, to } = range(req);

  const { rows } = await q(
    `SELECT COALESCE(SUM(jumlah) FILTER (WHERE tipe = 'masuk'), 0) AS masuk,
            COALESCE(SUM(jumlah) FILTER (WHERE tipe = 'keluar'), 0) AS keluar
       FROM cash_flows WHERE tanggal BETWEEN $1 AND $2`,
    [from, to],
  );
  const { rows: opening } = await q(
    `SELECT COALESCE(SUM(CASE WHEN tipe = 'masuk' THEN jumlah ELSE -jumlah END), 0) AS saldo
       FROM cash_flows WHERE tanggal < $1`,
    [from],
  );
  const { rows: byKategori } = await q(
    `SELECT kategori, tipe, COALESCE(SUM(jumlah), 0) AS total
       FROM cash_flows WHERE tanggal BETWEEN $1 AND $2
      GROUP BY kategori, tipe
      ORDER BY total DESC, kategori`,
    [from, to],
  );

  const masuk = Number(rows[0].masuk);
  const keluar = Number(rows[0].keluar);
  const saldoAwal = Number(opening[0].saldo);

  res.json({
    from,
    to,
    masuk,
    keluar,
    saldo: masuk - keluar,
    saldo_awal: saldoAwal,
    saldo_akhir: saldoAwal + masuk - keluar,
    by_kategori: byKategori.map((r) => ({ kategori: r.kategori, tipe: r.tipe, total: Number(r.total) })),
  });
});

/** Catat pengeluaran/pemasukan manual (listrik, gaji, setoran, ...). */
router.post('/cash-flows', requireSuperadmin, async (req, res) => {
  const tipe = toStr(req.body?.tipe);
  const kategori = toStr(req.body?.kategori);
  const jumlah = toInt(req.body?.jumlah);
  if (!TIPE.includes(tipe)) throw new ApiError(422, "tipe harus 'masuk' atau 'keluar'");
  if (!kategori) throw new ApiError(422, 'kategori wajib diisi');
  if (jumlah === null || jumlah <= 0) throw new ApiError(422, 'jumlah harus bilangan bulat lebih dari 0');

  const tanggal = req.body?.tanggal === undefined || req.body?.tanggal === null || req.body?.tanggal === ''
    ? todayJakarta()
    : dateOrNull(req.body.tanggal);
  if (!tanggal) throw new ApiError(422, 'tanggal tidak valid (YYYY-MM-DD)');

  const { rows } = await q(
    `INSERT INTO cash_flows (tanggal, tipe, kategori, jumlah, keterangan, user_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, to_char(tanggal, 'YYYY-MM-DD') AS tanggal, tipe, kategori, jumlah,
               keterangan, ref_type, ref_id, created_at`,
    [tanggal, tipe, kategori, jumlah, toStr(req.body?.keterangan), req.user.id],
  );
  res.status(201).json({ ...rows[0], user_name: req.user.name });
});

/**
 * Ubah baris kas manual. Baris otomatis (punya ref_type dari penjualan/pembelian/retur)
 * tidak boleh diubah di sini — nilainya diturunkan dari transaksinya, mengubahnya akan
 * membuat buku kas beda dengan transaksi asalnya.
 */
router.put('/cash-flows/:id', requireSuperadmin, async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'Baris kas tidak ditemukan');

  const row = await tx(async (c) => {
    const { rows: found } = await c.query('SELECT id, ref_type FROM cash_flows WHERE id = $1 FOR UPDATE', [id]);
    if (!found.length) throw new ApiError(404, 'Baris kas tidak ditemukan');
    if (found[0].ref_type) {
      throw new ApiError(422, `Baris kas otomatis (${found[0].ref_type}) tidak bisa diubah; ubah transaksinya`);
    }

    const tipe = req.body?.tipe === undefined ? null : toStr(req.body.tipe);
    if (tipe !== null && !TIPE.includes(tipe)) throw new ApiError(422, "tipe harus 'masuk' atau 'keluar'");
    const jumlah = req.body?.jumlah === undefined ? null : toInt(req.body.jumlah);
    if (jumlah !== null && jumlah <= 0) throw new ApiError(422, 'jumlah harus bilangan bulat lebih dari 0');
    const tanggal = req.body?.tanggal === undefined ? null : dateOrNull(req.body.tanggal);
    if (req.body?.tanggal !== undefined && !tanggal) throw new ApiError(422, 'tanggal tidak valid (YYYY-MM-DD)');

    const { rows } = await c.query(
      `UPDATE cash_flows SET
         tipe       = COALESCE($1, tipe),
         kategori   = COALESCE($2, kategori),
         jumlah     = COALESCE($3, jumlah),
         tanggal    = COALESCE($4::date, tanggal),
         keterangan = CASE WHEN $5::boolean THEN $6 ELSE keterangan END
       WHERE id = $7
       RETURNING id, to_char(tanggal, 'YYYY-MM-DD') AS tanggal, tipe, kategori, jumlah,
                 keterangan, ref_type, ref_id, created_at`,
      [
        tipe,
        req.body?.kategori === undefined ? null : toStr(req.body.kategori),
        jumlah,
        tanggal,
        req.body?.keterangan !== undefined,
        toStr(req.body?.keterangan),
        id,
      ],
    );
    return rows[0];
  });

  res.json({ ...row, user_name: req.user.name });
});

router.delete('/cash-flows/:id', requireSuperadmin, async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'Baris kas tidak ditemukan');
  const { rowCount } = await q('DELETE FROM cash_flows WHERE id = $1', [id]);
  if (!rowCount) throw new ApiError(404, 'Baris kas tidak ditemukan');
  res.json({ ok: true });
});

export default router;
