import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { authenticate } from './auth.js';
import { pgError } from './lib.js';
import authRouter from './routes/auth.js';
import masterRouter from './routes/master.js';
import stockRouter from './routes/stock.js';
import salesRouter from './routes/sales.js';
import syncRouter from './routes/sync.js';
import reportsRouter from './routes/reports.js';
import cashflowsRouter from './routes/cashflows.js';
import purchasesRouter from './routes/purchases.js';
import returnsRouter from './routes/returns.js';
import debtsRouter from './routes/debts.js';
import settingsRouter from './routes/settings.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  // /login publik; sisanya di bawah ini butuh Bearer token.
  app.use('/api', authRouter);
  app.use('/api', authenticate);
  app.use('/api', masterRouter);
  app.use('/api', stockRouter);
  app.use('/api', salesRouter);
  app.use('/api', purchasesRouter);
  app.use('/api', cashflowsRouter);
  app.use('/api', returnsRouter);
  app.use('/api', debtsRouter);
  app.use('/api', syncRouter);
  app.use('/api', reportsRouter);
  app.use('/api', settingsRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));

  // Produksi satu origin: sajikan hasil build frontend bila ada (tidak pernah menulis ke sana).
  const dist = path.resolve(root, '../frontend/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use((err, _req, res, _next) => {
    const e = pgError(err);
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('[error]', e);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  });

  return app;
}
