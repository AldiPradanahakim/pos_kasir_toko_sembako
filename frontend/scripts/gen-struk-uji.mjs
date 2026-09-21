/**
 * Membuat gambar struk supplier untuk menguji alur OCR sungguhan.
 * Memakai Chromium (Playwright) supaya font dan tata letaknya realistis,
 * lalu sengaja diturunkan kontrasnya supaya mirip foto struk dari HP.
 *
 * Jalankan: node scripts/gen-struk-uji.mjs
 * Hasil: verifikasi/struk-uji.png dan verifikasi/struk-uji-terang.png
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const KELUARAN = path.resolve('verifikasi');
fs.mkdirSync(KELUARAN, { recursive: true });

const BARIS = [
  ['2 x 40.000', 'MIE SEDAAP SOTO', '80.000'],
  ['1 x 12.500', 'TEH GELAS 200ML', '12.500'],
  ['3 x 8.000', 'KOPI KAPAL API', '24.000'],
  ['5 x 6.500', 'SARDEN ABC 155G', '32.500'],
  ['4 x 9.000', 'MINYAK GORENG 1L', '36.000'],
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #f3f0e8; font-family: 'Courier New', monospace; }
  .kertas {
    width: 720px; padding: 28px 30px; background: #fbf8ee; color: #1b1b1b;
    font-size: 22px; line-height: 1.5;
  }
  .tengah { text-align: center; }
  .tebal { font-weight: bold; }
  .baris { display: flex; justify-content: space-between; gap: 12px; }
  .garis { border-top: 2px dashed #444; margin: 10px 0; }
  .nama { flex: 1; }
  .qty { width: 190px; }
  .harga { width: 130px; text-align: right; }
</style></head>
<body>
  <div class="kertas">
    <div class="tengah tebal">WINGSFODD INDONESIA</div>
    <div class="tengah">JL RAYA WARU NO 12 SURABAYA</div>
    <div class="tengah">Telp 031-88889999</div>
    <div class="garis"></div>
    <div class="tengah tebal">NOTA PEMBELIAN</div>
    <div class="baris"><span>No. INV-2026-0912</span><span>19/09/2026</span></div>
    <div class="garis"></div>
    <div class="baris tebal">
      <span class="qty">Qty x Harga</span><span class="nama">Nama Barang</span><span class="harga">Jumlah</span>
    </div>
    <div class="garis"></div>
${BARIS.map(
  ([qty, nama, jumlah]) =>
    `    <div class="baris"><span class="qty">${qty}</span><span class="nama">${nama}</span><span class="harga">${jumlah}</span></div>`,
).join('\n')}
    <div class="garis"></div>
    <div class="baris tebal"><span class="nama">Total</span><span class="harga">185.000</span></div>
    <div class="baris"><span class="nama">Tunai</span><span class="harga">200.000</span></div>
    <div class="baris"><span class="nama">Kembali</span><span class="harga">15.000</span></div>
    <div class="garis"></div>
    <div class="tengah">Terima kasih atas pembelian Anda</div>
    <div class="tengah">Barang yang sudah dibeli tidak dapat ditukar</div>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 900 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.waitForTimeout(300);

const kertas = page.locator('.kertas');
await kertas.screenshot({ path: path.join(KELUARAN, 'struk-uji-terang.png') });

// Versi "foto HP": kontras rendah, sedikit kabur, sedikit miring.
await page.addStyleTag({
  content: `.kertas { filter: contrast(0.62) brightness(1.06) blur(0.6px); transform: rotate(-0.8deg); }`,
});
await page.waitForTimeout(300);
await kertas.screenshot({ path: path.join(KELUARAN, 'struk-uji.png') });

await browser.close();
console.log(`Gambar uji dibuat di ${KELUARAN}: struk-uji.png (kontras rendah) + struk-uji-terang.png`);
