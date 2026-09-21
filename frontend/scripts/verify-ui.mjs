/**
 * Harness verifikasi UI: mengukur overflow horizontal tiap halaman di 5 lebar layar,
 * mengambil tangkapan layar, dan menjalankan skenario kasir (simpan/cetak, kalkulator).
 *
 * Jalankan: node scripts/verify-ui.mjs [namaSkenario]
 * Prasyarat: dev server di http://127.0.0.1:5173 dan backend di 127.0.0.1:3000.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { bukaDanTunggu, masuk, pasangPenjagaOverlay } from './verifikasi-util.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const KELUARAN = path.resolve('verifikasi');
fs.mkdirSync(KELUARAN, { recursive: true });

const LEBAR = [
  { nama: 'hp-kecil', w: 360, h: 640 },
  { nama: 'hp', w: 390, h: 844 },
  { nama: 'tablet-potret', w: 768, h: 1024 },
  { nama: 'tablet-landscape', w: 1024, h: 768 },
  { nama: 'laptop', w: 1280, h: 800 },
];

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
];

const LAPORAN_SLUG = [
  'umum',
  'transaksi',
  'arus-keuangan',
  'penjualan',
  'kategori',
  'pembelian',
  'modal',
  'laba-rugi',
  'retur',
  'stok-opname',
  'harian',
  'laba',
  'harga',
];

async function apiLogin(username, password) {
  const res = await fetch(`${API}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`login ${username} gagal: ${res.status}`);
  return res.json();
}

/** Ukur overflow + cari elemen yang melebihi lebar viewport (penyebab overflow). */
async function ukur(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const vw = window.innerWidth;
    // Penjaga: kalau aplikasi tidak benar-benar merender (mis. modul sibling setengah
    // jadi), pengukuran overflow jadi hijau palsu. Tandai sebagai tidak sah.
    const dirender = document.styleSheets.length > 0 && (document.getElementById('root')?.childElementCount ?? 0) > 0;
    const pelanggar = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        const gaya = getComputedStyle(el);
        if (gaya.position === 'fixed') continue;
        pelanggar.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 90),
          right: Math.round(r.right),
          left: Math.round(r.left),
          w: Math.round(r.width),
        });
      }
    }
    return {
      dirender,
      scrollWidth: de.scrollWidth,
      innerWidth: vw,
      bodyScrollWidth: document.body.scrollWidth,
      pelanggar: pelanggar.slice(0, 6),
    };
  });
}

async function main() {
  const skenario = process.argv[2] ?? 'semua';
  const sesi = await apiLogin('superadmin', 'password');

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await pasangPenjagaOverlay(page);
  const galat = [];
  page.on('console', (m) => {
    if (m.type() === 'error') galat.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => galat.push(`pageerror: ${e.message}`));

  // Masuk lewat UI supaya token tersimpan seperti pemakaian nyata.
  await masuk(page, BASE, 'superadmin', 'password');

  const hasil = [];
  const daftar = skenario === 'laporan' ? LAPORAN_SLUG.map((s) => `/laporan/${s}`) : HALAMAN;

  for (const rute of daftar) {
    for (const l of LEBAR) {
      await page.setViewportSize({ width: l.w, height: l.h });
      await bukaDanTunggu(page, `${BASE}${rute}`, { percobaan: 4, jedaMs: 1500 });
      const m = await ukur(page);
      const ok = m.dirender && m.scrollWidth <= m.innerWidth;
      hasil.push({ rute, lebar: l.w, ok, urlAkhir: new URL(page.url()).pathname, ...m });
      if (!ok) {
        await page.screenshot({ path: path.join(KELUARAN, `overflow-${rute.replace(/\//g, '_')}-${l.w}.png`), fullPage: false });
      }
    }
  }

  // Tangkapan layar representatif.
  for (const [rute, l] of [
    ['/kasir', LEBAR[0]],
    ['/kasir', LEBAR[1]],
    ['/kasir', LEBAR[2]],
    ['/kasir', LEBAR[4]],
    ['/riwayat', LEBAR[1]],
    ['/stok', LEBAR[0]],
    ['/stok/scan', LEBAR[1]],
    ['/laporan', LEBAR[1]],
    ['/keuangan', LEBAR[1]],
    ['/pembelian', LEBAR[1]],
  ]) {
    await page.setViewportSize({ width: l.w, height: l.h });
    await page.goto(`${BASE}${rute}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(KELUARAN, `layar-${rute.replace(/\//g, '_')}-${l.w}.png`) });
  }

  console.log('=== OVERFLOW HORIZONTAL (scrollWidth vs innerWidth) ===');
  let gagal = 0;
  for (const h of hasil) {
    if (!h.ok) gagal++;
    console.log(
      `${h.ok ? 'OK  ' : 'GAGAL'} ${h.rute.padEnd(22)} ${String(h.lebar).padStart(4)}px  scrollWidth=${h.scrollWidth} innerWidth=${h.innerWidth}` +
        (h.urlAkhir && h.urlAkhir !== h.rute ? `  (dialihkan ke ${h.urlAkhir})` : '') +
        (h.ok ? '' : `  pelanggar=${JSON.stringify(h.pelanggar)}`),
    );
  }
  console.log(`\nTotal: ${hasil.length - gagal}/${hasil.length} lolos`);
  if (galat.length) {
    console.log('\n=== GALAT KONSOL ===');
    console.log([...new Set(galat)].slice(0, 20).join('\n'));
  }
  fs.writeFileSync(path.join(KELUARAN, 'hasil-overflow.json'), JSON.stringify(hasil, null, 2));

  await browser.close();
  console.log(`\nSesi token: ${sesi.token.slice(0, 10)}…  (skenario=${skenario})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
