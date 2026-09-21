/**
 * Regresi fitur lanjutan (migrasi 002): hapus riwayat pesanan, stok masuk massal,
 * pembelian + buku kas, omset, dan hak akses kasir atas endpoint baru.
 *
 * Semuanya memeriksa perilaku yang terlihat pemakai (stok, baris kas, angka laporan),
 * bukan susunan internal.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDb, seedMaster, createUser, startServer, login, productFixture, stokOf, closePool, q,
} from './helper.js';
import { runBackfillKas } from '../scripts/backfill-kas.js';

let api;
let token;
let kasir;
let fx;

before(async () => {
  api = await startServer();
});

after(async () => {
  await api.close();
  await closePool();
});

beforeEach(async () => {
  await resetDb();
  await seedMaster();
  await createUser({ name: 'Super Admin', username: 'superadmin', role: 'superadmin' });
  token = await login(api.req, 'superadmin');
  await createUser({ name: 'Kasir Satu', username: 'kasir1', role: 'kasir' });
  kasir = await login(api.req, 'kasir1');
  fx = await productFixture(api.req, token);
});

const saleBody = (items, extra = {}) => ({
  uuid: crypto.randomUUID(),
  items,
  metode_bayar: 'tunai',
  dibayar: 10_000_000,
  ...extra,
});

const cashFlows = async (query = '') => (await api.req('GET', `/api/cash-flows${query}`, { token })).body;

test('10. hapus transaksi mengembalikan stok dan membuang baris kasnya', async () => {
  await api.req('POST', '/api/stock/in', {
    token,
    body: { product_id: fx.productId, unit_id: fx.dusId, qty: 5 },
  });
  assert.equal((await stokOf(api.req, token, fx.productId)).stok_base, 200);

  const sale = await api.req('POST', '/api/sales', {
    token,
    body: saleBody([{ product_id: fx.productId, unit_id: fx.dusId, qty: 2 }]),
  });
  assert.equal(sale.status, 201);
  assert.equal((await stokOf(api.req, token, fx.productId)).stok_base, 120);

  // Penjualan menulis kas masuk.
  const before = await cashFlows();
  assert.equal(before.rows.length, 1);
  assert.equal(before.rows[0].tipe, 'masuk');
  assert.equal(before.rows[0].ref_type, 'sale');
  assert.equal(before.rows[0].ref_id, sale.body.sale.id);
  assert.equal(before.rows[0].jumlah, sale.body.sale.total);

  const del = await api.req('DELETE', `/api/sales/${sale.body.sale.id}`, { token });
  assert.equal(del.status, 200);
  assert.equal(del.body.deleted, 1);
  assert.equal(del.body.restore_stock, true);

  assert.equal((await stokOf(api.req, token, fx.productId)).stok_base, 200);
  assert.equal((await api.req('GET', `/api/sales/${sale.body.sale.id}`, { token })).status, 404);
  assert.equal((await cashFlows()).rows.length, 0, 'baris kas penjualan ikut terhapus');

  const movements = (await api.req('GET', `/api/stock/movements?product_id=${fx.productId}`, { token })).body;
  const restore = movements.find((m) => m.type === 'penyesuaian');
  assert.ok(restore, 'ada movement penyesuaian pengembalian');
  assert.equal(restore.qty_base, 80);
  assert.match(restore.note, /Hapus transaksi INV-/);
});

test('11. hapus transaksi dengan restore_stock=false tidak menyentuh stok', async () => {
  await api.req('POST', '/api/stock/in', { token, body: { product_id: fx.productId, unit_id: fx.dusId, qty: 5 } });
  const sale = await api.req('POST', '/api/sales', {
    token,
    body: saleBody([{ product_id: fx.productId, unit_id: fx.pcsId, qty: 10 }]),
  });

  const del = await api.req('DELETE', `/api/sales/${sale.body.sale.id}?restore_stock=false`, { token });
  assert.equal(del.status, 200);
  assert.equal(del.body.restore_stock, false);
  assert.equal(del.body.restored_movements, 0);
  assert.equal((await stokOf(api.req, token, fx.productId)).stok_base, 190, 'stok tetap seperti setelah penjualan');
});

test('12. transaksi yang sudah dibatalkan tidak dikembalikan stoknya dua kali saat dihapus', async () => {
  await api.req('POST', '/api/stock/in', { token, body: { product_id: fx.productId, unit_id: fx.dusId, qty: 5 } });
  const sale = await api.req('POST', '/api/sales', {
    token,
    body: saleBody([{ product_id: fx.productId, unit_id: fx.dusId, qty: 2 }]),
  });
  await api.req('POST', `/api/sales/${sale.body.sale.id}/cancel`, { token, body: { alasan_batal: 'salah input' } });
  assert.equal((await stokOf(api.req, token, fx.productId)).stok_base, 200, 'pembatalan sudah mengembalikan stok');

  // Pembatalan menulis kas keluar penyeimbang; keduanya hilang bersama transaksinya.
  const flows = await cashFlows();
  assert.equal(flows.rows.length, 2);
  assert.equal(flows.rows.find((r) => r.kategori === 'pembatalan').tipe, 'keluar');

  await api.req('DELETE', `/api/sales/${sale.body.sale.id}`, { token });
  assert.equal((await stokOf(api.req, token, fx.productId)).stok_base, 200, 'stok tidak digandakan');
  assert.equal((await cashFlows()).rows.length, 0);
});

test('13. purge menghapus riwayat per rentang tanggal dan mengembalikan stoknya', async () => {
  await api.req('POST', '/api/stock/in', { token, body: { product_id: fx.productId, unit_id: fx.dusId, qty: 5 } });

  const hari = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  for (let i = 0; i < 3; i++) {
    await api.req('POST', '/api/sales', {
      token,
      body: saleBody([{ product_id: fx.productId, unit_id: fx.dusId, qty: 1 }]),
    });
  }
  assert.equal((await stokOf(api.req, token, fx.productId)).stok_base, 80);

  const purge = await api.req('POST', '/api/sales/purge', { token, body: { from: hari, to: hari } });
  assert.equal(purge.status, 200);
  assert.equal(purge.body.deleted, 3);
  assert.equal((await stokOf(api.req, token, fx.productId)).stok_base, 200);
  assert.equal((await api.req('GET', '/api/sales', { token })).body.length, 0);
  assert.equal((await cashFlows()).rows.length, 0);

  // Rentang yang salah ditolak, bukan dianggap "hapus semua".
  assert.equal((await api.req('POST', '/api/sales/purge', { token, body: { from: '2026-01-01' } })).status, 422);
});

test('14. stok masuk massal menerapkan 3 baris sekaligus dan menyimpan alias', async () => {
  const res = await api.req('POST', '/api/stock/in/bulk', {
    token,
    body: {
      note: 'Struk supplier A',
      items: [
        { product_id: fx.productId, unit_id: fx.pcsId, qty: 5 },
        { product_id: fx.productId, unit_id: fx.dusId, qty: 2 },
        { product_id: fx.productId, unit_id: fx.pcsId, qty: 1, note: 'bonus' },
      ],
      aliases: [{ alias: 'KOPI SACHET 1', product_id: fx.productId }],
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.applied, 3);
  assert.equal(res.body.movements.length, 3);
  assert.equal((await stokOf(api.req, token, fx.productId)).stok_base, 5 + 80 + 1);

  const aliases = (await api.req('GET', '/api/product-aliases', { token })).body;
  assert.equal(aliases.length, 1);
  assert.equal(aliases[0].alias, 'KOPI SACHET 1');
  assert.equal(aliases[0].product_id, fx.productId);
  assert.equal(aliases[0].product_name, fx.product.name);

  // Alias yang sama diarahkan ke produk lain: diperbarui, bukan ditolak.
  const lain = await api.req('POST', '/api/products', {
    token,
    body: {
      name: 'Teh Celup',
      base_unit: 'pcs',
      units: [{ unit_id: fx.pcsId, isi: 1, harga_jual: 5000, harga_modal: 4000 }],
    },
  });
  await api.req('POST', '/api/stock/in/bulk', {
    token,
    body: {
      items: [{ product_id: lain.body.id, unit_id: fx.pcsId, qty: 2 }],
      aliases: [{ alias: 'KOPI SACHET 1', product_id: lain.body.id }],
    },
  });
  const after = (await api.req('GET', '/api/product-aliases', { token })).body;
  assert.equal(after.length, 1);
  assert.equal(after[0].product_id, lain.body.id);
});

test('15. stok masuk massal menolak SELURUH batch bila ada satu baris tidak sah', async () => {
  const bal = (await api.req('GET', '/api/units', { token })).body.find((u) => u.name === 'bal');

  const batches = [
    // Satuan yang tidak terdaftar untuk produk itu.
    [
      { product_id: fx.productId, unit_id: fx.pcsId, qty: 5 },
      { product_id: fx.productId, unit_id: bal.id, qty: 1 },
    ],
    // qty nol di baris terakhir.
    [
      { product_id: fx.productId, unit_id: fx.pcsId, qty: 5 },
      { product_id: fx.productId, unit_id: fx.pcsId, qty: 0 },
    ],
    // produk tidak ada.
    [
      { product_id: fx.productId, unit_id: fx.pcsId, qty: 5 },
      { product_id: 999_999, unit_id: fx.pcsId, qty: 1 },
    ],
  ];

  for (const items of batches) {
    const res = await api.req('POST', '/api/stock/in/bulk', { token, body: { items } });
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.ok(res.body.error);
    assert.equal((await stokOf(api.req, token, fx.productId)).stok_base, 0, 'tidak ada yang setengah masuk');
  }

  // Alias pun tidak tersimpan bila batchnya gagal.
  const gagal = await api.req('POST', '/api/stock/in/bulk', {
    token,
    body: {
      items: [{ product_id: fx.productId, unit_id: bal.id, qty: 1 }],
      aliases: [{ alias: 'TIDAK BOLEH MASUK', product_id: fx.productId }],
    },
  });
  assert.equal(gagal.status, 422);
  assert.equal((await api.req('GET', '/api/product-aliases', { token })).body.length, 0);
});

test('16. pembelian tanpa harga menambah stok dan TIDAK menulis baris kas', async () => {
  const res = await api.req('POST', '/api/purchases', {
    token,
    body: {
      tanggal: '2026-09-10',
      supplier: 'Toko Grosir Jaya',
      note: 'kulakan mingguan',
      items: [
        { product_id: fx.productId, unit_id: fx.dusId, qty: 3 },
        // Klien lama masih mengirim harga_beli: harus diabaikan, bukan ditolak.
        { product_id: fx.productId, unit_id: fx.pcsId, qty: 10, harga_beli: 2_100 },
      ],
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.total, 0, 'pembelian tidak punya nilai uang');
  assert.equal(res.body.items.length, 2);
  assert.equal(res.body.items[0].harga_beli, null);
  assert.equal(res.body.items[0].subtotal, null);
  assert.equal((await stokOf(api.req, token, fx.productId)).stok_base, 3 * 40 + 10);

  // Tidak ada uang yang berpindah, jadi tidak ada baris kas yang lahir.
  assert.equal((await cashFlows('?from=2026-09-10&to=2026-09-10')).rows.length, 0);

  const list = (await api.req('GET', '/api/purchases?from=2026-09-10&to=2026-09-10', { token })).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].supplier, 'Toko Grosir Jaya');
  assert.equal(list[0].items_count, 2);
  assert.equal(list[0].total, 0);

  // Hapus pembelian: stok kembali ke nol dan tetap tidak ada baris kas.
  assert.equal((await api.req('DELETE', `/api/purchases/${res.body.id}`, { token })).status, 200);
  assert.equal((await stokOf(api.req, token, fx.productId)).stok_base, 0);
  assert.equal((await cashFlows()).rows.length, 0);
});

test('17. omset hanya untuk superadmin dan konsisten dengan transaksi berjalan', async () => {
  assert.equal((await api.req('GET', '/api/reports/omzet', { token: kasir })).status, 403,
    'kasir tidak boleh melihat omset');
  assert.deepEqual((await api.req('GET', '/api/reports/omzet', { token })).body.hari_ini, { total: 0, transaksi: 0 });

  const a = await api.req('POST', '/api/sales', {
    token,
    body: saleBody([{ product_id: fx.productId, unit_id: fx.dusId, qty: 2 }]),
  });
  const b = await api.req('POST', '/api/sales', {
    token,
    body: saleBody([{ product_id: fx.productId, unit_id: fx.pcsId, qty: 4 }]),
  });
  const total = a.body.sale.total + b.body.sale.total;

  // Transaksi yang dibatalkan tidak boleh ikut terhitung.
  await api.req('POST', `/api/sales/${b.body.sale.id}/cancel`, { token, body: { alasan_batal: 'salah' } });

  const omzet = (await api.req('GET', '/api/reports/omzet', { token })).body;
  assert.equal(omzet.hari_ini.total, a.body.sale.total);
  assert.equal(omzet.hari_ini.transaksi, 1);
  assert.equal(omzet.hari_ini_items, 2, 'jumlah item hari ini dihitung dari qty');
  assert.equal(omzet.bulan_ini.total, a.body.sale.total);
  assert.equal(omzet.tahun_ini.total, a.body.sale.total);
  assert.ok(omzet.tahun_ini.total <= omzet.bulan_ini.total + total);
});

test('18. nama pelanggan tersimpan dan muncul di riwayat serta struk', async () => {
  const res = await api.req('POST', '/api/sales', {
    token,
    body: saleBody([{ product_id: fx.productId, unit_id: fx.pcsId, qty: 1 }], { nama_pelanggan: 'Bu Siti' }),
  });
  assert.equal(res.body.sale.nama_pelanggan, 'Bu Siti');

  const detail = (await api.req('GET', `/api/sales/${res.body.sale.id}`, { token })).body;
  assert.equal(detail.nama_pelanggan, 'Bu Siti');

  const riwayat = (await api.req('GET', '/api/sales', { token })).body;
  assert.equal(riwayat[0].nama_pelanggan, 'Bu Siti');

  // Tanpa nama pelanggan tetap boleh (null), tidak jadi string kosong.
  const tanpa = await api.req('POST', '/api/sales', {
    token,
    body: saleBody([{ product_id: fx.productId, unit_id: fx.pcsId, qty: 1 }]),
  });
  assert.equal(tanpa.body.sale.nama_pelanggan, null);
});

test('19. kasir ditolak 403 di seluruh endpoint baru milik superadmin', async () => {
  const denied = [
    ['GET', '/api/cash-flows', undefined],
    ['GET', '/api/cash-flows/summary', undefined],
    ['POST', '/api/cash-flows', { tipe: 'keluar', kategori: 'listrik', jumlah: 1000 }],
    ['DELETE', '/api/cash-flows/1', undefined],
    ['GET', '/api/purchases', undefined],
    ['POST', '/api/purchases', { items: [{ product_id: fx.productId, unit_id: fx.pcsId, qty: 1, harga_beli: 1000 }] }],
    ['DELETE', '/api/purchases/1', undefined],
    ['GET', '/api/debts', undefined],
    ['POST', '/api/debts', { tipe: 'utang', pihak: 'Supplier', jumlah: 1000 }],
    ['GET', '/api/reports/omzet', undefined],
    ['GET', '/api/reports/umum', undefined],
    ['GET', '/api/reports/transactions', undefined],
    ['GET', '/api/reports/cash-flow', undefined],
    ['GET', '/api/reports/sales-by-category', undefined],
    ['GET', '/api/reports/purchases', undefined],
    ['GET', '/api/reports/modal', undefined],
    ['GET', '/api/reports/debts', undefined],
    ['GET', '/api/reports/profit-loss', undefined],
    ['GET', '/api/reports/returns', undefined],
    ['GET', '/api/reports/stock-flow', undefined],
    ['GET', '/api/reports/stock-flow.csv', undefined],
    ['GET', '/api/reports/cash-flow.csv', undefined],
    ['POST', '/api/stock-opnames', { items: [{ product_id: fx.productId, stok_fisik: 1 }] }],
    ['POST', '/api/returns', { tipe: 'penjualan', product_id: fx.productId, unit_id: fx.pcsId, qty: 1, jumlah: 100, alasan: 'rusak' }],
    ['DELETE', '/api/returns/1', undefined],
    ['DELETE', `/api/sales/1`, undefined],
    ['POST', '/api/sales/purge', { from: '2026-01-01', to: '2026-01-02' }],
  ];

  for (const [method, path, body] of denied) {
    const r = await api.req(method, path, { token: kasir, body });
    assert.equal(r.status, 403, `${method} ${path} harus 403, dapat ${r.status}`);
    assert.ok(r.body.error, `${method} ${path} harus mengembalikan {error}`);
  }

  // Yang memang boleh dibaca kasir.
  assert.equal((await api.req('GET', '/api/product-aliases', { token: kasir })).status, 200);
  assert.equal((await api.req('GET', '/api/returns', { token: kasir })).status, 200);
  assert.equal((await api.req('GET', '/api/stock-opnames', { token: kasir })).status, 200);
  // Stok masuk massal adalah alur OCR yang dipakai kasir, seperti POST /stock/in.
  assert.equal((await api.req('POST', '/api/stock/in/bulk', {
    token: kasir,
    body: { items: [{ product_id: fx.productId, unit_id: fx.pcsId, qty: 1 }] },
  })).status, 201);
});

test('20. backfill kas melengkapi transaksi lama, idempotent, dan tidak menyentuh baris yang ada', async () => {
  // Transaksi selesai, lalu baris kasnya dibuang untuk meniru data yang dibuat
  // SEBELUM fitur arus keuangan ada.
  const sale = await api.req('POST', '/api/sales', {
    token,
    body: saleBody([{ product_id: fx.productId, unit_id: fx.dusId, qty: 1 }]),
  });
  const saleId = sale.body.sale.id;
  await q(`DELETE FROM cash_flows WHERE ref_type = 'sale' AND ref_id = $1`, [saleId]);
  assert.equal((await cashFlows()).rows.length, 0);

  const run1 = await runBackfillKas(process.env.DATABASE_URL, { log: () => {} });
  assert.equal(run1.masuk, 1, 'satu baris kas masuk dibuat untuk penjualan lama');
  assert.equal(run1.pembatalan, 0);

  const rows = (await cashFlows()).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tipe, 'masuk');
  assert.equal(rows[0].kategori, 'penjualan');
  assert.equal(rows[0].jumlah, sale.body.sale.total);
  assert.equal(rows[0].ref_type, 'sale');
  assert.equal(rows[0].ref_id, saleId);
  // Tanggalnya hari Jakarta dari transaksi, bukan hari backfill dijalankan.
  const hariSale = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' })
    .format(new Date(sale.body.sale.created_at));
  assert.equal(rows[0].tanggal, hariSale);

  // Penjalanan kedua tidak menambah apa pun.
  const run2 = await runBackfillKas(process.env.DATABASE_URL, { log: () => {} });
  assert.equal(run2.dibuat, 0, 'backfill kedua tidak membuat baris baru');
  assert.equal((await cashFlows()).rows.length, 1);

  // Penjualan yang dibatalkan tidak menambah pemasukan: omzet juga mengabaikannya,
  // jadi pemasukan kas harus tetap sama dengan omzet.
  const batal = await api.req('POST', '/api/sales', {
    token,
    body: saleBody([{ product_id: fx.productId, unit_id: fx.pcsId, qty: 2 }]),
  });
  const batalId = batal.body.sale.id;
  await api.req('POST', `/api/sales/${batalId}/cancel`, { token, body: { alasan_batal: 'salah input' } });
  await q(`DELETE FROM cash_flows WHERE ref_type = 'sale' AND ref_id = $1`, [batalId]);

  const run3 = await runBackfillKas(process.env.DATABASE_URL, { log: () => {} });
  assert.equal(run3.dibuat, 0, 'transaksi batal tidak diberi baris kas');
  assert.equal((await cashFlows()).rows.filter((r) => r.ref_id === batalId).length, 0);

  // Tapi kalau baris masuknya ada dan penyeimbangnya hilang, penyeimbangnya dibuat.
  await q(
    `INSERT INTO cash_flows (tanggal, tipe, kategori, jumlah, ref_type, ref_id)
     VALUES ($1, 'masuk', 'penjualan', $2, 'sale', $3)`,
    [hariSale, batal.body.sale.total, batalId],
  );
  const run4 = await runBackfillKas(process.env.DATABASE_URL, { log: () => {} });
  assert.equal(run4.pembatalan, 1, 'penyeimbang dibuat untuk baris masuk yang tak berpasangan');
  assert.equal(run4.masuk, 0);

  const pasangan = (await cashFlows()).rows.filter((r) => r.ref_id === batalId);
  assert.equal(pasangan.length, 2);
  assert.equal(pasangan.find((r) => r.tipe === 'keluar').kategori, 'pembatalan');
  assert.equal(pasangan.reduce((a, r) => a + (r.tipe === 'masuk' ? r.jumlah : -r.jumlah), 0), 0,
    'sepasang baris itu netto nol');

  // Penjalanan terakhir tidak mengubah apa pun lagi.
  const run5 = await runBackfillKas(process.env.DATABASE_URL, { log: () => {} });
  assert.equal(run5.dibuat, 0);
});

test('21. laporan pembelian melaporkan qty per supplier dan per produk', async () => {
  await api.req('POST', '/api/purchases', {
    token,
    body: {
      tanggal: '2026-09-12',
      supplier: 'Toko Grosir Jaya',
      items: [
        { product_id: fx.productId, unit_id: fx.dusId, qty: 3 },
        { product_id: fx.productId, unit_id: fx.pcsId, qty: 10 },
      ],
    },
  });

  const laporan = (await api.req('GET', '/api/reports/purchases?from=2026-09-12&to=2026-09-12', { token })).body;
  assert.equal(laporan.jumlah_transaksi, 1, 'jumlah dokumen pembelian');
  assert.equal(laporan.qty, 13, 'qty = jumlah satuan yang dibeli (3 dus + 10 pcs)');
  assert.equal(laporan.qty_base, 3 * 40 + 10, 'qty_base = konversi ke base_unit');
  assert.equal(laporan.total, 0, 'pembelian tanpa harga bernilai 0');

  assert.equal(laporan.by_supplier.length, 1);
  assert.deepEqual(laporan.by_supplier[0], {
    supplier: 'Toko Grosir Jaya', transaksi: 1, qty: 13, qty_base: 130, total: 0,
  });

  assert.equal(laporan.by_product.length, 1);
  assert.equal(laporan.by_product[0].product_name, 'Kopi Sachet');
  assert.equal(laporan.by_product[0].qty, 13);
  assert.equal(laporan.by_product[0].qty_base, 130);
  assert.equal(laporan.by_product[0].total, 0);
});

test('22. hapus pembelian tetap jalan tanpa baris kas, dan menyapu baris kas warisan', async () => {
  const buatPembelian = async () => (await api.req('POST', '/api/purchases', {
    token,
    body: { tanggal: '2026-09-13', supplier: 'Toko Lama', items: [{ product_id: fx.productId, unit_id: fx.dusId, qty: 1 }] },
  })).body.id;

  // Pembelian baru tidak punya baris kas: hapus harus tetap 200 dan stok kembali.
  const baru = await buatPembelian();
  assert.equal((await stokOf(api.req, token, fx.productId)).stok_base, 40);
  assert.equal((await api.req('DELETE', `/api/purchases/${baru}`, { token })).status, 200);
  assert.equal((await stokOf(api.req, token, fx.productId)).stok_base, 0);

  // Pembelian warisan punya baris kas keluar: ikut terhapus, bukan bikin error.
  const lama = await buatPembelian();
  await q(
    `INSERT INTO cash_flows (tanggal, tipe, kategori, jumlah, ref_type, ref_id)
     VALUES ('2026-09-13', 'keluar', 'pembelian', 50000, 'purchase', $1)`,
    [lama],
  );
  assert.equal((await api.req('DELETE', `/api/purchases/${lama}`, { token })).status, 200);
  assert.equal((await stokOf(api.req, token, fx.productId)).stok_base, 0);
  assert.equal((await cashFlows('?from=2026-09-13&to=2026-09-13')).rows.length, 0);
});
