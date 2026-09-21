import express from 'express';
import { q, tx } from '../db.js';
import { requireSuperadmin } from '../auth.js';
import {
  ApiError, toInt, toStr, dateOrNull, limitOf, insertCashFlow, todayJakarta,
} from '../lib.js';

const router = express.Router();
const TIPE = ['penjualan', 'pembelian'];

/** Kategori kas lawan dari sebuah retur. */
const KATEGORI = { penjualan: 'retur_penjualan', pembelian: 'retur_pembelian' };

const COLS = `r.id, r.tipe, r.ref_id, r.product_id, p.name AS product_name, r.unit_id, r.qty,
              r.jumlah, r.alasan, r.created_at, u.name AS user_name`;

router.get('/returns', async (req, res) => {
  const tipe = toStr(req.query.tipe);
  if (tipe && !TIPE.includes(tipe)) throw new ApiError(422, "tipe harus 'penjualan' atau 'pembelian'");
  const from = dateOrNull(req.query.from);
  const to = dateOrNull(req.query.to);

  const { rows } = await q(
    `SELECT ${COLS}
       FROM returns r
       JOIN products p ON p.id = r.product_id
       LEFT JOIN users u ON u.id = r.user_id
      WHERE ($1::text IS NULL OR r.tipe = $1)
        AND ($2::date IS NULL OR (r.created_at AT TIME ZONE 'Asia/Jakarta')::date >= $2)
        AND ($3::date IS NULL OR (r.created_at AT TIME ZONE 'Asia/Jakarta')::date <= $3)
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT $4`,
    [tipe, from, to, limitOf(req.query.limit, 100)],
  );
  res.json(rows);
});

/**
 * Catat retur (superadmin, sesuai aturan "endpoint tulis butuh superadmin").
 * Retur penjualan = barang kembali ke toko (stok masuk) dan uang keluar ke pembeli.
 * Retur pembelian = barang dikirim balik ke supplier (stok keluar) dan uang masuk
 * kembali dari supplier.
 */
router.post('/returns', requireSuperadmin, async (req, res) => {
  const tipe = toStr(req.body?.tipe);
  if (!TIPE.includes(tipe)) throw new ApiError(422, "tipe harus 'penjualan' atau 'pembelian'");

  const productId = toInt(req.body?.product_id);
  const unitId = toInt(req.body?.unit_id);
  const qty = toInt(req.body?.qty);
  const jumlah = toInt(req.body?.jumlah);
  const alasan = toStr(req.body?.alasan);
  const refId = req.body?.ref_id === undefined || req.body?.ref_id === null ? null : toInt(req.body.ref_id);

  if (productId === null) throw new ApiError(422, 'product_id wajib diisi');
  if (unitId === null) throw new ApiError(422, 'unit_id wajib diisi');
  if (qty === null || qty <= 0) throw new ApiError(422, 'qty harus bilangan bulat lebih dari 0');
  if (jumlah === null || jumlah < 0) throw new ApiError(422, 'jumlah harus bilangan bulat >= 0');
  if (!alasan) throw new ApiError(422, 'alasan wajib diisi');
  if (req.body?.ref_id !== undefined && req.body?.ref_id !== null && refId === null) {
    throw new ApiError(422, 'ref_id tidak valid');
  }

  const id = await tx(async (c) => {
    const { rows: pu } = await c.query(
      'SELECT isi FROM product_units WHERE product_id = $1 AND unit_id = $2',
      [productId, unitId],
    );
    if (!pu.length) throw new ApiError(422, 'Satuan itu tidak terdaftar untuk produk ini');

    const { rows } = await c.query(
      `INSERT INTO returns (tipe, ref_id, product_id, unit_id, qty, jumlah, alasan, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [tipe, refId, productId, unitId, qty, jumlah, alasan, req.user.id],
    );
    const returnId = rows[0].id;

    // penjualan: barang masuk kembali (+). pembelian: barang keluar ke supplier (-).
    const qtyBase = pu[0].isi * qty * (tipe === 'penjualan' ? 1 : -1);
    await c.query(
      `INSERT INTO stock_movements (product_id, type, qty_base, reference_type, reference_id, note, user_id)
       VALUES ($1, $2, $3, 'return', $4, $5, $6)`,
      [productId, tipe === 'penjualan' ? 'masuk' : 'keluar', qtyBase, returnId, `Retur ${tipe}: ${alasan}`, req.user.id],
    );

    await insertCashFlow(c, {
      tanggal: todayJakarta(),
      tipe: tipe === 'penjualan' ? 'keluar' : 'masuk',
      kategori: KATEGORI[tipe],
      jumlah,
      keterangan: `Retur ${tipe}: ${alasan}`,
      refType: 'return',
      refId: returnId,
      userId: req.user.id,
    });

    return returnId;
  });

  const { rows } = await q(
    `SELECT ${COLS} FROM returns r
       JOIN products p ON p.id = r.product_id
       LEFT JOIN users u ON u.id = r.user_id
      WHERE r.id = $1`,
    [id],
  );
  res.status(201).json(rows[0]);
});

// Batalkan retur: stok dikembalikan ke posisi semula, baris kasnya ikut dihapus.
router.delete('/returns/:id', requireSuperadmin, async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'Retur tidak ditemukan');

  await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT r.id, r.tipe, r.product_id, r.unit_id, r.qty, pu.isi
         FROM returns r
         JOIN product_units pu ON pu.product_id = r.product_id AND pu.unit_id = r.unit_id
        WHERE r.id = $1
          FOR UPDATE OF r`,
      [id],
    );
    if (!rows.length) throw new ApiError(404, 'Retur tidak ditemukan');
    const r = rows[0];

    const qtyBase = r.isi * r.qty * (r.tipe === 'penjualan' ? -1 : 1);
    await c.query(
      `INSERT INTO stock_movements (product_id, type, qty_base, reference_type, reference_id, note, user_id)
       VALUES ($1, 'penyesuaian', $2, 'return', $3, 'Hapus retur', $4)`,
      [r.product_id, qtyBase, id, req.user.id],
    );
    await c.query(`DELETE FROM cash_flows WHERE ref_type = 'return' AND ref_id = $1`, [id]);
    await c.query('DELETE FROM returns WHERE id = $1', [id]);
  });

  res.json({ ok: true });
});

export default router;
