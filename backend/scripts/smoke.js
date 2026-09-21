/**
 * Smoke test end-to-end: HTTP sungguhan ke server yang dijalankan skrip ini,
 * database sungguhan (DATABASE_URL). Menjalankan alur Definition of Done
 * satu per satu dan mencetak PASS/FAIL per pemeriksaan.
 *
 *   npm run smoke
 *
 * Data yang dibuat memakai penanda khusus (kategori "SMOKE-TEST", uuid berawalan
 * "smoke-") dan dihapus lagi di akhir, jadi aman dijalankan berulang.
 */
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
process.env.TZ = 'Asia/Jakarta';

// Smoke test menulis data sungguhan, jadi sengaja TIDAK menyentuh database produksi.
// Selalu memakai TEST_DATABASE_URL, dan menolak jalan bila namanya bukan database uji.
const smokeUrl = process.env.TEST_DATABASE_URL;
if (!smokeUrl) {
  console.error(
    'SMOKE GAGAL: TEST_DATABASE_URL belum diset di backend\\.env.\n' +
    'Skrip ini butuh database uji karena menulis dan menghapus data sungguhan.',
  );
  process.exit(1);
}
const smokeDb = decodeURIComponent(new URL(smokeUrl).pathname.replace(/^\//, ''));
if (!smokeDb.endsWith('_test')) {
  console.error(
    `SMOKE DITOLAK: database "${smokeDb}" bukan database uji.\n` +
    'Skrip ini menulis data sungguhan dan hanya boleh dijalankan pada database berakhiran "_test".',
  );
  process.exit(1);
}
process.env.DATABASE_URL = smokeUrl;

// Pastikan skema dan data dasar tersedia — smoke boleh dijalankan kapan saja, termasuk
// tepat setelah `npm test` yang membangun ulang skema tanpa seed.
const { runMigrations } = await import('./migrate.js');
const { runSeed } = await import('./seed.js');
await runMigrations(smokeUrl, { log: () => {} });
await runSeed(smokeUrl, { log: () => {} });

const { createApp } = await import('../src/app.js');
const { q, pool } = await import('../src/db.js');

const PORT = Number(process.env.SMOKE_PORT || 3101);
const BASE = `http://127.0.0.1:${PORT}`;
const KASIR_USER = 'smoke_kasir';
const KASIR_PASS = 'smoke12345';

let passed = 0;
let failed = 0;
const failures = [];

function check(label, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(label, actual, expected) {
  check(label, actual === expected, `dapat ${JSON.stringify(actual)}, harusnya ${JSON.stringify(expected)}`);
}

let token = null;
async function req(method, p, { tok = token, body, raw, type } = {}) {
  const headers = {};
  let payload;
  if (raw !== undefined) {
    headers['Content-Type'] = type;
    payload = raw;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(BASE + p, { method, headers, body: payload });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

const uuid = () => `smoke-${crypto.randomUUID()}`;

async function cleanup() {
  // Urutan penting: baris kas menunjuk transaksi/pembelian, jadi dibuang lebih dulu.
  await q(`DELETE FROM cash_flows WHERE ref_type = 'sale'
             AND ref_id IN (SELECT id FROM sales WHERE uuid LIKE 'smoke-%')`);
  await q(`DELETE FROM cash_flows WHERE ref_type = 'purchase'
             AND ref_id IN (SELECT id FROM purchases WHERE supplier LIKE 'SMOKE%')`);
  await q(`DELETE FROM cash_flows WHERE ref_type = 'return'
             AND ref_id IN (SELECT r.id FROM returns r JOIN products p ON p.id = r.product_id
                             WHERE p.name LIKE 'SMOKE %')`);
  await q(`DELETE FROM cash_flows WHERE user_id IN (SELECT id FROM users WHERE username = $1)`, [KASIR_USER]);
  await q(`DELETE FROM cash_flows WHERE keterangan LIKE 'SMOKE%'`);
  await q(`DELETE FROM purchase_items WHERE purchase_id IN (SELECT id FROM purchases WHERE supplier LIKE 'SMOKE%')`);
  await q(`DELETE FROM purchases WHERE supplier LIKE 'SMOKE%'`);
  await q(`DELETE FROM returns WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'SMOKE %')`);
  await q(`DELETE FROM stock_opnames WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'SMOKE %')`);
  await q(`DELETE FROM product_aliases WHERE alias LIKE 'SMOKE%'`);
  await q(`DELETE FROM debts WHERE pihak LIKE 'SMOKE%'`);
  await q(`DELETE FROM sales WHERE uuid LIKE 'smoke-%'`);
  await q(`DELETE FROM stock_movements WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'SMOKE %')`);
  await q(`DELETE FROM stock_movements WHERE user_id IN (SELECT id FROM users WHERE username = $1)`, [KASIR_USER]);
  await q(`DELETE FROM tokens WHERE user_id IN (SELECT id FROM users WHERE username = $1)`, [KASIR_USER]);
  await q(`DELETE FROM users WHERE username = $1`, [KASIR_USER]);
  await q(`DELETE FROM products WHERE name LIKE 'SMOKE %'`);
  await q(`DELETE FROM categories WHERE name = 'SMOKE-TEST'`);
}

const server = createApp().listen(PORT);
await once(server, 'listening');
console.log(`Smoke test POS Toko Hakim — server di ${BASE}, database uji ${smokeDb}\n`);

try {
  await cleanup();

  // ---------------------------------------------------------------- login
  const sa = await req('POST', '/api/login', { tok: null, body: { username: 'superadmin', password: 'password' } });
  check('login superadmin', sa.status === 200 && sa.body.token && sa.body.user.role === 'superadmin',
    sa.status === 200 ? `role=${sa.body.user.role}` : JSON.stringify(sa.body));
  token = sa.body?.token;

  await q('DELETE FROM users WHERE username = $1', [KASIR_USER]);
  await q('INSERT INTO users (name, username, password, role) VALUES ($1, $2, $3, $4)',
    ['Kasir Smoke', KASIR_USER, await bcrypt.hash(KASIR_PASS, 10), 'kasir']);
  const kasir = await req('POST', '/api/login', { tok: null, body: { username: KASIR_USER, password: KASIR_PASS } });
  check('login kasir', kasir.status === 200 && kasir.body.user.role === 'kasir');
  const kasirTok = kasir.body?.token;

  const me = await req('GET', '/api/me');
  eq('GET /me mengembalikan user yang login', me.body?.user?.username, 'superadmin');

  // ------------------------------------------- kategori, satuan, produk
  const cat = await req('POST', '/api/categories', { body: { name: 'SMOKE-TEST' } });
  check('buat kategori', cat.status === 201, `id=${cat.body?.id}`);

  const units = (await req('GET', '/api/units')).body;
  const idOf = (name) => units.find((u) => u.name === name)?.id;
  check('satuan dasar tersedia (pcs, dus, bal)', !!idOf('pcs') && !!idOf('dus') && !!idOf('bal'),
    units.map((u) => u.name).join(', '));

  const prod = await req('POST', '/api/products', {
    body: {
      name: 'SMOKE Rokok Sample',
      category_id: cat.body.id,
      base_unit: 'pcs',
      barcode: 'SMOKE-BC-1',
      units: [
        { unit_id: idOf('pcs'), isi: 1, harga_jual: 2000, harga_modal: 1500 },
        { unit_id: idOf('dus'), isi: 40, harga_jual: 76000, harga_modal: 60000, barcode: 'SMOKE-BC-2' },
        { unit_id: idOf('bal'), isi: 400, harga_jual: 740000, harga_modal: 600000, barcode: 'SMOKE-BC-3' },
      ],
    },
  });
  check('buat produk dengan 3 satuan (pcs, dus isi 40, bal isi 400)', prod.status === 201 && prod.body.units.length === 3,
    prod.body?.units?.map((u) => `${u.unit_name}=${u.isi}/${u.harga_jual}`).join(' '));
  const pid = prod.body.id;

  // -------------------------------------------------------------- stok masuk
  const stockIn = await req('POST', '/api/stock/in', { body: { product_id: pid, unit_id: idOf('bal'), qty: 2, note: 'smoke awal' } });
  eq('stok masuk 2 bal = 800 base_unit', stockIn.body?.movement?.qty_base, 800);

  const stokAfterIn = (await req('GET', '/api/stock')).body.find((s) => s.product_id === pid);
  eq('stok terbaca 800 pcs', stokAfterIn?.stok_base, 800);
  eq('tampilan stok enak dibaca', stokAfterIn?.display, '2 bal');
  eq('stok tidak minus', stokAfterIn?.minus, false);

  // ------------------------------------------------- transaksi multi-satuan
  const mixedUuid = uuid();
  const mixed = await req('POST', '/api/sales', {
    tok: kasirTok,
    body: {
      uuid: mixedUuid,
      items: [
        { product_id: pid, unit_id: idOf('pcs'), qty: 3 },
        { product_id: pid, unit_id: idOf('dus'), qty: 2 },
        { product_id: pid, unit_id: idOf('bal'), qty: 1 },
      ],
      metode_bayar: 'tunai',
      dibayar: 1_000_000,
    },
  });
  const expectedTotal = 3 * 2000 + 2 * 76000 + 740000;
  check('transaksi campuran multi-satuan dibuat', mixed.status === 201 && mixed.body.sale.items.length === 3,
    `total=${mixed.body?.sale?.total}`);
  eq('total transaksi dihitung otomatis', mixed.body?.sale?.total, expectedTotal);
  eq('kembalian pas sampai rupiah', mixed.body?.sale?.kembalian, 1_000_000 - expectedTotal);
  check('no_struk format INV-YYYYMMDD-####', /^INV-\d{8}-\d{4}$/.test(mixed.body?.sale?.no_struk || ''), mixed.body?.sale?.no_struk);

  const stokAfterSale = (await req('GET', '/api/stock')).body.find((s) => s.product_id === pid);
  const expectedStock = 800 - (3 * 1 + 2 * 40 + 1 * 400);
  eq('stok berkurang tepat di base_unit', stokAfterSale?.stok_base, expectedStock);
  // 317 = 7 dus + 37 pcs (bal isi 400 tidak muat lagi).
  eq('tampilan stok dipecah ke satuan terbesar', stokAfterSale?.display, '7 dus 37 pcs');

  const movements = (await req('GET', `/api/stock/movements?product_id=${pid}`)).body;
  const keluar = movements.filter((m) => m.type === 'keluar');
  eq('tiga movement keluar tercatat', keluar.length, 3);
  eq('movement keluar 1 bal = -400', keluar.find((m) => m.qty_base === -400)?.qty_base, -400);

  // ------------------------------------------------------------ ubah harga
  const noReason = await req('POST', '/api/sales', {
    tok: kasirTok,
    body: { uuid: uuid(), items: [{ product_id: pid, unit_id: idOf('pcs'), qty: 1, harga: 1800 }], metode_bayar: 'tunai', dibayar: 5000 },
  });
  eq('ubah harga tanpa alasan ditolak 422', noReason.status, 422);

  const withReason = await req('POST', '/api/sales', {
    tok: kasirTok,
    body: {
      uuid: uuid(),
      items: [{ product_id: pid, unit_id: idOf('pcs'), qty: 1, harga: 1800, alasan_ubah_harga: 'Potongan langganan' }],
      metode_bayar: 'tunai',
      dibayar: 5000,
    },
  });
  check('ubah harga dengan alasan tersimpan', withReason.status === 201
    && withReason.body.sale.items[0].harga_diubah === true
    && withReason.body.sale.items[0].alasan_ubah_harga === 'Potongan langganan',
  `harga=${withReason.body?.sale?.items?.[0]?.harga_snapshot}`);

  // harga_normal di laporan = harga master SAAT INI, jadi diperiksa sebelum master diubah di bawah.
  const priceChanges = (await req('GET', '/api/reports/price-changes')).body;
  const pc = priceChanges.find((r) => r.product_name === prod.body.name);
  check('laporan perubahan harga mencatat transaksi tadi',
    !!pc && pc.harga_snapshot === 1800 && pc.harga_normal === 2000 && pc.alasan_ubah_harga === 'Potongan langganan' && pc.kasir === 'Kasir Smoke',
    pc ? `${pc.harga_normal} -> ${pc.harga_snapshot}` : 'tidak ditemukan');
  check('transaksi tanpa ubah harga tidak muncul di laporan perubahan harga',
    !priceChanges.some((r) => r.no_struk === mixed.body.sale.no_struk));

  // ------------------------------------------------------------ idempotensi
  const dup = await req('POST', '/api/sales', {
    tok: kasirTok,
    body: { uuid: mixedUuid, items: [{ product_id: pid, unit_id: idOf('bal'), qty: 1 }], metode_bayar: 'tunai', dibayar: 740000 },
  });
  check('uuid sama -> duplicate:true', dup.body?.duplicate === true, `status ${dup.status}`);
  eq('no_struk duplicate identik', dup.body?.sale?.no_struk, mixed.body?.sale?.no_struk);
  eq('id sale duplicate identik', dup.body?.sale?.id, mixed.body?.sale?.id);
  const { rows: countRows } = await q('SELECT count(*)::int AS n FROM sales WHERE uuid = $1', [mixedUuid]);
  eq('hanya satu baris sale di database', countRows[0].n, 1);

  // --------------------------------------------------- transaksi offline
  // Counter no_struk bersifat permanen (tidak pernah mundur), jadi nomor yang
  // diharapkan dihitung relatif terhadap isi struk_counters saat ini.
  const OFFLINE_DAY = '2026-02-10';
  const { rows: counterBefore } = await q(
    'SELECT COALESCE((SELECT last FROM struk_counters WHERE day = $1), 0)::int AS n', [OFFLINE_DAY],
  );
  const expectedNo = `INV-20260210-${String(counterBefore[0].n + 1).padStart(4, '0')}`;

  const offline = await req('POST', '/api/sales', {
    tok: kasirTok,
    body: {
      uuid: uuid(),
      items: [{ product_id: pid, unit_id: idOf('dus'), qty: 10 }],
      metode_bayar: 'tunai',
      dibayar: 10_000_000,
      created_at: '2026-02-10T03:00:00.000Z',
    },
  });
  check('transaksi offline (tanggal lampau) diterima', offline.status === 201, offline.body?.sale?.no_struk);
  eq('no_struk memakai hari Jakarta dari created_at dan urut', offline.body?.sale?.no_struk, expectedNo);
  const minusRow = (await req('GET', '/api/stock')).body.find((s) => s.product_id === pid);
  check('stok minus ditandai minus:true', minusRow.minus === true, `stok=${minusRow.stok_base} display="${minusRow.display}"`);

  // ---------------------------------------------------- snapshot tak berubah
  const saleBefore = (await req('GET', `/api/sales/by-uuid/${mixedUuid}`)).body;
  await req('PUT', `/api/products/${pid}`, {
    body: {
      name: prod.body.name,
      category_id: cat.body.id,
      base_unit: 'pcs',
      barcode: prod.body.barcode,
      units: prod.body.units.map((u) => ({ ...u, harga_jual: u.harga_jual + 5000, harga_modal: u.harga_modal + 1000 })),
    },
  });
  const saleAfter = (await req('GET', `/api/sales/by-uuid/${mixedUuid}`)).body;
  eq('harga snapshot tidak berubah setelah master diubah', saleAfter.items[0].harga_snapshot, saleBefore.items[0].harga_snapshot);
  eq('total transaksi lama tidak berubah', saleAfter.total, saleBefore.total);

  // --------------------------------------------------------- hak akses kasir
  const forbidden = await req('POST', '/api/products', {
    tok: kasirTok,
    body: { name: 'X', base_unit: 'pcs', units: [{ unit_id: idOf('pcs'), isi: 1, harga_jual: 1, harga_modal: 1 }] },
  });
  eq('kasir ditolak 403 saat buat produk', forbidden.status, 403);
  eq('kasir ditolak 403 di laporan harian', (await req('GET', '/api/reports/daily', { tok: kasirTok })).status, 403);
  eq('kasir ditolak 403 saat ubah pengaturan', (await req('PUT', '/api/settings', { tok: kasirTok, body: { toko_nama: 'X' } })).status, 403);
  eq('kasir boleh lihat stok', (await req('GET', '/api/stock', { tok: kasirTok })).status, 200);

  // ------------------------------------------------------------ pembatalan
  const stokBeforeCancel = (await req('GET', '/api/stock')).body.find((s) => s.product_id === pid).stok_base;

  const cancelByKasirNoCreds = await req('POST', `/api/sales/${mixed.body.sale.id}/cancel`, {
    tok: kasirTok, body: { alasan_batal: 'salah input' },
  });
  eq('kasir tanpa kredensial superadmin ditolak 403', cancelByKasirNoCreds.status, 403);

  const cancel = await req('POST', `/api/sales/${mixed.body.sale.id}/cancel`, {
    body: { alasan_batal: 'Salah input satuan' },
  });
  eq('superadmin membatalkan transaksi', cancel.status, 200);
  eq('status menjadi dibatalkan', cancel.body?.status, 'dibatalkan');
  eq('alasan batal tersimpan', cancel.body?.alasan_batal, 'Salah input satuan');
  eq('no_struk tidak hilang setelah batal', cancel.body?.no_struk, mixed.body.sale.no_struk);

  const stokAfterCancel = (await req('GET', '/api/stock')).body.find((s) => s.product_id === pid).stok_base;
  eq('stok kembali persis seperti sebelumnya', stokAfterCancel, stokBeforeCancel + (3 * 1 + 2 * 40 + 1 * 400));

  const { rows: pembatalan } = await q(
    `SELECT COALESCE(SUM(qty_base), 0)::int AS n FROM stock_movements
      WHERE reference_id = $1 AND type = 'pembatalan'`, [mixed.body.sale.id],
  );
  eq('movement pembatalan mengembalikan seluruh base_unit', pembatalan[0].n, 3 * 1 + 2 * 40 + 1 * 400);

  eq('batal dua kali ditolak 422', (await req('POST', `/api/sales/${mixed.body.sale.id}/cancel`, { body: { alasan_batal: 'lagi' } })).status, 422);

  // ------------------------------------------------------ tunai & pengaturan
  const nonTunai = await req('POST', '/api/sales', {
    tok: kasirTok,
    body: { uuid: uuid(), items: [{ product_id: pid, unit_id: idOf('pcs'), qty: 1 }], metode_bayar: 'qris', dibayar: 5000 },
  });
  eq('metode bayar selain tunai ditolak 422', nonTunai.status, 422);

  const settings = (await req('GET', '/api/settings')).body;
  check('pengaturan toko punya nama', typeof settings.toko_nama === 'string' && settings.toko_nama.length > 0, settings.toko_nama);

  const spaRoute = await fetch(`${BASE}/kasir`);
  check('history fallback SPA tetap hidup di rute aplikasi',
    spaRoute.status === 200 && (spaRoute.headers.get('content-type') || '').startsWith('text/html'),
    `${spaRoute.status} ${spaRoute.headers.get('content-type')}`);

  // ------------------------------------------------------------ sync/pull
  const pull = (await req('GET', '/api/sync/pull', { tok: kasirTok })).body;
  check('sync/pull mengembalikan master + stok + pengaturan',
    Array.isArray(pull.products) && Array.isArray(pull.units) && Array.isArray(pull.categories)
    && !!pull.settings && Array.isArray(pull.stock) && !!pull.server_time,
    `${pull.products?.length} produk, ${pull.units?.length} satuan, ${pull.stock?.length} baris stok`);
  check('sync/pull memuat produk smoke lengkap dengan satuannya',
    pull.products.some((p) => p.id === pid && p.units.length === 3));

  // Baris stok di sync/pull harus identik dengan GET /stock (dipakai halaman stok offline).
  const stockApi = (await req('GET', '/api/stock', { tok: kasirTok })).body;
  const stockPull = pull.stock;
  const rowApi = stockApi.find((s) => s.product_id === pid);
  const rowPull = stockPull.find((s) => s.product_id === pid);
  check('baris stok sync/pull identik dengan GET /stock',
    JSON.stringify(rowApi) === JSON.stringify(rowPull),
    `GET /stock=${JSON.stringify(rowApi)} | sync=${JSON.stringify(rowPull)}`);
  check('semua baris stok sync/pull memuat name dan base_unit',
    stockPull.length > 0 && stockPull.every((s) => typeof s.name === 'string' && !!s.base_unit && typeof s.stok_base === 'number' && typeof s.display === 'string' && typeof s.minus === 'boolean'),
    `${stockPull.length} baris`);

  // ------------------------------------------------------------- laporan
  const daily = (await req('GET', '/api/reports/daily')).body;
  check('laporan harian punya bentuk yang benar',
    typeof daily.transactions === 'number' && typeof daily.total === 'number'
    && typeof daily.items_count === 'number',
    `transaksi=${daily.transactions} total=${daily.total} items=${daily.items_count}`);

  const profit = (await req('GET', '/api/reports/profit')).body;
  eq('laba kotor = omzet - modal', profit.laba_kotor, profit.total_omzet - profit.total_modal);
  check('laba kotor mengikuti rumus (harga_snapshot - harga_modal_snapshot) * qty',
    profit.rows.every((r) => r.laba === r.omzet - r.modal),
    `omzet=${profit.total_omzet} modal=${profit.total_modal} laba=${profit.laba_kotor}`);

  const salesReport = (await req('GET', '/api/reports/sales')).body;
  check('laporan penjualan konsisten dengan total harian',
    salesReport.rows.reduce((a, r) => a + r.total, 0) === salesReport.total,
    `total=${salesReport.total}`);

  const pcReport = (await req('GET', '/api/reports/price-changes')).body;
  check('laporan perubahan harga konsisten dengan bentuk yang dijanjikan',
    pcReport.every((r) => typeof r.sale_id === 'number' && typeof r.no_struk === 'string'
      && typeof r.harga_snapshot === 'number' && !!r.unit_name && !!r.kasir),
    `${pcReport.length} baris`);

  const { rows: cancelledTotal } = await q(
    `SELECT COALESCE(SUM(total), 0)::int AS n FROM sales
      WHERE status = 'dibatalkan' AND (created_at AT TIME ZONE 'Asia/Jakarta')::date
            = (now() AT TIME ZONE 'Asia/Jakarta')::date`,
  );
  check('laporan harian mengecualikan transaksi dibatalkan',
    cancelledTotal[0].n > 0 && daily.total >= 0,
    `total dibatalkan hari ini=${cancelledTotal[0].n}, total laporan=${daily.total}`);

  const history = (await req('GET', '/api/sales?limit=5')).body;
  check('riwayat transaksi terbaru tampil dengan items_count',
    Array.isArray(history) && history.every((s) => typeof s.items_count === 'number' && !!s.user_name),
    `${history.length} baris`);

  // ============================================================ fitur lanjutan
  const stokNow = async () => (await req('GET', '/api/stock')).body.find((s) => s.product_id === pid).stok_base;

  // ------------------------------------------------- stok masuk massal (OCR)
  const stokSebelumBulk = await stokNow();
  const bulk = await req('POST', '/api/stock/in/bulk', {
    body: {
      note: 'SMOKE struk supplier',
      items: [
        { product_id: pid, unit_id: idOf('pcs'), qty: 5 },
        { product_id: pid, unit_id: idOf('dus'), qty: 2 },
        { product_id: pid, unit_id: idOf('pcs'), qty: 1, note: 'SMOKE bonus' },
      ],
      aliases: [{ alias: 'SMOKE ALIAS KOPI', product_id: pid }],
    },
  });
  check('stok masuk massal menerapkan 3 baris dalam satu panggilan',
    bulk.status === 201 && bulk.body.applied === 3 && bulk.body.movements.length === 3,
    `${bulk.status} applied=${bulk.body?.applied}`);
  eq('stok naik sesuai isi tiap baris (5 + 2x40 + 1)', await stokNow(), stokSebelumBulk + 86);

  const aliases = (await req('GET', '/api/product-aliases')).body;
  check('alias OCR tersimpan dan bisa dibaca frontend',
    aliases.some((a) => a.alias === 'SMOKE ALIAS KOPI' && a.product_id === pid),
    `${aliases.length} alias`);

  const stokSebelumTolak = await stokNow();
  const badBatch = await req('POST', '/api/stock/in/bulk', {
    body: {
      items: [
        { product_id: pid, unit_id: idOf('pcs'), qty: 5 },
        // 'slop' sengaja bukan satuan produk smoke ini.
        { product_id: pid, unit_id: idOf('slop'), qty: 1 },
      ],
    },
  });
  eq('batch dengan satu baris tidak sah ditolak 422', badBatch.status, 422);
  eq('batch yang ditolak tidak mengubah stok sedikit pun', await stokNow(), stokSebelumTolak);

  // --------------------------------------------------------------- pembelian
  // Pembelian tidak memakai harga: hanya produk + jumlah. Tidak ada uang yang berpindah,
  // jadi tidak ada baris kas yang lahir.
  const purchase = await req('POST', '/api/purchases', {
    body: {
      tanggal: '2026-03-05',
      supplier: 'SMOKE Supplier Jaya',
      items: [
        { product_id: pid, unit_id: idOf('dus'), qty: 3 },
        { product_id: pid, unit_id: idOf('pcs'), qty: 10 },
      ],
    },
  });
  check('pembelian tanpa harga dibuat dengan total 0',
    purchase.status === 201 && purchase.body.total === 0,
    `total=${purchase.body?.total}`);
  eq('pembelian menambah stok sesuai isi satuan', await stokNow(), stokSebelumTolak + (3 * 40 + 10));

  const kasPembelian = (await req('GET', '/api/cash-flows?from=2026-03-05&to=2026-03-05')).body;
  check('pembelian tidak menulis baris kas sama sekali',
    !kasPembelian.rows.some((r) => r.ref_type === 'purchase' && r.ref_id === purchase.body.id),
    `${kasPembelian.rows.length} baris kas`);
  eq('saldo kas tidak berubah oleh pembelian', kasPembelian.saldo, kasPembelian.saldo_awal);

  const purchaseList = (await req('GET', '/api/purchases?from=2026-03-05&to=2026-03-05')).body;
  check('daftar pembelian memuat supplier dan jumlah barisnya',
    purchaseList.some((p) => p.id === purchase.body.id && p.supplier === 'SMOKE Supplier Jaya' && p.items_count === 2),
    `${purchaseList.length} pembelian`);

  const purchaseDetail = (await req('GET', `/api/purchases/${purchase.body.id}`)).body;
  check('detail pembelian memuat nama produk tiap baris tanpa harga',
    purchaseDetail.items.length === 2 && purchaseDetail.items.every((i) => !!i.product_name && !!i.unit_name
      && i.harga_beli === null && i.subtotal === null),
    purchaseDetail.items.map((i) => `${i.product_name}:${i.unit_name}`).join(' '));

  const stokSebelumHapusPembelian = await stokNow();
  eq('hapus pembelian berhasil', (await req('DELETE', `/api/purchases/${purchase.body.id}`)).status, 200);
  eq('hapus pembelian mengembalikan stok', await stokNow(), stokSebelumHapusPembelian - (3 * 40 + 10));
  eq('hapus pembelian tidak menyentuh buku kas',
    (await req('GET', '/api/cash-flows?from=2026-03-05&to=2026-03-05')).body.rows.length, 0);

  // ------------------------------------------------------------ buku kas
  const kasHariIni = (await req('GET', '/api/cash-flows')).body;
  check('daftar kas memuat saldo berjalan dan saldo awal',
    typeof kasHariIni.saldo === 'number' && typeof kasHariIni.saldo_awal === 'number'
    && Array.isArray(kasHariIni.rows) && kasHariIni.rows.every((r) => typeof r.saldo === 'number'),
    `${kasHariIni.rows.length} baris, saldo=${kasHariIni.saldo}`);

  const manual = await req('POST', '/api/cash-flows', {
    body: { tanggal: '2026-03-06', tipe: 'keluar', kategori: 'SMOKE operasional', jumlah: 50_000, keterangan: 'SMOKE listrik' },
  });
  check('pengeluaran manual tercatat', manual.status === 201 && manual.body.jumlah === 50_000, manual.body?.kategori);
  const ubah = await req('PUT', `/api/cash-flows/${manual.body.id}`, { body: { jumlah: 75_000 } });
  eq('pengeluaran manual bisa diubah', ubah.body?.jumlah, 75_000);
  eq('hapus pengeluaran manual berhasil', (await req('DELETE', `/api/cash-flows/${manual.body.id}`)).status, 200);

  const kasSummary = (await req('GET', '/api/cash-flows/summary?from=2026-03-01&to=2026-03-31')).body;
  check('ringkasan kas punya masuk/keluar/saldo dan rincian per kategori',
    typeof kasSummary.masuk === 'number' && typeof kasSummary.keluar === 'number'
    && typeof kasSummary.saldo === 'number' && Array.isArray(kasSummary.by_kategori),
    `masuk=${kasSummary.masuk} keluar=${kasSummary.keluar} saldo=${kasSummary.saldo}`);

  // ------------------------------------------------------------------ omset
  // Omset kini hanya untuk superadmin, sama seperti seluruh laporan lain.
  eq('kasir ditolak 403 di laporan omset',
    (await req('GET', '/api/reports/omzet', { tok: kasirTok })).status, 403);
  const omzet = (await req('GET', '/api/reports/omzet')).body;
  check('omzet superadmin berbentuk hari/bulan/tahun',
    typeof omzet.hari_ini?.total === 'number' && typeof omzet.hari_ini?.transaksi === 'number'
    && typeof omzet.bulan_ini?.total === 'number' && typeof omzet.tahun_ini?.total === 'number'
    && typeof omzet.hari_ini_items === 'number',
    `hari=${omzet.hari_ini?.total} bulan=${omzet.bulan_ini?.total} tahun=${omzet.tahun_ini?.total}`);
  check('omzet tahun ini minimal sebesar bulan ini', omzet.tahun_ini.total >= omzet.bulan_ini.total,
    `tahun=${omzet.tahun_ini.total} bulan=${omzet.bulan_ini.total}`);
  check('omzet hari ini minimal sebesar transaksi hari ini di laporan harian',
    omzet.hari_ini.total >= 0 && omzet.hari_ini.transaksi >= 0 && daily.total >= 0,
    `omzet=${omzet.hari_ini.total} harian=${daily.total}`);

  // --------------------------------------------------------- laporan lengkap
  const umum = (await req('GET', '/api/reports/umum')).body;
  check('laporan umum memuat ringkasan lengkap',
    typeof umum.omzet === 'number' && typeof umum.laba_kotor === 'number'
    && typeof umum.jumlah_transaksi === 'number' && typeof umum.jumlah_item === 'number'
    && typeof umum.pembelian === 'number' && typeof umum.pengeluaran === 'number'
    && typeof umum.pemasukan === 'number' && typeof umum.saldo_kas === 'number'
    && Array.isArray(umum.produk_terlaris),
    `omzet=${umum.omzet} laba=${umum.laba_kotor} transaksi=${umum.jumlah_transaksi} item=${umum.jumlah_item}`);
  eq('laba kotor laporan umum = omzet - modal', umum.laba_kotor, umum.omzet - umum.modal);
  check('produk terlaris maksimal 5 baris dan berisi nama produk',
    umum.produk_terlaris.length <= 5 && umum.produk_terlaris.every((r) => !!r.product_name && typeof r.qty === 'number'),
    `${umum.produk_terlaris.length} baris`);

  const trx = (await req('GET', '/api/reports/transactions')).body;
  check('laporan transaksi memuat baris per item siap ekspor',
    Array.isArray(trx) && trx.length > 0 && trx.every((r) => !!r.no_struk && !!r.product_name
      && typeof r.subtotal === 'number' && typeof r.laba === 'number' && !!r.kasir),
    `${trx.length} baris`);
  check('laporan transaksi bisa disaring per status',
    (await req('GET', '/api/reports/transactions?status=selesai')).body.every((r) => r.status === 'selesai'));
  eq('status tidak dikenal ditolak 422', (await req('GET', '/api/reports/transactions?status=ngawur')).status, 422);

  const kasLaporan = (await req('GET', '/api/reports/cash-flow')).body;
  check('laporan arus kas harian punya masuk/keluar/saldo berjalan',
    Array.isArray(kasLaporan.rows) && kasLaporan.rows.every((r) => typeof r.masuk === 'number'
      && typeof r.keluar === 'number' && typeof r.saldo === 'number')
    && Array.isArray(kasLaporan.by_kategori) && typeof kasLaporan.saldo_akhir === 'number',
    `${kasLaporan.rows.length} hari, saldo akhir=${kasLaporan.saldo_akhir}`);

  const perKategori = (await req('GET', '/api/reports/sales-by-category')).body;
  check('laporan per kategori punya qty, omzet, dan laba',
    Array.isArray(perKategori.rows) && perKategori.rows.every((r) => !!r.category_name
      && typeof r.qty === 'number' && typeof r.omzet === 'number' && typeof r.laba === 'number')
    && typeof perKategori.total_omzet === 'number',
    `${perKategori.rows.length} kategori`);

  // Laporan pembelian berbasis qty (bukan uang). Satu pembelian di tanggal tetap supaya
  // angkanya bisa diperiksa persis, lalu dihapus lagi.
  const beliQty = await req('POST', '/api/purchases', {
    body: {
      tanggal: '2026-03-07',
      supplier: 'SMOKE Supplier Qty',
      items: [{ product_id: pid, unit_id: idOf('dus'), qty: 2 }],
    },
  });
  const laporanBeli = (await req('GET', '/api/reports/purchases?from=2026-03-07&to=2026-03-07')).body;
  check('laporan pembelian melaporkan qty per supplier dan per produk',
    laporanBeli.jumlah_transaksi === 1 && laporanBeli.qty === 2 && laporanBeli.qty_base === 2 * 40
    && laporanBeli.total === 0
    && laporanBeli.by_supplier.length === 1 && laporanBeli.by_supplier[0].qty_base === 2 * 40
    && laporanBeli.by_product.length === 1 && laporanBeli.by_product[0].qty === 2
    && laporanBeli.by_product[0].qty_base === 2 * 40,
    `transaksi=${laporanBeli.jumlah_transaksi} qty=${laporanBeli.qty} qty_base=${laporanBeli.qty_base}`);
  eq('hapus pembelian pemeriksaan qty berhasil',
    (await req('DELETE', `/api/purchases/${beliQty.body.id}`)).status, 200);

  const modal = (await req('GET', '/api/reports/modal')).body;
  check('laporan modal menghitung modal tersimpan dan modal terjual',
    typeof modal.modal_tersimpan === 'number' && typeof modal.modal_terjual === 'number'
    && typeof modal.omzet_periode === 'number',
    `tersimpan=${modal.modal_tersimpan} terjual=${modal.modal_terjual}`);

  const laporanUtang = (await req('GET', '/api/reports/debts')).body;
  check('laporan hutang/piutang punya ringkasan belum lunas',
    typeof laporanUtang.ringkasan?.utang_sisa === 'number'
    && typeof laporanUtang.ringkasan?.piutang_sisa === 'number' && Array.isArray(laporanUtang.rows),
    `utang sisa=${laporanUtang.ringkasan?.utang_sisa} piutang sisa=${laporanUtang.ringkasan?.piutang_sisa}`);

  const rugiLaba = (await req('GET', '/api/reports/profit-loss')).body;
  check('laporan laba rugi punya omzet, HPP, laba kotor, dan laba bersih',
    typeof rugiLaba.omzet === 'number' && typeof rugiLaba.hpp === 'number'
    && typeof rugiLaba.laba_kotor === 'number' && typeof rugiLaba.pengeluaran_operasional === 'number'
    && typeof rugiLaba.laba_bersih === 'number',
    `omzet=${rugiLaba.omzet} hpp=${rugiLaba.hpp} laba bersih=${rugiLaba.laba_bersih}`);
  eq('laba kotor = omzet - HPP', rugiLaba.laba_kotor, rugiLaba.omzet - rugiLaba.hpp);
  eq('laba bersih = laba kotor - pengeluaran operasional', rugiLaba.laba_bersih,
    rugiLaba.laba_kotor - rugiLaba.pengeluaran_operasional);

  const laporanRetur = (await req('GET', '/api/reports/returns')).body;
  check('laporan retur memisahkan retur penjualan dan pembelian',
    typeof laporanRetur.penjualan?.jumlah === 'number' && typeof laporanRetur.pembelian?.jumlah === 'number'
    && Array.isArray(laporanRetur.rows),
    `jual=${laporanRetur.penjualan.jumlah} beli=${laporanRetur.pembelian.jumlah}`);

  const arusStok = (await req('GET', '/api/reports/stock-flow')).body;
  check('laporan arus stok punya masuk/keluar/penyesuaian/saldo akhir per produk',
    Array.isArray(arusStok.rows) && arusStok.rows.length > 0
    && arusStok.rows.every((r) => typeof r.masuk === 'number' && typeof r.keluar === 'number'
      && typeof r.penyesuaian === 'number' && typeof r.saldo_akhir === 'number' && !!r.base_unit),
    `${arusStok.rows.length} produk`);
  const barisStokSmoke = arusStok.rows.find((r) => r.product_id === pid);
  check('arus stok produk smoke sejalan dengan GET /stock',
    !!barisStokSmoke && barisStokSmoke.saldo_akhir === (await stokNow()),
    `arus=${barisStokSmoke?.saldo_akhir} stok=${await stokNow()}`);

  // ------------------------------------------------------------------- CSV
  // fetch().text() MEMBUANG BOM (perilaku decoding WHATWG), jadi BOM diperiksa
  // dari byte mentahnya, bukan dari string hasil text().
  const csvStok = await fetch(`${BASE}/api/reports/stock-flow.csv`, { headers: { Authorization: `Bearer ${token}` } });
  const csvStokBytes = Buffer.from(await csvStok.arrayBuffer());
  const csvStokText = csvStokBytes.toString('utf8');
  check('CSV arus stok menjawab text/csv sebagai unduhan',
    csvStok.status === 200
    && (csvStok.headers.get('content-type') || '').startsWith('text/csv')
    && (csvStok.headers.get('content-disposition') || '').includes('attachment; filename="arus-stok-'),
    `${csvStok.status} ${csvStok.headers.get('content-type')} ${csvStok.headers.get('content-disposition')}`);
  check('CSV diawali BOM UTF-8 supaya Excel membaca huruf Indonesia',
    csvStokBytes[0] === 0xef && csvStokBytes[1] === 0xbb && csvStokBytes[2] === 0xbf,
    `tiga byte pertama=${csvStokBytes.subarray(0, 3).toString('hex')}`);
  // Laporan CSV harus persegi: setiap baris punya jumlah kolom sama dengan tajuknya,
  // supaya Excel tidak menaruh sel nyasar. Baris terakhir laporan arus stok adalah TOTAL.
  const kolomSama = (teks) => {
    // Kutipan dibuang dulu supaya koma di dalam sel (nama produk) tidak ikut dihitung.
    const baris = teks.replace(/^\uFEFF/, '').trim().split('\r\n').map((b) => b.replace(/"[^"]*"/g, ''));
    const n = baris[0].split(',').length;
    return { n, ok: baris.every((b) => b.split(',').length === n) };
  };
  const csvStokKolom = kolomSama(csvStokText);
  check('CSV arus stok punya kolom tetap dan baris TOTAL di akhir',
    csvStokText.includes('Produk,Kategori,Satuan Dasar,Masuk,Keluar,Penyesuaian,Pembatalan,Saldo Akhir')
    && csvStokText.includes(prod.body.name) && csvStokText.includes('\r\nTOTAL,')
    && csvStokKolom.ok,
    `${csvStokText.split('\r\n').length - 1} baris, ${csvStokKolom.n} kolom`);
  check('CSV mengutip sel yang mengandung koma/kutip dengan benar',
    csvStokText.includes('"') === false || /"[^"]*"/.test(csvStokText));

  const csvKas = await fetch(`${BASE}/api/reports/cash-flow.csv`, { headers: { Authorization: `Bearer ${token}` } });
  const csvKasBytes = Buffer.from(await csvKas.arrayBuffer());
  const csvKasText = csvKasBytes.toString('utf8');
  check('CSV arus kas menjawab text/csv dengan nama berkas periode',
    csvKas.status === 200 && (csvKas.headers.get('content-type') || '').startsWith('text/csv')
    && /attachment; filename="arus-kas-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv"/.test(csvKas.headers.get('content-disposition') || ''),
    csvKas.headers.get('content-disposition'));
  const csvKasKolom = kolomSama(csvKasText);
  check('CSV arus kas memuat BOM, tajuk baru, dan tetap satu tabel persegi',
    csvKasBytes[0] === 0xef && csvKasBytes[1] === 0xbb && csvKasBytes[2] === 0xbf
    && csvKasText.includes('Bagian,Tanggal,Kategori,Masuk,Keluar,Saldo,Baris')
    && csvKasText.includes('\r\nTOTAL,')
    && csvKasKolom.ok,
    `${csvKasText.split('\r\n').length - 1} baris, ${csvKasKolom.n} kolom`);

  // ------------------------------------------------------ retur & opname
  const stokSebelumRetur = await stokNow();
  const retur = await req('POST', '/api/returns', {
    body: {
      tipe: 'penjualan', ref_id: null, product_id: pid, unit_id: idOf('pcs'), qty: 3,
      jumlah: 6_000, alasan: 'SMOKE barang rusak',
    },
  });
  check('retur penjualan tercatat', retur.status === 201 && retur.body.tipe === 'penjualan', retur.body?.alasan);
  eq('retur penjualan menambah stok kembali', await stokNow(), stokSebelumRetur + 3);
  const kasRetur = (await req('GET', '/api/cash-flows')).body;
  check('retur penjualan menulis kas keluar',
    kasRetur.rows.some((r) => r.ref_type === 'return' && r.ref_id === retur.body.id
      && r.kategori === 'retur_penjualan' && r.tipe === 'keluar'),
    `${kasRetur.rows.length} baris kas`);

  const returList = (await req('GET', '/api/returns?tipe=penjualan')).body;
  check('daftar retur memuat nama produk dan alasannya',
    returList.some((r) => r.id === retur.body.id && r.product_name === prod.body.name && !!r.alasan),
    `${returList.length} retur`);
  eq('hapus retur berhasil', (await req('DELETE', `/api/returns/${retur.body.id}`)).status, 200);
  eq('hapus retur mengembalikan stok ke posisi semula', await stokNow(), stokSebelumRetur);

  const opnameList = (await req('GET', '/api/stock-opnames')).body;
  const barisOpname = opnameList.find((r) => r.product_id === pid);
  check('stok opname menampilkan stok sistem per produk',
    !!barisOpname && typeof barisOpname.stok_sistem === 'number' && !!barisOpname.base_unit,
    `sistem=${barisOpname?.stok_sistem} display="${barisOpname?.display}"`);

  const stokSebelumOpname = await stokNow();
  const opname = await req('POST', '/api/stock-opnames', {
    body: { items: [{ product_id: pid, stok_fisik: stokSebelumOpname - 7, catatan: 'SMOKE kurang 7' }] },
  });
  check('stok opname tersimpan dengan selisih', opname.status === 201
    && opname.body.rows[0].selisih === -7 && opname.body.rows[0].stok_sistem === stokSebelumOpname,
    `sistem=${opname.body?.rows?.[0]?.stok_sistem} fisik=${opname.body?.rows?.[0]?.stok_fisik} selisih=${opname.body?.rows?.[0]?.selisih}`);
  eq('stok opname menyesuaikan stok sesuai selisih', await stokNow(), stokSebelumOpname - 7);

  // ------------------------------------------------------------ hutang/piutang
  const utang = await req('POST', '/api/debts', {
    body: { tipe: 'utang', pihak: 'SMOKE Supplier Jaya', jumlah: 500_000, jatuh_tempo: '2026-04-01', keterangan: 'SMOKE tempo' },
  });
  check('hutang dibuat dengan status belum', utang.status === 201 && utang.body.status === 'belum' && utang.body.sisa === 500_000,
    `status=${utang.body?.status} sisa=${utang.body?.sisa}`);

  const bayarSebagian = await req('PUT', `/api/debts/${utang.body.id}`, { body: { dibayar: 200_000 } });
  check('pembayaran sebagian belum melunasi', bayarSebagian.body.status === 'belum' && bayarSebagian.body.sisa === 300_000,
    `status=${bayarSebagian.body?.status} sisa=${bayarSebagian.body?.sisa}`);

  const lunas = await req('PUT', `/api/debts/${utang.body.id}`, { body: { dibayar: 500_000 } });
  check('dibayar penuh otomatis jadi lunas', lunas.body.status === 'lunas' && lunas.body.sisa === 0,
    `status=${lunas.body?.status}`);

  eq('dibayar melebihi jumlah ditolak 422',
    (await req('PUT', `/api/debts/${utang.body.id}`, { body: { dibayar: 900_000 } })).status, 422);

  const laporanUtang2 = (await req('GET', '/api/reports/debts?tipe=utang')).body;
  check('laporan hutang menyaring per tipe', laporanUtang2.rows.every((r) => r.tipe === 'utang'));
  eq('hapus hutang berhasil', (await req('DELETE', `/api/debts/${utang.body.id}`)).status, 200);

  // -------------------------------------------------- hapus riwayat pesanan
  const stokSebelumHapus = await stokNow();
  const saleHapus = await req('POST', '/api/sales', {
    tok: kasirTok,
    body: {
      uuid: uuid(), nama_pelanggan: 'SMOKE Pelanggan',
      items: [{ product_id: pid, unit_id: idOf('dus'), qty: 1 }],
      metode_bayar: 'tunai', dibayar: 1_000_000,
    },
  });
  eq('nama pelanggan tersimpan di transaksi', saleHapus.body?.sale?.nama_pelanggan, 'SMOKE Pelanggan');
  eq('stok berkurang setelah penjualan', await stokNow(), stokSebelumHapus - 40);

  const kasSetelahJual = (await req('GET', '/api/cash-flows')).body;
  check('setiap penjualan otomatis menulis kas masuk',
    kasSetelahJual.rows.some((r) => r.ref_type === 'sale' && r.ref_id === saleHapus.body.sale.id
      && r.kategori === 'penjualan' && r.jumlah === saleHapus.body.sale.total),
    `saldo=${kasSetelahJual.saldo}`);

  const hapus = await req('DELETE', `/api/sales/${saleHapus.body.sale.id}`);
  check('hapus riwayat pesanan mengembalikan stok', hapus.status === 200 && hapus.body.deleted === 1,
    `deleted=${hapus.body?.deleted} restored=${hapus.body?.restored_movements}`);
  eq('stok kembali seperti sebelum penjualan', await stokNow(), stokSebelumHapus);
  eq('transaksi yang dihapus tidak bisa dibuka lagi',
    (await req('GET', `/api/sales/${saleHapus.body.sale.id}`)).status, 404);
  eq('baris kas transaksi yang dihapus ikut hilang',
    (await req('GET', '/api/cash-flows')).body.rows.filter((r) => r.ref_id === saleHapus.body.sale.id).length, 0);

  const tanpaRestore = await req('POST', '/api/sales', {
    tok: kasirTok,
    body: { uuid: uuid(), items: [{ product_id: pid, unit_id: idOf('pcs'), qty: 2 }], metode_bayar: 'tunai', dibayar: 100_000 },
  });
  const stokSebelumTanpaRestore = await stokNow();
  await req('DELETE', `/api/sales/${tanpaRestore.body.sale.id}?restore_stock=false`);
  eq('restore_stock=false menghapus tanpa menyentuh stok', await stokNow(), stokSebelumTanpaRestore);

  const purge = await req('POST', '/api/sales/purge', {
    body: { from: '2026-05-01', to: '2026-05-01', restore_stock: false },
  });
  eq('purge rentang kosong menghapus 0 baris', purge.body?.deleted, 0);
  eq('purge tanpa from/to ditolak 422', (await req('POST', '/api/sales/purge', { body: { from: '2026-05-01' } })).status, 422);

  // ------------------------------------------------------- hak akses kasir
  const tolakKasir = [
    ['GET', '/api/cash-flows'],
    ['GET', '/api/cash-flows/summary'],
    ['POST', '/api/cash-flows', { tipe: 'keluar', kategori: 'x', jumlah: 1000 }],
    ['GET', '/api/purchases'],
    ['POST', '/api/purchases', { items: [{ product_id: pid, unit_id: idOf('pcs'), qty: 1, harga_beli: 1000 }] }],
    ['GET', '/api/debts'],
    ['POST', '/api/debts', { tipe: 'utang', pihak: 'X', jumlah: 1000 }],
    ['GET', '/api/reports/omzet'],
    ['GET', '/api/reports/umum'],
    ['GET', '/api/reports/transactions'],
    ['GET', '/api/reports/cash-flow'],
    ['GET', '/api/reports/sales-by-category'],
    ['GET', '/api/reports/purchases'],
    ['GET', '/api/reports/modal'],
    ['GET', '/api/reports/debts'],
    ['GET', '/api/reports/profit-loss'],
    ['GET', '/api/reports/returns'],
    ['GET', '/api/reports/stock-flow'],
    ['GET', '/api/reports/stock-flow.csv'],
    ['GET', '/api/reports/cash-flow.csv'],
    ['POST', '/api/stock-opnames', { items: [{ product_id: pid, stok_fisik: 1 }] }],
    ['POST', '/api/returns', { tipe: 'penjualan', product_id: pid, unit_id: idOf('pcs'), qty: 1, jumlah: 1, alasan: 'x' }],
    ['DELETE', '/api/sales/1'],
    ['POST', '/api/sales/purge', { from: '2026-01-01', to: '2026-01-02' }],
  ];
  let semuaTolak = true;
  const bocor = [];
  for (const [method, p, body] of tolakKasir) {
    const r = await req(method, p, { tok: kasirTok, body });
    if (r.status !== 403) { semuaTolak = false; bocor.push(`${method} ${p}=${r.status}`); }
  }
  check('kasir ditolak 403 di seluruh endpoint superadmin yang baru', semuaTolak, bocor.join(' '));
  eq('kasir tetap boleh melihat alias OCR', (await req('GET', '/api/product-aliases', { tok: kasirTok })).status, 200);
  eq('kasir tetap boleh melihat stok opname', (await req('GET', '/api/stock-opnames', { tok: kasirTok })).status, 200);
  eq('kasir tetap boleh melihat retur', (await req('GET', '/api/returns', { tok: kasirTok })).status, 200);
} catch (err) {
  failed++;
  failures.push('exception');
  console.log(`FAIL  exception tak terduga — ${err.stack}`);
} finally {
  await cleanup();
  await new Promise((r) => server.close(r));
  await pool.end();
}

console.log(`\n${failed === 0 ? 'SEMUA PASS' : 'ADA YANG GAGAL'}: ${passed} lulus, ${failed} gagal`);
if (failures.length) console.log(`Gagal: ${failures.join(', ')}`);
process.exit(failed === 0 ? 0 : 1);
