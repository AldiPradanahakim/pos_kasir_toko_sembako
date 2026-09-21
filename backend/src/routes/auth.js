import express from 'express';
import bcrypt from 'bcryptjs';
import { q } from '../db.js';
import { authenticate, newToken, hashToken } from '../auth.js';
import { ApiError, toStr } from '../lib.js';

const router = express.Router();
const TTL_HOURS = Number(process.env.TOKEN_TTL_HOURS || 720);

router.post('/login', async (req, res) => {
  const username = toStr(req.body?.username);
  const password = req.body?.password;
  if (!username || !password) throw new ApiError(422, 'Username dan password wajib diisi');

  const { rows } = await q(
    'SELECT id, name, username, password, role, is_active FROM users WHERE username = $1',
    [username],
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(String(password), user.password))) {
    throw new ApiError(401, 'Username atau password salah');
  }
  if (!user.is_active) throw new ApiError(401, 'Akun tidak aktif, hubungi superadmin');

  const token = newToken();
  await q(
    `INSERT INTO tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' hours')::interval)`,
    [user.id, hashToken(token), String(TTL_HOURS)],
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, username: user.username, role: user.role },
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
