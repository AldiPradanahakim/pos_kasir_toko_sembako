/**
 * Verifikasi kontrol Hapus di /riwayat:
 *  - superadmin melihat "Hapus Permanen" per baris + aksi hapus per rentang tanggal;
 *  - kasir TIDAK melihat keduanya, tetapi tetap melihat "Batalkan Transaksi";
 *  - label Batalkan dan Hapus berbeda jelas (warna + teks).
 *
 * Jalankan: node scripts/verify-riwayat-hapus.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { bukaDanTunggu, masuk, pasangPenjagaOverlay } from './verifikasi-util.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const KELUARAN = path.resolve('verifikasi');
fs.mkdirSync(KELUARAN, { recursive: true });

const bukti = {};
const browser = await chromium.launch();

for (const [peran, user, sandi] of [
  ['superadmin', 'superadmin', 'password'],
  ['kasir', 'uji.kasir', 'uji12345'],
]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await pasangPenjagaOverlay(page);
  await masuk(page, BASE, user, sandi);

  await bukaDanTunggu(page, `${BASE}/riwayat`);
  // Muat daftar transaksi hari ini supaya baris + tombol aksinya benar-benar ada.
  await page.getByRole('button', { name: /Tampilkan/ }).first().click().catch(() => {});
  await page.waitForTimeout(2500);

  const info = await page.evaluate(() => {
    const teks = document.querySelector('main')?.innerText ?? '';
    const tombol = [...document.querySelectorAll('main button')].map((b) => ({
      teks: (b.textContent ?? '').trim(),
      warna: getComputedStyle(b).backgroundColor,
      tinggi: Math.round(b.getBoundingClientRect().height),
      lebar: Math.round(b.getBoundingClientRect().width),
    }));
    return {
      adaBaris: /INV-|OFF-/.test(teks),
      teksHapusPerBaris: /Hapus Permanen/.test(teks),
      teksHapusRentang: /Hapus Riwayat per Tanggal/.test(teks),
      teksBatalkan: /Batalkan Transaksi/.test(teks),
      tombolHapus: tombol.filter((t) => /Hapus/i.test(t.teks)).slice(0, 4),
      tombolBatalkan: tombol.filter((t) => /Batalkan/i.test(t.teks)).slice(0, 2),
    };
  });
  bukti[peran] = info;
  await page.screenshot({ path: path.join(KELUARAN, `riwayat-${peran}-hapus-390.png`) });
  await ctx.close();
}

await browser.close();
fs.writeFileSync(path.join(KELUARAN, 'bukti-riwayat-hapus.json'), JSON.stringify(bukti, null, 2));
console.log(JSON.stringify(bukti, null, 2));
