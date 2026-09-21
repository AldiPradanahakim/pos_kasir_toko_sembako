import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env'), quiet: true });

// bigint (int8) -> number. Dipakai untuk id, COUNT(*), dan SUM(): semuanya jauh di bawah 2^53.
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL belum diset. Salin .env.example ke .env lalu sesuaikan.');
}

export const pool = new pg.Pool({ connectionString, max: 10 });
pool.on('error', (err) => console.error('[db] koneksi idle bermasalah:', err.message));

export const q = (text, params) => pool.query(text, params);

/** Jalankan fn(client) di dalam satu transaksi. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Tanggal hari ini menurut zona Asia/Jakarta, format YYYY-MM-DD. */
export function jakartaDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
