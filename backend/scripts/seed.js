import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env'), quiet: true });

/** Satuan dasar yang di-seed. Satu-satunya sumber daftar ini. */
export const SEED_UNITS = ['pcs', 'renceng', 'pack', 'dus', 'slop', 'bal', 'karung', 'kg', '1/2 kg', '1/4 kg'];

/** Nilai pengaturan awal toko. */
export const SEED_SETTINGS = {
  toko_nama: 'Toko Hakim',
  alamat: '',
  telepon: '',
};

export const SEED_SUPERADMIN = { name: 'Super Admin', username: 'superadmin', password: 'password' };

/**
 * Isi data dasar: superadmin, satuan, dan pengaturan toko.
 * Idempotent — data yang sudah ada tidak ditimpa (password superadmin tidak pernah direset di sini).
 * Dipakai oleh CLI `npm run seed` dan oleh skrip smoke.
 */
export async function runSeed(url, { log = console.log } = {}) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const hash = await bcrypt.hash(SEED_SUPERADMIN.password, 10);
    const { rows: sa } = await client.query(
      `INSERT INTO users (name, username, password, role, is_active)
       VALUES ($1, $2, $3, 'superadmin', true)
       ON CONFLICT (username) DO UPDATE SET role = 'superadmin'
       RETURNING id, username`,
      [SEED_SUPERADMIN.name, SEED_SUPERADMIN.username, hash],
    );
    log(`user     : ${sa[0].username} (id ${sa[0].id})`);

    for (const name of SEED_UNITS) {
      await client.query('INSERT INTO units (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
    }
    const { rows: u } = await client.query('SELECT count(*)::int AS n FROM units');
    log(`units    : ${u[0].n} baris (target ${SEED_UNITS.length})`);

    await client.query(
      `INSERT INTO settings (key, value) VALUES ('toko_nama', $1)
       ON CONFLICT (key) DO NOTHING`,
      [SEED_SETTINGS.toko_nama],
    );
    for (const key of ['alamat', 'telepon']) {
      await client.query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
        [key, SEED_SETTINGS[key]],
      );
    }
    const { rows: s } = await client.query('SELECT key, value FROM settings ORDER BY key');
    log(`settings : ${s.map((r) => `${r.key}=${r.value}`).join(', ')}`);
    log('Seed selesai. Tidak ada produk/kategori/harga yang di-seed.');
  } finally {
    await client.end();
  }
}

// --- CLI: node scripts/seed.js ---
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'SEED GAGAL: DATABASE_URL belum diset.\n' +
      'Berkas backend\\.env belum ada. Buat dulu dengan:  copy .env.example .env\n' +
      'lalu sesuaikan nomor port PostgreSQL-nya (5433 untuk PostgreSQL 14, 5432 untuk PostgreSQL 18).',
    );
    process.exit(1);
  }

  runSeed(url).catch((err) => {
    console.error('SEED GAGAL:', err.message);
    process.exitCode = 1;
  });
}
