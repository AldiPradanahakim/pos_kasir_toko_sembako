import { createApp } from './app.js';
import { tandaiPasswordDefault } from './cekPasswordDefault.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

const app = createApp();
const server = app.listen(port, host, () => {
  console.log(`POS Toko Hakim API siap di http://127.0.0.1:${port}/api  (TZ=${process.env.TZ || 'sistem'})`);
  // Pemeriksaan sekali di awal, bukan per permintaan: menandai akun berpassword default.
  void tandaiPasswordDefault().catch((err) => console.error('[cek password] gagal:', err.message));
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
