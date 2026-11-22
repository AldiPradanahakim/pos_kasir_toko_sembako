/**
 * Verifikasi perbaikan sesi.
 * Jalankan: node scripts/verify-sesi.mjs
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pg = await import(pathToFileURL(path.resolve(here, '../../backend/node_modules/pg/lib/index.js')).href);
const { Client } = pg.default ?? pg;
const DATABASE_URL = /^DATABASE_URL=(.+)$/m.exec(
  fs.readFileSync(path.resolve(here, '../../backend/.env'), 'utf8'),
)[1].trim();

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const browser = await chromium.launch();
const hasil = {};

const loginApi = async (ctx) => {
  const r = await ctx.request.post(`${BASE}/api/login`, {
    data: { username: 'superadmin', password: 'password' },
  });
  return (await r.json()).token;
};

// 1. Token palsu/kedaluwarsa: tidak boleh membuka aplikasi.
{
  const c = await browser.newContext();
  const p = await c.newPage();
  await c.addInitScript(() => {
    localStorage.setItem('th_token', 'token-palsu-123');
    localStorage.setItem('th_user', JSON.stringify({ id: 1, name: 'Super Admin', username: 'superadmin', role: 'superadmin' }));
  });
  await p.goto(`${BASE}/kasir`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(3000);
  hasil.tokenPalsu = {
    urlAkhir: p.url(),
    tokenTersisa: await p.evaluate(() => localStorage.getItem('th_token')),
    adaFormLogin: await p.locator('input[type="password"]').count(),
  };
  await c.close();
}

// 2. Token dicabut server (mis. habis reset data): tidak boleh membuka aplikasi.
{
  const c = await browser.newContext();
  const token = await loginApi(c);
  await c.addInitScript((t) => localStorage.setItem('th_token', t), token);
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  await db.query('DELETE FROM tokens WHERE token_hash = $1', [
    createHash('sha256').update(token).digest('hex'),
  ]);
  await db.end();
  const p = await c.newPage();
  await p.goto(`${BASE}/kasir`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(3000);
  hasil.tokenDicabut = { urlAkhir: p.url(), adaFormLogin: await p.locator('input[type="password"]').count() };
  await c.close();
}

// 3. Password salah: pesan server yang tampil, bukan "Sesi berakhir".
{
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[autocomplete="username"]', 'superadmin');
  await p.fill('input[type="password"]', 'password-salah');
  await p.click('button[type="submit"]');
  await p.waitForTimeout(2500);
  hasil.passwordSalah = {
    urlAkhir: p.url(),
    pesan: (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim().slice(0, 120),
  };
  await c.close();
}

// 4a. Perangkat tanpa jaringan (benar-benar offline) dengan token tersimpan: kasir harus tetap
//     bisa masuk, karena login mustahil tanpa jaringan.
{
  const c = await browser.newContext();
  const token = await loginApi(c);
  // Perangkat offline disimulasikan lewat navigator.onLine (setOffline memblokir juga server
  // dev-nya, sehingga aplikasinya sendiri tidak bisa dimuat).
  await c.addInitScript((t) => {
    localStorage.setItem('th_token', t);
    localStorage.setItem('th_user', JSON.stringify({ id: 1, name: 'Super Admin', username: 'superadmin', role: 'superadmin' }));
    Object.defineProperty(navigator, 'onLine', { get: () => false });
  }, token);
  await c.route('**/api/**', (r) => r.abort());
  const p = await c.newPage();
  await p.goto(`${BASE}/kasir`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  hasil.perangkatOffline = {
    urlAkhir: p.url(),
    teksAwal: (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim().slice(0, 60),
  };
  await c.close();
}

// 4b. Perangkat punya jaringan tapi server tidak menjawab: tetap wajib login, jangan memakai
//     sesi lama hanya karena server mati.
{
  const c = await browser.newContext();
  const token = await loginApi(c);
  await c.addInitScript((t) => {
    localStorage.setItem('th_token', t);
    localStorage.setItem('th_user', JSON.stringify({ id: 1, name: 'Super Admin', username: 'superadmin', role: 'superadmin' }));
  }, token);
  await c.route('**/api/**', (r) => r.abort());
  const p = await c.newPage();
  await p.goto(`${BASE}/kasir`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  hasil.serverMatiPerangkatOnline = { urlAkhir: p.url(), adaFormLogin: await p.locator('input[type="password"]').count() };
  await c.close();
}

// 4c. Muat ulang di sesi yang sudah dibuka saat server tidak menjawab: kasir tidak dikunci.
{
  const c = await browser.newContext();
  const token = await loginApi(c);
  await c.addInitScript((t) => {
    localStorage.setItem('th_token', t);
    sessionStorage.setItem('th_terbuka', '1');
  }, token);
  await c.route('**/api/**', (r) => r.abort());
  const p = await c.newPage();
  await p.goto(`${BASE}/kasir`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  hasil.sudahDibukaServerMati = { urlAkhir: p.url() };
  await c.close();
}

// 5. Alur normal: login -> masuk -> muat ulang tetap masuk -> tab baru wajib login -> keluar.
{
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await c.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[autocomplete="username"]', 'superadmin');
  await p.fill('input[type="password"]', 'password');
  await p.click('button[type="submit"]');
  await p.waitForURL('**/kasir', { timeout: 20000 });
  const setelahLogin = p.url();
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  const setelahMuatUlang = p.url();
  const tabBaru = await c.newPage();
  await tabBaru.goto(`${BASE}/kasir`, { waitUntil: 'networkidle' });
  await tabBaru.waitForTimeout(2500);
  const tabBaruUrl = tabBaru.url();
  await tabBaru.close();
  await p.getByRole('button', { name: 'Buka menu' }).click();
  await p.getByRole('button', { name: 'Keluar' }).click();
  await p.waitForTimeout(2500);
  hasil.alurNormal = {
    setelahLogin,
    setelahMuatUlang,
    tabBaruUrl,
    setelahKeluar: p.url(),
    tokenTersisa: await p.evaluate(() => localStorage.getItem('th_token')),
    penandaTersisa: await p.evaluate(() => sessionStorage.getItem('th_terbuka')),
  };
  await c.close();
}

// 6. Token sah tanpa penanda "sudah dibuka" (aplikasi baru dibuka): wajib login.
{
  const c = await browser.newContext();
  const token = await loginApi(c);
  await c.addInitScript((t) => localStorage.setItem('th_token', t), token);
  const p = await c.newPage();
  await p.goto(`${BASE}/kasir`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(3000);
  hasil.tokenSahTanpaPenanda = {
    urlAkhir: p.url(),
    tokenTersisa: await p.evaluate(() => localStorage.getItem('th_token')),
    adaFormLogin: await p.locator('input[type="password"]').count(),
  };
  await c.close();
}

// 7. Token sah dengan penanda "sudah dibuka" (muat ulang dalam sesi yang sama): langsung masuk.
{
  const c = await browser.newContext();
  const token = await loginApi(c);
  await c.addInitScript((t) => {
    localStorage.setItem('th_token', t);
    sessionStorage.setItem('th_terbuka', '1');
  }, token);
  const p = await c.newPage();
  await p.goto(`${BASE}/kasir`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(3000);
  hasil.tokenSahDenganPenanda = { urlAkhir: p.url() };
  await c.close();
}

console.log(JSON.stringify(hasil, null, 2));
await browser.close();
