import express from 'express';
import { q, tx } from '../db.js';
import { requireSuperadmin } from '../auth.js';
import { ApiError, toInt, toStr, dateOrNull, limitOf } from '../lib.js';

const router = express.Router();
const TIPE = ['utang', 'piutang'];

const COLS = `d.id, d.tipe, d.pihak, d.jumlah, d.dibayar, d.jumlah - d.dibayar AS sisa,
              to_char(d.jatuh_tempo, 'YYYY-MM-DD') AS jatuh_tempo, d.keterangan, d.status,
              d.created_at, u.name AS user_name`;

router.get('/debts', requireSuperadmin, async (req, res) => {
  const tipe = toStr(req.query.tipe);
  const status = toStr(req.query.status);
  if (tipe && !TIPE.includes(tipe)) throw new ApiError(422, "tipe harus 'utang' atau 'piutang'");
  if (status && status !== 'belum' && status !== 'lunas') {
    throw new ApiError(422, "status harus 'belum' atau 'lunas'");
  }

  const { rows } = await q(
    `SELECT ${COLS}
       FROM debts d
       LEFT JOIN users u ON u.id = d.user_id
      WHERE ($1::text IS NULL OR d.tipe = $1)
        AND ($2::text IS NULL OR d.status = $2)
      ORDER BY d.status, d.created_at DESC, d.id DESC
      LIMIT $3`,
    [tipe, status, limitOf(req.query.limit, 200)],
  );
  res.json(rows);
});

router.post('/debts', requireSuperadmin, async (req, res) => {
  const tipe = toStr(req.body?.tipe);
  const pihak = toStr(req.body?.pihak);
  const jumlah = toInt(req.body?.jumlah);
  if (!TIPE.includes(tipe)) throw new ApiError(422, "tipe harus 'utang' atau 'piutang'");
  if (!pihak) throw new ApiError(422, 'pihak wajib diisi');
  if (jumlah === null || jumlah <= 0) throw new ApiError(422, 'jumlah harus bilangan bulat lebih dari 0');

  const dibayar = req.body?.dibayar === undefined || req.body?.dibayar === null ? 0 : toInt(req.body.dibayar);
  if (dibayar === null || dibayar < 0) throw new ApiError(422, 'dibayar harus bilangan bulat >= 0');
  if (dibayar > jumlah) throw new ApiError(422, 'dibayar tidak boleh lebih besar dari jumlah');

  const jatuhTempo = req.body?.jatuh_tempo === undefined || req.body?.jatuh_tempo === null || req.body?.jatuh_tempo === ''
    ? null
    : dateOrNull(req.body.jatuh_tempo);
  if (req.body?.jatuh_tempo !== undefined && req.body?.jatuh_tempo !== null && req.body?.jatuh_tempo !== '' && !jatuhTempo) {
    throw new ApiError(422, 'jatuh_tempo tidak valid (YYYY-MM-DD)');
  }

  const { rows } = await q(
    `INSERT INTO debts (tipe, pihak, jumlah, dibayar, jatuh_tempo, keterangan, status, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [tipe, pihak, jumlah, dibayar, jatuhTempo, toStr(req.body?.keterangan),
      dibayar >= jumlah ? 'lunas' : 'belum', req.user.id],
  );
  res.status(201).json((await q(`SELECT ${COLS} FROM debts d LEFT JOIN users u ON u.id = d.user_id WHERE d.id = $1`, [rows[0].id])).rows[0]);
});

/**
 * PUT bisa sekadar mengubah data, atau mencatat pembayaran lewat `dibayar`.
 * `dibayar` di sini adalah TOTAL yang sudah dibayar (bukan tambahan), dan status
 * otomatis jadi 'lunas' begitu dibayar >= jumlah.
 */
router.put('/debts/:id', requireSuperadmin, async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'Hutang/piutang tidak ditemukan');

  const row = await tx(async (c) => {
    const { rows: found } = await c.query('SELECT id, jumlah, dibayar FROM debts WHERE id = $1 FOR UPDATE', [id]);
    if (!found.length) throw new ApiError(404, 'Hutang/piutang tidak ditemukan');

    const tipe = req.body?.tipe === undefined ? null : toStr(req.body.tipe);
    if (tipe !== null && !TIPE.includes(tipe)) throw new ApiError(422, "tipe harus 'utang' atau 'piutang'");

    const jumlah = req.body?.jumlah === undefined ? null : toInt(req.body.jumlah);
    if (req.body?.jumlah !== undefined && (jumlah === null || jumlah <= 0)) {
      throw new ApiError(422, 'jumlah harus bilangan bulat lebih dari 0');
    }

    const dibayar = req.body?.dibayar === undefined ? null : toInt(req.body.dibayar);
    if (req.body?.dibayar !== undefined && (dibayar === null || dibayar < 0)) {
      throw new ApiError(422, 'dibayar harus bilangan bulat >= 0');
    }

    const jatuhTempo = req.body?.jatuh_tempo === undefined ? null : dateOrNull(req.body.jatuh_tempo);
    if (req.body?.jatuh_tempo !== undefined && req.body?.jatuh_tempo !== null && req.body?.jatuh_tempo !== '' && !jatuhTempo) {
      throw new ApiError(422, 'jatuh_tempo tidak valid (YYYY-MM-DD)');
    }

    const jumlahAkhir = jumlah ?? found[0].jumlah;
    const dibayarAkhir = dibayar ?? found[0].dibayar;
    if (dibayarAkhir > jumlahAkhir) throw new ApiError(422, 'dibayar tidak boleh lebih besar dari jumlah');

    const statusInput = req.body?.status === undefined ? null : toStr(req.body.status);
    if (statusInput !== null && statusInput !== 'belum' && statusInput !== 'lunas') {
      throw new ApiError(422, "status harus 'belum' atau 'lunas'");
    }

    const { rows } = await c.query(
      `UPDATE debts SET
         tipe        = COALESCE($1, tipe),
         pihak       = COALESCE($2, pihak),
         jumlah      = $3,
         dibayar     = $4,
         jatuh_tempo = CASE WHEN $5::boolean THEN $6::date ELSE jatuh_tempo END,
         keterangan  = CASE WHEN $7::boolean THEN $8 ELSE keterangan END,
         status      = $9
       WHERE id = $10
       RETURNING id`,
      [
        tipe,
        req.body?.pihak === undefined ? null : toStr(req.body.pihak),
        jumlahAkhir,
        dibayarAkhir,
        req.body?.jatuh_tempo !== undefined,
        req.body?.jatuh_tempo === null || req.body?.jatuh_tempo === '' ? null : jatuhTempo,
        req.body?.keterangan !== undefined,
        toStr(req.body?.keterangan),
        statusInput ?? (dibayarAkhir >= jumlahAkhir ? 'lunas' : 'belum'),
        id,
      ],
    );
    const { rows: out } = await c.query(
      `SELECT ${COLS} FROM debts d LEFT JOIN users u ON u.id = d.user_id WHERE d.id = $1`,
      [rows[0].id],
    );
    return out[0];
  });

  res.json(row);
});

router.delete('/debts/:id', requireSuperadmin, async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'Hutang/piutang tidak ditemukan');
  const { rowCount } = await q('DELETE FROM debts WHERE id = $1', [id]);
  if (!rowCount) throw new ApiError(404, 'Hutang/piutang tidak ditemukan');
  res.json({ ok: true });
});

export default router;
