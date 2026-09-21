/**
 * Audit sentuh & keterbacaan: memastikan setiap kontrol yang bisa disentuh minimal
 * 44×44px dan tidak ada teks yang lebih kecil dari 16px.
 *
 * Jalankan: node scripts/verify-tap.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { bukaDanTunggu, masuk, pasangPenjagaOverlay } from './verifikasi-util.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const KELUARAN = path.resolve('verifikasi');
fs.mkdirSync(KELUARAN, { recursive: true });

const LEBAR = [360, 390, 768, 1024];
const HALAMAN = [
  '/kasir',
  '/riwayat',
  '/stok',
  '/stok/scan',
  '/retur',
  '/hutang-piutang',
  '/pembelian',
  '/keuangan',
  '/produk',
  '/kategori',
  '/satuan',
  '/laporan',
  '/pengaturan',
  '/users',
  '/login',
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
await pasangPenjagaOverlay(page);

await masuk(page, BASE, 'superadmin', 'password');

const audit = () =>
  page.evaluate(() => {
    const kecil = [];
    const teksKecil = [];
    // Penjaga: aplikasi harus benar-benar merender, kalau tidak hasil audit kosong palsu.
    const dirender = document.styleSheets.length > 0 && (document.getElementById('root')?.childElementCount ?? 0) > 0;
    if (!dirender) return { dirender, kecil, teksKecil };
    const pilih = 'button, a[href], select, input, textarea, [role="button"], [role="tab"]';
    for (const el of document.querySelectorAll(pilih)) {
      const r = el.getBoundingClientRect();
      const gaya = getComputedStyle(el);
      if (gaya.display === 'none' || gaya.visibility === 'hidden') continue;
      if (r.width === 0 && r.height === 0) continue;
      if (el.closest('.struk') || el.closest('[aria-hidden="true"]')) continue;
      if (r.height < 44 || r.width < 44) {
        kecil.push({
          tag: el.tagName.toLowerCase(),
          tipe: el.getAttribute('type') ?? '',
          teks: (el.textContent ?? '').trim().slice(0, 40) || el.getAttribute('placeholder') || el.getAttribute('aria-label') || '',
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
    // Teks yang benar-benar terlihat (punya text node sendiri).
    for (const el of document.querySelectorAll('body *')) {
      const punyaTeks = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
      if (!punyaTeks) continue;
      if (el.closest('.struk')) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px < 16) {
        teksKecil.push({ tag: el.tagName.toLowerCase(), px, teks: el.textContent.trim().slice(0, 45) });
      }
    }
    return { kecil, teksKecil };
  });

const hasil = [];
for (const rute of HALAMAN) {
  for (const w of LEBAR) {
    await page.setViewportSize({ width: w, height: w < 500 ? 844 : 1024 });
    await bukaDanTunggu(page, `${BASE}${rute}`, { percobaan: 4, jedaMs: 1500 });
    const a = await audit();
    hasil.push({ rute, lebar: w, ...a });
  }
}

console.log('=== TARGET SENTUH < 44px ===');
let totalKecil = 0;
let totalTeks = 0;
let takDirender = 0;
for (const h of hasil) {
  // Audit yang berhasil render TIDAK membawa kunci `dirender` (hanya kasus gagal yang
  // membawanya, bernilai false), jadi pemeriksaannya harus `=== false` — bukan truthiness,
  // yang akan menganggap semua halaman gagal render dan membuat ringkasan selalu 0.
  if (h.dirender === false) {
    takDirender++;
    console.log(`\nTIDAK DIRENDER ${h.rute} @ ${h.lebar}px — hasil diabaikan`);
    continue;
  }
  totalKecil += h.kecil.length;
  totalTeks += h.teksKecil.length;
  if (!h.kecil.length && !h.teksKecil.length) continue;
  console.log(`\n${h.rute} @ ${h.lebar}px`);
  for (const k of h.kecil) console.log(`  kecil ${k.tag}${k.tipe ? `[${k.tipe}]` : ''} ${k.w}x${k.h} "${k.teks}"`);
  for (const t of h.teksKecil) console.log(`  teks ${t.px}px <${t.tag}> "${t.teks}"`);
}
console.log(`\nTotal target <44px: ${totalKecil}   Total teks <16px: ${totalTeks}   Tidak dirender: ${takDirender}`);

fs.writeFileSync(path.join(KELUARAN, 'hasil-sentuh.json'), JSON.stringify(hasil, null, 2));
await browser.close();
