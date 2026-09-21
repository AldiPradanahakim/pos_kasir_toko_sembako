import express from 'express';
import { q, tx } from '../db.js';
import { requireSuperadmin } from '../auth.js';
import {
  ApiError, toInt, toStr, dateOrNull, limitOf, todayJakarta,
} from '../lib.js';

const router = express.Router();

/** Detail pembelian lengkap dengan baris-barisnya. */
async function purchaseDetail(where, params) {
  const { rows } = await q(
    `SELECT pu.id, to_char(pu.tanggal, 'YYYY-MM-DD') AS tanggal, pu.supplier, pu.total,
            pu.note, pu.void, pu.created_at, u.id AS user_id, u.name AS user_name
       FROM purchases pu
       JOIN users u ON u.id = pu.user_id
      WHERE ${where}`,
    params,
  );
  const purchase = rows[0];
  if (!purchase) return null;

  const { rows: items } = await q(
    `SELECT pi.id, pi.product_id, p.name AS product_name, pi.unit_id, pi.unit_name, pi.qty,
            pi.isi_snapshot, pi.harga_beli, pi.subtotal
       FROM purchase_items pi
       JOIN products p ON p.id = pi.product_id
      WHERE pi.purchase_id = $1
      ORDER BY pi.id`,
    [purchase.id],
  );

  return { ...purchase, user: { id: purchase.user_id, name: purchase.user_name }, items };
}

router.get('/purchases', requireSuperadmin, async (req, res) => {
  const from = dateOrNull(req.query.from);
  const to = dateOrNull(req.query.to);
  const supplier = toStr(req.query.supplier);

  const { rows } = await q(
    `SELECT pu.id, to_char(pu.tanggal, 'YYYY-MM-DD') AS tanggal, pu.supplier, pu.total,
            pu.note, pu.void, pu.created_at, u.name AS user_name,
            (SELECT count(*) FROM purchase_items pi WHERE pi.purchase_id = pu.id) AS items_count
       FROM purchases pu
       JOIN users u ON u.id = pu.user_id
      WHERE ($1::date IS NULL OR pu.tanggal >= $1)
        AND ($2::date IS NULL OR pu.tanggal <= $2)
        AND ($3::text IS NULL OR pu.supplier ILIKE '%' || $3 || '%')
      ORDER BY pu.tanggal DESC, pu.id DESC
      LIMIT $4`,
    [from, to, supplier, limitOf(req.query.limit, 100)],
  );
  res.json(rows);
});

router.get('/purchases/:id', requireSuperadmin, async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'Pembelian tidak ditemukan');
  const purchase = await purchaseDetail('pu.id = $1', [id]);
  if (!purchase) throw new ApiError(404, 'Pembelian tidak ditemukan');
  res.json(purchase);
});

/**
 * Barang masuk dari supplier. Satu transaksi: pembelian, barisnya, dan stok masuk.
 *
 * Pembelian TIDAK memakai uang: pemilik toko hanya memasukkan produk dan jumlah, jadi
 * `total` selalu 0, `harga_beli`/`subtotal` disimpan NULL, dan tidak ada baris `cash_flows`
 * yang ditulis. `harga_beli` dari klien (bila masih dikirim versi lama) diabaikan, bukan
 * ditolak. `qty_base` = `isi_snapshot × qty`.
 */
router.post('/purchases', requireSuperadmin, async (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length === 0) throw new ApiError(422, 'items tidak boleh kosong');

  const tanggal = req.body?.tanggal === undefined || req.body?.tanggal === null || req.body?.tanggal === ''
    ? todayJakarta()
    : dateOrNull(req.body.tanggal);
  if (!tanggal) throw new ApiError(422, 'tanggal tidak valid (YYYY-MM-DD)');
  const supplier = toStr(req.body?.supplier);

  const id = await tx(async (c) => {
    const lines = [];
    for (const raw of items) {
      const productId = toInt(raw?.product_id);
      const unitId = toInt(raw?.unit_id);
      const qty = toInt(raw?.qty);
      if (productId === null) throw new ApiError(422, 'product_id item tidak valid');
      if (unitId === null) throw new ApiError(422, 'unit_id item tidak valid');
      if (qty === null || qty <= 0) throw new ApiError(422, 'qty item harus bilangan bulat lebih dari 0');

      const { rows: pu } = await c.query(
        `SELECT pu.isi, u.name AS unit_name
           FROM product_units pu JOIN units u ON u.id = pu.unit_id
          WHERE pu.product_id = $1 AND pu.unit_id = $2`,
        [productId, unitId],
      );
      if (!pu.length) throw new ApiError(422, 'Satuan itu tidak terdaftar untuk produk pada item');

      lines.push({
        product_id: productId,
        unit_id: unitId,
        unit_name: pu[0].unit_name,
        qty,
        isi_snapshot: pu[0].isi,
      });
    }

    const { rows } = await c.query(
      `INSERT INTO purchases (tanggal, supplier, total, note, user_id)
       VALUES ($1, $2, 0, $3, $4) RETURNING id`,
      [tanggal, supplier, toStr(req.body?.note), req.user.id],
    );
    const purchaseId = rows[0].id;

    for (const l of lines) {
      await c.query(
        `INSERT INTO purchase_items (purchase_id, product_id, unit_id, unit_name, qty,
                                     isi_snapshot, harga_beli, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL)`,
        [purchaseId, l.product_id, l.unit_id, l.unit_name, l.qty, l.isi_snapshot],
      );
      // Beli 2 dus isi 40 => masuk +80 base_unit.
      await c.query(
        `INSERT INTO stock_movements (product_id, type, qty_base, reference_type, reference_id, note, user_id, created_at)
         VALUES ($1, 'masuk', $2, 'purchase', $3, $4, $5, $6::date + time '12:00')`,
        [l.product_id, l.isi_snapshot * l.qty, purchaseId,
          `Pembelian${supplier ? ` ${supplier}` : ''}`, req.user.id, tanggal],
      );
    }

    return purchaseId;
  });

  res.status(201).json(await purchaseDetail('pu.id = $1', [id]));
});

/**
 * Hapus pembelian (superadmin): stok dikembalikan sebagai `penyesuaian` negatif, lalu
 * barisnya dihapus.
 *
 * Pembelian baru tidak punya baris kas, jadi tidak ada yang perlu dibuang; DELETE di bawah
 * hanya menyapu baris kas warisan milik pembelian lama, dan menghapus 0 baris bukan error.
 */
router.delete('/purchases/:id', requireSuperadmin, async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'Pembelian tidak ditemukan');

  await tx(async (c) => {
    const { rows } = await c.query('SELECT id, supplier FROM purchases WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) throw new ApiError(404, 'Pembelian tidak ditemukan');

    await c.query(
      `INSERT INTO stock_movements (product_id, type, qty_base, reference_type, reference_id, note, user_id)
       SELECT pi.product_id, 'penyesuaian', -SUM(pi.isi_snapshot * pi.qty), 'purchase', pi.purchase_id,
              'Hapus pembelian' || CASE WHEN $2::text IS NULL THEN '' ELSE ' ' || $2 END, $3
         FROM purchase_items pi
        WHERE pi.purchase_id = $1
        GROUP BY pi.product_id, pi.purchase_id`,
      [id, rows[0].supplier, req.user.id],
    );

    await c.query(`DELETE FROM cash_flows WHERE ref_type = 'purchase' AND ref_id = $1`, [id]);
    await c.query('DELETE FROM purchases WHERE id = $1', [id]);
  });

  res.json({ ok: true });
});

export default router;
