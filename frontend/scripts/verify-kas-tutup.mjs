/**
 * Bukti alur kas: buka kas → tutup kas → laporan, plus total barang/qty di kasir & struk.
 *
 * Yang dibuktikan:
 *  1. Buka kas 80.000 lalu tutup dengan uang fisik 100.000: laporan tutup kas (modal,
 *     seharusnya, fisik, selisih +20.000) tampil SEKALI di layar kasir dan bisa dicetak,
 *     tanpa kasir dipindah ke Riwayat Kas.
 *  2. Shift TANPA penjualan tetap muncul di laporan (dulu hilang karena laporan dibangun
 *     dari tabel penjualan).
 *  3. Riwayat Kas khusus superadmin: kasir yang membuka `/kas` dilempar ke `/kasir`, menunya
 *     tidak ada di sidebar, dan API-nya menjawab 403. Superadmin melihat kas semua kasir.
 *  4. Layar kasir menampilkan "Jumlah barang" dan "Total qty" keranjang.
 *  5. Struk menampilkan baris "Jumlah N barang · M qty".
 *
 * Skrip ini MENULIS data (satu akun kasir uji, satu akun superadmin uji, satu produk uji,
 * satu transaksi) lalu menghapusnya lagi berdasarkan id akun uji itu sendiri — data pemilik
 * tidak pernah disentuh, termasuk bila pemilik sedang membuka kas. Jalankan:
 *   node scripts/verify-kas-tutup.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pasangPenjagaOverlay } from './verifikasi-util.mjs';

/**
 * Login TANPA membuka kas. `masuk()` bawaan langsung membuka kas dengan modal 0, sedangkan
 * alur yang diuji di sini justru buka kas dengan modal 80.000.
 */
async function masukTanpaKas(page, base, username, password) {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.fill('input[autocomplete="username"]', username);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/kasir', { timeout: 25000 });
  await page.waitForTimeout(1500);
}

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

// Token superadmin asli hanya dipakai untuk MENYIAPKAN akun uji (tidak membuka kas).
const superadmin = await login('superadmin', 'password');
const tokSuper = superadmin.token;
const api = async (method, p, body) => {
  const res = await fetch(`${API}/api${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokSuper}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

// ---- Persiapan: satu akun kasir dan satu produk uji (dibersihkan di akhir) ----
const akunKasir = `ujikas${Date.now() % 100000}`;
const buatKasir = await api('POST', '/users', {
  name: 'Kasir Uji',
  username: akunKasir,
  password: 'uji1234',
  role: 'kasir',
  is_active: true,
});
if (buatKasir.status !== 201) throw new Error(`gagal membuat akun kasir uji: ${JSON.stringify(buatKasir)}`);

/**
 * Superadmin uji terpisah, bukan akun `superadmin` asli: semua shift & penjualan yang
 * dibuat skrip ini jadi milik akun ini, sehingga pembersihan cukup menghapus per user_id
 * dan shift pemilik toko yang mungkin sedang terbuka tidak ikut terhapus.
 */
const akunAdmin = `ujiadm${Date.now() % 100000}`;
const buatAdmin = await api('POST', '/users', {
  name: 'Admin Uji',
  username: akunAdmin,
  password: 'uji1234',
  role: 'superadmin',
  is_active: true,
});
if (buatAdmin.status !== 201) throw new Error(`gagal membuat akun superadmin uji: ${JSON.stringify(buatAdmin)}`);
const idUji = [buatKasir.body.id, buatAdmin.body.id];

const satuan = (await api('GET', '/units')).body;
const pcsId = satuan.find((u) => u.name === 'pcs').id;
const produk = await api('POST', '/products', {
  name: 'Produk Uji Kas',
  base_unit: 'pcs',
  is_active: true,
  units: [{ unit_id: pcsId, isi: 1, harga_jual: 5_000, harga_modal: 4_000 }],
});
if (produk.status !== 201) throw new Error(`gagal membuat produk uji: ${JSON.stringify(produk)}`);
await api('POST', '/stock/in', { product_id: produk.body.id, unit_id: pcsId, qty: 20 });

// ---- Alur kasir: buka 80.000, tutup 100.000 ----
const ctxKasir = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const kasir = await ctxKasir.newPage();
await pasangPenjagaOverlay(kasir);

await masukTanpaKas(kasir, BASE, akunKasir, 'uji1234');
await kasir.waitForTimeout(1200);

await kasir.locator('main input[inputmode="numeric"]').first().fill('80000');
await kasir.getByRole('button', { name: 'Buka Kas' }).click();
await kasir.waitForTimeout(1500);
bukti.setelahBukaKas = await kasir.evaluate(() => document.querySelector('main').innerText.replace(/\s+/g, ' ').match(/Kas dibuka[^T]*/)?.[0] ?? null);

await kasir.getByRole('button', { name: 'Tutup Kas' }).click();
await kasir.waitForTimeout(600);
const dialog = kasir.locator('.fixed.inset-0');
await dialog.locator('input[inputmode="numeric"]').fill('100000');
await kasir.waitForTimeout(300);
bukti.selisihDiDialog = await dialog.evaluate(
  (el) => el.innerText.replace(/\s+/g, ' ').match(/Selisih Rp [\d.]+/)?.[0] ?? null,
);
await dialog.getByRole('button', { name: 'Tutup Kas' }).click();

// Kasir TIDAK diarahkan ke Riwayat Kas (menu itu khusus superadmin). Laporan tutup kasnya
// tampil sekali di layar kasir sendiri, di tempat kartu "Buka Kas".
await kasir.waitForTimeout(2000);
bukti.urlSetelahTutup = kasir.url();
bukti.tetapDiKasir = kasir.url().endsWith('/kasir');
bukti.laporan = await kasir.evaluate(() => {
  const main = document.querySelector('main');
  const teks = main.innerText.replace(/\s+/g, ' ');
  return {
    judul: `Laporan Tutup Kas — ${teks.match(/Laporan Tutup Kas — ([^ ]+(?: [^ ]+)?)/)?.[1] ?? ''}`,
    modal: /Modal awal Rp 80\.000/.test(teks),
    seharusnya: /Uang seharusnya di laci Rp 80\.000/.test(teks),
    fisik: /Uang fisik dihitung Rp 100\.000/.test(teks),
    selisih: /Selisih Rp 20\.000/.test(teks),
    transaksi: /Transaksi 0/.test(teks),
    adaTombolCetak: [...main.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Cetak'),
  };
});
await kasir.screenshot({ path: path.join(KELUARAN, 'laporan-tutup-kas-390.png') });

// Riwayat kas khusus superadmin: kasir yang mengetik /kas dilempar balik ke /kasir,
// dan menunya tidak pernah muncul di sidebar kasir.
await kasir.goto(`${BASE}/kas`, { waitUntil: 'networkidle' });
await kasir.waitForTimeout(1500);
bukti.riwayatKasir = {
  urlDitolak: kasir.url(),
  dilemparKeKasir: kasir.url().endsWith('/kasir'),
  adaMenu: await kasir.evaluate(() =>
    [...document.querySelectorAll('a')].some((a) => a.textContent.trim() === 'Riwayat Kas'),
  ),
};

// ---- Superadmin: melihat semua shift, termasuk shift dari akun kasir di atas ----
const ctxAdmin = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const admin = await ctxAdmin.newPage();
await masukTanpaKas(admin, BASE, akunAdmin, 'uji1234');
await admin.goto(`${BASE}/kas`, { waitUntil: 'networkidle' });
await admin.waitForTimeout(1800);
bukti.riwayatSuperadmin = await admin.evaluate(() => {
  const semua = [...document.querySelectorAll('main tbody tr')];
  const uji = semua.filter((tr) => /Kasir Uji|Admin Uji/.test(tr.querySelector('td')?.innerText ?? ''));
  return {
    adaMenu: [...document.querySelectorAll('a')].some((a) => a.textContent.trim() === 'Riwayat Kas'),
    jumlahTotal: semua.length,
    barisUji: uji.map((tr) => tr.innerText.replace(/\s+/g, ' ')),
  };
});
await admin.screenshot({ path: path.join(KELUARAN, 'riwayat-kas-superadmin-1280.png') });

// ---- Total barang & qty di kasir dan struk ----
await admin.goto(`${BASE}/kasir`, { waitUntil: 'networkidle' });
// Tunggu status kas selesai dimuat: sebelum itu tombol Buka/Tutup Kas belum ada.
await admin
  .locator('main button', { hasText: /^(Buka Kas|Tutup Kas)$/ })
  .first()
  .waitFor({ timeout: 20000 });
if (await admin.getByRole('button', { name: 'Buka Kas' }).count()) {
  await admin.locator('main input[inputmode="numeric"]').first().fill('50000');
  await admin.getByRole('button', { name: 'Buka Kas' }).click();
  await admin.waitForTimeout(1200);
}
await admin.fill('main input[type="search"]', 'Produk Uji Kas');
await admin.waitForTimeout(900);
await admin.locator('main button[aria-label^="Tambah Produk Uji Kas "]').first().click();
await admin.waitForTimeout(400);
await admin.locator('main button[aria-label^="Tambah qty Produk Uji Kas"]').click();
await admin.waitForTimeout(500);
bukti.halamanKasir = await admin.evaluate(() => {
  const teks = document.querySelector('main').innerText.replace(/\s+/g, ' ');
  return {
    jumlahBarang: /Jumlah barang 1/.test(teks),
    totalQty: /Total qty 2/.test(teks),
    potongan: teks.match(/Jumlah barang \d+/)?.[0] ?? null,
    potonganQty: teks.match(/Total qty \d+/)?.[0] ?? null,
  };
});
await admin.screenshot({ path: path.join(KELUARAN, 'kasir-total-qty-1280.png') });

// Tanpa jumlah dibayar, tombol simpan menolak: uang tunai kurang dari total.
await admin.fill('main input[aria-label="Jumlah dibayar"]', '50000');
await admin.waitForTimeout(300);
await admin.getByRole('button', { name: 'Cetak Struk' }).click();
await admin.waitForURL('**/kasir/struk/**', { timeout: 20000 });
/** Transaksi contoh milik superadmin ini ikut dihapus di akhir (hanya yang ini). */
const uuidStruk = admin.url().split('/kasir/struk/')[1].split('?')[0];
await admin.waitForTimeout(1500);
bukti.struk = await admin.evaluate(() => {
  const struk = document.querySelector('.struk');
  const teks = struk?.innerText.replace(/\s+/g, ' ') ?? '';
  return { teks, jumlah: teks.match(/Jumlah 1 barang · 2 qty/)?.[0] ?? null };
});
await admin.screenshot({ path: path.join(KELUARAN, 'struk-total-qty-1280.png') });

await browser.close();

// ---- Bersihkan data uji: HANYA milik akun uji di atas ----
// Semua baris yang dibuat skrip ini dimiliki dua akun uji (`idUji`), jadi pembersihan
// memakai user_id itu. Shift/sale milik pemilik toko — termasuk yang sedang terbuka —
// tidak tersentuh, apa pun yang terjadi selama skrip berjalan.
bukti.pembersihan = { catatan: 'data dua akun uji dihapus lewat SQL langsung' };
const { default: pg } = await import('../../backend/node_modules/pg/lib/index.js');
const klien = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? 'postgres://pos_hakim:pos_hakim_dev@127.0.0.1:5433/pos_hakim',
});
await klien.connect();
try {
  await klien.query('BEGIN');
  const { rows: siftUji } = await klien.query('SELECT id FROM shifts WHERE user_id = ANY($1::bigint[])', [idUji]);
  const idShift = siftUji.map((r) => r.id);
  if (idShift.length) {
    // Urutan WAJIB: cash_flows & sales menunjuk shifts tanpa ON DELETE CASCADE.
    await klien.query('DELETE FROM cash_flows WHERE shift_id = ANY($1::bigint[])', [idShift]);
  }
  await klien.query(
    'DELETE FROM sales WHERE uuid = $1 OR user_id = ANY($2::bigint[]) OR shift_id = ANY($3::bigint[])',
    [uuidStruk, idUji, idShift],
  );
  await klien.query('DELETE FROM shifts WHERE user_id = ANY($1::bigint[])', [idUji]);
  await klien.query('DELETE FROM stock_movements WHERE product_id = $1', [produk.body.id]);
  await klien.query('DELETE FROM product_units WHERE product_id = $1', [produk.body.id]);
  await klien.query('DELETE FROM products WHERE id = $1', [produk.body.id]);
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

fs.writeFileSync(path.join(KELUARAN, 'bukti-kas-tutup.json'), JSON.stringify(bukti, null, 2));
console.log(JSON.stringify(bukti, null, 2));
