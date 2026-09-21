import express from 'express';
import { q, tx } from '../db.js';
import { requireSuperadmin } from '../auth.js';
import {
  ApiError, toInt, toStr, dateOrNull, limitOf, stockList,
  stockByProduct, unitsByProduct, displayStock,
} from '../lib.js';

const router = express.Router();

// Stok = SUM(stock_movements.qty_base), selalu base_unit.
router.get('/stock', async (_req, res) => {
  res.json(await stockList());
});

router.get('/stock/movements', async (req, res) => {
  const productId = toInt(req.query.product_id);
  const from = dateOrNull(req.query.from);
  const to = dateOrNull(req.query.to);

  const { rows } = await q(
    `SELECT sm.id, sm.product_id, p.name AS product_name, sm.type, sm.qty_base,
            sm.note, u.name AS user_name, sm.created_at, sm.reference_type, sm.reference_id
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id
       LEFT JOIN users u ON u.id = sm.user_id
      WHERE ($1::bigint IS NULL OR sm.product_id = $1)
        AND ($2::date IS NULL OR (sm.created_at AT TIME ZONE 'Asia/Jakarta')::date >= $2)
        AND ($3::date IS NULL OR (sm.created_at AT TIME ZONE 'Asia/Jakarta')::date <= $3)
      ORDER BY sm.created_at DESC, sm.id DESC
      LIMIT $4`,
    [productId, from, to, limitOf(req.query.limit)],
  );
  res.json(rows);
});

// Stok masuk: konversi otomatis lewat `isi` satuan. Tanpa supplier/PO/harga beli.
router.post('/stock/in', async (req, res) => {
  const productId = toInt(req.body?.product_id);
  const unitId = toInt(req.body?.unit_id);
  const qty = toInt(req.body?.qty);
  const note = toStr(req.body?.note);

  if (productId === null) throw new ApiError(422, 'product_id wajib diisi');
  if (unitId === null) throw new ApiError(422, 'unit_id wajib diisi');
  if (qty === null || qty <= 0) throw new ApiError(422, 'qty harus bilangan bulat lebih dari 0');

  const movement = await tx(async (c) => {
    const { rows: pu } = await c.query(
      'SELECT isi FROM product_units WHERE product_id = $1 AND unit_id = $2',
      [productId, unitId],
    );
    if (!pu.length) throw new ApiError(422, 'Satuan itu tidak terdaftar untuk produk ini');

    const { rows } = await c.query(
      `INSERT INTO stock_movements (product_id, type, qty_base, reference_type, reference_id, note, user_id)
       VALUES ($1, 'masuk', $2, 'stok_masuk', NULL, $3, $4)
       RETURNING id, product_id, type, qty_base, note, user_id, created_at`,
      [productId, pu[0].isi * qty, note, req.user.id],
    );
    return rows[0];
  });

  const { rows: named } = await q(
    `SELECT sm.id, sm.product_id, p.name AS product_name, sm.type, sm.qty_base, sm.note,
            u.name AS user_name, sm.created_at, sm.reference_type, sm.reference_id
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id
       LEFT JOIN users u ON u.id = sm.user_id
      WHERE sm.id = $1`,
    [movement.id],
  );
  res.status(201).json({ ok: true, movement: named[0] });
});

/**
 * Stok masuk massal (alur OCR struk). Seluruh baris diterapkan dalam SATU transaksi:
 * satu baris tidak valid => 422 dan tidak ada yang setengah masuk. Stok yang masuk
 * sebagian dari sebuah struk akan diam-diam merusak hitungan.
 */
router.post('/stock/in/bulk', async (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length === 0) throw new ApiError(422, 'items tidak boleh kosong');
  const note = toStr(req.body?.note);

  const rawAliases = req.body?.aliases ?? [];
  if (!Array.isArray(rawAliases)) throw new ApiError(422, 'aliases harus berupa array');

  const applied = await tx(async (c) => {
    // Tahap 1: validasi seluruh baris. Belum ada satu pun tulisan di sini.
    const lines = [];
    for (const raw of items) {
      const productId = toInt(raw?.product_id);
      const unitId = toInt(raw?.unit_id);
      const qty = toInt(raw?.qty);
      if (productId === null) throw new ApiError(422, 'product_id baris tidak valid');
      if (unitId === null) throw new ApiError(422, 'unit_id baris tidak valid');
      if (qty === null || qty <= 0) throw new ApiError(422, 'qty baris harus bilangan bulat lebih dari 0');

      const { rows: pu } = await c.query(
        'SELECT isi FROM product_units WHERE product_id = $1 AND unit_id = $2',
        [productId, unitId],
      );
      if (!pu.length) throw new ApiError(422, 'Satuan pada salah satu baris tidak terdaftar untuk produknya');
      lines.push({ productId, qtyBase: pu[0].isi * qty, note: toStr(raw?.note) ?? note });
    }

    const aliases = [];
    for (const raw of rawAliases) {
      const alias = toStr(raw?.alias);
      const productId = toInt(raw?.product_id);
      if (!alias) throw new ApiError(422, 'alias wajib diisi');
      if (productId === null) throw new ApiError(422, 'product_id alias tidak valid');
      const { rows } = await c.query('SELECT 1 FROM products WHERE id = $1', [productId]);
      if (!rows.length) throw new ApiError(422, `Produk untuk alias "${alias}" tidak ditemukan`);
      aliases.push({ alias, productId });
    }

    // Tahap 2: baru menulis.
    const movementIds = [];
    for (const l of lines) {
      const { rows } = await c.query(
        `INSERT INTO stock_movements (product_id, type, qty_base, reference_type, reference_id, note, user_id)
         VALUES ($1, 'masuk', $2, 'stok_masuk', NULL, $3, $4) RETURNING id`,
        [l.productId, l.qtyBase, l.note, req.user.id],
      );
      movementIds.push(rows[0].id);
    }

    for (const a of aliases) {
      await c.query(
        `INSERT INTO product_aliases (alias, product_id) VALUES ($1, $2)
         ON CONFLICT (alias) DO UPDATE SET product_id = EXCLUDED.product_id, updated_at = now()`,
        [a.alias, a.productId],
      );
    }

    return movementIds;
  });

  const { rows: movements } = await q(
    `SELECT sm.id, sm.product_id, p.name AS product_name, sm.type, sm.qty_base, sm.note,
            u.name AS user_name, sm.created_at, sm.reference_type, sm.reference_id
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id
       LEFT JOIN users u ON u.id = sm.user_id
      WHERE sm.id = ANY($1::bigint[])
      ORDER BY sm.id`,
    [applied],
  );

  res.status(201).json({ ok: true, applied: movements.length, movements });
});

// Pemetaan teks struk OCR -> produk, untuk pra-cocok di perangkat.
router.get('/product-aliases', async (_req, res) => {
  const { rows } = await q(
    `SELECT pa.id, pa.alias, pa.product_id, p.name AS product_name, pa.updated_at
       FROM product_aliases pa
       JOIN products p ON p.id = pa.product_id
      ORDER BY pa.alias`,
  );
  res.json(rows);
});

// Stok opname: stok sistem saat ini per produk + opname terakhir, untuk mengisi formulir.
router.get('/stock-opnames', async (_req, res) => {
  const [stock, units, products, last] = await Promise.all([
    stockByProduct(),
    unitsByProduct(),
    q('SELECT id, name, base_unit FROM products ORDER BY name'),
    q(`SELECT DISTINCT ON (o.product_id) o.product_id, o.stok_fisik, o.selisih, o.catatan,
              o.created_at, u.name AS user_name
         FROM stock_opnames o
         LEFT JOIN users u ON u.id = o.user_id
        ORDER BY o.product_id, o.created_at DESC, o.id DESC`),
  ]);

  const lastBy = new Map(last.rows.map((r) => [r.product_id, r]));
  res.json(products.rows.map((p) => {
    const sistem = stock.get(p.id) ?? 0;
    const prev = lastBy.get(p.id);
    return {
      product_id: p.id,
      name: p.name,
      base_unit: p.base_unit,
      stok_sistem: sistem,
      display: displayStock(sistem, p.base_unit, units.get(p.id) || []),
      minus: sistem < 0,
      last_opname: prev
        ? {
          stok_fisik: prev.stok_fisik,
          selisih: prev.selisih,
          catatan: prev.catatan,
          created_at: prev.created_at,
          user_name: prev.user_name,
        }
        : null,
    };
  }));
});

/**
 * Simpan hasil hitung fisik. Selisih != 0 langsung menyesuaikan stok lewat movement
 * `penyesuaian`. Semua baris dalam satu transaksi.
 */
router.post('/stock-opnames', requireSuperadmin, async (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length === 0) throw new ApiError(422, 'items tidak boleh kosong');

  const saved = await tx(async (c) => {
    const lines = [];
    for (const raw of items) {
      const productId = toInt(raw?.product_id);
      const stokFisik = toInt(raw?.stok_fisik);
      if (productId === null) throw new ApiError(422, 'product_id baris tidak valid');
      if (stokFisik === null || stokFisik < 0) throw new ApiError(422, 'stok_fisik baris harus bilangan bulat >= 0');
      lines.push({ productId, stokFisik, catatan: toStr(raw?.catatan) });
    }

    const ids = [...new Set(lines.map((l) => l.productId))];
    if (ids.length !== lines.length) throw new ApiError(422, 'Satu produk tidak boleh muncul dua kali');

    const { rows: found } = await c.query('SELECT id FROM products WHERE id = ANY($1::bigint[]) FOR UPDATE', [ids]);
    if (found.length !== ids.length) throw new ApiError(422, 'Ada produk pada items yang tidak ditemukan');

    const { rows: stok } = await c.query(
      `SELECT product_id, COALESCE(SUM(qty_base), 0) AS stok_base
         FROM stock_movements WHERE product_id = ANY($1::bigint[]) GROUP BY product_id`,
      [ids],
    );
    const sistemOf = new Map(stok.map((r) => [r.product_id, Number(r.stok_base)]));

    const out = [];
    for (const l of lines) {
      const sistem = sistemOf.get(l.productId) ?? 0;
      const selisih = l.stokFisik - sistem;
      const { rows } = await c.query(
        `INSERT INTO stock_opnames (product_id, stok_sistem, stok_fisik, selisih, catatan, user_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, product_id, stok_sistem, stok_fisik, selisih, catatan, created_at`,
        [l.productId, sistem, l.stokFisik, selisih, l.catatan, req.user.id],
      );
      if (selisih !== 0) {
        await c.query(
          `INSERT INTO stock_movements (product_id, type, qty_base, reference_type, reference_id, note, user_id)
           VALUES ($1, 'penyesuaian', $2, 'opname', $3, $4, $5)`,
          [l.productId, selisih, rows[0].id, l.catatan ? `Opname: ${l.catatan}` : 'Stok opname', req.user.id],
        );
      }
      out.push(rows[0]);
    }
    return out;
  });

  res.status(201).json({ ok: true, applied: saved.length, rows: saved });
});

export default router;
