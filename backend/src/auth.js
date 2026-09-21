import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { q } from './db.js';

export const newToken = () => crypto.randomBytes(32).toString('hex');
export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

function bearer(req) {
  const m = /^Bearer\s+(.+)$/i.exec((req.get('authorization') || '').trim());
  return m ? m[1] : null;
}

/** Middleware: butuh header Authorization: Bearer <token>. */
export async function authenticate(req, res, next) {
  try {
    const raw = bearer(req);
    if (!raw) return res.status(401).json({ error: 'Token tidak ditemukan' });

    const { rows } = await q(
      `SELECT u.id, u.name, u.username, u.role, u.is_active
         FROM tokens t
         JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND t.expires_at > now()`,
      [hashToken(raw)],
    );
    if (!rows.length) return res.status(401).json({ error: 'Token tidak valid atau sudah kedaluwarsa' });
    if (!rows[0].is_active) return res.status(401).json({ error: 'Akun tidak aktif' });

    req.user = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

/** Middleware: hanya superadmin. */
export function requireSuperadmin(req, res, next) {
  if (req.user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Akses ditolak: hanya superadmin' });
  }
  next();
}

/** Verifikasi kredensial superadmin (kasir memakai ini untuk membatalkan transaksi). */
export async function findSuperadmin(username, password) {
  if (!username || !password) return null;
  const { rows } = await q(
    `SELECT id, name, username, password FROM users
      WHERE username = $1 AND role = 'superadmin' AND is_active`,
    [String(username)],
  );
  if (!rows.length) return null;
  const ok = await bcrypt.compare(String(password), rows[0].password);
  return ok ? { id: rows[0].id, name: rows[0].name, username: rows[0].username } : null;
}
