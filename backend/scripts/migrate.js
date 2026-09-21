import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

/**
 * Terapkan migrations/*.sql berurutan, masing-masing di dalam satu transaksi.
 * Idempotent: berkas yang sudah diterapkan dicatat di tabel _migrations dan dilewati.
 * Dipakai oleh CLI `npm run migrate` dan oleh skrip smoke (yang menyiapkan database ujinya sendiri).
 */
export async function runMigrations(url, { fresh = false, log = console.log } = {}) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows: who } = await client.query('select current_database() as db, current_user as usr');
    log(`Migrasi ke ${who[0].db} sebagai ${who[0].usr}${fresh ? ' (--fresh: skema dibuang dulu)' : ''}`);

    if (fresh) {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }

    await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    const { rows: done } = await client.query('SELECT name FROM _migrations');
    const applied = new Set(done.map((r) => r.name));

    const dir = path.join(root, 'migrations');
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        log(`  lewati   ${file}`);
        continue;
      }
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        log(`  terapkan ${file}`);
        count++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`gagal di ${file}: ${err.message}`);
      }
    }
    log(count ? `Selesai: ${count} migrasi diterapkan.` : 'Selesai: tidak ada migrasi baru.');
    return count;
  } finally {
    await client.end();
  }
}

const pesanEnvHilang = (envKey) =>
  `${envKey} belum diset.\n` +
  'Berkas backend\\.env belum ada. Buat dulu dengan:  copy .env.example .env\n' +
  'lalu sesuaikan nomor port PostgreSQL-nya (5433 untuk PostgreSQL 14, 5432 untuk PostgreSQL 18).';

// --- CLI: node scripts/migrate.js [--test] [--fresh] ---
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const useTest = process.argv.includes('--test');
  const envKey = useTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
  const url = process.env[envKey];

  if (!url) {
    console.error(`MIGRASI GAGAL: ${pesanEnvHilang(envKey)}`);
    process.exit(1);
  }

  runMigrations(url, { fresh: process.argv.includes('--fresh') }).catch((err) => {
    console.error('MIGRASI GAGAL:', err.message);
    process.exitCode = 1;
  });
}
