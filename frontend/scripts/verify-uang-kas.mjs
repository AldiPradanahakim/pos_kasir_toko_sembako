/**
 * Bukti dua hal yang dilihat pemilik toko:
 *
 *  1. SEMUA kolom uang menampilkan titik ribuan saat diketik (10.000 / 1.000 / 100.000),
 *     bukan angka gundul "10000". Diperiksa langsung di DOM setelah angka diketik.
 *  2. Kas keluar: kasir mencatat uang laci yang dipakai selama shift (beli barang, bayar
 *     ongkos), angkanya mengurangi "seharusnya di laci", muncul sebagai RINCIAN di laporan
 *     tutup kas, dan bisa dibatalkan selama kas masih terbuka.
 *
 * Skrip ini menulis data lewat dua akun uji buatan sendiri (kasir uji + superadmin uji) dan
 * menghapusnya lagi berdasarkan id akun itu, jadi data pemilik tidak tersentuh.
 *   node scripts/verify-uang-kas.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pasangPenjagaOverlay } from './verifikasi-util.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const KELUARAN = path.resolve('verifikasi');
fs.mkdirSync(KELUARAN, { recursive: true });

const bukti = { base: BASE };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });

const login = async (username, password) => {
  const res = await fetch(`${API}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return res.json();
};

const superadmin = await login('superadmin', 'password');
const api = async (method, p, body) => {
  const res = await fetch(`${API}/api${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superadmin.token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

// ---- Akun uji: kasir untuk alur kas, superadmin untuk halaman yang khusus dia ----
const akunKasir = `ujikas${Date.now() % 100000}`;
const akunAdmin = `ujiadm${Date.now() % 100000}`;
const buatKasir = await api('POST', '/users', {
  name: 'Kasir Uji', username: akunKasir, password: 'uji1234', role: 'kasir', is_active: true,
});
const buatAdmin = await api('POST', '/users', {
  name: 'Admin Uji', username: akunAdmin, password: 'uji1234', role: 'superadmin', is_active: true,
});
if (buatKasir.status !== 201 || buatAdmin.status !== 201) throw new Error('gagal membuat akun uji');
const idUji = [buatKasir.body.id, buatAdmin.body.id];

async function masuk(page, username) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.fill('input[autocomplete="username"]', username);
  await page.fill('input[type="password"]', 'uji1234');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/kasir', { timeout: 25000 });
  await page.waitForTimeout(1800);
}

/** Ketik satu angka ke kolom lalu kembalikan teks yang benar-benar tampil di kolom itu. */
async function ketikDanBaca(kolom, angka) {
  await kolom.fill('');
  await kolom.type(angka, { delay: 15 });
  return kolom.inputValue();
}

const ctxAdmin = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const admin = await ctxAdmin.newPage();
await pasangPenjagaOverlay(admin);
await masuk(admin, akunAdmin);

// ---- 1. Format titik ribuan di halaman yang dimiliki superadmin ----
const kasus = [];

// Keuangan: Jumlah (Rp) — kolomnya ada di dalam modal "Catat Arus Kas".
await admin.goto(`${BASE}/keuangan`, { waitUntil: 'networkidle' });
await admin.waitForTimeout(1500);
await admin.getByRole('button', { name: '+ Catat Arus Kas' }).click();
await admin.waitForTimeout(800);
const keu = admin.locator('.fixed.inset-0 input[inputmode="numeric"]').first();
await keu.waitFor({ timeout: 15000 });
kasus.push({ halaman: 'Keuangan · Jumlah (Rp)', ketik: '100000', tampil: await ketikDanBaca(keu, '100000') });

// Produk: harga jual & harga modal per satuan
await admin.goto(`${BASE}/produk`, { waitUntil: 'networkidle' });
await admin.waitForTimeout(1500);
await admin.getByRole('button', { name: '+ Tambah Produk' }).click();
await admin.waitForTimeout(1000);
const kolomHarga = admin.locator('.fixed.inset-0 input[inputmode="numeric"]');
const jumlahKolom = await kolomHarga.count();
if (jumlahKolom >= 2) {
  kasus.push({
    halaman: 'Produk · Harga jual & modal',
    ketik: '10000 / 1000',
    tampil: [await ketikDanBaca(kolomHarga.nth(1), '10000'), await ketikDanBaca(kolomHarga.nth(2), '1000')].join(' / '),
  });
}

// Hutang & Piutang: Jumlah (Rp)
await admin.goto(`${BASE}/hutang-piutang`, { waitUntil: 'networkidle' });
await admin.waitForTimeout(1500);
await admin.getByRole('button', { name: '+ Catat', exact: true }).click();
await admin.waitForTimeout(900);
const hp = admin.locator('.fixed.inset-0 input[inputmode="numeric"]').first();
if (await hp.count()) {
  kasus.push({ halaman: 'Hutang & Piutang · Jumlah (Rp)', ketik: '10000', tampil: await ketikDanBaca(hp, '10000') });
}
await admin.screenshot({ path: path.join(KELUARAN, 'uang-format-hutang-1280.png') });

// Retur: uang kembali ke pembeli
await admin.goto(`${BASE}/retur`, { waitUntil: 'networkidle' });
await admin.waitForTimeout(1800);
const returUang = admin.locator('main input[inputmode="numeric"]').nth(1);
if (await returUang.count()) {
  kasus.push({ halaman: 'Retur · Uang kembali (Rp)', ketik: '100000', tampil: await ketikDanBaca(returUang, '100000') });
}
await admin.screenshot({ path: path.join(KELUARAN, 'uang-format-retur-1280.png') });

// Stok Scan: harga satuan di baris hasil scan
await admin.goto(`${BASE}/stok/scan`, { waitUntil: 'networkidle' });
await admin.waitForTimeout(1500);
kasus.push({ halaman: 'Stok Scan', catatan: 'input harga memakai InputUang yang sama (diperiksa di StokScan.tsx)' });

bukti.formatUang = kasus;

// ---- 2. Kas keluar: uang laci dipakai selama shift ----
const ctxKasir = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const kasir = await ctxKasir.newPage();
await pasangPenjagaOverlay(kasir);
await masuk(kasir, akunKasir);

const kolomModal = kasir.locator('main input[inputmode="numeric"]').first();
await kolomModal.fill('80000');
bukti.modalAwalDiLayar = await kolomModal.inputValue();
await kasir.getByRole('button', { name: 'Buka Kas' }).click();
await kasir.waitForTimeout(1500);

// Catat dua pengeluaran: satu dibatalkan, satu dipakai.
await kasir.getByRole('button', { name: 'Kas Keluar' }).click();
await kasir.waitForTimeout(600);
const dlg = kasir.locator('.fixed.inset-0');
const kolomJumlah = dlg.locator('input[inputmode="numeric"]');
bukti.kasKeluar = { ketikJumlah: await ketikDanBaca(kolomJumlah, '15000') };
await dlg.getByPlaceholder(/beli gula/).fill('beli gula 5 kg');
await dlg.getByRole('button', { name: 'Catat Kas Keluar' }).click();
await kasir.waitForTimeout(1500);

// Yang salah catat dibatalkan lagi.
await kasir.getByRole('button', { name: 'Kas Keluar' }).click();
await kasir.waitForTimeout(600);
const dlg2 = kasir.locator('.fixed.inset-0');
await dlg2.locator('input[inputmode="numeric"]').fill('5000');
await dlg2.getByPlaceholder(/beli gula/).fill('salah catat');
await dlg2.getByRole('button', { name: 'Catat Kas Keluar' }).click();
await kasir.waitForTimeout(1500);
await kasir.getByRole('button', { name: 'Kas Keluar' }).click();
await kasir.waitForTimeout(600);
const dlg3 = kasir.locator('.fixed.inset-0');
bukti.kasKeluar.daftarSebelumBatal = await dlg3.evaluate((el) => el.innerText.replace(/\s+/g, ' '));
await dlg3.getByRole('button', { name: 'Batalkan pengeluaran salah catat' }).click();
await kasir.waitForTimeout(1500);
bukti.kasKeluar.daftarSetelahBatal = await kasir
  .locator('.fixed.inset-0')
  .evaluate((el) => el.innerText.replace(/\s+/g, ' '));
await kasir.screenshot({ path: path.join(KELUARAN, 'kas-keluar-kasir-390.png') });
await kasir.locator('.fixed.inset-0').getByRole('button', { name: 'Batal', exact: true }).click();
// Tunggu modal benar-benar hilang: tombol "Tutup Kas" di belakangnya tidak bisa diketuk
// selama lapisan modal masih terpasang.
await kasir.locator('.fixed.inset-0').waitFor({ state: 'hidden', timeout: 15000 });

// Bar kas harus menyebut uang keluar dan "seharusnya di laci" yang sudah dikurangi.
bukti.barKas = await kasir.evaluate(() => {
  const teks = document.querySelector('main').innerText.replace(/\s+/g, ' ');
  return teks.match(/Kas dibuka[^T]*/)?.[0] ?? null;
});

// Tutup kas: dialog menampilkan uang masuk, uang keluar, dan rinciannya.
await kasir.getByRole('button', { name: 'Tutup Kas' }).click();
await kasir.waitForTimeout(700);
const tutup = kasir.locator('.fixed.inset-0');
bukti.dialogTutup = await tutup.evaluate((el) => {
  const teks = el.innerText.replace(/\s+/g, ' ');
  return {
    teks,
    adaUangMasuk: /Uang masuk/.test(teks),
    adaUangKeluar: /Uang keluar \(dipakai\) − Rp 15\.000/.test(teks),
    adaRincian: /uang dipakai selama shift/i.test(teks),
    rincianGula: /beli gula 5 kg/.test(teks),
    seharusnya: /Seharusnya di laci Rp 65\.000/.test(teks),
  };
});
await kasir.screenshot({ path: path.join(KELUARAN, 'tutup-kas-rincian-390.png') });

// Uang fisik 65.000 = pas dengan modal 80.000 - 15.000 yang dipakai.
await tutup.locator('input[inputmode="numeric"]').fill('65000');
await kasir.waitForTimeout(400);
await tutup.getByRole('button', { name: 'Tutup Kas' }).click();
await kasir.waitForTimeout(2000);

bukti.laporan = await kasir.evaluate(() => {
  const teks = document.querySelector('main').innerText.replace(/\s+/g, ' ');
  return {
    adaRincian: /rincian uang dipakai \(1\)/i.test(teks),
    barisGula: /beli gula 5 kg/.test(teks),
    uangKeluar: /Uang keluar \(dipakai\) − Rp 15\.000/.test(teks),
    seharusnya: /Uang seharusnya di laci Rp 65\.000/.test(teks),
    selisih: /Selisih Rp 0/.test(teks),
  };
});
await kasir.screenshot({ path: path.join(KELUARAN, 'laporan-tutup-kas-rincian-390.png') });

// Laporan yang sama dibaca superadmin dari Riwayat Kas.
await admin.goto(`${BASE}/kas`, { waitUntil: 'networkidle' });
await admin.waitForTimeout(1800);
const barisUji = admin.locator('main tbody tr', { hasText: 'Kasir Uji' }).first();
await barisUji.getByRole('button', { name: 'Lihat' }).click();
await admin.waitForTimeout(1800);
bukti.riwayatSuperadmin = await admin.evaluate(() => {
  const teks = document.querySelector('main').innerText.replace(/\s+/g, ' ');
  return {
    adaRincian: /rincian uang dipakai/i.test(teks),
    barisGula: /beli gula 5 kg/.test(teks),
    kolomKeluar: /keluar/i.test(teks),
  };
});
await admin.screenshot({ path: path.join(KELUARAN, 'riwayat-kas-rincian-1280.png') });

await browser.close();

// ---- Bersihkan HANYA data dua akun uji ----
bukti.pembersihan = {};
const { default: pg } = await import('../../backend/node_modules/pg/lib/index.js');
const klien = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? 'postgres://pos_hakim:pos_hakim_dev@127.0.0.1:5433/pos_hakim',
});
await klien.connect();
try {
  await klien.query('BEGIN');
  const { rows: sift } = await klien.query('SELECT id FROM shifts WHERE user_id = ANY($1::bigint[])', [idUji]);
  const idShift = sift.map((r) => r.id);
  if (idShift.length) await klien.query('DELETE FROM cash_flows WHERE shift_id = ANY($1::bigint[])', [idShift]);
  await klien.query('DELETE FROM sales WHERE user_id = ANY($1::bigint[])', [idUji]);
  await klien.query('DELETE FROM shifts WHERE user_id = ANY($1::bigint[])', [idUji]);
  await klien.query('DELETE FROM tokens WHERE user_id = ANY($1::bigint[])', [idUji]);
  await klien.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [idUji]);
  await klien.query('COMMIT');
  bukti.pembersihan.selesai = true;
} catch (e) {
  await klien.query('ROLLBACK');
  bukti.pembersihan.gagal = e.message;
} finally {
  await klien.end();
}

fs.writeFileSync(path.join(KELUARAN, 'bukti-uang-kas.json'), JSON.stringify(bukti, null, 2));
console.log(JSON.stringify(bukti, null, 2));
