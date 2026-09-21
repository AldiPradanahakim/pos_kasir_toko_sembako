/**
 * Cek cepat pengurai struk OCR.
 * Jalankan: node scripts/check-ocr-parse.mjs
 * (Node 22 masih butuh --experimental-strip-types untuk mengimpor .ts; skrip ini
 * menjalankan ulang dirinya sendiri dengan flag itu supaya perintahnya tetap pendek.)
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.execArgv.some((a) => a.startsWith('--experimental-strip-types'))) {
  const ulang = spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(import.meta.url)], {
    stdio: 'inherit',
  });
  process.exit(ulang.status ?? 1);
}

const { parseStruk, tebakProduk, bacaAngka } = await import('../src/lib/ocrParse.ts');

const baris = (t) => parseStruk(t);

// Pemisah ribuan titik dan koma sama-sama 40000.
assert.equal(bacaAngka('40.000'), 40000);
assert.equal(bacaAngka('40,000'), 40000);
assert.equal(bacaAngka('Rp12.500'), 12500);
assert.equal(bacaAngka('2,5'), 2.5);

// Layout struk supplier: nama barang dan angka ada di baris yang sama.
const struk = [
  'WINGSFODD INDONESIA',
  'NOTA PEMBELIAN',
  '2 x 40.000 MIE SEDAAP SOTO 80.000',
  '1 x 12.500 TEH GELAS 200ML 12.500',
  '3 x 8.000 KOPI KAPAL API 24.000',
  'Total 153.000',
  'Tunai 200.000',
  'Kembali 47.000',
  'Terima kasih',
].join('\n');

const hasil = baris(struk);
assert.equal(hasil.length, 3, 'total/tunai/kembali/terima kasih harus dilewati');
assert.deepEqual(
  hasil.map((b) => [b.nama, b.qty, b.harga, b.subtotal]),
  [
    ['MIE SEDAAP SOTO', 2, 40000, 80000],
    ['TEH GELAS ML', 1, 12500, 12500],
    ['KOPI KAPAL API', 3, 8000, 24000],
  ],
);

// Struk uji sungguhan (verifikasi/struk-uji.png) setelah dibaca OCR: 5 baris,
// termasuk "5x" yang menempel dan header "Oty x Harga" yang harus dilewati.
const teksUji = [
  'WINGSFODD INDONESIA',
  'JL RAYA WARU NO 12 SURABAYA',
  'Telp 031-88889999',
  'NOTA PEMBELIAN',
  'No. INV-2026-0912 19/09/2026',
  'Oty x Harga Nama Barang Jumlah',
  '2 x 40.000 MIE SEDAAP SOTO 80.000',
  '1 x 12.500 TEH GELAS 200ML 12.500',
  '3 x 8.000 KOPI KAPAL API 24.000',
  '5x 6.500 SARDEN ABC 155G 32.500',
  '4 x 9.000 MINYAK GORENG 1L 36.000',
  'Total 185.000',
  'Tunai 200.000',
  'Kembali 15.000',
  'Terima kasih atas pembelian Anda',
  'Barang yang sudah dibeli tidak dapat ditukar',
].join('\n');

const hasilUji = baris(teksUji);
assert.deepEqual(
  hasilUji.map((b) => [b.nama, b.qty, b.harga, b.subtotal]),
  [
    ['MIE SEDAAP SOTO', 2, 40000, 80000],
    ['TEH GELAS ML', 1, 12500, 12500],
    ['KOPI KAPAL API', 3, 8000, 24000],
    ['SARDEN ABC G', 5, 6500, 32500],
    ['MINYAK GORENG L', 4, 9000, 36000],
  ],
  'struk uji harus terbaca 5 baris, tanpa alamat/telepon/total',
);

// Bentuk qty lain yang lazim di struk.
assert.deepEqual(
  baris('MIE INSTAN 2x40.000').map((b) => [b.qty, b.harga]),
  [[2, 40000]],
);
assert.deepEqual(baris('MIE INSTAN 2 X 40.000').map((b) => [b.qty, b.harga]), [[2, 40000]]);
assert.deepEqual(baris('GULA PASIR 40.000 2').map((b) => [b.qty, b.harga]), [[2, 40000]]);
assert.deepEqual(baris('GULA PASIR Rp 40,000').map((b) => [b.qty, b.harga]), [[1, 40000]]);

// Baris yang bukan barang tidak pernah jadi baris stok.
for (const t of ['Subtotal 80.000', 'Grand Total 153.000', 'PPN 11% 15.300', 'Diskon 5.000', 'Kasir: Budi', 'No. 12345', 'Faktur 2024', 'Harga Qty']) {
  assert.equal(baris(t).length, 0, `harus dilewati: ${t}`);
}
assert.equal(baris('WINGSFODD INDONESIA').length, 0, 'baris tanpa angka harus dilewati');
assert.equal(baris('JL RAYA WARU NO 12 SURABAYA').length, 0, 'alamat bernomor kecil bukan barang');
assert.equal(baris('Telp 031-88889999').length, 0, 'telepon bukan barang');

// Pencocokan produk: alias menang, lalu nama persis, lalu kemiripan.
const produk = [
  { id: 1, name: 'Sedaap Soto' },
  { id: 2, name: 'Teh Gelas 200ml' },
  { id: 3, name: 'Kopi Kapal Api' },
];
const alias = [{ alias: 'MIE SEDAAP SOTO', product_id: 1 }];
assert.equal(tebakProduk('MIE SEDAAP SOTO', produk, alias), 1, 'alias harus menang');
assert.equal(tebakProduk('teh gelas 200ml', produk), 2, 'nama persis');
assert.equal(tebakProduk('KOPI KAPAL API', produk), 3, 'kemiripan teks');
assert.equal(tebakProduk('BATERAI ABC', produk), null, 'tidak ada yang mirip → null');
assert.equal(tebakProduk('', produk), null);

console.log(
  `OK — ${hasil.length} baris dari struk contoh, ${hasilUji.length} baris dari struk uji; semua assert lulus.`,
);
