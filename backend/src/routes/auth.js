import express from 'express';
import bcrypt from 'bcryptjs';
import { q } from '../db.js';
import { authenticate, newToken, hashToken } from '../auth.js';
import { audit } from '../audit.js';
import { ApiError, toStr } from '../lib.js';
import { rateLimitLogin } from '../rateLimit.js';

const router = express.Router();
const TTL_HOURS = Number(process.env.TOKEN_TTL_HOURS || 720);

// Satu-satunya pintu tanpa token: dibatasi supaya password tidak bisa ditebak tanpa henti.
const batasPercobaan = rateLimitLogin();

/**
 * Hash umpan untuk username yang tidak terdaftar.
 *
 * Tanpa ini, permintaan untuk username yang ada memakan waktu satu bcrypt (~60 ms) sedangkan
 * username yang tidak ada langsung dijawab. Selisih itu cukup untuk memetakan username mana
 * yang terdaftar, walau pesan galatnya sama. Hash ini TIDAK pernah cocok dengan password apa pun.
 */
const HASH_UMPAN = '$2a$10$gQzmUTjbHNbXreBgEZZn8e5S/7685wQRM0c3MLZf/ip4KzeOJc1mO';

router.post('/login', batasPercobaan, async (req, res) => {
  const username = toStr(req.body?.username);
  const password = req.body?.password;
  if (!username || !password) throw new ApiError(422, 'Username dan password wajib diisi');

  // lower(username) = lower($1): keyboard HP sering mengapitalkan huruf pertama, dan
  // password yang benar tidak boleh ditolak hanya karena itu. Keunikannya dijamin indeks
  // users_username_lower_idx (migrasi 010).
  const { rows } = await q(
    `SELECT id, name, username, password, role, is_active, must_change_password
       FROM users WHERE lower(username) = lower($1)`,
    [username],
  );
  const user = rows[0];
  // Bandingkan SELALU, termasuk saat user tidak ada (lihat HASH_UMPAN).
  const cocok = await bcrypt.compare(String(password), user?.password ?? HASH_UMPAN);
  if (!user || !cocok) throw new ApiError(401, 'Username atau password salah');
  if (!user.is_active) throw new ApiError(401, 'Akun tidak aktif, hubungi superadmin');

  const token = newToken();
  // Tiap login membuat satu baris dan tidak ada yang pernah membersihkannya.
  // Buang yang sudah kedaluwarsa supaya tabel token tidak menumpuk tanpa batas.
  await q('DELETE FROM tokens WHERE expires_at <= now()');
  await q(
    `INSERT INTO tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' hours')::interval)`,
    [user.id, hashToken(token), String(TTL_HOURS)],
  );
  await audit(req, 'auth.login', 'users', user.id, { username: user.username });

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      must_change_password: user.must_change_password,
    },
  });
});

router.post('/logout', authenticate, async (req, res) => {
  await q('DELETE FROM tokens WHERE token_hash = $1', [hashToken(req.get('authorization').slice(7).trim())]);
  res.json({ ok: true });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

export default router;
