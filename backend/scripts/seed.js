import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { randomBytes } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env'), quiet: true });

/**
 * Satuan dasar yang di-seed. Satu-satunya sumber daftar ini.
 * `inisial` = singkatan yang boleh ditulis kasir/pelanggan di nota ("2 (r) Beng Beng").
 */
export const SEED_UNITS = [
  { name: 'pcs', inisial: 'pc' },
  { name: 'renceng', inisial: 'r' },
  { name: 'pack', inisial: 'p' },
  { name: 'dus', inisial: 'd' },
  { name: 'slop', inisial: 'sl' },
  { name: 'bal', inisial: 'b' },
  { name: 'karung', inisial: 'kr' },
  { name: 'kg', inisial: 'kg' },
  // Satuan pecahan sengaja tanpa inisial: pengurai membuang angka dari nama barang, jadi
  // singkatan "1/2" tidak bisa dicocokkan. Nama lengkapnya tetap dikenali.
  { name: '1/2 kg', inisial: null },
  { name: '1/4 kg', inisial: null },
];

/** Nilai pengaturan awal toko. */
export const SEED_SETTINGS = {
  toko_nama: 'Toko Hakim',
  alamat: '',
  telepon: '',
};

export const SEED_SUPERADMIN = { name: 'Super Admin', username: 'superadmin' };

/**
 * Password acak untuk superadmin baru.
 *
 * Dulu seed memakai "password" — satu-satunya kredensial yang tertulis di dokumentasi, dan
 * karena itu yang paling sering dibiarkan. Sekarang password dibuat acak (20 karakter, huruf
 * besar/kecil/angka) dan dicetak SEKALI saat seed membuat akunnya. Kalau akunnya sudah ada,
 * password lama tidak pernah disentuh.
 */
export function buatPasswordAcak(panjang = 20) {
  const abjad = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const n = abjad.length;
  // Rejection sampling, bukan `byte % n`: 256 tidak habis dibagi 58, jadi modulo langsung
  // membuat 24 huruf pertama sedikit lebih sering muncul. Selisihnya kecil, tetapi tidak ada
  // alasan memakai cara yang bisa dibuktikan bias.
  const batas = 256 - (256 % n);
  let out = '';
  while (out.length < panjang) {
    for (const b of randomBytes(panjang * 2)) {
      if (b >= batas) continue;
      out += abjad[b % n];
      if (out.length === panjang) break;
    }
  }
  return out;
}

/**
 * Isi data dasar: superadmin, satuan, dan pengaturan toko.
 * Idempotent — data yang sudah ada tidak ditimpa (password superadmin tidak pernah direset di sini).
 * Dipakai oleh CLI `npm run seed` dan oleh skrip smoke.
 */
export async function runSeed(url, { log = console.log, password } = {}) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const ada = await client.query('SELECT 1 FROM users WHERE username = $1', [SEED_SUPERADMIN.username]);
    const passwordBaru = ada.rows.length ? null : (password ?? buatPasswordAcak());
    const hash = passwordBaru ? await bcrypt.hash(passwordBaru, 10) : null;
    const { rows: sa } = await client.query(
      `INSERT INTO users (name, username, password, role, is_active)
       VALUES ($1, $2, $3, 'superadmin', true)
       ON CONFLICT (username) DO UPDATE SET role = 'superadmin'
       RETURNING id, username`,
      [SEED_SUPERADMIN.name, SEED_SUPERADMIN.username, hash],
    );
    log(`user     : ${sa[0].username} (id ${sa[0].id})`);
    if (passwordBaru) {
      log('');
      log('  ============================================================');
      log(`  Password superadmin (hanya ditampilkan sekali): ${passwordBaru}`);
      log('  Simpan di tempat aman, lalu ganti setelah masuk pertama.');
      log('  ============================================================');
      log('');
    } else {
      log('  password : TIDAK diubah (akun sudah ada)');
    }

    for (const u of SEED_UNITS) {
      await client.query(
        `INSERT INTO units (name, inisial) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET inisial = COALESCE(units.inisial, EXCLUDED.inisial)`,
        [u.name, u.inisial],
      );
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
