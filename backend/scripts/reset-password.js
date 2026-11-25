import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { buatPasswordAcak } from './seed.js';

/**
 * Pulihkan akses akun yang passwordnya lupa.
 *
 *   npm run reset:password -- superadmin
 *
 * Membuat password acak baru, mencetaknya sekali, dan menandai akun itu wajib mengganti
 * password saat masuk. Butuh akses langsung ke database (DATABASE_URL di .env), jadi tidak
 * bisa dipakai orang luar — ini jalan keluar terakhir, bukan pintu belakang aplikasi.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env'), quiet: true });

const username = process.argv.slice(2).find((a) => !a.startsWith('-'));
if (!username) {
  console.error('Pakai: npm run reset:password -- <username>');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL belum diset di backend/.env');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query('SELECT id, username, role FROM users WHERE username = $1', [username]);
  if (!rows.length) {
    console.error(`Akun "${username}" tidak ditemukan.`);
    process.exit(1);
  }

  const password = buatPasswordAcak();
  await client.query(
    'UPDATE users SET password = $1, must_change_password = true, is_active = true, updated_at = now() WHERE id = $2',
    [await bcrypt.hash(password, 10), rows[0].id],
  );
  // Token lama milik akun itu tidak boleh tetap berlaku setelah password diganti.
  await client.query('DELETE FROM tokens WHERE user_id = $1', [rows[0].id]);

  console.log('');
  console.log(`  Akun     : ${rows[0].username} (${rows[0].role})`);
  console.log(`  Password : ${password}`);
  console.log('');
  console.log('  Catat sekarang — hanya ditampilkan sekali.');
  console.log('  Saat masuk, aplikasi akan meminta Anda membuat password baru.');
  console.log('');
} finally {
  await client.end();
}
