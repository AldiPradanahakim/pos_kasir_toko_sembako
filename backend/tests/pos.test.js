import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDb, seedMaster, createUser, startServer, login, productFixture, stokOf, closePool,
} from './helper.js';

let api;
let token;
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
  fx = await productFixture(api.req, token);
});

const saleBody = (items, extra = {}) => ({
  uuid: crypto.randomUUID(),
  items,
  metode_bayar: 'tunai',
  dibayar: 10_000_000,
  ...extra,
});

test('1. konversi stok: jual 2 dus (isi 40) => stok -80 dan movement keluar -80', async () => {
  await api.req('POST', '/api/stock/in', {
    token,
    body: { product_id: fx.productId, unit_id: fx.dusId, qty: 5, note: 'kulakan' },
  });
  assert.equal((await stokOf(api.req, token, fx.productId)).stok_base, 200);

  const res = await api.req('POST', '/api/sales', {
    token,
    body: saleBody([{ product_id: fx.productId, unit_id: fx.dusId, qty: 2 }]),
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.sale.items[0].isi_snapshot, 40);
  assert.equal(res.body.sale.total, 200_000);

  const stok = await stokOf(api.req, token, fx.productId);
  assert.equal(stok.stok_base, 200 - 80);
  assert.equal(stok.display, '3 dus');
  assert.equal(stok.minus, false);

  const movements = (await api.req('GET', `/api/stock/movements?product_id=${fx.productId}`, { token })).body;
  const keluar = movements.find((m) => m.type === 'keluar');
  assert.ok(keluar, 'movement keluar harus ada');
  assert.equal(keluar.qty_base, -80);
  assert.equal(keluar.reference_type, 'sale');
  assert.equal(keluar.reference_id, res.body.sale.id);
});

test('2. idempotensi sync: uuid sama dua kali => satu baris, duplicate:true, no_struk identik', async () => {
  const body = saleBody([{ product_id: fx.productId, unit_id: fx.pcsId, qty: 3 }]);

  const first = await api.req('POST', '/api/sales', { token, body });
  const second = await api.req('POST', '/api/sales', { token, body });

  assert.equal(first.status, 201);
  assert.equal(first.body.duplicate, false);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.sale.no_struk, first.body.sale.no_struk);
  assert.equal(second.body.sale.id, first.body.sale.id);

  const list = (await api.req('GET', '/api/sales', { token })).body;
  assert.equal(list.length, 1);

  // Stok hanya berkurang sekali.
  assert.equal((await stokOf(api.req, token, fx.productId)).stok_base, -3);
});

test('3. pembatalan: stok kembali, status dibatalkan, no_struk tidak hilang', async () => {
  await api.req('POST', '/api/stock/in', {
    token,
    body: { product_id: fx.productId, unit_id: fx.dusId, qty: 5, note: null },
  });
  const before = (await stokOf(api.req, token, fx.productId)).stok_base;

  const sale = (await api.req('POST', '/api/sales', {
    token,
    body: saleBody([{ product_id: fx.productId, unit_id: fx.dusId, qty: 2 }]),
  })).body.sale;
  assert.equal((await stokOf(api.req, token, fx.productId)).stok_base, before - 80);

  const cancelled = await api.req('POST', `/api/sales/${sale.id}/cancel`, {
    token,
    body: { alasan_batal: 'Salah input satuan' },
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, 'dibatalkan');
  assert.equal(cancelled.body.alasan_batal, 'Salah input satuan');
  assert.equal(cancelled.body.no_struk, sale.no_struk);
  assert.ok(cancelled.body.no_struk);

  assert.equal((await stokOf(api.req, token, fx.productId)).stok_base, before);

  const movements = (await api.req('GET', `/api/stock/movements?product_id=${fx.productId}`, { token })).body;
  const pembatalan = movements.find((m) => m.type === 'pembatalan');
  assert.equal(pembatalan.qty_base, 80);

  // Baris transaksi tetap ada, tidak dihapus.
  const still = await api.req('GET', `/api/sales/${sale.id}`, { token });
  assert.equal(still.status, 200);

  // Batal dua kali ditolak.
  const again = await api.req('POST', `/api/sales/${sale.id}/cancel`, { token, body: { alasan_batal: 'lagi' } });
  assert.equal(again.status, 422);
});

test('4. snapshot: ubah harga_jual setelah transaksi => sale_items lama tidak berubah', async () => {
  const sale = (await api.req('POST', '/api/sales', {
    token,
    body: saleBody([{ product_id: fx.productId, unit_id: fx.dusId, qty: 1 }]),
  })).body.sale;
  assert.equal(sale.items[0].harga_snapshot, 100_000);
  assert.equal(sale.items[0].harga_modal_snapshot, 80_000);

  const units = fx.product.units.map((u) => ({
    unit_id: u.unit_id,
    isi: u.isi,
    harga_jual: u.unit_id === fx.dusId ? 130_000 : u.harga_jual,
    harga_modal: u.unit_id === fx.dusId ? 90_000 : u.harga_modal,
    barcode: u.barcode,
  }));
  const updated = await api.req('PUT', `/api/products/${fx.productId}`, {
    token,
    body: {
      name: fx.product.name,
      category_id: fx.product.category_id,
      base_unit: fx.product.base_unit,
      barcode: fx.product.barcode,
      units,
    },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.units.find((u) => u.unit_id === fx.dusId).harga_jual, 130_000);

  const after = (await api.req('GET', `/api/sales/${sale.id}`, { token })).body;
  assert.equal(after.items[0].harga_snapshot, 100_000);
  assert.equal(after.items[0].harga_modal_snapshot, 80_000);
  assert.equal(after.items[0].subtotal, 100_000);
  assert.equal(after.total, 100_000);
});

test('5. hak akses: kasir ditolak 403 di endpoint superadmin', async () => {
  await createUser({ name: 'Kasir Satu', username: 'kasir1', role: 'kasir' });
  const kasir = await login(api.req, 'kasir1');

  const denied = [
    ['POST', '/api/products', { name: 'X', base_unit: 'pcs', units: [{ unit_id: fx.pcsId, isi: 1, harga_jual: 1, harga_modal: 1 }] }],
    ['PUT', `/api/products/${fx.productId}`, { name: 'X', base_unit: 'pcs', units: [{ unit_id: fx.pcsId, isi: 1, harga_jual: 1, harga_modal: 1 }] }],
    ['DELETE', `/api/products/${fx.productId}`, undefined],
    ['POST', '/api/categories', { name: 'Baru' }],
    ['PUT', `/api/categories/1`, { name: 'Baru' }],
    ['DELETE', '/api/categories/1', undefined],
    ['POST', '/api/units', { name: 'baru' }],
    ['GET', '/api/users', undefined],
    ['POST', '/api/users', { name: 'A', username: 'a', password: 'rahasia', role: 'kasir' }],
    ['GET', '/api/reports/daily', undefined],
    ['GET', '/api/reports/profit', undefined],
    ['PUT', '/api/settings', { toko_nama: 'X' }],
  ];

  for (const [method, path, body] of denied) {
    const r = await api.req(method, path, { token: kasir, body });
    assert.equal(r.status, 403, `${method} ${path} harus 403, dapat ${r.status}`);
    assert.ok(r.body.error, `${method} ${path} harus mengembalikan {error}`);
  }

  // Kasir tetap boleh: lihat master, stok, stok masuk, transaksi.
  assert.equal((await api.req('GET', '/api/products', { token: kasir })).status, 200);
  assert.equal((await api.req('GET', '/api/stock', { token: kasir })).status, 200);
  assert.equal((await api.req('GET', '/api/sync/pull', { token: kasir })).status, 200);
  assert.equal((await api.req('POST', '/api/stock/in', {
    token: kasir,
    body: { product_id: fx.productId, unit_id: fx.pcsId, qty: 5, note: null },
  })).status, 201);
  assert.equal((await api.req('POST', '/api/sales', {
    token: kasir,
    body: saleBody([{ product_id: fx.productId, unit_id: fx.pcsId, qty: 1 }]),
  })).status, 201);

  // Kasir tidak bisa membatalkan tanpa kredensial superadmin...
  const sale = (await api.req('GET', '/api/sales', { token: kasir })).body[0];
  const noCreds = await api.req('POST', `/api/sales/${sale.id}/cancel`, {
    token: kasir,
    body: { alasan_batal: 'salah' },
  });
  assert.equal(noCreds.status, 403);

  const wrongCreds = await api.req('POST', `/api/sales/${sale.id}/cancel`, {
    token: kasir,
    body: { alasan_batal: 'salah', superadmin_username: 'superadmin', superadmin_password: 'SALAH' },
  });
  assert.equal(wrongCreds.status, 403);

  // ...tapi bisa dengan kredensial superadmin yang sah.
  const ok = await api.req('POST', `/api/sales/${sale.id}/cancel`, {
    token: kasir,
    body: { alasan_batal: 'salah input', superadmin_username: 'superadmin', superadmin_password: 'password' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'dibatalkan');
});

test('6. no_struk urut dan tidak bolong per hari Jakarta', async () => {
  const nos = [];
  for (let i = 0; i < 5; i++) {
    const r = await api.req('POST', '/api/sales', {
      token,
      body: saleBody([{ product_id: fx.productId, unit_id: fx.pcsId, qty: 1 }]),
    });
    nos.push(r.body.sale.no_struk);
  }

  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).replaceAll('-', '');
  assert.deepEqual(nos, [1, 2, 3, 4, 5].map((n) => `INV-${day}-${String(n).padStart(4, '0')}`));

  // Transaksi offline bertanggal lain memakai counter harinya sendiri, mulai dari 1 lagi.
  const offline = await api.req('POST', '/api/sales', {
    token,
    body: saleBody([{ product_id: fx.productId, unit_id: fx.pcsId, qty: 1 }], {
      created_at: '2026-01-05T04:30:00.000Z',
    }),
  });
  assert.equal(offline.body.sale.no_struk, 'INV-20260105-0001');
});

test('7. ubah harga: tanpa alasan 422, dengan alasan tersimpan + harga_diubah', async () => {
  const withoutReason = await api.req('POST', '/api/sales', {
    token,
    body: saleBody([{ product_id: fx.productId, unit_id: fx.pcsId, qty: 2, harga: 2500 }]),
  });
  assert.equal(withoutReason.status, 422);
  assert.match(withoutReason.body.error, /alasan_ubah_harga/);

  const withReason = await api.req('POST', '/api/sales', {
    token,
    body: saleBody([{ product_id: fx.productId, unit_id: fx.pcsId, qty: 2, harga: 2500, alasan_ubah_harga: 'Harga promo grosir' }]),
  });
  assert.equal(withReason.status, 201);
  const item = withReason.body.sale.items[0];
  assert.equal(item.harga_snapshot, 2500);
  assert.equal(item.harga_diubah, true);
  assert.equal(item.alasan_ubah_harga, 'Harga promo grosir');
  assert.equal(item.subtotal, 5000);

  // Harga sama dengan master tidak dianggap perubahan.
  const same = await api.req('POST', '/api/sales', {
    token,
    body: saleBody([{ product_id: fx.productId, unit_id: fx.pcsId, qty: 1, harga: 3000 }]),
  });
  assert.equal(same.body.sale.items[0].harga_diubah, false);

  // Laporan perubahan harga mencatatnya.
  const report = (await api.req('GET', '/api/reports/price-changes', { token })).body;
  assert.equal(report.length, 1);
  assert.equal(report[0].harga_snapshot, 2500);
  assert.equal(report[0].harga_normal, 3000);
  assert.equal(report[0].kasir, 'Super Admin');
});

test('8. validasi: qty/harga/dibayar dan stok minus ditandai', async () => {
  const bad = [
    [{ product_id: fx.productId, unit_id: fx.pcsId, qty: 0 }],
    [{ product_id: fx.productId, unit_id: fx.pcsId, qty: 1.5 }],
    [{ product_id: fx.productId, unit_id: fx.pcsId, qty: -2 }],
  ];
  for (const items of bad) {
    assert.equal((await api.req('POST', '/api/sales', { token, body: saleBody(items) })).status, 422);
  }

  // Satuan yang tidak terdaftar untuk produk itu.
  const otherUnit = (await api.req('GET', '/api/units', { token })).body.find((u) => u.name === 'bal');
  assert.equal((await api.req('POST', '/api/sales', {
    token,
    body: saleBody([{ product_id: fx.productId, unit_id: otherUnit.id, qty: 1 }]),
  })).status, 422);

  // Tunai kurang bayar.
  assert.equal((await api.req('POST', '/api/sales', {
    token,
    body: { uuid: crypto.randomUUID(), items: [{ product_id: fx.productId, unit_id: fx.pcsId, qty: 1 }], metode_bayar: 'tunai', dibayar: 100 },
  })).status, 422);

  // Kembalian pas sampai rupiah.
  const exact = await api.req('POST', '/api/sales', {
    token,
    body: { uuid: crypto.randomUUID(), items: [{ product_id: fx.productId, unit_id: fx.pcsId, qty: 1 }], metode_bayar: 'tunai', dibayar: 5000 },
  });
  assert.equal(exact.body.sale.total, 3000);
  assert.equal(exact.body.sale.kembalian, 2000);

  // Jual offline melebihi stok: diterima, ditandai minus.
  const minus = await api.req('POST', '/api/sales', {
    token,
    body: saleBody([{ product_id: fx.productId, unit_id: fx.dusId, qty: 3 }]),
  });
  assert.equal(minus.status, 201);
  const stok = await stokOf(api.req, token, fx.productId);
  assert.equal(stok.stok_base, -121); // -1 pcs dari transaksi pas di atas, lalu -120 dari 3 dus
  assert.equal(stok.minus, true);
  assert.equal(stok.display, '-3 dus 1 pcs');
});

test('9. laporan mengabaikan transaksi dibatalkan', async () => {
  const keep = (await api.req('POST', '/api/sales', {
    token,
    body: saleBody([{ product_id: fx.productId, unit_id: fx.pcsId, qty: 2 }]),
  })).body.sale;
  const drop = (await api.req('POST', '/api/sales', {
    token,
    body: { uuid: crypto.randomUUID(), items: [{ product_id: fx.productId, unit_id: fx.pcsId, qty: 5 }], metode_bayar: 'tunai', dibayar: 10_000_000 },
  })).body.sale;
  await api.req('POST', `/api/sales/${drop.id}/cancel`, { token, body: { alasan_batal: 'void' } });

  const daily = (await api.req('GET', '/api/reports/daily', { token })).body;
  assert.equal(daily.transactions, 1);
  assert.equal(daily.total, keep.total);
  assert.equal(daily.items_count, 2);

  const profit = (await api.req('GET', '/api/reports/profit', { token })).body;
  assert.equal(profit.total_omzet, keep.total);
  assert.equal(profit.total_modal, 2000 * 2);
  assert.equal(profit.laba_kotor, keep.total - 4000);
  assert.equal(profit.rows.length, 1);

  const sales = (await api.req('GET', '/api/reports/sales', { token })).body;
  assert.equal(sales.total, keep.total);
  assert.equal(sales.rows[0].transactions, 1);
});

test('10. metode bayar selain tunai ditolak', async () => {
  const r = await api.req('POST', '/api/sales', {
    token,
    body: { uuid: crypto.randomUUID(), items: [{ product_id: fx.productId, unit_id: fx.pcsId, qty: 1 }], metode_bayar: 'qris', dibayar: 5000 },
  });
  assert.equal(r.status, 422);
  assert.match(r.body.error, /tunai/);
});
