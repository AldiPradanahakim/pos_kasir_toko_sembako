import bcrypt from 'bcryptjs';
import { q } from './db.js';

/**
 * Periksa akun yang password-nya masih "password" (warisan seed versi lama) lalu tandai wajib
 * ganti. Dijalankan sekali saat server menyala.
 *
 * Ini menutup celah paling berbahaya di instalasi nyata: aplikasi dipasang mengikuti panduan,
 * password default tidak pernah diganti, dan alamatnya bisa dijangkau dari internet. Akun itu
 * tetap bisa masuk (supaya pemiliknya tidak terkunci dari tokonya sendiri), tetapi hanya boleh
 * mengganti password sampai selesai — lihat `hanyaBolehGantiPassword`.
 *
 * Aman diulang: akun yang passwordnya sudah kuat tidak disentuh.
 */
export async function tandaiPasswordDefault() {
  const { rows } = await q(
    'SELECT id, username, password FROM users WHERE is_active AND must_change_password = false',
  );
  const lemah = [];
  for (const u of rows) {
    if (await bcrypt.compare('password', u.password)) lemah.push(u);
  }
  if (!lemah.length) return [];

  await q('UPDATE users SET must_change_password = true WHERE id = ANY($1::bigint[])', [
    lemah.map((u) => u.id),
  ]);

  const daftar = lemah.map((u) => u.username).join(', ');
  console.error('');
  console.error('  !! PERINGATAN KEAMANAN !!');
  console.error(`  Akun berikut masih memakai password "password": ${daftar}`);
  console.error('  Akun itu hanya bisa mengganti password sampai passwordnya diganti.');
  console.error('');
  return lemah.map((u) => u.username);
}
