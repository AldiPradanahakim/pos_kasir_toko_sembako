/**
 * Kembalikan database ke kondisi "baru dipasang": seluruh data transaksi dan data produk
 * dihapus, pengaturan toko dan daftar satuan dikembalikan ke nilai seed, dan hanya akun
 * superadmin yang dipertahankan. Skema TIDAK dihapus — migrasi tidak perlu dijalankan ulang.
 *
 *   npm run reset:data            (menolak jalan bila nama database bukan *_test)
 *   npm run reset:data -- --force (paksa, untuk database produksi)
 *
 * Ini skrip PERUSAK: semua transaksi, produk, dan pengguna selain superadmin akan hilang.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { SEED_UNITS, SEED_SETTINGS, SEED_SUPERADMIN } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'RESET GAGAL: DATABASE_URL belum diset.\n' +
    'Berkas backend\\.env belum ada. Buat dulu dengan:  copy .env.example .env',
  );
  process.exit(1);
}

const force = process.argv.includes('--force');
const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));

if (!force && !dbName.endsWith('_test')) {
  console.error(
    `RESET DITOLAK: database "${dbName}" bukan database uji.\n` +
    'Skrip ini menghapus SEMUA transaksi, produk, dan pengguna selain superadmin.\n' +
    'Bila memang ingin menghapus data database ini, jalankan:  npm run reset:data -- --force',
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });

const TABLES = [
  'products', 'product_units', 'categories', 'sales', 'sale_items',
  'stock_movements', 'struk_counters', 'users', 'units', 'tokens',
  'product_aliases', 'cash_flows', 'purchases', 'purchase_items',
  'debts', 'returns', 'stock_opnames',
];

async function main() {
  await client.connect();
  console.log(`Reset data pada database "${dbName}"${force ? ' (--force)' : ''}`);

  await client.query('BEGIN');

  // 1. Data transaksi + data produk. RESTART IDENTITY supaya penomoran mulai dari 1 lagi.
  await client.query(
    `TRUNCATE sale_items, stock_movements, sales, struk_counters,
              product_units, products, categories,
              product_aliases, cash_flows, purchases, purchase_items,
              debts, returns, stock_opnames
     RESTART IDENTITY CASCADE`,
  );
  console.log('  dihapus  : transaksi, item, pergerakan stok, counter struk, produk, kategori,'
    + ' buku kas, pembelian, retur, hutang, opname, alias');

  // 2. Token login dibuang seluruhnya.
  const tok = await client.query('DELETE FROM tokens');
  console.log(`  dihapus  : ${tok.rowCount} token login`);

  // 3. Pengguna: hanya superadmin yang dipertahankan.
  const otherUsers = await client.query(`DELETE FROM users WHERE username <> $1`, [SEED_SUPERADMIN.username]);
  console.log(`  dihapus  : ${otherUsers.rowCount} pengguna selain superadmin`);

  const { rows: sa } = await client.query('SELECT id FROM users WHERE username = $1', [SEED_SUPERADMIN.username]);
  if (sa.length) {
    await client.query(
      `UPDATE users SET role = 'superadmin', is_active = true, updated_at = now() WHERE id = $1`,
      [sa[0].id],
    );
    console.log(`  dijaga   : superadmin (id ${sa[0].id}), password TIDAK diubah`);
  } else {
    const { rows } = await client.query(
      `INSERT INTO users (name, username, password, role, is_active)
       VALUES ($1, $2, $3, 'superadmin', true) RETURNING id`,
      [SEED_SUPERADMIN.name, SEED_SUPERADMIN.username, await bcrypt.hash(SEED_SUPERADMIN.password, 10)],
    );
    console.log(`  dibuat   : superadmin (id ${rows[0].id}) dengan password seed`);
  }

  // 4. Satuan: sisakan hanya 10 satuan seed, dan aktifkan kembali yang sempat dinonaktifkan.
  const extraUnits = await client.query('DELETE FROM units WHERE name <> ALL($1::text[])', [SEED_UNITS]);
  for (const name of SEED_UNITS) {
    await client.query(
      `INSERT INTO units (name, is_active) VALUES ($1, true)
       ON CONFLICT (name) DO UPDATE SET is_active = true, updated_at = now()`,
      [name],
    );
  }
  console.log(`  dihapus  : ${extraUnits.rowCount} satuan di luar daftar seed; ${SEED_UNITS.length} satuan seed dipastikan aktif`);

  // 5. Pengaturan toko kembali ke nilai awal.
  await client.query('DELETE FROM settings');
  await client.query(
    `INSERT INTO settings (key, value) VALUES
       ('toko_nama', $1), ('alamat', $2), ('telepon', $3)`,
    [SEED_SETTINGS.toko_nama, SEED_SETTINGS.alamat, SEED_SETTINGS.telepon],
  );
  console.log('  direset  : pengaturan toko');

  await client.query('COMMIT');

  console.log('\nJumlah baris setelah reset:');
  for (const t of TABLES) {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${t}`);
    console.log(`  ${t.padEnd(16)} ${rows[0].n}`);
  }
  const { rows: s } = await client.query('SELECT key, value FROM settings ORDER BY key');
  console.log(`  ${'settings'.padEnd(16)} ${s.map((r) => `${r.key}=${JSON.stringify(r.value)}`).join(', ')}`);
  console.log('\nSelesai. Database siap dipakai dari nol.');
}

main()
  .catch((err) => {
    console.error('RESET GAGAL:', err.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
