import express from 'express';
import { q } from '../db.js';
import { requireSuperadmin } from '../auth.js';
import { ApiError, toStr } from '../lib.js';

const router = express.Router();

const KEYS = ['toko_nama', 'alamat', 'telepon'];

/** Nilai pengaturan siap pakai untuk API. */
export async function getSettings() {
  const { rows } = await q('SELECT key, value FROM settings WHERE key = ANY($1::text[])', [KEYS]);
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    toko_nama: m.toko_nama ?? '',
    alamat: m.alamat ?? '',
    telepon: m.telepon ?? '',
  };
}

async function put(key, value) {
  await q(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  );
}

router.get('/settings', async (_req, res) => {
  res.json(await getSettings());
});

router.put('/settings', requireSuperadmin, async (req, res) => {
  const nama = toStr(req.body?.toko_nama);
  if (!nama) throw new ApiError(422, 'toko_nama wajib diisi');
  await put('toko_nama', nama);
  await put('alamat', toStr(req.body?.alamat) ?? '');
  await put('telepon', toStr(req.body?.telepon) ?? '');
  res.json(await getSettings());
});

export default router;
