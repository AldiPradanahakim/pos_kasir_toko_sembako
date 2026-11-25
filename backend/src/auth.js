import crypto from 'node:crypto';
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
      `SELECT u.id, u.name, u.username, u.role, u.is_active, u.must_change_password
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

/**
 * Middleware: akun yang password-nya baru direset superadmin hanya boleh melihat dirinya dan
 * mengganti password. Tanpa ini, akun dengan password sementara bisa dipakai berjualan
 * selamanya, dan password sementara itu (yang dikirim lewat chat/ucapan) jadi password tetap.
 */
export function hanyaBolehGantiPassword(req, res, next) {
  if (!req.user?.must_change_password) return next();
  const boleh =
    (req.method === 'GET' && req.path === '/me') ||
    (req.method === 'POST' && req.path === '/logout') ||
    (req.method === 'PUT' && req.path === `/users/${req.user.id}`);
  if (boleh) return next();
  return res.status(403).json({
    error: 'Password Anda baru direset. Ganti password dulu sebelum memakai aplikasi.',
    kode: 'wajib_ganti_password',
  });
}

/** Middleware: hanya superadmin. */
export function requireSuperadmin(req, res, next) {
  if (req.user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Akses ditolak: hanya superadmin' });
  }
  next();
}

