import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

// WAJIB sebelum src/db.js diimpor: tes selalu memakai database tes.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.TZ = 'Asia/Jakarta';

if (!process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL belum diset di .env');

const { createApp } = await import('../src/app.js');
const { q, pool } = await import('../src/db.js');

export { q, pool };

export const UNITS = ['pcs', 'renceng', 'pack', 'dus', 'slop', 'bal', 'karung', 'kg', '1/2 kg', '1/4 kg'];

export async function resetDb() {
  await q(`TRUNCATE users, tokens, categories, units, products, product_units, sales,
                    sale_items, stock_movements, settings, struk_counters_tahun,
                    product_aliases, cash_flows, purchases, purchase_items,
                    debts, returns, stock_opnames, customers, debt_payments, shifts
                    RESTART IDENTITY CASCADE`);
}

export async function seedMaster() {
  for (const name of UNITS) {
    await q('INSERT INTO units (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
  }
  for (const [key, value] of [['toko_nama', 'Toko Hakim'], ['alamat', ''], ['telepon', '']]) {
    await q('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
  }
}

export async function createUser({ name, username, password = 'password', role }) {
  const { rows } = await q(
    'INSERT INTO users (name, username, password, role) VALUES ($1, $2, $3, $4) RETURNING id',
    [name, username, await bcrypt.hash(password, 4), role],
  );
  return rows[0].id;
}

/** Server sungguhan di port 0 + klien fetch. */
export async function startServer() {
  const server = createApp().listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  const req = async (method, p, { token, body, raw, type } = {}) => {
    const headers = {};
    let payload;
    if (raw !== undefined) {
      headers['Content-Type'] = type;
      payload = raw;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + p, { method, headers, body: payload });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed };
  };

  return {
    base,
    req,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function login(req, username, password = 'password') {
  const r = await req('POST', '/api/login', { body: { username, password } });
  if (r.status !== 200) throw new Error(`login ${username} gagal: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}

/**
 * Kategori + produk dasar (base pcs) dengan satuan pcs & dus isi 40.
 * `izin_minus: true` supaya tes lama tetap menguji subjeknya masing-masing (idempotensi,
 * snapshot, no_struk): sebelum aturan izin minus ada, semua penjualan diterima apa pun
 * stoknya. Aturan "tanpa izin ditolak" diuji tersendiri, tidak lewat fixture ini.
 */
export async function productFixture(req, token, { dus = 40 } = {}) {
  const units = (await req('GET', '/api/units', { token })).body;
  const unitId = (name) => units.find((u) => u.name === name).id;

  const cat = await req('POST', '/api/categories', { token, body: { name: 'Sembako' } });
  const prod = await req('POST', '/api/products', {
    token,
    body: {
      name: 'Kopi Sachet',
      category_id: cat.body.id,
      base_unit: 'pcs',
      barcode: '8991234567890',
      izin_minus: true,
      units: [
        { unit_id: unitId('pcs'), isi: 1, harga_jual: 3000, harga_modal: 2000 },
        { unit_id: unitId('dus'), isi: dus, harga_jual: 100000, harga_modal: 80000, barcode: '8991234567891' },
      ],
    },
  });
  if (prod.status !== 201) throw new Error(`buat produk gagal: ${prod.status} ${JSON.stringify(prod.body)}`);

  return {
    product: prod.body,
    unitId,
    productId: prod.body.id,
    pcsId: unitId('pcs'),
    dusId: unitId('dus'),
  };
}

export const stokOf = async (req, token, productId) => {
  const rows = (await req('GET', '/api/stock', { token })).body;
  return rows.find((r) => r.product_id === productId);
};

/**
 * Menandai transaksi sebagai "dibatalkan" langsung di database.
 *
 * Aplikasi TIDAK lagi punya jalan membatalkan transaksi (hanya hapus permanen superadmin),
 * tetapi baris lama berstatus 'dibatalkan' tetap ada di data pemilik dan tetap dibaca
 * laporan, riwayat, dan proses hapus. Helper ini menyiapkan keadaan itu apa adanya —
 * persis efek yang dulu ditulis endpoint pembatalan: status, movement `pembatalan`,
 * dan baris kas keluar penyeimbang.
 */
export async function tandaiDibatalkan(saleId, alasan, oleh = 'superadmin') {
  const { rows } = await q(
    `SELECT s.total, s.no_struk, u.id AS user_id
       FROM sales s JOIN users u ON u.username = $2
      WHERE s.id = $1`,
    [saleId, oleh],
  );
  if (!rows.length) throw new Error(`transaksi ${saleId} atau user ${oleh} tidak ada`);
  const userId = rows[0].user_id;
  await q(`UPDATE sales SET status = 'dibatalkan', alasan_batal = $1, dibatalkan_oleh = $2 WHERE id = $3`, [
    alasan,
    userId,
    saleId,
  ]);
  await q(
    `INSERT INTO stock_movements (product_id, type, qty_base, reference_type, reference_id, note, user_id)
     SELECT product_id, 'pembatalan', isi_snapshot * qty, 'sale', sale_id, $2, $3
       FROM sale_items WHERE sale_id = $1`,
    [saleId, `Batal: ${alasan}`, userId],
  );
  await q(
    `INSERT INTO cash_flows (tanggal, tipe, kategori, jumlah, keterangan, ref_type, ref_id, user_id)
     VALUES ((now() AT TIME ZONE 'Asia/Jakarta')::date, 'keluar', 'pembatalan', $1, $2, 'sale', $3, $4)`,
    [rows[0].total, `Pembatalan ${rows[0].no_struk ?? saleId}`, saleId, userId],
  );
  return rows[0];
}

export const closePool = () => pool.end();
