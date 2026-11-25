/**
 * Pembatas percobaan login: brute force harus berhenti di sini, bukan di bcrypt.
 * Jalankan: node --test tests/login-limit.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, seedMaster, createUser, startServer, closePool } from './helper.js';
import { bersihkanCatatanLogin } from '../src/rateLimit.js';

const login = (api, username, password, ip) =>
  fetch(`${api.base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ip ? { 'X-Forwarded-For': ip } : {}) },
    body: JSON.stringify({ username, password }),
  });

test('login', async (t) => {
  await resetDb();
  await seedMaster();
  await createUser({ name: 'Super Admin', username: 'superadmin', role: 'superadmin' });
  await createUser({ name: 'Kasir', username: 'kasir1', role: 'kasir' });
  const api = await startServer();
  t.after(async () => {
    await api.close();
    await closePool();
  });

  await t.test('percobaan gagal berulang memblokir IP, termasuk akun lain', async () => {
    bersihkanCatatanLogin();
    for (let i = 0; i < 10; i++) {
      assert.equal((await login(api, 'superadmin', 'salah')).status, 401);
    }
    const diblokir = await login(api, 'superadmin', 'password');
    assert.equal(diblokir.status, 429);
    assert.match((await diblokir.json()).error, /Terlalu banyak/);
    assert.ok(Number(diblokir.headers.get('retry-after')) > 0);

    // Per IP: akun lain dari alamat yang sama ikut tertahan.
    assert.equal((await login(api, 'kasir1', 'password')).status, 429);
    // Alamat lain tidak ikut tertahan.
    assert.equal((await login(api, 'kasir1', 'password', '203.0.113.9')).status, 200);
  });

  await t.test('login berhasil mengosongkan hitungan', async () => {
    bersihkanCatatanLogin();
    for (let i = 0; i < 9; i++) await login(api, 'superadmin', 'salah');
    assert.equal((await login(api, 'superadmin', 'password')).status, 200);
    // Hitungan kembali nol: sembilan salah ketik berikutnya belum memblokir.
    for (let i = 0; i < 9; i++) await login(api, 'superadmin', 'salah');
    assert.equal((await login(api, 'superadmin', 'password')).status, 200);
  });

  await t.test('satu akun tertahan walau penyerang berganti IP', async () => {
    bersihkanCatatanLogin();
    for (let i = 0; i < 10; i++) {
      assert.equal((await login(api, 'kasir1', 'salah', `198.51.100.${i + 1}`)).status, 401);
    }
    const dariIpBaru = await login(api, 'kasir1', 'password', '198.51.100.200');
    assert.equal(dariIpBaru.status, 429);
    // Akun lain dari IP baru itu tetap boleh mencoba.
    assert.equal((await login(api, 'superadmin', 'password', '198.51.100.200')).status, 200);
  });
});
