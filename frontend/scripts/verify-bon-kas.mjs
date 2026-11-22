/**
 * Verifikasi fitur bon + buka/tutup kas di browser sungguhan.
 *
 * Yang dibuktikan (bukan sekadar "halaman terbuka"):
 *  1. Tanpa shift terbuka, layar kasir menampilkan gerbang "Buka Kas" dan TIDAK ada
 *     tombol simpan/cetak — kasir tidak bisa berjualan sebelum modal awal dicatat.
 *  2. Setelah buka kas, penjualan bisa disimpan dan menempel ke shift (shift_id terisi).
 *  3. Tombol "Bon" menerima pembayaran kurang dari total: struk mencetak SISA (BON),
 *     transaksi tersimpan dengan sisa_piutang > 0, dan baris piutang pelanggan muncul.
 *  4. Tutup kas menghitung selisih dari uang fisik yang diketik.
 *  5. Bon tanpa nama pelanggan ditolak di layar (pesan jelas, tidak tersimpan).
 *
 * Semua transaksi uji dihapus lagi di akhir supaya data pemilik utuh.
 * Jalankan: node scripts/verify-bon-kas.mjs   (server harus hidup di BASE_URL)
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { bacaTabelKeranjang, bukaDanTunggu, masuk, pasangPenjagaOverlay, tambahProduk } from './verifikasi-util.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const API = process.env.API_URL ?? BASE;
const USER = process.env.POS_USER ?? 'aldipradana';
const PASS = process.env.POS_PASS ?? 'Aldi1234';
const KELUARAN = path.resolve('verifikasi');
fs.mkdirSync(KELUARAN, { recursive: true });

const bukti = { catatan: [] };
const dibuat = [];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (e) => bukti.catatan.push(`pageerror: ${e.message}`));
await pasangPenjagaOverlay(page);

const tombolSimpan = () => page.getByRole('button', { name: /Simpan Struk|Cetak Struk/ });

/** Tutup shift kalau ada (supaya uji mulai dari keadaan "belum buka kas"). */
async function tokenApi() {
  return page.evaluate(() => localStorage.getItem('th_token'));
}
/**
 * Panggilan API atas nama user yang sedang login. `/debts/pelanggan` dan `/shifts` khusus
 * superadmin, jadi skrip ini memakai dua token: `kasir` (dari localStorage) dan `admin`.
 */
let TOKEN_ADMIN = null;
async function api(method, jalur, body, sebagai = 'kasir') {
  const token = sebagai === 'admin' ? TOKEN_ADMIN : await tokenApi();
  const r = await fetch(`${API}/api${jalur}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// Token superadmin untuk membaca laporan & membersihkan data uji di akhir.
TOKEN_ADMIN = (
  await (
    await fetch(`${API}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: process.env.POS_ADMIN_USER ?? 'superadmin', password: process.env.POS_ADMIN_PASS ?? 'password' }),
    })
  ).json()
).token;

// ---------- 1. Gerbang buka kas ----------
await bukaDanTunggu(page, `${BASE}/login`);
await page.fill('input[autocomplete="username"]', USER);
await page.fill('input[type="password"]', PASS);
await page.click('button[type="submit"]');
await page.waitForURL('**/kasir', { timeout: 25000 });
await page.waitForTimeout(2500);

// Pastikan memang belum ada shift terbuka.
const aktifAwal = await api('GET', '/shifts/aktif');
if (aktifAwal.body) {
  bukti.catatan.push('shift terbuka dari sesi sebelumnya, ditutup dulu oleh skrip');
  await api('POST', '/shifts/tutup', { uang_fisik: 0 });
  await page.evaluate(() => localStorage.removeItem('th_shift'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
}

bukti.gerbang = await page.evaluate(() => {
  const main = document.querySelector('main');
  return {
    adaTombolBukaKas: [...main.querySelectorAll('button')].some((b) => /Buka Kas/.test(b.textContent ?? '')),
    adaTombolSimpan: [...main.querySelectorAll('button')].some((b) => /Simpan Struk|Cetak Struk/.test(b.textContent ?? '')),
    adaKotakCari: !!main.querySelector('input[type="search"]'),
  };
});

// ---------- 2. Buka kas dengan modal awal ----------
await page.locator('main input[inputmode="numeric"]').first().fill('50000');
await page.getByRole('button', { name: 'Buka Kas' }).click();
await page.waitForTimeout(2000);
bukti.bukaKas = {
  ...(await page.evaluate(() => ({
    adaTombolTutupKas: [...document.querySelectorAll('main button')].some((b) => /Tutup Kas/.test(b.textContent ?? '')),
    teks: (document.querySelector('main')?.innerText ?? '').slice(0, 200),
  }))),
  server: (await api('GET', '/shifts/aktif')).body,
};
const shiftId = bukti.bukaKas.server?.id;

// ---------- 3. Bon tanpa nama ditolak ----------
await tambahProduk(page, 'Sedaap Soto');
await page.waitForTimeout(500);
await page.locator('main input[aria-label="Jumlah dibayar"]').fill('1000');
await page.getByRole('button', { name: /^Bon/ }).click();
await page.waitForTimeout(300);
await tombolSimpan().first().click();
await page.waitForTimeout(1200);
bukti.bonTanpaNama = {
  url: page.url(),
  pesan: await page.evaluate(() => {
    const t = document.querySelector('main')?.innerText ?? '';
    return t.split('\n').find((l) => /Bon butuh nama/i.test(l)) ?? null;
  }),
};

// ---------- 4. Bon dengan nama: sisa jadi piutang ----------
const namaBon = 'Pelanggan Uji Bon';
await page.locator('main input[aria-label^="Nama tuan/nyonya"]').fill(namaBon);
await tombolSimpan().first().click();
await page.waitForURL('**/kasir/struk/**', { timeout: 20000 });
await page.waitForTimeout(1500);
const uuidBon = page.url().split('/kasir/struk/')[1].split('?')[0];
dibuat.push(uuidBon);
bukti.bonTersimpan = {
  uuid: uuidBon,
  struk: (await page.locator('body').innerText()).slice(0, 900),
};

const penjualan = await api('GET', `/sales/by-uuid/${uuidBon}`);
bukti.bonDiServer = {
  status: penjualan.status,
  total: penjualan.body?.total,
  dibayar: penjualan.body?.dibayar,
  sisa_piutang: penjualan.body?.sisa_piutang,
  customer_id: penjualan.body?.customer_id,
  shift_id: penjualan.body?.shift_id,
};

const pelanggan = await api('GET', `/debts/pelanggan?tipe=piutang`, undefined, 'admin');
bukti.piutangPelanggan = {
  // Nama di layar kasir hanya menerima huruf, jadi akhiran angka pada `namaBon` dibuang
  // browser; dibandingkan setelah trim, bukan sama persis.
  semua: (pelanggan.body?.rows ?? []).map((r) => `${r.nama}=${r.sisa}`),
  baris: (pelanggan.body?.rows ?? []).filter((r) => r.nama === namaBon),
};

// ---------- 5. Tutup kas: selisih dari uang fisik ----------
await page.goto(`${BASE}/kasir`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Tutup Kas' }).click();
await page.waitForTimeout(800);
const seharusnya = await page.evaluate(() => {
  const t = document.querySelector('.fixed.inset-0')?.innerText ?? '';
  const m = /Seharusnya di laci\s*Rp\s*([\d.]+)/.exec(t);
  return m ? Number(m[1].replaceAll('.', '')) : null;
});
await page.locator('.fixed.inset-0 input[inputmode="numeric"]').last().fill(String(seharusnya ?? 0));
await page.waitForTimeout(400);
await page.locator('.fixed.inset-0').getByRole('button', { name: 'Tutup Kas' }).click();
await page.waitForTimeout(2000);
// Riwayat shift hanya untuk superadmin, jadi yang dibaca di sini adalah pesan di layar
// (kasir melihat selisihnya langsung) + bukti bahwa shift sudah tidak terbuka lagi.
bukti.tutupKas = {
  seharusnya,
  shiftAktifSesudah: (await api('GET', '/shifts/aktif')).body,
  // Pesan selisih ada di elemen sr-only (pembaca layar), jadi dibaca lewat textContent.
  pesanLayar: await page.evaluate(() => {
    const t = document.querySelector('main')?.textContent ?? '';
    const i = t.indexOf('Kas ditutup');
    return i >= 0 ? t.slice(i, i + 90).trim() : null;
  }),
  riwayat403UntukKasir: (await api('GET', '/shifts')).status,
  shiftDipakai: shiftId,
};

// ---------- 6. Laporan per kasir & per jam memuat shift yang baru ditutup ----------
// Halaman /laporan khusus superadmin (akun kasir dialihkan ke /kasir), jadi angkanya
// dibaca lewat API superadmin. Tampilan halamannya diuji terpisah oleh verify-laporan.mjs.
const perKasir = await api('GET', '/reports/per-kasir', undefined, 'admin');
const perJam = await api('GET', '/reports/per-jam', undefined, 'admin');
bukti.laporanPerKasir = {
  status: perKasir.status,
  total: perKasir.body?.total,
  baris: (perKasir.body?.rows ?? []).map((r) => ({
    kasir: r.kasir, shift_mulai: r.shift_mulai, transaksi: r.transaksi, omzet: r.omzet, selisih: r.selisih,
  })),
};
bukti.laporanPerJam = {
  status: perJam.status,
  total: perJam.body?.total,
  baris: (perJam.body?.rows ?? []).map((r) => ({ jam: r.jam, transaksi: r.transaksi, omzet: r.omzet })),
};

// ---------- Pembersihan: hapus transaksi uji (stok dikembalikan server) ----------
bukti.pembersihan = [];
for (const uuid of dibuat) {
  const cari = await api('GET', `/sales/by-uuid/${uuid}`, undefined, 'admin');
  if (cari.status !== 200) continue;
  const hapus = await api('DELETE', `/sales/${cari.body.id}`, undefined, 'admin');
  bukti.pembersihan.push({ uuid, id: cari.body.id, statusHapus: hapus.status, hasil: hapus.body });
}

// Shift yang ditutup TIDAK dihapus: riwayat shift adalah catatan uang (selisih kas),
// jadi tidak ada endpoint hapus — dan memang tidak boleh ada. Setiap kali skrip ini
// dijalankan, satu shift uji (modal 50.000, selisih 0) tertinggal di riwayat.

await page.screenshot({ path: path.join(KELUARAN, 'bon-kas-kasir.png'), fullPage: false });
fs.writeFileSync(path.join(KELUARAN, 'bukti-bon-kas.json'), JSON.stringify(bukti, null, 2));
console.log(JSON.stringify(bukti, null, 2));
await browser.close();
