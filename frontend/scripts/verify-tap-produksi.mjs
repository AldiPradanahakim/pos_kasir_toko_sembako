/**
 * Audit target sentuh pada build produksi, memakai networkidle (bukan domcontentloaded)
 * supaya CSS yang dimuat sebagai <link> benar-benar sudah terpasang saat diukur.
 *
 * Jalankan: BASE_URL=http://127.0.0.1:3000 node scripts/verify-tap-produksi.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const LEBAR = [360, 390, 768, 1024];
const HALAMAN = [
  '/kasir', '/riwayat', '/stok', '/stok/scan', '/retur', '/hutang-piutang',
  '/pembelian', '/keuangan', '/produk', '/kategori', '/satuan', '/laporan',
  '/pengaturan', '/users',
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[autocomplete="username"]', 'superadmin');
await page.fill('input[type="password"]', 'password');
await page.click('button[type="submit"]');
await page.waitForURL('**/kasir', { timeout: 30000 });
await page.waitForTimeout(2500);

const audit = () =>
  page.evaluate(() => {
    const kecil = [];
    const pilih = 'button, a[href], select, input, textarea, [role="button"], [role="tab"]';
    for (const el of document.querySelectorAll(pilih)) {
      const r = el.getBoundingClientRect();
      const g = getComputedStyle(el);
      if (g.display === 'none' || g.visibility === 'hidden') continue;
      if (r.width === 0 && r.height === 0) continue;
      if (el.closest('.struk') || el.closest('[aria-hidden="true"]')) continue;
      if (r.height < 44 || r.width < 44) {
        kecil.push({
          tag: el.tagName.toLowerCase(),
          teks: ((el.textContent ?? '').trim() || el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').slice(0, 30),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
    return { sheet: document.styleSheets.length, rootAnak: document.getElementById('root')?.childElementCount ?? 0, kecil };
  });

let totalKecil = 0;
let totalSel = 0;
let takRender = 0;
for (const rute of HALAMAN) {
  for (const w of LEBAR) {
    await page.setViewportSize({ width: w, height: w < 500 ? 844 : 1024 });
    await page.goto(`${BASE}${rute}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const a = await audit();
    totalSel++;
    if (!a.sheet || !a.rootAnak) {
      takRender++;
      console.log(`TIDAK DIRENDER ${rute} @${w} (sheet=${a.sheet}, root=${a.rootAnak})`);
      continue;
    }
    totalKecil += a.kecil.length;
    for (const k of a.kecil.slice(0, 5)) console.log(`KECIL ${rute} @${w}: ${k.tag} ${k.w}x${k.h} "${k.teks}"`);
  }
}

console.log(`\nHalaman diuji: ${totalSel}   tidak dirender: ${takRender}   target <44px: ${totalKecil}`);
await browser.close();
