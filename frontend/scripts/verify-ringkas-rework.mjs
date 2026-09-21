/**
 * Pemeriksaan ringkas setelah rework tata letak kasir: halaman lain yang TIDAK boleh
 * berubah (OCR stok scan, dan data pemilik) masih sehat pada build produksi.
 *
 * Jalankan: node scripts/verify-ringkas-rework.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { bukaDanTunggu, masuk, pasangPenjagaOverlay } from './verifikasi-util.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const KELUARAN = path.resolve('verifikasi');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await pasangPenjagaOverlay(page);
await masuk(page, BASE, 'superadmin', 'password');

const bukti = {};

// OCR: halaman /stok/scan harus tetap lengkap (terpisah dari kasir).
await bukaDanTunggu(page, `${BASE}/stok/scan`);
await page.waitForTimeout(2500);
bukti.ocr = await page.evaluate(() => {
  const main = document.querySelector('main');
  return {
    inputBerkas: main.querySelectorAll('input[type="file"]').length,
    tombolBaca: [...main.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /Baca Teks/i.test(t)),
    judul: [...main.querySelectorAll('h2')].map((h) => h.textContent.trim()),
    teks: main.innerText.split('\n').map((t) => t.trim()).filter(Boolean).slice(0, 6),
  };
});

// Data pemilik: jumlah produk, stok Sedaap Soto, dan sisa transaksi/pembelian uji.
const login = await fetch(`${API}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'superadmin', password: 'password' }),
});
const { token } = await login.json();
const ambil = async (p) => (await fetch(`${API}/api${p}`, { headers: { Authorization: `Bearer ${token}` } })).json();
const pull = await ambil('/sync/pull');
const daftar = (b) => (Array.isArray(b) ? b : (b?.rows ?? b?.data ?? []));
const sales = daftar(await ambil('/sales?limit=500'));
const purchases = daftar(await ambil('/purchases?limit=500'));
const movements = daftar(await ambil('/stock/movements?limit=500'));
bukti.data = {
  produk: pull.products.length,
  sedaapSoto: pull.stock.find((s) => s.product_id === 1)?.stok_base,
  penjualan: sales.length,
  pembelian: purchases.length,
  // Transaksi uji kami selalu bernama pelanggan "Pelanggan Uji …" — harus nol sisa.
  sisaUjiJual: sales.filter((s) => /Pelanggan Uji/.test(s.nama_pelanggan ?? '')).map((s) => s.uuid),
  // Nota pembelian uji memakai supplier "Supplier Uji …".
  sisaUjiBeli: purchases.filter((p) => /Uji/.test(p.supplier ?? '')).map((p) => p.id),
  // Movement uji OCR memakai catatan koreksi uji.
  sisaUjiMovement: movements.filter((m) => /uji/i.test(m.note ?? '')).map((m) => m.id),
  jumlahMovement: movements.length,
};

// Keranjang kasir harus kosong setelah semua pengujian (localStorage bersih per konteks baru).
await browser.close();
fs.writeFileSync(path.join(KELUARAN, 'bukti-ringkas-rework.json'), JSON.stringify(bukti, null, 2));
console.log(JSON.stringify(bukti, null, 2));
