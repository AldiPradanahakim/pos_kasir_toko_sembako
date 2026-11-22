/**
 * Cek pemetaan baris nota (OCR) menjadi barang jual di keranjang.
 * Jalankan: node scripts/check-nota-kasir.mjs
 *
 * Yang diuji hanya keputusan yang tidak kelihatan di layar sebelum kasir mengetuk:
 * satuan mana yang terpilih, baris mana yang mulai tidak dicentang, dan kapan
 * peringatan satuan muncul.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.env.NOTA_KASIR_SUB) {
  const ulang = spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(import.meta.url)], {
    stdio: 'inherit',
    env: { ...process.env, NOTA_KASIR_SUB: '1' },
  });
  process.exit(ulang.status ?? 1);
}

const { susunBarisNota, pilihSatuan, daftarSatuan } = await import('../src/lib/notaKasir.ts');
const { parseStruk } = await import('../src/lib/ocrParse.ts');

const unit = (unit_id, unit_name, isi, harga_jual) => ({ unit_id, unit_name, isi, harga_jual, harga_modal: 0, barcode: null });

const produk = [
  {
    id: 1,
    name: 'Beng Beng',
    units: [unit(1, 'pcs', 1, 1500), unit(2, 'renceng', 10, 14000), unit(3, 'dus', 60, 80000)],
  },
  { id: 2, name: 'Gudang Garam International', units: [unit(1, 'pcs', 1, 30000), unit(4, 'slop', 10, 287000)] },
  { id: 3, name: 'Indomie Goreng', units: [unit(1, 'pcs', 1, 3200), unit(5, 'dus', 40, 120000)] },
];

// Satuan terkecil dipakai kalau nota tidak menyebut satuan (sama dengan default kasir).
assert.equal(pilihSatuan(produk[1].units, null).unit?.unit_name, 'pcs');

// Ejaan pembeli dipetakan ke nama satuan di master.
assert.equal(pilihSatuan(produk[0].units, 'renteng').unit?.unit_name, 'renceng');
assert.equal(pilihSatuan(produk[0].units, 'RENTENGAN').cocok, true);
assert.equal(pilihSatuan(produk[0].units, 'pak').cocok, false, 'pak tidak ada di produk ini');
assert.equal(pilihSatuan(produk[0].units, 'pak').unit?.unit_name, 'pcs', 'jatuh ke satuan terkecil');

// Daftar satuan membawa inisial dari master; satuan yang hanya ada di produk ikut,
// dengan inisial kosong.
const satuan = daftarSatuan(produk, [
  { name: 'pcs', inisial: 'pc' },
  { name: 'pack', inisial: 'p' },
  { name: 'renceng', inisial: 'r' },
  { name: 'dus', inisial: 'd' },
]);
assert.deepEqual(
  satuan.map((s) => `${s.name}:${s.inisial ?? ''}`).sort(),
  // `slop` hanya terpasang di produk dan tidak ada di master: tetap dikenal namanya,
  // tanpa inisial — jadi "sl" tidak ditebak.
  ['dus:d', 'pack:p', 'pcs:pc', 'renceng:r', 'slop:'],
);

const teks = [
  'DAFTAR BELANJA',
  '2 renteng beng beng',
  'Gudang Garam International 1 slop',
  'Indomie Goreng 3 pak',
  'Sabun Wangi',
].join('\n');

const { baris } = susunBarisNota(parseStruk(teks, { tanpaHarga: true, satuan }), produk);

assert.deepEqual(
  baris.map((b) => [b.nama, b.productId, b.unitId, b.qty, b.pilih]),
  [
    ['beng beng', 1, 2, 2, true],
    ['Gudang Garam International', 2, 4, 1, true],
    // "pak" bukan satuan produk ini: tetap dicentang dengan satuan terkecil + peringatan.
    ['Indomie Goreng', 3, 1, 3, true],
    // Tidak dikenali: tampil, tidak dicentang, kasir yang memilih.
    ['Sabun Wangi', null, null, 1, false],
  ],
);
assert.match(baris[2].catatan ?? "", /Satuan "pack"/);
assert.match(baris[3].catatan ?? '', /belum dikenali/);
assert.equal(baris[3].pilih, false);

// Nota yang ditulis dengan inisial: "2 (r) Beng Beng" dan "1 P Indomie Goreng".
const notaInisial = susunBarisNota(
  parseStruk('2 (r) beng beng\n3 P Indomie Goreng\n1 d Beng Beng', { tanpaHarga: true, satuan }),
  produk,
).baris;
assert.deepEqual(
  notaInisial.map((b) => [b.nama, b.productId, b.unitId, b.qty]),
  [
    // (r) -> renceng (unit 2), qty 2.
    ['beng beng', 1, 2, 2],
    // P -> pack, tapi Beng Beng/Indomie tidak punya satuan pack: tetap jatuh ke pcs + peringatan.
    ['Indomie Goreng', 3, 1, 3],
    // d -> dus (unit 3).
    ['Beng Beng', 1, 3, 1],
  ],
);
assert.match(notaInisial[1].catatan ?? '', /Satuan "pack"/);

// Alias hasil koreksi kasir tetap menang atas kemiripan nama.
const denganAlias = susunBarisNota(
  parseStruk('SABUN MANDI WARNA', { tanpaHarga: true, satuan }),
  produk,
  [{ alias: 'SABUN MANDI WARNA', product_id: 3 }],
).baris;
assert.equal(denganAlias[0].productId, 3);
assert.equal(denganAlias[0].pilih, true);

// Kunci baris tidak bertabrakan antar pemindaian (dipakai sebagai key React).
const pertama = susunBarisNota(parseStruk('teh gelas', { tanpaHarga: true }), produk);
const kedua = susunBarisNota(parseStruk('teh gelas', { tanpaHarga: true }), produk, [], pertama.kunciBerikut);
assert.equal(kedua.baris[0].kunci, pertama.baris[0].kunci + 1);

console.log(`OK — ${baris.length} baris nota dipetakan; semua assert lulus.`);
