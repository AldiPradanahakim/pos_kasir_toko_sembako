/**
 * Verifikasi peran & mode offline:
 *  1. Kasir hanya melihat menu Kasir, Riwayat, Stok, Stok Scan (tanpa tombol hapus riwayat).
 *  2. Superadmin melihat menu lengkap.
 *  3. Penjaga rute: kasir yang membuka /laporan dialihkan ke /kasir.
 *  4. Offline: transaksi disimpan lokal (OFF-), lalu tersinkron tepat sekali saat online
 *     (tanpa duplikat).
 *
 * Jalankan: node scripts/verify-role-offline.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { bukaDanTunggu, masuk, pasangPenjagaOverlay, tambahProduk } from './verifikasi-util.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const KELUARAN = path.resolve('verifikasi');
fs.mkdirSync(KELUARAN, { recursive: true });

const bukti = {};
const browser = await chromium.launch();

/** Menu yang benar-benar terlihat di drawer hamburger pada layar HP. */
async function menuKasir(page, label) {
  await bukaDanTunggu(page, `${BASE}/kasir`);
  const navBawah = await page.evaluate(() =>
    [...document.querySelectorAll('nav')].filter(
      (n) => getComputedStyle(n).position === 'fixed' && n.getBoundingClientRect().bottom >= window.innerHeight - 1,
    ).length,
  );
  await page.getByRole('button', { name: 'Buka menu' }).click();
  await page.waitForTimeout(600);
  const menu = await page.evaluate(() =>
    [...document.querySelectorAll('nav a')].map((a) => a.textContent?.trim() ?? ''),
  );
  await page.screenshot({ path: path.join(KELUARAN, `menu-${label}-390.png`) });
  await page.getByRole('button', { name: 'Tutup menu' }).first().click().catch(() => {});
  return { menu, navBawahTampil: navBawah > 0 };
}

// ---------- 1. Kasir ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await pasangPenjagaOverlay(page);
  await masuk(page, BASE, 'aldipradana', 'Aldi1234');
  bukti.menuKasir = await menuKasir(page, 'kasir');
  await page.screenshot({ path: path.join(KELUARAN, 'menu-kasir-390.png') });

  // Penjaga rute superadmin.
  await page.goto(`${BASE}/laporan`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  bukti.kasirBukaLaporan = new URL(page.url()).pathname;
  await page.goto(`${BASE}/pengaturan`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  bukti.kasirBukaPengaturan = new URL(page.url()).pathname;
  await page.goto(`${BASE}/keuangan`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  bukti.kasirBukaKeuangan = new URL(page.url()).pathname;

  // Riwayat: kasir tidak boleh melihat kontrol Hapus.
  await page.goto(`${BASE}/riwayat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const teksRiwayat = await page.locator('main').innerText();
  bukti.kasirAdaTombolHapusRiwayat = /Hapus Riwayat per Tanggal/.test(teksRiwayat);
  bukti.kasirLihatBatalkan = /Batalkan/.test(teksRiwayat);
  await page.screenshot({ path: path.join(KELUARAN, 'riwayat-kasir-390.png') });

  // Backend tetap menolak (pertahanan berlapis).
  const tokKasir = await page.evaluate(() => localStorage.getItem('th_token'));
  const res = await fetch(`${API}/api/sales/1`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokKasir}` } });
  bukti.kasirDeleteDitolakStatus = res.status;

  await ctx.close();
}

// ---------- 2. Superadmin ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await pasangPenjagaOverlay(page);
  await masuk(page, BASE, 'superadmin', 'password');
  bukti.menuSuperadmin = await menuKasir(page, 'superadmin');

  await page.goto(`${BASE}/riwayat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const teks = await page.locator('main').innerText();
  // Teks judul modal baru ada di DOM setelah modalnya dibuka, jadi tombolnya diklik dulu.
  bukti.superadminAdaTombolHapusRiwayat = /Hapus Riwayat per Tanggal/.test(teks);
  await page.getByRole('button', { name: 'Hapus Riwayat per Tanggal' }).click();
  await page.waitForTimeout(700);
  bukti.superadminLihatHapus = /Hapus Riwayat per Rentang Tanggal/.test(await page.locator('main').innerText());
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Tutup' }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(KELUARAN, 'riwayat-superadmin-390.png') });

  // ---------- 3. Offline: simpan lokal, lalu sinkron tanpa duplikat ----------
  await page.goto(`${BASE}/kasir`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForTimeout(500);

  await tambahProduk(page, 'Sedaap');
  await page.fill('main input[placeholder*="Bu Siti"]', 'Pelanggan Uji Offline');
  // Dibayar diisi lewat kalkulator: kolomnya tombol, bukan input.
  await page.locator('main button[aria-haspopup="dialog"]').click();
  await page.waitForTimeout(500);
  const modalKasir = page.locator('.fixed.inset-0');
  for (const t of ['1', '0', '0', '0', '0']) await modalKasir.getByRole('button', { name: t, exact: true }).click();
  await modalKasir.getByRole('button', { name: 'Isi Dibayar' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Simpan Struk', exact: true }).click();
  await page.waitForURL('**/kasir/struk/**', { timeout: 20000 });
  await page.waitForTimeout(1500);
  const urlOffline = page.url();
  const uuidOffline = urlOffline.split('/kasir/struk/')[1].split('?')[0];
  const strukOffline = await page.locator('.struk').innerText();
  bukti.offline = { uuid: uuidOffline, nomorSementara: /OFF-\d{14}/.test(strukOffline), struk: strukOffline };
  await page.screenshot({ path: path.join(KELUARAN, 'struk-offline-390.png') });

  // Kembali online -> antrean dikuras.
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.goto(`${BASE}/kasir`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(8000);

  const tok = await page.evaluate(() => localStorage.getItem('th_token'));
  const cek = await fetch(`${API}/api/sales/by-uuid/${uuidOffline}`, { headers: { Authorization: `Bearer ${tok}` } });
  bukti.sinkron = { status: cek.status };
  if (cek.ok) {
    const s = await cek.json();
    bukti.sinkron.sale = { id: s.id, no_struk: s.no_struk, total: s.total, nama_pelanggan: s.nama_pelanggan };
  }
  // Hitung duplikat: jumlah transaksi dengan uuid ini harus tepat satu.
  const daftar = await (await fetch(`${API}/api/sales?limit=200`, { headers: { Authorization: `Bearer ${tok}` } })).json();
  bukti.sinkron.jumlahDenganUuidSama = daftar.filter((s) => s.uuid === uuidOffline).length;
  bukti.sinkron.jumlahTotalTransaksi = daftar.length;

  // Bersihkan transaksi uji (stok dikembalikan server) supaya data pemilik utuh.
  if (bukti.sinkron.sale?.id) {
    const hapus = await fetch(`${API}/api/sales/${bukti.sinkron.sale.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok}` },
    });
    bukti.pembersihan = { id: bukti.sinkron.sale.id, statusHapus: hapus.status, hasil: await hapus.json().catch(() => null) };
  }

  await ctx.close();
}

await browser.close();
fs.writeFileSync(path.join(KELUARAN, 'bukti-role-offline.json'), JSON.stringify(bukti, null, 2));
console.log(JSON.stringify(bukti, null, 2));
