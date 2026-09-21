import { q } from './db.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Angka bulat valid (menerima number maupun string numerik), else null. */
export function toInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
  return null;
}

export function toBool(v, dflt = true) {
  if (v === undefined || v === null || v === '') return dflt;
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === '1' || v === 1) return true;
  if (v === 'false' || v === '0' || v === 0) return false;
  return dflt;
}

export function toStr(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Kolom barcode: string kosong dianggap NULL supaya UNIQUE tidak bentrok. */
export const barcodeOrNull = (v) => toStr(v);

/** Batas limit query, cegah permintaan raksasa. */
export function limitOf(v, dflt = 200, max = 1000) {
  const n = toInt(v);
  if (n === null || n <= 0) return dflt;
  return Math.min(n, max);
}

/** Tanggal YYYY-MM-DD valid, else null. */
export function dateOrNull(v) {
  const s = toStr(v);
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
}

export const todayJakarta = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Awal bulan berjalan menurut Asia/Jakarta. */
export function monthStartJakarta() {
  return `${todayJakarta().slice(0, 7)}-01`;
}

/**
 * Tampilan stok enak dibaca: unit terbesar dulu, sisa di base_unit.
 * 132 pcs dengan dus isi 40 -> "3 dus 12 pcs".
 */
export function displayStock(stokBase, baseUnit, units = []) {
  const abs = Math.abs(stokBase);
  if (abs === 0) return `0 ${baseUnit}`;
  let rem = abs;
  const parts = [];
  for (const u of [...units].sort((a, b) => b.isi - a.isi)) {
    if (u.isi <= 1) continue;
    const n = Math.floor(rem / u.isi);
    if (n > 0) {
      parts.push(`${n} ${u.unit_name}`);
      rem -= n * u.isi;
    }
  }
  if (rem > 0) parts.push(`${rem} ${baseUnit}`);
  return (stokBase < 0 ? '-' : '') + parts.join(' ');
}

/** Satuan (isi + nama) per produk, terbesar dulu. */
export async function unitsByProduct(productIds = null) {
  const { rows } = await q(
    `SELECT pu.product_id, pu.unit_id, pu.isi, u.name AS unit_name
       FROM product_units pu
       JOIN units u ON u.id = pu.unit_id
      ${productIds ? 'WHERE pu.product_id = ANY($1::bigint[])' : ''}
      ORDER BY pu.isi DESC, u.name`,
    productIds ? [productIds] : [],
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.product_id)) map.set(r.product_id, []);
    map.get(r.product_id).push(r);
  }
  return map;
}

/** Stok terkini (base_unit) per produk. */
export async function stockByProduct(productIds = null) {
  const { rows } = await q(
    `SELECT p.id AS product_id, COALESCE(SUM(sm.qty_base), 0) AS stok_base
       FROM products p
       LEFT JOIN stock_movements sm ON sm.product_id = p.id
      ${productIds ? 'WHERE p.id = ANY($1::bigint[])' : ''}
      GROUP BY p.id`,
    productIds ? [productIds] : [],
  );
  const map = new Map();
  for (const r of rows) map.set(r.product_id, Number(r.stok_base));
  return map;
}

/**
 * Daftar stok lengkap. Satu-satunya sumber bentuk baris stok, dipakai bersama oleh
 * GET /stock dan GET /sync/pull supaya keduanya dijamin identik.
 */
export async function stockList() {
  const [stock, units] = await Promise.all([stockByProduct(), unitsByProduct()]);
  const { rows } = await q('SELECT id, name, base_unit FROM products ORDER BY name');

  return rows.map((p) => {
    const stok = stock.get(p.id) ?? 0;
    return {
      product_id: p.id,
      name: p.name,
      base_unit: p.base_unit,
      stok_base: stok,
      display: displayStock(stok, p.base_unit, units.get(p.id) || []),
      minus: stok < 0,
    };
  });
}

/** Produk dalam bentuk GET /products (termasuk array units). */
export async function listProducts({ id = null, q: search = null, barcode = null, categoryId = null } = {}) {
  const { rows } = await q(
    `SELECT p.id, p.name, p.category_id, c.name AS category_name, p.base_unit,
            p.barcode, p.is_active,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'id', pu.id, 'unit_id', pu.unit_id, 'unit_name', u.name,
                        'isi', pu.isi, 'harga_jual', pu.harga_jual,
                        'harga_modal', pu.harga_modal, 'barcode', pu.barcode)
                      ORDER BY pu.isi DESC, u.name)
                 FROM product_units pu JOIN units u ON u.id = pu.unit_id
                WHERE pu.product_id = p.id),
              '[]'::json) AS units
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE ($1::bigint IS NULL OR p.id = $1)
        AND ($2::text IS NULL OR p.name ILIKE '%' || $2 || '%' OR c.name ILIKE '%' || $2 || '%')
        AND ($3::text IS NULL OR p.barcode = $3
             OR EXISTS (SELECT 1 FROM product_units pu2 WHERE pu2.product_id = p.id AND pu2.barcode = $3))
        AND ($4::bigint IS NULL OR p.category_id = $4)
      ORDER BY p.name`,
    [id, search, barcode, categoryId],
  );
  return rows;
}

export async function getProductOr404(id) {
  const rows = await listProducts({ id });
  if (!rows.length) throw new ApiError(404, 'Produk tidak ditemukan');
  return rows[0];
}

/**
 * Catat satu baris buku kas. `c` boleh pool maupun client transaksi — selalu dipanggil
 * di dalam transaksi penjualan/pembelian supaya kas tidak pernah beda dengan transaksinya.
 * Jumlah 0 tidak menghasilkan baris (CHECK jumlah > 0); kembaliannya null.
 */
export async function insertCashFlow(c, {
  tanggal, tipe, kategori, jumlah, keterangan = null, refType = null, refId = null, userId = null,
}) {
  if (!Number.isInteger(jumlah) || jumlah <= 0) return null;
  const { rows } = await c.query(
    `INSERT INTO cash_flows (tanggal, tipe, kategori, jumlah, keterangan, ref_type, ref_id, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [tanggal, tipe, kategori, jumlah, keterangan, refType, refId, userId],
  );
  return rows[0].id;
}

/** Satu sel CSV: dikutip hanya bila perlu, kutip ganda digandakan. */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** CSV dengan BOM UTF-8 supaya Excel membaca huruf beraksen dengan benar. */
export function buildCsv(header, rows) {
  return `\uFEFF${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** Kirim CSV sebagai unduhan berkas. */
export function sendCsv(res, filename, header, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buildCsv(header, rows));
}

/** Terjemahkan error PostgreSQL yang lazim jadi pesan API yang jelas. */
export function pgError(err) {
  if (err instanceof ApiError) return err;
  if (err?.code === '23505') {
    const detail = err.detail || '';
    if (detail.includes('(username)')) return new ApiError(422, 'Username sudah dipakai');
    if (detail.includes('(name)')) return new ApiError(422, 'Nama sudah dipakai');
    if (detail.includes('(barcode)')) return new ApiError(422, 'Barcode sudah dipakai produk/satuan lain');
    if (detail.includes('(uuid)')) return new ApiError(422, 'Transaksi dengan uuid itu sudah ada');
    return new ApiError(422, 'Data sudah ada (duplikat)');
  }
  if (err?.code === '23503') return new ApiError(422, 'Data terkait tidak ditemukan');
  if (err?.code === '23514') return new ApiError(422, 'Nilai tidak memenuhi aturan database');
  if (err?.code === '23502') return new ApiError(422, 'Ada kolom wajib yang kosong');
  return err;
}
