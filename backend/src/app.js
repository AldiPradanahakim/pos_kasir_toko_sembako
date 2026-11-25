import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { authenticate, hanyaBolehGantiPassword } from './auth.js';
import { pgError } from './lib.js';
import authRouter from './routes/auth.js';
import masterRouter from './routes/master.js';
import stockRouter from './routes/stock.js';
import salesRouter from './routes/sales.js';
import syncRouter from './routes/sync.js';
import reportsRouter from './routes/reports.js';
import dashboardRouter from './routes/dashboard.js';
import cashflowsRouter from './routes/cashflows.js';
import purchasesRouter from './routes/purchases.js';
import returnsRouter from './routes/returns.js';
import debtsRouter from './routes/debts.js';
import shiftsRouter from './routes/shifts.js';
import settingsRouter from './routes/settings.js';
import auditRouter from './routes/audit.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Header keamanan. Token sesi disimpan di localStorage (aplikasi harus bisa dipakai offline,
 * jadi cookie httpOnly tidak mungkin), sehingga CSP adalah lapisan yang menahan XSS — satu
 * skrip yang lolos bisa memakai token 30 hari milik kasir.
 *
 * Semua aset (termasuk worker OCR, core wasm, dan data bahasa) dilayani origin ini, jadi
 * `default-src 'self'` tanpa pengecualian pihak ketiga: tidak ada skrip, koneksi, atau bingkai
 * yang boleh keluar dari origin aplikasi. `blob:` di worker-src dipakai tesseract.js yang
 * membuat worker dari blob; `wasm-unsafe-eval` wajib untuk meng-instansiasi core wasm-nya.
 */
const CSP_DASAR = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

function securityHeaders(req, res, next) {
  // `upgrade-insecure-requests` hanya di HTTPS: kalau dikirim di http://localhost atau
  // http://192.168.x.x, browser menaikkan permintaan aset ke https dan aplikasi mati.
  const csp = req.secure ? [...CSP_DASAR, 'upgrade-insecure-requests'].join('; ') : CSP_DASAR.join('; ');
  res.set('Content-Security-Policy', csp);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'DENY');
  // Kamera dibiarkan untuk origin sendiri: tombol "Scan Nota" memakai input file capture
  // (memotret nota), dan beberapa browser menolaknya bila camera=() .
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self)');
  // HSTS hanya dikirim di koneksi HTTPS: di localhost/IP LAN yang masih http, header ini
  // akan memaksa browser memakai https ke alamat yang tidak punya sertifikat.
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Jawaban API berisi data penjualan dan token; jangan sampai disimpan cache bersama.
  if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
  next();
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Di produksi Caddy (127.0.0.1) meneruskan X-Forwarded-For; hanya peer loopback yang
  // dipercaya, sehingga req.ip berisi IP klien asli tanpa membuka pemalsuan dari jaringan.
  // Pembatas login memakai req.ip — tanpa ini semua kasir berbagi satu hitungan "127.0.0.1".
  app.set('trust proxy', 'loopback');
  app.use(securityHeaders);
  app.use(express.json({ limit: '2mb' }));

  // /login publik; sisanya di bawah ini butuh Bearer token.
  /**
   * Denyut server untuk penanda Online/Offline di klien.
   *
   * `navigator.onLine` hanya tahu "ada jaringan", bukan "server terjangkau". Di toko ini
   * server berjalan di komputer yang sama dengan jaringan lokal, jadi PC server mati atau
   * Wi-Fi pindah jaringan tetap membuat navigator bilang online padahal aplikasi tidak bisa
   * memuat apa pun. Klien menembak endpoint ini berkala; gagal = tampilkan Offline.
   *
   * Tanpa autentikasi dan tanpa database: tujuannya hanya "proses ini hidup dan menjawab".
   */
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api', authRouter);
  app.use('/api', authenticate);
  // Akun yang password-nya baru direset hanya boleh mengganti password dulu.
  app.use('/api', hanyaBolehGantiPassword);
  app.use('/api', masterRouter);
  app.use('/api', stockRouter);
  app.use('/api', salesRouter);
  app.use('/api', purchasesRouter);
  app.use('/api', cashflowsRouter);
  app.use('/api', returnsRouter);
  app.use('/api', debtsRouter);
  app.use('/api', shiftsRouter);
  app.use('/api', syncRouter);
  app.use('/api', reportsRouter);
  app.use('/api', dashboardRouter);
  app.use('/api', settingsRouter);
  app.use('/api', auditRouter);

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
    // JSON rusak dari klien adalah kesalahan pemanggil (400), bukan kesalahan server (500).
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Isi permintaan bukan JSON yang valid' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Isi permintaan terlalu besar' });
    }
    const e = pgError(err);
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('[error]', e);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  });

  return app;
}
