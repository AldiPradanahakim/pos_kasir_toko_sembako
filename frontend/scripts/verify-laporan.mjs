/**
 * Verifikasi hub laporan pada build produksi:
 *  - tiap entri memuat data nyata dan menampilkan baris TOTAL;
 *  - dua entri Export benar-benar mengunduh CSV (lewat fetch + Bearer token).
 *
 * Jalankan: node scripts/verify-laporan.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const KELUARAN = path.resolve('verifikasi');
fs.mkdirSync(KELUARAN, { recursive: true });

const SLUG = [
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

const bukti = { base: BASE, laporan: [], ekspor: [] };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[autocomplete="username"]', 'superadmin');
await page.fill('input[type="password"]', 'password');
await page.click('button[type="submit"]');
await page.waitForURL('**/kasir', { timeout: 30000 });
await page.waitForTimeout(2500);

for (const slug of SLUG) {
  await page.goto(`${BASE}/laporan/${slug}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  const info = await page.evaluate(() => {
    const teks = document.querySelector('main')?.innerText ?? '';
    const barisTotal = teks.split('\n').map((s) => s.trim()).filter((s) => /^TOTAL/.test(s));
    return {
      panjangTeks: teks.length,
      adaGalat: /Endpoint tidak ditemukan|Gagal memuat|403|Akses ditolak/i.test(teks),
      cuplikanGalat: (teks.match(/Endpoint tidak ditemukan[^\n]*|Gagal memuat[^\n]*|Akses ditolak[^\n]*/) ?? [])[0] ?? null,
      barisTotal: barisTotal.slice(0, 3),
      jumlahBarisTabel: document.querySelectorAll('tbody tr').length,
      adaKosong: /Tidak ada data pada rentang ini/i.test(teks),
    };
  });
  bukti.laporan.push({ slug, ...info });
  await page.screenshot({ path: path.join(KELUARAN, `laporan-${slug}-1280.png`) });
}

// ---- Ekspor CSV ----
for (const [slug, nama] of [
  ['export-arus-stok', 'laporan-arus-stok.csv'],
  ['export-arus-keuangan', 'laporan-arus-keuangan.csv'],
]) {
  await page.goto(`${BASE}/laporan/${slug}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const unduhan = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: /Unduh|Export|Ekspor/i }).first().click();
  try {
    const d = await unduhan;
    const tujuan = path.join(KELUARAN, d.suggestedFilename() || nama);
    await d.saveAs(tujuan);
    const isi = fs.readFileSync(tujuan, 'utf8');
    bukti.ekspor.push({
      slug,
      namaBerkas: d.suggestedFilename(),
      ukuranByte: isi.length,
      tigaBarisPertama: isi.split('\n').slice(0, 3),
    });
  } catch (e) {
    const teks = await page.locator('main').innerText();
    bukti.ekspor.push({ slug, gagal: e.message.slice(0, 120), teksLayar: teks.slice(0, 400) });
  }
}

await browser.close();
fs.writeFileSync(path.join(KELUARAN, 'bukti-laporan.json'), JSON.stringify(bukti, null, 2));
console.log(JSON.stringify(bukti, null, 2));
