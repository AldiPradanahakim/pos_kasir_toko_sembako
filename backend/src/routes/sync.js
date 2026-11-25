import express from 'express';
import { q } from '../db.js';
import { listProducts, stockList } from '../lib.js';
import { getSettings } from './settings.js';

const router = express.Router();

// Sekali tarik untuk mengisi Dexie di perangkat (dipakai saat online & saat app dibuka).
// Bentuk baris `stock` identik dengan GET /stock — keduanya memakai stockList().
router.get('/sync/pull', async (req, res) => {
  const [categories, units, products, settings, stock] = await Promise.all([
    q('SELECT id, name, is_active FROM categories ORDER BY name'),
    q('SELECT id, name, inisial, is_active FROM units ORDER BY name'),
    // Salinan ini ikut tersimpan di IndexedDB perangkat, jadi isinya dibatasi per peran.
    listProducts({ tanpaModal: req.user.role !== 'superadmin' }),
    getSettings(),
    stockList(),
  ]);

  res.json({
    server_time: new Date().toISOString(),
    categories: categories.rows,
    units: units.rows,
    products,
    settings,
    stock,
  });
});

export default router;
