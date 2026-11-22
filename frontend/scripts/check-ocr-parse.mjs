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

const { parseStruk, tebakProduk, bacaAngka, pisahkanSatuan, normalSatuan } = await import('../src/lib/ocrParse.ts');

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

// ---- Nota daftar belanja pelanggan: tanpa harga, satuan ditulis di nama ----
// Perilaku bawaan (nota supplier) tidak boleh berubah: baris tanpa harga tetap dibuang.
assert.equal(baris('GULA PASIR').length, 0, 'tanpa opsi tanpaHarga, baris tanpa harga dilewati');

// Bentuk yang dipakai aplikasi: nama + inisial dari master Satuan.
const satuan = [
  { name: 'pcs', inisial: 'pc' },
  { name: 'renceng', inisial: 'r' },
  { name: 'pack', inisial: 'p' },
  { name: 'dus', inisial: 'd' },
  { name: 'slop', inisial: 'sl' },
  { name: 'kg', inisial: 'kg' },
  { name: 'bal', inisial: 'b' },
];
const nota = (t) => parseStruk(t, { tanpaHarga: true, satuan });

const daftarBelanja = [
  'DAFTAR BELANJA',
  'GULA PASIR 2 kg',
  'MINYAK GORENG 1 dus',
  'GUDANG GARAM INTERNATIONAL 12 2 slop',
  'TEH GELAS 3 bungkus',
  'Indomie Goreng',
  'total 5 barang',
].join('\n');

assert.deepEqual(
  nota(daftarBelanja).map((b) => [b.nama, b.qty, b.satuan, b.harga]),
  [
    ['GULA PASIR', 2, 'kg', 0],
    ['MINYAK GORENG', 1, 'dus', 0],
    // Nama barang selalu kehilangan angkanya (perilaku lama pengurai); yang dipakai
    // sebagai qty hanya angka TERDEKAT sebelum kata satuan, jadi 12 tidak ikut terbaca.
    ['GUDANG GARAM INTERNATIONAL', 2, 'slop', 0],
    // Ejaan pembeli "bungkus" dikenali sebagai satuan "pack".
    ['TEH GELAS', 3, 'pack', 0],
    ['Indomie Goreng', 1, null, 0],
  ],
  'daftar belanja: nama, qty, satuan, tanpa harga',
);

// Satuan dipecah dari nama, dan hanya kata satuan yang dikenal yang diambil.
assert.deepEqual(pisahkanSatuan('GUDANG GARAM RENTENG', satuan), {
  nama: 'GUDANG GARAM',
  satuan: 'renceng',
  kata: 'RENTENG',
});
assert.deepEqual(pisahkanSatuan('ROKOK 12 SLOP', satuan), { nama: 'ROKOK 12', satuan: 'slop', kata: 'SLOP' });
assert.deepEqual(pisahkanSatuan('GULA PASIR', satuan), { nama: 'GULA PASIR', satuan: null, kata: null });

// Inisial: singkatan yang ditulis kasir/pelanggan di nota.
assert.deepEqual(pisahkanSatuan('BENG BENG R', satuan), { nama: 'BENG BENG', satuan: 'renceng', kata: 'R' });
assert.deepEqual(pisahkanSatuan('INDOMIE P', satuan), { nama: 'INDOMIE', satuan: 'pack', kata: 'P' });
assert.deepEqual(pisahkanSatuan('AQUA D', satuan), { nama: 'AQUA', satuan: 'dus', kata: 'D' });
// Nama lengkap menang atas inisial, dan satuan majemuk tidak ikut ditebak dari nama.
assert.deepEqual(pisahkanSatuan('GULA PASIR KG', satuan), { nama: 'GULA PASIR', satuan: 'kg', kata: 'KG' });
assert.equal(pisahkanSatuan('ROTI BAKAR', satuan).satuan, null, 'kata yang bukan inisial tidak dianggap satuan');

// Kotoran OCR di dalam kurung tidak boleh jadi qty: "(4d)" terbaca dari "(d)".
assert.deepEqual(
  nota('2 (4d) ALE-ALE 350ML').map((b) => [b.nama, b.qty, b.satuan]),
  [['ALE ALE ML', 2, 'dus']],
  'angka nyasar di dalam kurung bukan qty',
);

// Inisial di nota lengkap: tanda kurung, qty, dan nama barang.
assert.deepEqual(
  nota('2 (r) BENG BENG').map((b) => [b.nama, b.qty, b.satuan]),
  [['BENG BENG', 2, 'renceng']],
);
assert.deepEqual(
  nota('3 P INDOMIE GORENG').map((b) => [b.nama, b.qty, b.satuan]),
  [['INDOMIE GORENG', 3, 'pack']],
);
assert.deepEqual(
  nota('1 D AQUA 600ML').map((b) => [b.nama, b.qty, b.satuan]),
  [['AQUA ML', 1, 'dus']],
);
assert.equal(normalSatuan('Bungkus'), 'pack');
assert.equal(normalSatuan('renteng'), 'renceng');

// Baris yang bukan barang di nota: alamat dan telepon tidak boleh jadi barang.
for (const t of ['JL RAYA WARU NO 12 SURABAYA', 'Telp 031-88889999', 'Alamat: Jl. Merdeka 5', 'WA 0812 3456 7890']) {
  assert.equal(nota(t).length, 0, `harus dilewati di nota: ${t}`);
}

// Nota yang mencantumkan harga: qty tetap diambil dari kata satuan, bukan dari harga.
assert.deepEqual(
  nota('2 dus MIE SEDAAP SOTO 128.000').map((b) => [b.nama, b.qty, b.satuan]),
  [['MIE SEDAAP SOTO', 2, 'dus']],
);
assert.deepEqual(
  nota('3 slop GUDANG GARAM SURYA 12 915.000').map((b) => [b.nama, b.qty, b.satuan]),
  [['GUDANG GARAM SURYA', 3, 'slop']],
);

console.log(
  `OK — ${hasil.length} baris dari struk contoh, ${hasilUji.length} baris dari struk uji, ` +
    `${nota(daftarBelanja).length} baris dari daftar belanja; semua assert lulus.`,
);
