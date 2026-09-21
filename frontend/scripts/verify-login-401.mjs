/**
 * Verifikasi perbaikan 401 di halaman login: sebelum masuk, aplikasi TIDAK boleh
 * memanggil /api sama sekali.
 *
 * Jalankan: node scripts/verify-login-401.mjs
 */
import { chromium } from 'playwright';
import { bukaDanTunggu, pasangPenjagaOverlay } from './verifikasi-util.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await pasangPenjagaOverlay(page);

const panggilan = [];
const galat = [];
page.on('response', (r) => {
  if (new URL(r.url()).pathname.startsWith('/api')) panggilan.push({ url: new URL(r.url()).pathname, status: r.status() });
});
page.on('console', (m) => {
  if (m.type() === 'error') galat.push(m.text().slice(0, 160));
});

await bukaDanTunggu(page, `${BASE}/login`);
await page.waitForTimeout(6000);

const api401 = panggilan.filter((p) => p.status === 401);
console.log(JSON.stringify({ panggilanSebelumMasuk: panggilan, ada401: api401, galatKonsol: galat }, null, 2));

// Lanjut masuk untuk memastikan alur normal tetap jalan.
await page.fill('input[autocomplete="username"]', 'superadmin');
await page.fill('input[type="password"]', 'password');
await page.click('button[type="submit"]');
await page.waitForURL('**/kasir', { timeout: 25000 });
await page.waitForTimeout(3000);
const setelahMasuk = panggilan.filter((p) => p.status === 401);
console.log(JSON.stringify({ panggilanSetelahMasuk: panggilan.slice(-8), ada401SetelahMasuk: setelahMasuk }, null, 2));

await browser.close();
