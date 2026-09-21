import express from 'express';
import bcrypt from 'bcryptjs';
import { q, tx } from '../db.js';
import { requireSuperadmin } from '../auth.js';
import {
  ApiError, toBool, toInt, toStr, barcodeOrNull, listProducts, getProductOr404,
} from '../lib.js';

const router = express.Router();
const superadminOnly = [requireSuperadmin];

/** CRUD sederhana untuk categories & units (bentuknya identik). */
function simpleMaster(table, label) {
  const r = express.Router();

  r.get('/', async (_req, res) => {
    const { rows } = await q(`SELECT id, name, is_active FROM ${table} ORDER BY name`);
    res.json(rows);
  });

  r.post('/', ...superadminOnly, async (req, res) => {
    const name = toStr(req.body?.name);
    if (!name) throw new ApiError(422, `Nama ${label} wajib diisi`);
    const { rows } = await q(
      `INSERT INTO ${table} (name, is_active) VALUES ($1, $2) RETURNING id, name, is_active`,
      [name, toBool(req.body?.is_active)],
    );
    res.status(201).json(rows[0]);
  });

  r.put('/:id', ...superadminOnly, async (req, res) => {
    const id = toInt(req.params.id);
    if (id === null) throw new ApiError(404, `${label} tidak ditemukan`);
    const name = toStr(req.body?.name);
    if (!name) throw new ApiError(422, `Nama ${label} wajib diisi`);
    const { rows } = await q(
      `UPDATE ${table} SET name = $1, is_active = $2, updated_at = now()
        WHERE id = $3 RETURNING id, name, is_active`,
      [name, toBool(req.body?.is_active), id],
    );
    if (!rows.length) throw new ApiError(404, `${label} tidak ditemukan`);
    res.json(rows[0]);
  });

  // Soft delete bila masih dipakai, hard delete bila tidak.
  r.delete('/:id', ...superadminOnly, async (req, res) => {
    const id = toInt(req.params.id);
    if (id === null) throw new ApiError(404, `${label} tidak ditemukan`);
    const { rows } = await q(
      table === 'categories'
        ? 'SELECT 1 FROM products WHERE category_id = $1 LIMIT 1'
        : 'SELECT 1 FROM product_units WHERE unit_id = $1 LIMIT 1',
      [id],
    );
    if (rows.length) {
      const r2 = await q(`UPDATE ${table} SET is_active = false, updated_at = now() WHERE id = $1 RETURNING id`, [id]);
      if (!r2.rows.length) throw new ApiError(404, `${label} tidak ditemukan`);
    } else {
      const r2 = await q(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]);
      if (!r2.rows.length) throw new ApiError(404, `${label} tidak ditemukan`);
    }
    res.json({ ok: true });
  });

  return r;
}

router.use('/categories', simpleMaster('categories', 'Kategori'));
router.use('/units', simpleMaster('units', 'Satuan'));

// ---------------------------------------------------------------- products
router.get('/products', async (req, res) => {
  res.json(await listProducts({
    q: toStr(req.query.q),
    barcode: toStr(req.query.barcode),
    categoryId: toInt(req.query.category_id),
  }));
});

/** Validasi payload units[] dan normalkan. */
function parseUnits(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ApiError(422, 'Minimal satu satuan produk wajib diisi');
  }
  const seen = new Set();
  return raw.map((u) => {
    const unitId = toInt(u?.unit_id);
    const isi = toInt(u?.isi);
    const hargaJual = toInt(u?.harga_jual);
    const hargaModal = toInt(u?.harga_modal);
    if (unitId === null) throw new ApiError(422, 'unit_id satuan tidak valid');
    if (isi === null || isi <= 0) throw new ApiError(422, 'isi harus bilangan bulat lebih dari 0');
    if (hargaJual === null || hargaJual < 0) throw new ApiError(422, 'harga_jual harus bilangan bulat >= 0');
    if (hargaModal === null || hargaModal < 0) throw new ApiError(422, 'harga_modal harus bilangan bulat >= 0');
    if (seen.has(unitId)) throw new ApiError(422, 'Satuan yang sama tidak boleh muncul dua kali');
    seen.add(unitId);
    return { unit_id: unitId, isi, harga_jual: hargaJual, harga_modal: hargaModal, barcode: barcodeOrNull(u?.barcode) };
  });
}

function parseProductBody(body) {
  const name = toStr(body?.name);
  const baseUnit = toStr(body?.base_unit);
  if (!name) throw new ApiError(422, 'Nama produk wajib diisi');
  if (baseUnit !== 'pcs' && baseUnit !== 'gram') throw new ApiError(422, "base_unit harus 'pcs' atau 'gram'");
  const categoryId = toInt(body?.category_id);
  if (body?.category_id !== undefined && body?.category_id !== null && categoryId === null) {
    throw new ApiError(422, 'category_id tidak valid');
  }
  return { name, base_unit: baseUnit, category_id: categoryId, barcode: barcodeOrNull(body?.barcode), is_active: toBool(body?.is_active) };
}

router.post('/products', ...superadminOnly, async (req, res) => {
  const p = parseProductBody(req.body);
  const units = parseUnits(req.body?.units);

  const created = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO products (name, category_id, base_unit, barcode, is_active)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [p.name, p.category_id, p.base_unit, p.barcode, p.is_active],
    );
    const id = rows[0].id;
    for (const u of units) {
      await c.query(
        `INSERT INTO product_units (product_id, unit_id, isi, harga_jual, harga_modal, barcode)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, u.unit_id, u.isi, u.harga_jual, u.harga_modal, u.barcode],
      );
    }
    return id;
  });

  res.status(201).json(await getProductOr404(created));
});

// PUT mengganti seluruh array units: upsert per unit_id, sisanya dihapus.
router.put('/products/:id', ...superadminOnly, async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'Produk tidak ditemukan');
  const p = parseProductBody(req.body);
  const units = parseUnits(req.body?.units);

  await tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE products SET name = $1, category_id = $2, base_unit = $3, barcode = $4,
              is_active = $5, updated_at = now()
        WHERE id = $6 RETURNING id`,
      [p.name, p.category_id, p.base_unit, p.barcode, p.is_active, id],
    );
    if (!rows.length) throw new ApiError(404, 'Produk tidak ditemukan');

    const keep = units.map((u) => u.unit_id);
    await c.query('DELETE FROM product_units WHERE product_id = $1 AND NOT (unit_id = ANY($2::bigint[]))', [id, keep]);
    for (const u of units) {
      await c.query(
        `INSERT INTO product_units (product_id, unit_id, isi, harga_jual, harga_modal, barcode)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (product_id, unit_id) DO UPDATE
           SET isi = EXCLUDED.isi, harga_jual = EXCLUDED.harga_jual,
               harga_modal = EXCLUDED.harga_modal, barcode = EXCLUDED.barcode,
               updated_at = now()`,
        [id, u.unit_id, u.isi, u.harga_jual, u.harga_modal, u.barcode],
      );
    }
  });

  res.json(await getProductOr404(id));
});

router.delete('/products/:id', ...superadminOnly, async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'Produk tidak ditemukan');
  const { rows } = await q(
    'UPDATE products SET is_active = false, updated_at = now() WHERE id = $1 RETURNING id',
    [id],
  );
  if (!rows.length) throw new ApiError(404, 'Produk tidak ditemukan');
  res.json({ ok: true });
});

// ------------------------------------------------------------------- users
const USER_COLS = 'id, name, username, role, is_active';

router.get('/users', ...superadminOnly, async (_req, res) => {
  const { rows } = await q(`SELECT ${USER_COLS} FROM users ORDER BY name`);
  res.json(rows);
});

router.post('/users', ...superadminOnly, async (req, res) => {
  const name = toStr(req.body?.name);
  const username = toStr(req.body?.username);
  const password = req.body?.password;
  const role = toStr(req.body?.role);
  if (!name) throw new ApiError(422, 'Nama wajib diisi');
  if (!username) throw new ApiError(422, 'Username wajib diisi');
  if (!password || String(password).length < 4) throw new ApiError(422, 'Password minimal 4 karakter');
  if (role !== 'kasir' && role !== 'superadmin') throw new ApiError(422, "role harus 'kasir' atau 'superadmin'");

  const { rows } = await q(
    `INSERT INTO users (name, username, password, role, is_active)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${USER_COLS}`,
    [name, username, await bcrypt.hash(String(password), 10), role, toBool(req.body?.is_active)],
  );
  res.status(201).json(rows[0]);
});

router.put('/users/:id', ...superadminOnly, async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'User tidak ditemukan');

  const { rows: cur } = await q(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]);
  if (!cur.length) throw new ApiError(404, 'User tidak ditemukan');
  const current = cur[0];

  const name = toStr(req.body?.name) ?? current.name;
  const username = toStr(req.body?.username) ?? current.username;
  const role = toStr(req.body?.role) ?? current.role;
  const isActive = toBool(req.body?.is_active, current.is_active);
  if (role !== 'kasir' && role !== 'superadmin') throw new ApiError(422, "role harus 'kasir' atau 'superadmin'");
  if (id === req.user.id && !isActive) throw new ApiError(422, 'Tidak bisa menonaktifkan akun sendiri');

  const password = req.body?.password;
  if (password !== undefined && password !== null && String(password) !== '') {
    if (String(password).length < 4) throw new ApiError(422, 'Password minimal 4 karakter');
    await q(
      `UPDATE users SET name = $1, username = $2, role = $3, is_active = $4, password = $5, updated_at = now()
        WHERE id = $6`,
      [name, username, role, isActive, await bcrypt.hash(String(password), 10), id],
    );
  } else {
    await q(
      `UPDATE users SET name = $1, username = $2, role = $3, is_active = $4, updated_at = now() WHERE id = $5`,
      [name, username, role, isActive, id],
    );
  }

  const { rows } = await q(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]);
  res.json(rows[0]);
});

router.delete('/users/:id', ...superadminOnly, async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'User tidak ditemukan');
  if (id === req.user.id) throw new ApiError(422, 'Tidak bisa menghapus akun sendiri');

  const { rows: used } = await q(
    `SELECT 1 FROM sales WHERE user_id = $1
      UNION ALL SELECT 1 FROM stock_movements WHERE user_id = $1 LIMIT 1`,
    [id],
  );
  if (used.length) {
    const r = await q('UPDATE users SET is_active = false, updated_at = now() WHERE id = $1 RETURNING id', [id]);
    if (!r.rows.length) throw new ApiError(404, 'User tidak ditemukan');
  } else {
    const r = await q('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (!r.rows.length) throw new ApiError(404, 'User tidak ditemukan');
  }
  res.json({ ok: true });
});

export default router;
