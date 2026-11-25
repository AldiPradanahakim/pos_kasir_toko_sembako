/**
 * Batas antar-peran dan header keamanan.
 * Jalankan: node --test tests/keamanan.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, seedMaster, createUser, startServer, login, productFixture, closePool } from './helper.js';

let api;
let superToken;
let kasirToken;
let fx;

test.before(async () => {
  await resetDb();
  await seedMaster();
  await createUser({ name: 'Super Admin', username: 'superadmin', role: 'superadmin' });
  await createUser({ name: 'Kasir Satu', username: 'kasir1', role: 'kasir' });
  await createUser({ name: 'Kasir Dua', username: 'kasir2', role: 'kasir' });
  api = await startServer();
  superToken = await login(api.req, 'superadmin');
  kasirToken = await login(api.req, 'kasir1');
  fx = await productFixture(api.req, superToken);
});

test.after(async () => {
  await api.close();
  await closePool();
});

const saleBody = (extra = {}) => ({
  uuid: crypto.randomUUID(),
  items: [{ product_id: fx.productId, unit_id: fx.pcsId, qty: 1 }],
  metode_bayar: 'tunai',
  dibayar: 10_000_000,
  ...extra,
});

test('harga kulak tidak dikirim ke perangkat kasir', async () => {
  const superProducts = await api.req('GET', '/api/products', { token: superToken });
  assert.equal(typeof superProducts.body[0].units[0].harga_modal, 'number');

  const kasirProducts = await api.req('GET', '/api/products', { token: kasirToken });
  assert.ok(kasirProducts.body.length > 0);
  for (const p of kasirProducts.body) {
    for (const u of p.units) assert.equal('harga_modal' in u, false, 'harga_modal bocor lewat /products');
    // Harga jual tetap ada: kasir membutuhkannya untuk melayani.
    assert.equal(typeof p.units[0].harga_jual, 'number');
  }

  const kasirSync = await api.req('GET', '/api/sync/pull', { token: kasirToken });
  for (const p of kasirSync.body.products) {
    for (const u of p.units) assert.equal('harga_modal' in u, false, 'harga_modal bocor lewat /sync/pull');
  }
  const superSync = await api.req('GET', '/api/sync/pull', { token: superToken });
  assert.equal(typeof superSync.body.products[0].units[0].harga_modal, 'number');
});

test('detail transaksi tidak membocorkan harga modal ke kasir', async () => {
  const dibuat = await api.req('POST', '/api/sales', { token: kasirToken, body: saleBody() });
  assert.equal(dibuat.status, 201);
  const id = dibuat.body.sale.id;

  const kasir = await api.req('GET', `/api/sales/${id}`, { token: kasirToken });
  assert.equal(kasir.status, 200);
  assert.equal('harga_modal_snapshot' in kasir.body.items[0], false);
  // Struk kasir tetap lengkap.
  assert.equal(typeof kasir.body.items[0].harga_snapshot, 'number');

  const superadmin = await api.req('GET', `/api/sales/${id}`, { token: superToken });
  assert.equal(typeof superadmin.body.items[0].harga_modal_snapshot, 'number');
});

test('kasir tidak bisa memundurkan tanggal transaksi tanpa batas', async () => {
  const tua = await api.req('POST', '/api/sales', {
    token: kasirToken,
    body: saleBody({ created_at: '2020-01-05T04:30:00.000Z' }),
  });
  assert.equal(tua.status, 422);
  assert.match(tua.body.error, /di luar batas wajar/);

  const jauhKeDepan = await api.req('POST', '/api/sales', {
    token: kasirToken,
    body: saleBody({ created_at: new Date(Date.now() + 5 * 86_400_000).toISOString() }),
  });
  assert.equal(jauhKeDepan.status, 422);

  // Offline beberapa hari tetap diterima.
  const kemarin = await api.req('POST', '/api/sales', {
    token: kasirToken,
    body: saleBody({ created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() }),
  });
  assert.equal(kemarin.status, 201);
});

test('kasir tidak bisa membuka kas kasir lain', async () => {
  const buka = await api.req('POST', '/api/shifts/buka', { token: kasirToken, body: { modal_awal: 50_000 } });
  assert.equal(buka.status, 201);
  const idShift = buka.body.id;

  const kasirLain = await login(api.req, 'kasir2');
  assert.equal((await api.req('GET', `/api/shifts/${idShift}`, { token: kasirLain })).status, 403);
  assert.equal((await api.req('GET', '/api/shifts', { token: kasirLain })).status, 403);
  assert.equal((await api.req('GET', `/api/shifts/${idShift}`, { token: superToken })).status, 200);
});

test('respons membawa header keamanan', async () => {
  const r = await fetch(`${api.base}/api/me`, { headers: { Authorization: `Bearer ${kasirToken}` } });
  assert.equal(r.status, 200);
  const csp = r.headers.get('content-security-policy') ?? '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('referrer-policy'), 'same-origin');
  // http polos tidak boleh memaksa HSTS.
  assert.equal(r.headers.get('strict-transport-security'), null);
});

test('kebijakan password menolak yang lemah', async () => {
  const kasus = [
    { body: { name: 'A', username: 'baru1', password: 'pendek1', role: 'kasir' }, alasan: /minimal 10/ },
    { body: { name: 'A', username: 'baru2', password: 'tanpaangka', role: 'kasir' }, alasan: /huruf dan angka/ },
    { body: { name: 'A', username: 'baru3', password: 'password123', role: 'kasir' }, alasan: /mudah ditebak/ },
    { body: { name: 'A', username: 'baru4', password: 'baru4baru44', role: 'kasir' }, alasan: /memuat username/ },
    { body: { name: 'A', username: 'baru5', password: 'aaaaaaaaaa1', role: 'kasir' }, alasan: null },
  ];
  for (const k of kasus) {
    const r = await api.req('POST', '/api/users', { token: superToken, body: k.body });
    if (k.alasan) {
      assert.equal(r.status, 422, JSON.stringify(k.body));
      assert.match(r.body.error, k.alasan);
    } else {
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }
  }
});

test('ganti password sendiri wajib menyebut password lama, dan mencabut sesi lain', async () => {
  const dibuat = await api.req('POST', '/api/users', {
    token: superToken,
    body: { name: 'Kasir Tiga', username: 'kasir3', password: 'kasirtiga123', role: 'kasir' },
  });
  assert.equal(dibuat.status, 201);
  const id = dibuat.body.id;
  const sesi1 = await login(api.req, 'kasir3', 'kasirtiga123');
  const sesi2 = await login(api.req, 'kasir3', 'kasirtiga123');

  // Tanpa password lama.
  const tanpaLama = await api.req('PUT', `/api/users/${id}`, { token: sesi1, body: { password: 'kasirtiga456' } });
  assert.equal(tanpaLama.status, 422);

  // Password lama salah: 422 (sesi tetap sah, hanya isian yang salah). Kalau 401, klien
  // membuang token dan pengguna terlempar ke halaman login hanya karena salah ketik.
  const salahLama = await api.req('PUT', `/api/users/${id}`, {
    token: sesi1,
    body: { password: 'kasirtiga456', password_lama: 'bukanpassword' },
  });
  assert.equal(salahLama.status, 422);
  assert.match(salahLama.body.error, /Password lama salah/);
  assert.equal((await api.req('GET', '/api/me', { token: sesi1 })).status, 200);

  // Benar: sesi lain (sesi2) mati, sesi yang dipakai mengganti tetap hidup.
  const benar = await api.req('PUT', `/api/users/${id}`, {
    token: sesi1,
    body: { password: 'kasirtiga456', password_lama: 'kasirtiga123' },
  });
  assert.equal(benar.status, 200);
  assert.equal((await api.req('GET', '/api/me', { token: sesi2 })).status, 401);
  assert.equal((await api.req('GET', '/api/me', { token: sesi1 })).status, 200);
});

test('kasir tidak bisa menaikkan perannya sendiri', async () => {
  const buat = await api.req('POST', '/api/users', {
    token: superToken,
    body: { name: 'Kasir Empat', username: 'kasir4', password: 'kasirempat123', role: 'kasir' },
  });
  const id = buat.body.id;
  const tok = await login(api.req, 'kasir4', 'kasirempat123');
  const naik = await api.req('PUT', `/api/users/${id}`, {
    token: tok,
    body: { password: 'kasirempat456', password_lama: 'kasirempat123', role: 'superadmin' },
  });
  assert.equal(naik.status, 403);
  assert.match(naik.body.error, /Hanya superadmin/);
});

test('jejak audit tercatat dan hanya bisa dibaca superadmin', async () => {
  const dibuat = await api.req('POST', '/api/products', {
    token: superToken,
    body: {
      name: 'Produk Audit',
      base_unit: 'pcs',
      units: [{ unit_id: fx.pcsId, isi: 1, harga_jual: 5000, harga_modal: 4000 }],
    },
  });
  assert.equal(dibuat.status, 201);

  const logs = await api.req('GET', '/api/audit-logs?limit=50', { token: superToken });
  assert.equal(logs.status, 200);
  const catat = logs.body.find((r) => r.aksi === 'products.create' && r.entitas_id === dibuat.body.id);
  assert.ok(catat, 'perubahan produk harus tercatat');
  assert.equal(catat.user_name, 'Super Admin');
  assert.equal(catat.detail.nama, 'Produk Audit');

  // Kasir tidak boleh membaca jejak audit.
  assert.equal((await api.req('GET', '/api/audit-logs', { token: kasirToken })).status, 403);

  // Tidak ada endpoint untuk menghapus/mengubah audit.
  assert.equal((await api.req('DELETE', `/api/audit-logs/${catat.id}`, { token: superToken })).status, 404);
  assert.equal((await api.req('PUT', `/api/audit-logs/${catat.id}`, { token: superToken, body: {} })).status, 404);
});

test('CSV menetralkan sel yang bisa jadi rumus', async () => {
  const { buildCsv } = await import('../src/lib.js');
  const csv = buildCsv(['a', 'b', 'c'], [
    ['=1+1', '+cmd', '-5000'],
    ['@SUM(A1)', 'aman', '-teks'],
  ]);
  assert.match(csv, /'=1\+1/);
  assert.match(csv, /'\+cmd/);
  // Angka negatif tetap angka (tidak diberi awalan kutip).
  assert.match(csv, /,-5000\r/);
  assert.doesNotMatch(csv, /'-5000/);
  assert.match(csv, /'@SUM\(A1\)/);
  assert.match(csv, /'-teks/);
});

test('JSON rusak dijawab 400, bukan 500', async () => {
  const r = await fetch(`${api.base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{rusak',
  });
  assert.equal(r.status, 400);
});

test('jawaban API tidak boleh disimpan cache', async () => {
  const r = await fetch(`${api.base}/api/me`, { headers: { Authorization: `Bearer ${kasirToken}` } });
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('payload raksasa ditolak, bukan diproses', async () => {
  const banyakBaris = Array.from({ length: 201 }, () => ({
    product_id: fx.productId,
    unit_id: fx.pcsId,
    qty: 1,
  }));
  const besar = await api.req('POST', '/api/sales', {
    token: kasirToken,
    body: saleBody({ items: banyakBaris }),
  });
  assert.equal(besar.status, 422);
  assert.match(besar.body.error, /maksimal 200 baris/i);

  const uuidPanjang = await api.req('POST', '/api/sales', {
    token: kasirToken,
    body: saleBody({ uuid: 'x'.repeat(65) }),
  });
  assert.equal(uuidPanjang.status, 422);
  assert.match(uuidPanjang.body.error, /uuid tidak valid/);
});

test('login tidak peka huruf besar/kecil pada username', async () => {
  const buat = await api.req('POST', '/api/users', {
    token: superToken,
    body: { name: 'Kasir Campur', username: 'kasirCampur', password: 'RahasiaToko123', role: 'kasir' },
  });
  assert.equal(buat.status, 201);

  for (const u of ['kasirCampur', 'kasircampur', 'KASIRCAMPUR', '  kasirCampur  ']) {
    const r = await api.req('POST', '/api/login', { body: { username: u, password: 'RahasiaToko123' } });
    assert.equal(r.status, 200, `username "${u}" harus bisa masuk`);
  }
  // Password tetap peka huruf besar/kecil.
  assert.equal(
    (await api.req('POST', '/api/login', { body: { username: 'kasircampur', password: 'rahasiatoko123' } })).status,
    401,
  );
});

test('username yang hanya beda besar/kecil ditolak sebagai duplikat', async () => {
  const r = await api.req('POST', '/api/users', {
    token: superToken,
    body: { name: 'Kasir Kembar', username: 'KASIRCAMPUR', password: 'RahasiaLain123', role: 'kasir' },
  });
  assert.equal(r.status, 422);
  assert.match(r.body.error, /Username sudah dipakai/);
});
