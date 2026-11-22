/**
 * Regresi bug "kolom di dalam modal hanya bisa menerima SATU huruf".
 *
 * Bug lama: efek di `Modal` (components/ui.tsx) memasang `onClose` di daftar dependensinya,
 * sedangkan pemanggil selalu mengirim arrow baru (`onClose={() => setBuka(false)}`). Efeknya
 * jalan ulang tiap render dan bagian pembersihnya mengembalikan fokus ke tombol pembuka modal,
 * sehingga fokus dicuri setiap satu huruf yang diketik.
 *
 * Skrip ini mengetik KATA UTUH lewat kejadian tombol sungguhan di beberapa modal berbeda lalu
 * membandingkan nilai kolomnya. Kalau dependensinya dikembalikan ke `[open, onClose]`, nilai
 * kolomnya terpotong jadi satu huruf dan skrip ini GAGAL.
 *
 * Jalankan: BASE_URL=http://localhost:3000 node scripts/verify-ketik.mjs
 * Prasyarat: server yang menyajikan build produksi (frontend/dist) sudah jalan.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { bukaDanTunggu, masuk, pasangPenjagaOverlay } from './verifikasi-util.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const KELUARAN = path.resolve('verifikasi');
fs.mkdirSync(KELUARAN, { recursive: true });

const TEKS = 'barang rusak / kadaluarsa';

/**
 * Modal yang diuji: halaman, tombol pembukanya, dan kolom teks di dalamnya.
 * Empat modal di empat halaman berbeda supaya terbukti berlaku umum — bugnya ada di
 * `Modal` (components/ui.tsx) yang dipakai semua halaman.
 * `[role="dialog"] input` = kolom pertama di modal itu, dipakai kalau kolomnya tidak punya
 * placeholder yang bisa diandalkan.
 */
const MODAL = [
  {
    nama: 'retur',
    rute: '/retur',
    buka: '+ Retur Baru',
    kolom: '[role="dialog"] input[placeholder="mis. barang rusak / kadaluarsa / salah kirim"]',
    judul: 'Alasan retur',
  },
  {
    nama: 'hutang-piutang',
    rute: '/hutang-piutang',
    buka: '+ Catat',
    kolom: '[role="dialog"] input[placeholder="mis. Toko Grosir Jaya / Bu Ani"]',
    judul: 'Nama pihak',
  },
  {
    nama: 'keuangan',
    rute: '/keuangan',
    buka: '+ Catat Arus Kas',
    kolom: '[role="dialog"] input[placeholder="mis. bayar listrik bulan ini"]',
    judul: 'Catatan arus kas',
  },
  {
    nama: 'produk',
    rute: '/produk',
    buka: '+ Tambah Produk',
    kolom: '[role="dialog"] input',
    judul: 'Nama produk',
  },
];

const browser = await chromium.launch();
// Service worker PWA bisa menyajikan build lama; dimatikan supaya yang diuji pasti dist terbaru.
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
await pasangPenjagaOverlay(page);
await masuk(page, BASE, 'superadmin', 'password');

const bukti = { base: BASE, teksDiketik: TEKS, modal: [] };

for (const m of MODAL) {
  const catat = { nama: m.nama, rute: m.rute, judulKolom: m.judul };
  // Diulang sampai 3 kali: berkas build bisa sedang ditulis ulang proses lain, dan saat itu
  // aset halaman gagal dimuat. Yang diuji ulang adalah ketikan, bukan pengulangan aslinya.
  for (let percobaan = 1; percobaan <= 3; percobaan++) {
    try {
      if (!(await bukaDanTunggu(page, `${BASE}${m.rute}`, { percobaan: 4, jedaMs: 1500 }))) {
        throw new Error('halaman tidak merender');
      }
      await page.getByRole('button', { name: m.buka, exact: true }).first().click({ timeout: 15000 });
      await page.waitForSelector('[role="dialog"]', { timeout: 10000 });

      const kolom = page.locator(m.kolom).first();
      await kolom.click();
      // Ketikan nyata per huruf: inilah yang dulu memicu perpindahan fokus tiap karakter.
      await page.keyboard.type(TEKS, { delay: 60 });
      await page.waitForTimeout(400);

      catat.nilai = await kolom.inputValue();
      catat.fokusMasihDiKolom = await kolom.evaluate((el) => document.activeElement === el);
      catat.utuh = catat.nilai === TEKS;

      // Tutup modal tanpa menyimpan supaya tidak ada data uji yang tertinggal.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      catat.dialogTertutup = (await page.locator('[role="dialog"]').count()) === 0;
      catat.percobaan = percobaan;
      delete catat.galat;
      break;
    } catch (e) {
      catat.utuh = false;
      catat.galat = e.message.slice(0, 200);
      catat.percobaan = percobaan;
    }
  }
  bukti.modal.push(catat);
  console.log(
    `${catat.utuh ? 'LULUS' : 'GAGAL'} ${m.nama.padEnd(8)} "${catat.nilai ?? ''}"` +
      (catat.galat ? `  (${catat.galat})` : ''),
  );
}

await browser.close();

bukti.lulus = bukti.modal.every((m) => m.utuh);
fs.writeFileSync(path.join(KELUARAN, 'bukti-ketik.json'), JSON.stringify(bukti, null, 2));
console.log(JSON.stringify(bukti, null, 2));

if (!bukti.lulus) {
  console.error('\nGAGAL: ada kolom modal yang nilainya tidak utuh (fokus dicuri saat mengetik).');
  process.exit(1);
}
console.log('\nLULUS: semua kolom modal menerima ketikan utuh.');
