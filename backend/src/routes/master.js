import express from 'express';
import bcrypt from 'bcryptjs';
import { q, tx } from '../db.js';
import { requireSuperadmin } from '../auth.js';
import {
  ApiError, toBool, toInt, toStr, barcodeOrNull, listProducts, getProductOr404, limitOf,
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

/**
 * Satuan punya satu kolom tambahan: `inisial`. Dipakai layar kasir untuk membaca singkatan
 * di nota pelanggan ("2 (r) Beng Beng" = 2 renceng), jadi bentuknya dibatasi: 1–4 huruf
 * atau angka. Tanda "/" sengaja TIDAK diterima: pengurai membuang angka & tanda baca dari
 * nama barang lebih dulu, jadi singkatan seperti "1/2" tidak akan pernah bisa dicocokkan.
 * Disimpan huruf kecil supaya "P" dan "p" satu hal yang sama.
 */
function inisialAtauNull(v) {
  // Spasi di tengah TIDAK dibuang diam-diam: "r r" bukan singkatan, jadi ditolak.
  const s = toStr(v)?.toLowerCase() ?? null;
  if (!s) return null;
  if (!/^[a-z0-9]{1,4}$/.test(s)) {
    throw new ApiError(422, 'Inisial satuan hanya boleh 1–4 huruf/angka, mis. r, p, d, sl');
  }
  return s;
}

const unitRouter = express.Router();

unitRouter.get('/', async (_req, res) => {
  const { rows } = await q('SELECT id, name, inisial, is_active FROM units ORDER BY name');
  res.json(rows);
});

unitRouter.post('/', ...superadminOnly, async (req, res) => {
  const name = toStr(req.body?.name);
  if (!name) throw new ApiError(422, 'Nama Satuan wajib diisi');
  const { rows } = await q(
    'INSERT INTO units (name, inisial, is_active) VALUES ($1, $2, $3) RETURNING id, name, inisial, is_active',
    [name, inisialAtauNull(req.body?.inisial), toBool(req.body?.is_active)],
  );
  res.status(201).json(rows[0]);
});

unitRouter.put('/:id', ...superadminOnly, async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'Satuan tidak ditemukan');
  const name = toStr(req.body?.name);
  if (!name) throw new ApiError(422, 'Nama Satuan wajib diisi');
  const { rows } = await q(
    `UPDATE units SET name = $1, inisial = $2, is_active = $3, updated_at = now()
      WHERE id = $4 RETURNING id, name, inisial, is_active`,
    [name, inisialAtauNull(req.body?.inisial), toBool(req.body?.is_active), id],
  );
  if (!rows.length) throw new ApiError(404, 'Satuan tidak ditemukan');
  res.json(rows[0]);
});

// Sama seperti kategori: soft delete bila masih dipakai produk, hard delete bila tidak.
unitRouter.delete('/:id', ...superadminOnly, async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'Satuan tidak ditemukan');
  const { rows } = await q('SELECT 1 FROM product_units WHERE unit_id = $1 LIMIT 1', [id]);
  const r2 = rows.length
    ? await q('UPDATE units SET is_active = false, updated_at = now() WHERE id = $1 RETURNING id', [id])
    : await q('DELETE FROM units WHERE id = $1 RETURNING id', [id]);
  if (!r2.rows.length) throw new ApiError(404, 'Satuan tidak ditemukan');
  res.json({ ok: true });
});

router.use('/units', unitRouter);

/**
 * Pelanggan (untuk bon). Baris dibuat otomatis dari nama di layar kasir, jadi di sini
 * yang perlu ada hanya: daftar + sisa piutangnya, perbaikan nama/telepon, dan nonaktif.
 * Nama tidak bisa diubah jadi nama yang sudah dipakai pelanggan lain (indeks lower(nama)).
 */
const COLS_PELANGGAN = `c.id, c.nama, c.telepon, c.catatan, c.is_active, c.created_at,
  (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) AS jumlah_transaksi,
  COALESCE((SELECT SUM(d.jumlah - d.dibayar) FROM debts d
             WHERE d.customer_id = c.id AND d.tipe = 'piutang' AND d.status = 'belum'), 0) AS sisa_piutang`;

router.get('/customers', async (req, res) => {
  const search = toStr(req.query.q);
  const aktif = toStr(req.query.aktif);
  const { rows } = await q(
    `SELECT ${COLS_PELANGGAN}
       FROM customers c
      WHERE ($1::text IS NULL OR c.nama ILIKE '%' || $1 || '%' OR c.telepon ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR c.is_active = ($2 = 'true'))
      ORDER BY c.is_active DESC, sisa_piutang DESC, c.nama
      LIMIT $3`,
    [search, aktif === 'true' || aktif === 'false' ? aktif : null, limitOf(req.query.limit, 500)],
  );
  res.json(rows);
});

router.post('/customers', ...superadminOnly, async (req, res) => {
  const nama = toStr(req.body?.nama);
  if (!nama) throw new ApiError(422, 'Nama pelanggan wajib diisi');
  const { rows } = await q(
    `INSERT INTO customers (nama, telepon, catatan, is_active) VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [nama, toStr(req.body?.telepon), toStr(req.body?.catatan), toBool(req.body?.is_active)],
  );
  res.status(201).json((await q(`SELECT ${COLS_PELANGGAN} FROM customers c WHERE c.id = $1`, [rows[0].id])).rows[0]);
});

router.put('/customers/:id', ...superadminOnly, async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'Pelanggan tidak ditemukan');
  const nama = toStr(req.body?.nama);
  if (!nama) throw new ApiError(422, 'Nama pelanggan wajib diisi');
  const { rows } = await q(
    `UPDATE customers SET nama = $1, telepon = $2, catatan = $3, is_active = $4
      WHERE id = $5 RETURNING id`,
    [nama, toStr(req.body?.telepon), toStr(req.body?.catatan), toBool(req.body?.is_active), id],
  );
  if (!rows.length) throw new ApiError(404, 'Pelanggan tidak ditemukan');
  res.json((await q(`SELECT ${COLS_PELANGGAN} FROM customers c WHERE c.id = $1`, [id])).rows[0]);
});

// Nonaktifkan (bukan hapus): riwayat bon dan transaksinya harus tetap bisa dibaca.
router.delete('/customers/:id', ...superadminOnly, async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'Pelanggan tidak ditemukan');
  const { rowCount } = await q('UPDATE customers SET is_active = false WHERE id = $1', [id]);
  if (!rowCount) throw new ApiError(404, 'Pelanggan tidak ditemukan');
  res.json({ ok: true });
});

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
  // Satuan hitung opsional: kosong berarti "belum dipilih", server memakai satuan terbesar.
  const baseUnitId = toInt(body?.base_unit_id);
  if (body?.base_unit_id !== undefined && body?.base_unit_id !== null && body?.base_unit_id !== ''
      && baseUnitId === null) {
    throw new ApiError(422, 'base_unit_id tidak valid');
  }
  return {
    name,
    base_unit: baseUnit,
    category_id: categoryId,
    barcode: barcodeOrNull(body?.barcode),
    is_active: toBool(body?.is_active),
    base_unit_id: baseUnitId,
    izin_minus: toBool(body?.izin_minus, false),
  };
}

/**
 * Satuan hitung wajib milik produk itu sendiri: kalau tidak dicek, produk bisa menunjuk
 * satuan produk lain dan tampilan stoknya membagi dengan `isi` yang salah.
 * Dipanggil SETELAH units[] dinormalkan, karena PUT menghapus satuan yang tidak dikirim.
 */
function pastikanBaseUnitMilikProduk(baseUnitId, units) {
  if (baseUnitId !== null && !units.some((u) => u.unit_id === baseUnitId)) {
    throw new ApiError(422, 'base_unit_id harus salah satu satuan produk');
  }
}

router.post('/products', ...superadminOnly, async (req, res) => {
  const p = parseProductBody(req.body);
  const units = parseUnits(req.body?.units);
  pastikanBaseUnitMilikProduk(p.base_unit_id, units);

  const created = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO products (name, category_id, base_unit, barcode, is_active, base_unit_id, izin_minus)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [p.name, p.category_id, p.base_unit, p.barcode, p.is_active, p.base_unit_id, p.izin_minus],
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
  // Divalidasi terhadap units[] yang BARU: satuan yang ikut terhapus tidak boleh jadi
  // satuan hitung, dan cek ini dilakukan sebelum satu baris pun diubah.
  pastikanBaseUnitMilikProduk(p.base_unit_id, units);

  await tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE products SET name = $1, category_id = $2, base_unit = $3, barcode = $4,
              is_active = $5, base_unit_id = $6, izin_minus = $7, updated_at = now()
        WHERE id = $8 RETURNING id`,
      [p.name, p.category_id, p.base_unit, p.barcode, p.is_active, p.base_unit_id, p.izin_minus, id],
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

/**
 * PATCH mengganti HANYA pengaturan yang dikirim. PUT di atas mengganti seluruh produk,
 * jadi memakai PUT untuk menyalakan `izin_minus` memaksa klien mengirim ulang nama,
 * kategori, semua satuan, dan harga — satu field yang terlewat akan tereset diam-diam.
 * Endpoint sempit ini menghilangkan bahaya itu.
 */
router.patch('/products/:id/pengaturan', ...superadminOnly, async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'Produk tidak ditemukan');

  const adaIzin = req.body?.izin_minus !== undefined;
  const adaBase = req.body?.base_unit_id !== undefined;
  if (!adaIzin && !adaBase) throw new ApiError(422, 'Tidak ada pengaturan yang diubah');

  let izinMinus = null;
  if (adaIzin) {
    const v = req.body.izin_minus;
    const dikenali = typeof v === 'boolean' || v === 1 || v === 0 || v === '1' || v === '0'
      || v === 'true' || v === 'false';
    if (!dikenali) throw new ApiError(422, 'izin_minus harus boolean');
    izinMinus = toBool(v, false);
  }

  // null = kembali ke otomatis (satuan terbesar). Selain null wajib angka satuan.
  let baseUnitId = null;
  if (adaBase && req.body.base_unit_id !== null) {
    baseUnitId = toInt(req.body.base_unit_id);
    if (baseUnitId === null) throw new ApiError(422, 'base_unit_id tidak valid');
  }

  // Satu query: sekaligus memastikan produknya ada dan satuan yang diminta memang miliknya.
  const { rows: cek } = await q(
    `SELECT EXISTS (SELECT 1 FROM products WHERE id = $1) AS ada,
            EXISTS (SELECT 1 FROM product_units WHERE product_id = $1 AND unit_id = $2) AS punya`,
    [id, baseUnitId],
  );
  if (!cek[0].ada) throw new ApiError(404, 'Produk tidak ditemukan');
  if (baseUnitId !== null && !cek[0].punya) {
    throw new ApiError(422, 'base_unit_id harus salah satu satuan produk');
  }

  // Field yang tidak dikirim dibiarkan apa adanya — bukan ditimpa nilai default.
  await q(
    `UPDATE products SET
       izin_minus = CASE WHEN $1::boolean IS NULL THEN izin_minus ELSE $1 END,
       base_unit_id = CASE WHEN $2::boolean THEN $3::bigint ELSE base_unit_id END,
       updated_at = now()
     WHERE id = $4`,
    [izinMinus, adaBase, baseUnitId, id],
  );

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
