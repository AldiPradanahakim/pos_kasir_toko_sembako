import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDb, seedMaster, createUser, startServer, login, productFixture, closePool,
} from './helper.js';

let api;
let token;

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
});

test('produk: PUT mengganti array units secara wholesale (upsert + hapus yang hilang)', async () => {
  const fx = await productFixture(api.req, token);
  const units = (await api.req('GET', '/api/units', { token })).body;
  const balId = units.find((u) => u.name === 'bal').id;

  const updated = await api.req('PUT', `/api/products/${fx.productId}`, {
    token,
    body: {
      name: 'Kopi Sachet Premium',
      category_id: fx.product.category_id,
      base_unit: 'pcs',
      barcode: '8991234567890',
      units: [
        // pcs tetap ada tapi isi/harga diubah
        { unit_id: fx.pcsId, isi: 1, harga_jual: 3500, harga_modal: 2200 },
        // dus dihapus dari payload -> harus hilang
        // bal ditambahkan
        { unit_id: balId, isi: 400, harga_jual: 950000, harga_modal: 760000 },
      ],
    },
  });

  assert.equal(updated.status, 200);
  assert.equal(updated.body.name, 'Kopi Sachet Premium');
  assert.deepEqual(updated.body.units.map((u) => u.unit_name).sort(), ['bal', 'pcs']);
  assert.equal(updated.body.units.find((u) => u.unit_name === 'pcs').harga_jual, 3500);
  assert.equal(updated.body.units.find((u) => u.unit_name === 'bal').isi, 400);

  const reloaded = (await api.req('GET', '/api/products', { token })).body[0];
  assert.deepEqual(reloaded.units.map((u) => u.unit_name).sort(), ['bal', 'pcs']);
});

test('produk: validasi payload ditolak 422', async () => {
  const cases = [
    { name: '', base_unit: 'pcs', units: [{ unit_id: 1, isi: 1, harga_jual: 1, harga_modal: 1 }] },
    { name: 'A', base_unit: 'liter', units: [{ unit_id: 1, isi: 1, harga_jual: 1, harga_modal: 1 }] },
    { name: 'A', base_unit: 'pcs', units: [] },
    { name: 'A', base_unit: 'pcs', units: [{ unit_id: 1, isi: 0, harga_jual: 1, harga_modal: 1 }] },
    { name: 'A', base_unit: 'pcs', units: [{ unit_id: 1, isi: 1, harga_jual: -1, harga_modal: 1 }] },
    { name: 'A', base_unit: 'pcs', units: [{ unit_id: 1, isi: 1, harga_jual: 1.5, harga_modal: 1 }] },
    { name: 'A', base_unit: 'pcs', units: [
      { unit_id: 1, isi: 1, harga_jual: 1, harga_modal: 1 },
      { unit_id: 1, isi: 2, harga_jual: 2, harga_modal: 2 },
    ] },
  ];
  for (const body of cases) {
    const r = await api.req('POST', '/api/products', { token, body });
    assert.equal(r.status, 422, `harus 422 untuk ${JSON.stringify(body)}`);
  }

  // Barcode duplikat ditolak.
  await productFixture(api.req, token);
  const dup = await api.req('POST', '/api/products', {
    token,
    body: {
      name: 'Lain',
      base_unit: 'pcs',
      barcode: '8991234567890',
      units: [{ unit_id: 1, isi: 1, harga_jual: 1, harga_modal: 1 }],
    },
  });
  assert.equal(dup.status, 422);
});

test('kategori & satuan: DELETE hard bila tak terpakai, soft bila terpakai', async () => {
  const free = (await api.req('POST', '/api/categories', { token, body: { name: 'Kosong' } })).body;
  const hard = await api.req('DELETE', `/api/categories/${free.id}`, { token });
  assert.deepEqual(hard.body, { ok: true });
  assert.equal((await api.req('GET', '/api/categories', { token })).body.find((c) => c.id === free.id), undefined);

  // Kategori yang dipakai produk -> soft delete.
  const used = (await api.req('POST', '/api/categories', { token, body: { name: 'Minuman' } })).body;
  const units = (await api.req('GET', '/api/units', { token })).body;
  const idOf = (name) => units.find((u) => u.name === name).id;

  const prod = await api.req('POST', '/api/products', {
    token,
    body: {
      name: 'Teh Kotak',
      category_id: used.id,
      base_unit: 'pcs',
      units: [
        { unit_id: idOf('pcs'), isi: 1, harga_jual: 5000, harga_modal: 4000 },
        { unit_id: idOf('dus'), isi: 24, harga_jual: 110000, harga_modal: 90000 },
      ],
    },
  });
  assert.equal(prod.status, 201);

  const soft = await api.req('DELETE', `/api/categories/${used.id}`, { token });
  assert.deepEqual(soft.body, { ok: true });
  const listed = (await api.req('GET', '/api/categories', { token })).body.find((c) => c.id === used.id);
  assert.equal(listed.is_active, false, 'kategori terpakai harus dinonaktifkan, bukan dihapus');

  // Satuan yang dipakai product_units -> soft.
  await api.req('DELETE', `/api/units/${idOf('dus')}`, { token });
  assert.equal((await api.req('GET', '/api/units', { token })).body.find((u) => u.id === idOf('dus')).is_active, false);

  // Satuan yang tidak dipakai -> hard delete.
  await api.req('DELETE', `/api/units/${idOf('bal')}`, { token });
  assert.equal((await api.req('GET', '/api/units', { token })).body.find((u) => u.id === idOf('bal')), undefined);

  assert.equal((await api.req('DELETE', '/api/categories/999999', { token })).status, 404);
});

test('users: password tidak pernah dikembalikan, tidak bisa menonaktifkan diri sendiri', async () => {
  const created = await api.req('POST', '/api/users', {
    token,
    body: { name: 'Kasir Dua', username: 'kasir2', password: 'rahasia123', role: 'kasir' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.password, undefined);
  assert.equal(created.body.username, 'kasir2');
  assert.equal(created.body.is_active, true);

  const list = (await api.req('GET', '/api/users', { token })).body;
  assert.ok(list.length >= 2);
  for (const u of list) assert.equal(u.password, undefined, 'password tidak boleh bocor');

  // Username duplikat.
  assert.equal((await api.req('POST', '/api/users', {
    token,
    body: { name: 'X', username: 'kasir2', password: 'rahasia123', role: 'kasir' },
  })).status, 422);

  // Role tidak sah.
  assert.equal((await api.req('POST', '/api/users', {
    token,
    body: { name: 'X', username: 'x', password: 'rahasia123', role: 'admin' },
  })).status, 422);

  const me = (await api.req('GET', '/api/me', { token })).body.user;
  assert.equal((await api.req('PUT', `/api/users/${me.id}`, { token, body: { is_active: false } })).status, 422);
  assert.equal((await api.req('DELETE', `/api/users/${me.id}`, { token })).status, 422);

  // Ganti password lalu login dengan yang baru. Reset oleh superadmin menandai akun itu
  // wajib mengganti password saat masuk, jadi pemiliknya mengganti sendiri dulu.
  const upd = await api.req('PUT', `/api/users/${created.body.id}`, { token, body: { password: 'baru123456' } });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.password, undefined);
  assert.equal(upd.body.must_change_password, true);
  const masukKasir = await api.req('POST', '/api/login', { body: { username: 'kasir2', password: 'baru123456' } });
  assert.equal(masukKasir.status, 200);
  assert.equal(masukKasir.body.user.must_change_password, true);
  // Sebelum password diganti, endpoint lain ditolak.
  assert.equal((await api.req('GET', '/api/products', { token: masukKasir.body.token })).status, 403);
  assert.equal((await api.req('POST', '/api/login', { body: { username: 'kasir2', password: 'rahasia123' } })).status, 401);

  const gantiSendiri = await api.req('PUT', `/api/users/${created.body.id}`, {
    token: masukKasir.body.token,
    body: { password: 'kasirbaru123', password_lama: 'baru123456' },
  });
  assert.equal(gantiSendiri.status, 200);
  assert.equal(gantiSendiri.body.must_change_password, false);

  // User yang sudah dipakai bertransaksi tidak dihapus, hanya dinonaktifkan.
  const kasir = await login(api.req, 'kasir2', 'kasirbaru123');
  const fx = await productFixture(api.req, token);
  await api.req('POST', '/api/sales', {
    token: kasir,
    body: { uuid: crypto.randomUUID(), items: [{ product_id: fx.productId, unit_id: fx.pcsId, qty: 1 }], metode_bayar: 'tunai', dibayar: 3000 },
  });
  assert.deepEqual((await api.req('DELETE', `/api/users/${created.body.id}`, { token })).body, { ok: true });
  assert.equal((await api.req('GET', '/api/users', { token })).body.find((u) => u.id === created.body.id).is_active, false);
  // Token yang masih beredar langsung tidak berlaku.
  assert.equal((await api.req('GET', '/api/me', { token: kasir })).status, 401);
});

test('auth: token wajib, logout mencabut token', async () => {
  assert.equal((await api.req('GET', '/api/me')).status, 401);
  assert.equal((await api.req('GET', '/api/me', { token: 'token-palsu' })).status, 401);
  assert.equal((await api.req('POST', '/api/login', { body: { username: 'superadmin', password: 'salah' } })).status, 401);
  assert.equal((await api.req('POST', '/api/login', { body: { username: '' } })).status, 422);
  assert.equal((await api.req('GET', '/api/endpoint-ngawur', { token })).status, 404);

  const me = await api.req('GET', '/api/me', { token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.username, 'superadmin');
  assert.equal(me.body.user.is_active, true);

  assert.deepEqual((await api.req('POST', '/api/logout', { token })).body, { ok: true });
  assert.equal((await api.req('GET', '/api/me', { token })).status, 401);
});

test('settings: PUT menyimpan identitas toko dan menolak nama kosong', async () => {
  const initial = (await api.req('GET', '/api/settings', { token })).body;
  assert.equal(initial.toko_nama, 'Toko Hakim');

  const put = await api.req('PUT', '/api/settings', {
    token,
    body: { toko_nama: 'Toko Hakim Grosir', alamat: 'Jl. Merdeka 1', telepon: '08123456789' },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.toko_nama, 'Toko Hakim Grosir');
  assert.equal(put.body.alamat, 'Jl. Merdeka 1');
  assert.equal(put.body.telepon, '08123456789');

  assert.equal((await api.req('PUT', '/api/settings', { token, body: { toko_nama: '' } })).status, 422);

  const after = (await api.req('GET', '/api/settings', { token })).body;
  assert.equal(after.toko_nama, 'Toko Hakim Grosir');
});

test('sync/pull mengembalikan master + stok + pengaturan dalam satu panggilan', async () => {
  const fx = await productFixture(api.req, token);
  await api.req('POST', '/api/stock/in', {
    token,
    body: { product_id: fx.productId, unit_id: fx.dusId, qty: 3, note: 'awal' },
  });

  const pull = (await api.req('GET', '/api/sync/pull', { token })).body;
  assert.ok(pull.server_time);
  assert.equal(pull.units.length, 10);
  assert.equal(pull.categories.length, 1);
  assert.equal(pull.products.length, 1);
  assert.equal(pull.products[0].units.length, 2);
  assert.equal(pull.products[0].units[0].unit_name, 'dus');
  assert.equal(pull.settings.toko_nama, 'Toko Hakim');
  assert.equal(pull.stock.length, 1);
  assert.equal(pull.stock[0].product_id, fx.productId);
  assert.equal(pull.stock[0].stok_base, 120);
  assert.equal(pull.stock[0].display, '3 dus');
  assert.equal(pull.stock[0].minus, false);

  // Halaman stok offline membaca master dari Dexie, jadi baris stok hasil pull harus
  // membawa name + base_unit, dan bentuknya persis sama dengan GET /stock.
  assert.equal(pull.stock[0].name, 'Kopi Sachet');
  assert.equal(pull.stock[0].base_unit, 'pcs');
  const stockApi = (await api.req('GET', '/api/stock', { token })).body;
  assert.deepEqual(pull.stock, stockApi);
});

test('stok masuk: konversi lewat isi, tolak satuan asing dan qty tidak sah', async () => {
  const fx = await productFixture(api.req, token);

  const ok = await api.req('POST', '/api/stock/in', {
    token,
    body: { product_id: fx.productId, unit_id: fx.dusId, qty: 2, note: 'kiriman' },
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.movement.qty_base, 80);
  assert.equal(ok.body.movement.type, 'masuk');
  assert.equal(ok.body.movement.note, 'kiriman');

  const other = (await api.req('GET', '/api/units', { token })).body.find((u) => u.name === 'bal');
  assert.equal((await api.req('POST', '/api/stock/in', {
    token, body: { product_id: fx.productId, unit_id: other.id, qty: 1 },
  })).status, 422);
  assert.equal((await api.req('POST', '/api/stock/in', {
    token, body: { product_id: fx.productId, unit_id: fx.dusId, qty: 0 },
  })).status, 422);
  assert.equal((await api.req('POST', '/api/stock/in', {
    token, body: { product_id: fx.productId, unit_id: fx.dusId, qty: 1.5 },
  })).status, 422);

  // Riwayat pergerakan bisa difilter per produk.
  const movements = (await api.req('GET', `/api/stock/movements?product_id=${fx.productId}`, { token })).body;
  assert.equal(movements.length, 1);
  assert.equal(movements[0].product_name, 'Kopi Sachet');
  assert.equal(movements[0].user_name, 'Super Admin');
  assert.equal(movements[0].reference_type, 'stok_masuk');
});

test('satuan: inisial tersimpan, unik tanpa beda huruf besar/kecil, dan bentuknya dijaga', async () => {
  const dibuat = await api.req('POST', '/api/units', {
    token,
    body: { name: 'renteng', inisial: 'R', is_active: true },
  });
  assert.equal(dibuat.status, 201);
  // Disimpan huruf kecil supaya "P" dan "p" satu hal yang sama bagi pembaca nota.
  assert.equal(dibuat.body.inisial, 'r');

  const daftar = (await api.req('GET', '/api/units', { token })).body;
  const baris = daftar.find((u) => u.name === 'renteng');
  assert.equal(baris.inisial, 'r', 'GET /units harus membawa inisial');
  assert.ok(daftar.every((u) => 'inisial' in u), 'setiap baris punya field inisial');

  // Inisial harus unik: tanpa ini "p" bisa berarti pack sekaligus pcs saat membaca nota.
  const bentrok = await api.req('POST', '/api/units', { token, body: { name: 'pack besar', inisial: 'r' } });
  assert.equal(bentrok.status, 422);
  assert.match(bentrok.body.error, /Inisial/);

  // Bentuk yang tidak masuk akal ditolak, bukan disimpan sebagai sampah.
  for (const salah of ['terlalupanjang', 'r r', '##']) {
    const res = await api.req('POST', '/api/units', { token, body: { name: `satuan ${salah}`, inisial: salah } });
    assert.equal(res.status, 422, `inisial "${salah}" harus ditolak`);
  }

  // Mengosongkan inisial boleh (satuan lama tidak wajib punya singkatan).
  const dikosongkan = await api.req('PUT', `/api/units/${dibuat.body.id}`, {
    token,
    body: { name: 'renteng', inisial: '', is_active: true },
  });
  assert.equal(dikosongkan.status, 200);
  assert.equal(dikosongkan.body.inisial, null);
});

test('sync pull membawa inisial satuan untuk dibaca layar kasir', async () => {
  await api.req('POST', '/api/units', { token, body: { name: 'renteng', inisial: 'r' } });
  const pull = (await api.req('GET', '/api/sync/pull', { token })).body;
  assert.equal(pull.units.find((u) => u.name === 'renteng').inisial, 'r');
});
