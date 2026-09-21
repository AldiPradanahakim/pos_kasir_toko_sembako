/**
 * Seed 100 produk grosir nyata untuk Toko Hakim.
 *
 *   npm run seed:produk
 *
 * Sifatnya:
 * - Idempotent: kuncinya NAMA produk. Produk yang namanya sudah ada dilewati, jadi
 *   aman dijalankan berulang (jalankan kedua membuat 0 produk).
 * - Tidak pernah mengubah/menghapus data yang sudah ada — termasuk `Sedaap Soto`,
 *   kategori, dan satuan buatan pengguna. Hanya menambah yang belum ada.
 * - Tidak mengisi stok dan tidak membuat penjualan; stok diisi pengguna sendiri.
 * - Barcode diturunkan dari nama (sha256), jadi stabil di setiap penjalanan dan
 *   tidak berubah walau urutan daftar diubah.
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env'), quiet: true });

/** Kategori yang dibuat bila belum ada. Kategori lain milik pengguna tidak disentuh. */
export const SEED_PRODUCT_CATEGORIES = ['Rokok', 'Minuman', 'Makanan', 'Sembako', 'Perawatan', 'Lain-lain'];

/** Satuan yang dipakai daftar di bawah; dibuat bila belum ada. */
export const SEED_PRODUCT_UNITS = ['pcs', 'renceng', 'pack', 'dus', 'slop', 'karung', 'kg'];

/**
 * Daftar produk: [nama, kategori, base_unit, [[satuan, isi, harga_jual, harga_modal], ...]].
 *
 * Satuan pertama selalu base_unit dengan isi 1 dan harganya adalah harga per base_unit.
 * Satuan lain adalah kemasan grosir (isi = jumlah base_unit di dalamnya) dengan harga
 * yang lebih murah per unitnya, seperti layaknya grosir.
 *
 * Harga grosir Indonesia 2026, integer rupiah.
 */
export const SEED_PRODUCTS = [
  // ---------------------------------------------------------------- Rokok
  // base_unit pcs = 1 bungkus; slop = 10 bungkus.
  ['Gudang Garam Surya 12', 'Rokok', 'pcs', [['pcs', 1, 32000, 30800], ['slop', 10, 305000, 296000]]],
  ['Gudang Garam Merah 12', 'Rokok', 'pcs', [['pcs', 1, 28500, 27400], ['slop', 10, 272000, 264000]]],
  ['Gudang Garam International 12', 'Rokok', 'pcs', [['pcs', 1, 30000, 28900], ['slop', 10, 287000, 278000]]],
  ['Sampoerna A Mild 16', 'Rokok', 'pcs', [['pcs', 1, 33500, 32300], ['slop', 10, 320000, 310000]]],
  ['Sampoerna Hijau 12', 'Rokok', 'pcs', [['pcs', 1, 25500, 24600], ['slop', 10, 244000, 237000]]],
  ['Sampoerna Kretek 12', 'Rokok', 'pcs', [['pcs', 1, 25000, 24100], ['slop', 10, 239000, 232000]]],
  ['Djarum Super 12', 'Rokok', 'pcs', [['pcs', 1, 27500, 26500], ['slop', 10, 263000, 255000]]],
  ['Djarum Black 20', 'Rokok', 'pcs', [['pcs', 1, 35500, 34200], ['slop', 10, 340000, 330000]]],
  ['Djarum 76 12', 'Rokok', 'pcs', [['pcs', 1, 24500, 23600], ['slop', 10, 234000, 227000]]],
  ['Bentoel Biru 12', 'Rokok', 'pcs', [['pcs', 1, 22500, 21700], ['slop', 10, 215000, 208000]]],
  ['Marlboro Merah 20', 'Rokok', 'pcs', [['pcs', 1, 40500, 39000], ['slop', 10, 388000, 376000]]],
  ['Marlboro Gold 20', 'Rokok', 'pcs', [['pcs', 1, 40500, 39000], ['slop', 10, 388000, 376000]]],
  ['Dunhill Fine Cut 16', 'Rokok', 'pcs', [['pcs', 1, 36500, 35200], ['slop', 10, 350000, 339000]]],
  ['Dji Sam Soe 234 12', 'Rokok', 'pcs', [['pcs', 1, 29500, 28400], ['slop', 10, 282000, 273000]]],
  ['LA Lights 16', 'Rokok', 'pcs', [['pcs', 1, 30500, 29400], ['slop', 10, 292000, 283000]]],
  ['Apache Filter 12', 'Rokok', 'pcs', [['pcs', 1, 21500, 20700], ['slop', 10, 205000, 199000]]],

  // -------------------------------------------------------------- Minuman
  ['Teh Botol Sosro 350ml', 'Minuman', 'pcs', [['pcs', 1, 4500, 3900], ['dus', 24, 98000, 90000]]],
  ['Aqua 600ml', 'Minuman', 'pcs', [['pcs', 1, 4000, 3400], ['dus', 24, 88000, 79000]]],
  ['Aqua Galon 19L', 'Minuman', 'pcs', [['pcs', 1, 22000, 19000]]],
  ['Coca Cola 390ml', 'Minuman', 'pcs', [['pcs', 1, 6500, 5600], ['dus', 24, 145000, 133000]]],
  ['Fanta Strawberry 390ml', 'Minuman', 'pcs', [['pcs', 1, 6500, 5600], ['dus', 24, 145000, 133000]]],
  ['Sprite 390ml', 'Minuman', 'pcs', [['pcs', 1, 6500, 5600], ['dus', 24, 145000, 133000]]],
  ['Pocari Sweat 500ml', 'Minuman', 'pcs', [['pcs', 1, 9500, 8400], ['dus', 24, 215000, 199000]]],
  ['Ultra Milk Cokelat 250ml', 'Minuman', 'pcs', [['pcs', 1, 7000, 6200], ['dus', 24, 160000, 147000]]],
  ['Freshtea Botol 350ml', 'Minuman', 'pcs', [['pcs', 1, 4500, 3900], ['dus', 24, 98000, 90000]]],
  ['Floridina Orange 350ml', 'Minuman', 'pcs', [['pcs', 1, 5000, 4300], ['dus', 24, 110000, 101000]]],
  ['Ale-Ale 350ml', 'Minuman', 'pcs', [['pcs', 1, 4000, 3500], ['dus', 24, 88000, 82000]]],
  ['Mizone Isotonik 500ml', 'Minuman', 'pcs', [['pcs', 1, 6500, 5700], ['dus', 24, 145000, 134000]]],
  ['Bear Brand 189ml', 'Minuman', 'pcs', [['pcs', 1, 11500, 10300], ['dus', 24, 265000, 245000]]],
  ['Kapal Api Kopi Bubuk 165g', 'Minuman', 'pcs', [['pcs', 1, 14500, 13000], ['dus', 12, 165000, 153000]]],
  ['Good Day Cappuccino 20g', 'Minuman', 'pcs',
    [['pcs', 1, 2500, 2100], ['renceng', 10, 24000, 21000], ['dus', 120, 280000, 250000]]],
  ['Kapal Api Kopi Sachet 8g', 'Minuman', 'pcs',
    [['pcs', 1, 2000, 1700], ['renceng', 10, 19000, 17000], ['dus', 240, 440000, 400000]]],
  ['Nescafe Classic Sachet 2g', 'Minuman', 'pcs', [['pcs', 1, 2500, 2100], ['renceng', 10, 24000, 21000]]],
  ['Teh Pucuk Harum 350ml', 'Minuman', 'pcs', [['pcs', 1, 4500, 3900], ['dus', 24, 98000, 90000]]],
  ['Teh Gelas 350ml', 'Minuman', 'pcs', [['pcs', 1, 3500, 3000], ['dus', 24, 78000, 71000]]],
  ['Indomilk Susu Kental Manis 545g', 'Minuman', 'pcs', [['pcs', 1, 14500, 13000], ['dus', 24, 340000, 310000]]],

  // -------------------------------------------------------------- Makanan
  ['Indomie Goreng', 'Makanan', 'pcs', [['pcs', 1, 3500, 3050], ['dus', 40, 132000, 120000]]],
  ['Indomie Kuah Ayam Bawang', 'Makanan', 'pcs', [['pcs', 1, 3400, 2950], ['dus', 40, 128000, 116000]]],
  ['Indomie Kari Ayam', 'Makanan', 'pcs', [['pcs', 1, 3400, 2950], ['dus', 40, 128000, 116000]]],
  ['Mie Sedaap Soto', 'Makanan', 'pcs', [['pcs', 1, 3400, 2950], ['dus', 40, 128000, 116000]]],
  ['Mie Sedaap Kari Spesial', 'Makanan', 'pcs', [['pcs', 1, 3400, 2950], ['dus', 40, 128000, 116000]]],
  ['Sarimi Isi 2 Ayam Bawang', 'Makanan', 'pcs', [['pcs', 1, 4200, 3650], ['dus', 40, 158000, 144000]]],
  ['Pop Mie Ayam', 'Makanan', 'pcs', [['pcs', 1, 6500, 5600], ['dus', 24, 148000, 134000]]],
  ['Chitato Sapi Panggang 68g', 'Makanan', 'pcs', [['pcs', 1, 11000, 9500], ['dus', 12, 128000, 113000]]],
  ['Qtela Singkong Original 60g', 'Makanan', 'pcs', [['pcs', 1, 9500, 8200], ['dus', 12, 110000, 97000]]],
  ['Taro Net Seaweed 70g', 'Makanan', 'pcs', [['pcs', 1, 9500, 8200], ['dus', 12, 110000, 97000]]],
  ['Pringles Original 107g', 'Makanan', 'pcs', [['pcs', 1, 26000, 22500], ['dus', 12, 300000, 268000]]],
  ['Oreo Original 133g', 'Makanan', 'pcs', [['pcs', 1, 10500, 9100], ['dus', 12, 122000, 108000]]],
  ['Roma Kelapa 300g', 'Makanan', 'pcs', [['pcs', 1, 12500, 10900], ['dus', 12, 145000, 129000]]],
  ['Biskuat Original 150g', 'Makanan', 'pcs', [['pcs', 1, 11500, 10000], ['dus', 12, 134000, 119000]]],
  ['Khong Guan Assorted 550g', 'Makanan', 'pcs', [['pcs', 1, 36500, 32000], ['dus', 6, 213000, 190000]]],
  ['Beng Beng', 'Makanan', 'pcs',
    [['pcs', 1, 2500, 2150], ['renceng', 10, 24000, 21000], ['dus', 60, 140000, 125000]]],
  ['Silverqueen Cashew 65g', 'Makanan', 'pcs', [['pcs', 1, 26000, 22500], ['dus', 12, 300000, 268000]]],
  ['Nabati Richoco 100g', 'Makanan', 'pcs', [['pcs', 1, 9500, 8200], ['dus', 12, 110000, 97000]]],
  ['Nextar Brownies 110g', 'Makanan', 'pcs', [['pcs', 1, 10500, 9100], ['dus', 12, 122000, 108000]]],
  ['Wafer Tango Vanilla 115g', 'Makanan', 'pcs', [['pcs', 1, 9500, 8200], ['dus', 12, 110000, 97000]]],
  ['Garuda Kacang Atom 80g', 'Makanan', 'pcs', [['pcs', 1, 7500, 6400], ['dus', 24, 172000, 152000]]],
  ['Dua Kelinci Kacang Kulit 100g', 'Makanan', 'pcs', [['pcs', 1, 8500, 7300], ['dus', 24, 195000, 173000]]],
  ['Roma Marie Susu 200g', 'Makanan', 'pcs', [['pcs', 1, 9500, 8200], ['dus', 24, 220000, 195000]]],
  ['Sari Roti Tawar', 'Makanan', 'pcs', [['pcs', 1, 17500, 15500]]],

  // -------------------------------------------------------------- Sembako
  // Beras/gula/tepung/bawang memakai base_unit gram supaya bisa dijual per kg dan per karung.
  ['Beras Pandan Wangi', 'Sembako', 'gram', [['kg', 1000, 15500, 13800], ['karung', 25000, 370000, 340000]]],
  ['Beras Setra Ramos', 'Sembako', 'gram', [['kg', 1000, 14000, 12500], ['karung', 25000, 335000, 305000]]],
  ['Beras Rojo Lele', 'Sembako', 'gram', [['kg', 1000, 16000, 14300], ['karung', 25000, 380000, 350000]]],
  ['Gula Pasir Curah', 'Sembako', 'gram', [['kg', 1000, 16000, 14500], ['karung', 50000, 770000, 715000]]],
  ['Gula Batu', 'Sembako', 'gram', [['pack', 500, 9500, 8500], ['kg', 1000, 18000, 16200]]],
  ['Minyak Goreng Sania 2L', 'Sembako', 'pcs', [['pcs', 1, 39000, 35500], ['dus', 6, 228000, 210000]]],
  ['Minyak Goreng Fortune 2L', 'Sembako', 'pcs', [['pcs', 1, 38000, 34500], ['dus', 6, 222000, 204000]]],
  ['Minyak Goreng Tropical 1L', 'Sembako', 'pcs', [['pcs', 1, 20500, 18500], ['dus', 12, 240000, 219000]]],
  ['Tepung Segitiga Biru', 'Sembako', 'gram', [['kg', 1000, 13500, 12100], ['karung', 25000, 325000, 298000]]],
  ['Tepung Cakra Kembar', 'Sembako', 'gram', [['kg', 1000, 14000, 12500], ['karung', 25000, 340000, 310000]]],
  ['Tepung Kunci Biru', 'Sembako', 'gram', [['kg', 1000, 13000, 11600], ['karung', 25000, 315000, 288000]]],
  ['Telur Ayam Negeri', 'Sembako', 'pcs',
    [['pcs', 1, 2300, 2050], ['kg', 16, 33000, 30500], ['pack', 30, 62000, 58000]]],
  ['Telur Ayam Kampung', 'Sembako', 'pcs', [['pcs', 1, 3800, 3400], ['pack', 30, 108000, 100000]]],
  ['Garam Halus Beryodium 250g', 'Sembako', 'pcs', [['pcs', 1, 3500, 2900], ['dus', 40, 128000, 112000]]],
  ['Garam Refina 500g', 'Sembako', 'pcs', [['pcs', 1, 5500, 4700], ['dus', 24, 125000, 110000]]],
  ['Kecap Manis Bango 220ml', 'Sembako', 'pcs', [['pcs', 1, 12500, 10900], ['dus', 24, 285000, 258000]]],
  ['Kecap Manis ABC 275ml', 'Sembako', 'pcs', [['pcs', 1, 12500, 10900], ['dus', 24, 285000, 258000]]],
  ['Saus Sambal ABC 335ml', 'Sembako', 'pcs', [['pcs', 1, 13500, 11800], ['dus', 24, 310000, 280000]]],
  ['Saus Tomat ABC 335ml', 'Sembako', 'pcs', [['pcs', 1, 12500, 10900], ['dus', 24, 285000, 258000]]],
  ['Penyedap Masako Sapi 250g', 'Sembako', 'pcs', [['pcs', 1, 8500, 7300], ['dus', 24, 195000, 173000]]],
  ['Penyedap Royco Ayam 230g', 'Sembako', 'pcs', [['pcs', 1, 8500, 7300], ['dus', 24, 195000, 173000]]],
  ['Bawang Merah', 'Sembako', 'gram', [['pack', 500, 22000, 19500], ['kg', 1000, 42000, 37000]]],
  ['Bawang Putih', 'Sembako', 'gram', [['pack', 500, 24000, 21000], ['kg', 1000, 45000, 39500]]],
  ['Sabun Mandi Lifebuoy 85g', 'Sembako', 'pcs', [['pcs', 1, 4200, 3600], ['dus', 48, 192000, 170000]]],
  ['Sabun Mandi Lux 85g', 'Sembako', 'pcs', [['pcs', 1, 4200, 3600], ['dus', 48, 192000, 170000]]],
  ['Deterjen Rinso Anti Noda 770g', 'Sembako', 'pcs', [['pcs', 1, 18500, 16300], ['dus', 12, 213000, 192000]]],
  ['Deterjen SoKlin 800g', 'Sembako', 'pcs', [['pcs', 1, 17500, 15400], ['dus', 12, 200000, 181000]]],
  ['Rinso Cair 700ml', 'Sembako', 'pcs', [['pcs', 1, 19500, 17200], ['dus', 12, 225000, 203000]]],
  ['Sunlight Jeruk Nipis 750ml', 'Sembako', 'pcs', [['pcs', 1, 18500, 16300], ['dus', 12, 213000, 192000]]],
  ['Sabun Cuci Mama Lemon 700ml', 'Sembako', 'pcs', [['pcs', 1, 17500, 15400], ['dus', 12, 200000, 181000]]],

  // ------------------------------------------------------------ Perawatan
  ['Shampo Sunsilk 170ml', 'Perawatan', 'pcs', [['pcs', 1, 20500, 18000], ['dus', 12, 235000, 212000]]],
  ['Shampo Clear 160ml', 'Perawatan', 'pcs', [['pcs', 1, 21500, 18900], ['dus', 12, 248000, 223000]]],
  ['Pasta Gigi Pepsodent 190g', 'Perawatan', 'pcs', [['pcs', 1, 14500, 12700], ['dus', 12, 167000, 150000]]],
  ['Pasta Gigi Close Up 160g', 'Perawatan', 'pcs', [['pcs', 1, 13500, 11800], ['dus', 12, 155000, 140000]]],
  ['Minyak Telon Konicare 60ml', 'Perawatan', 'pcs', [['pcs', 1, 18500, 16200], ['dus', 24, 425000, 382000]]],
  ['Minyak Kayu Putih Cap Lang 60ml', 'Perawatan', 'pcs', [['pcs', 1, 25500, 22400], ['dus', 24, 585000, 527000]]],

  // ------------------------------------------------------------ Lain-lain
  ['Bedak My Baby 100g', 'Lain-lain', 'pcs', [['pcs', 1, 15500, 13600], ['dus', 24, 355000, 320000]]],
  ['Tisu Paseo 250s', 'Lain-lain', 'pcs', [['pcs', 1, 13500, 11800], ['dus', 12, 155000, 140000]]],
  ['Baterai ABC AA', 'Lain-lain', 'pcs', [['pcs', 1, 10500, 9200], ['dus', 12, 120000, 108000]]],
  ['Korek Api Gas Tokai', 'Lain-lain', 'pcs', [['pcs', 1, 3500, 2900], ['dus', 50, 160000, 140000]]],
];

/** Barcode 13 digit: '899' + 10 digit dari hash nama. Stabil, tidak bergantung urutan. */
export function barcodeFor(name) {
  const digest = crypto.createHash('sha256').update(name).digest();
  const n = digest.readBigUInt64BE(0) % 10_000_000_000n;
  return `899${String(n).padStart(10, '0')}`;
}

/**
 * Isi kategori, satuan, dan produk. Dipakai oleh CLI `npm run seed:produk`.
 * Mengembalikan { produk, dilewati, satuan } untuk dilaporkan.
 */
export async function runSeedProducts(url, { log = console.log } = {}) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');

    const categoryIds = new Map();
    for (const name of SEED_PRODUCT_CATEGORIES) {
      const { rows: found } = await client.query('SELECT id FROM categories WHERE name = $1', [name]);
      if (found.length) {
        categoryIds.set(name, found[0].id);
      } else {
        const { rows } = await client.query('INSERT INTO categories (name) VALUES ($1) RETURNING id', [name]);
        categoryIds.set(name, rows[0].id);
      }
    }

    let unitsCreated = 0;
    const unitIds = new Map();
    for (const name of SEED_PRODUCT_UNITS) {
      const { rows: found } = await client.query('SELECT id FROM units WHERE name = $1', [name]);
      if (found.length) {
        unitIds.set(name, found[0].id);
      } else {
        const { rows } = await client.query('INSERT INTO units (name) VALUES ($1) RETURNING id', [name]);
        unitIds.set(name, rows[0].id);
        unitsCreated++;
      }
    }

    const seenBarcode = new Set();
    let created = 0;
    let skipped = 0;
    const skippedNames = [];

    for (const [name, category, baseUnit, units] of SEED_PRODUCTS) {
      const barcode = barcodeFor(name);
      if (seenBarcode.has(barcode)) throw new Error(`barcode bentrok di daftar seed: ${name}`);
      seenBarcode.add(barcode);

      // Kunci idempotensi: nama produk. Produk yang sudah ada tidak pernah disentuh.
      const { rows: exists } = await client.query('SELECT id FROM products WHERE name = $1', [name]);
      if (exists.length) {
        skipped++;
        skippedNames.push(name);
        continue;
      }

      const { rows: prod } = await client.query(
        `INSERT INTO products (name, category_id, base_unit, barcode, is_active)
         VALUES ($1, $2, $3, $4, true) RETURNING id`,
        [name, categoryIds.get(category), baseUnit, barcode],
      );
      const productId = prod[0].id;

      for (const [unitName, isi, hargaJual, hargaModal] of units) {
        const unitId = unitIds.get(unitName);
        if (!unitId) throw new Error(`satuan "${unitName}" tidak dikenal pada produk ${name}`);
        await client.query(
          `INSERT INTO product_units (product_id, unit_id, isi, harga_jual, harga_modal)
           VALUES ($1, $2, $3, $4, $5)`,
          [productId, unitId, isi, hargaJual, hargaModal],
        );
      }
      created++;
    }

    await client.query('COMMIT');
    log(`produk dibuat: ${created}, dilewati: ${skipped}, satuan dibuat: ${unitsCreated}`);
    if (skipped) log(`  dilewati karena sudah ada: ${skippedNames.slice(0, 10).join(', ')}${skipped > 10 ? ` … (+${skipped - 10} lagi)` : ''}`);
    log('Stok TIDAK diisi dan tidak ada penjualan yang dibuat — stok diisi lewat halaman stok.');
    return { produk: created, dilewati: skipped, satuan: unitsCreated };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

// --- CLI: node scripts/seed-produk.js ---
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'SEED PRODUK GAGAL: DATABASE_URL belum diset.\n' +
      'Berkas backend\\.env belum ada. Buat dulu dengan:  copy .env.example .env',
    );
    process.exit(1);
  }
  runSeedProducts(url).catch((err) => {
    console.error('SEED PRODUK GAGAL:', err.message);
    process.exitCode = 1;
  });
}
