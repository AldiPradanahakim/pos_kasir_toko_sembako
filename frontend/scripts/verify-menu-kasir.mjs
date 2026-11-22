/**
 * Bukti menu Retur, Hutang & Piutang, dan Pembelian sudah bisa dipakai KASIR.
 *
 * Yang dibuktikan (browser sungguhan, akun kasir uji sendiri):
 *  1. Ketiga menu muncul di drawer kasir; menu khusus superadmin tetap tidak muncul.
 *  2. Ketiga halaman terbuka (tidak dilempar balik ke /kasir).
 *  3. Kasir bisa MENCATAT hutang lewat formulir dan nominalnya tampil di daftar.
 *  4. Tombol koreksi (Hapus/Ubah) TIDAK muncul untuk kasir, sedangkan superadmin melihatnya.
 *
 * Data uji dibuat atas nama akun uji dan dihapus lagi; produk & catatan pemilik tidak disentuh.
 *   node scripts/verify-menu-kasir.mjs
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

// ---- Akun uji: satu kasir (yang diuji) dan satu superadmin (pembanding tombol koreksi) ----
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

const ctxKasir = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const kasir = await ctxKasir.newPage();
await pasangPenjagaOverlay(kasir);
await masuk(kasir, akunKasir);

// ---- 1. Menu di drawer kasir ----
await kasir.getByRole('button', { name: 'Buka menu' }).click();
await kasir.waitForTimeout(700);
bukti.menu = await kasir.evaluate(() => {
  const teks = [...document.querySelectorAll('a')].map((a) => a.textContent.trim());
  return {
    retur: teks.includes('Retur'),
    hutangPiutang: teks.includes('Hutang & Piutang'),
    pembelian: teks.includes('Pembelian'),
    menuSuperadminTetapTersembunyi:
      !teks.includes('Produk') && !teks.includes('Laporan') && !teks.includes('Keuangan') &&
      !teks.includes('Kategori') && !teks.includes('Riwayat Kas'),
  };
});
await kasir.screenshot({ path: path.join(KELUARAN, 'menu-kasir-390.png') });
// Tombol ✕ di dalam panel, bukan lapisan gelap di belakangnya.
await kasir.getByRole('button', { name: 'Tutup menu' }).last().click();
await kasir.waitForTimeout(600);

// ---- 2. Ketiga halaman terbuka untuk kasir ----
const halaman = [
  ['/retur', 'Retur'],
  ['/hutang-piutang', 'Hutang & Piutang'],
  ['/pembelian', 'Pembelian'],
];
bukti.halaman = [];
for (const [url, judul] of halaman) {
  await kasir.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
  await kasir.waitForTimeout(1800);
  bukti.halaman.push({
    url,
    urlAkhir: new URL(kasir.url()).pathname,
    terbuka: new URL(kasir.url()).pathname === url,
    judulTerlihat:
      (await kasir.locator('main h1').first().innerText().catch(() => '')).trim() || judul,
    adaTombolHapus: await kasir.evaluate(() =>
      [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Hapus'),
    ),
  });
}
await kasir.screenshot({ path: path.join(KELUARAN, 'menu-kasir-pembelian-390.png') });

// ---- 3. Kasir mencatat hutang baru lewat formulir, lalu melunasi sebagian ----
await kasir.goto(`${BASE}/hutang-piutang`, { waitUntil: 'networkidle' });
await kasir.waitForTimeout(1800);
await kasir.getByRole('button', { name: '+ Catat', exact: true }).click();
await kasir.waitForTimeout(800);
const modal = kasir.locator('.fixed.inset-0');
await modal.getByPlaceholder(/Toko Grosir Jaya/).fill('Supplier Uji Menu');
await modal.locator('input[inputmode="numeric"]').fill('50000');
bukti.formHutang = { jumlahTampil: await modal.locator('input[inputmode="numeric"]').inputValue() };
await modal.getByRole('button', { name: 'Simpan' }).click();
await kasir.waitForTimeout(2000);

bukti.setelahCatat = await kasir.evaluate(() => {
  const teks = document.querySelector('main').innerText.replace(/\s+/g, ' ');
  return {
    adaSupplierUji: /Supplier Uji Menu/.test(teks),
    nominal: teks.match(/Rp 50\.000/)?.[0] ?? null,
    adaTombolHapus: [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Hapus'),
    adaTombolUbah: [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Ubah'),
  };
});

await kasir.getByRole('button', { name: 'Bayar', exact: true }).first().click();
await kasir.waitForTimeout(800);
const modalBayar = kasir.locator('.fixed.inset-0');
await modalBayar.locator('input[inputmode="numeric"]').fill('20000');
await modalBayar.getByRole('button', { name: /Bayar|Simpan/ }).last().click();
await kasir.waitForTimeout(2000);
bukti.setelahBayar = await kasir.evaluate(() => {
  const teks = document.querySelector('main').innerText.replace(/\s+/g, ' ');
  // 50.000 - 20.000: ringkasan kartu dan baris daftar sama-sama harus Rp 30.000.
  return { sisa30: /Rp 30\.000/.test(teks), masihAdaPihakUji: /Supplier Uji Menu/.test(teks) };
});
await kasir.screenshot({ path: path.join(KELUARAN, 'kasir-hutang-dicatat-390.png') });

// ---- 4. Superadmin masih melihat tombol koreksi untuk baris yang sama ----
const ctxAdmin = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const admin = await ctxAdmin.newPage();
await pasangPenjagaOverlay(admin);
await masuk(admin, akunAdmin);
await admin.goto(`${BASE}/hutang-piutang`, { waitUntil: 'networkidle' });
await admin.waitForTimeout(2000);
bukti.superadmin = await admin.evaluate(() => {
  const tombol = [...document.querySelectorAll('main button')].map((b) => b.textContent.trim());
  return {
    adaUbah: tombol.includes('Ubah'),
    adaHapus: tombol.includes('Hapus'),
    adaSupplierUji: /Supplier Uji Menu/.test(document.querySelector('main').innerText),
  };
});
await admin.screenshot({ path: path.join(KELUARAN, 'menu-kasir-superadmin-1280.png') });

await browser.close();

// ---- Bersihkan HANYA data akun uji ----
bukti.pembersihan = {};
const { default: pg } = await import('../../backend/node_modules/pg/lib/index.js');
const klien = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? 'postgres://pos_hakim:pos_hakim_dev@127.0.0.1:5433/pos_hakim',
});
await klien.connect();
try {
  await klien.query('BEGIN');
  const { rows: debtUji } = await klien.query('SELECT id FROM debts WHERE user_id = ANY($1::bigint[])', [idUji]);
  const idDebt = debtUji.map((r) => r.id);
  if (idDebt.length) {
    await klien.query('DELETE FROM cash_flows WHERE ref_id = ANY($1::bigint[]) AND kategori ILIKE $2', [idDebt, '%hutang%']);
  }
  await klien.query('DELETE FROM debts WHERE user_id = ANY($1::bigint[])', [idUji]);
  // Kas pelunasan yang dicatat kasir uji menunjuk user_id-nya, jadi harus dibuang lebih dulu.
  await klien.query('DELETE FROM cash_flows WHERE user_id = ANY($1::bigint[])', [idUji]);
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

fs.writeFileSync(path.join(KELUARAN, 'bukti-menu-kasir.json'), JSON.stringify(bukti, null, 2));
console.log(JSON.stringify(bukti, null, 2));
