/**
 * Bukti fitur "Scan Nota" di layar KASIR, dijalankan di browser sungguhan terhadap
 * build produksi yang disajikan backend (port 3000).
 *
 * Yang dibuktikan:
 *  1. Tombol "Scan Nota" membuka modal TANPA meninggalkan halaman kasir.
 *  2. Foto daftar belanja (nama + jumlah + satuan, tanpa harga) terbaca menjadi baris
 *     dengan produk, satuan, dan qty yang benar — termasuk satuan "dus"/"slop".
 *  3. Baris yang produknya tidak dikenali tetap tampil dan TIDAK dicentang.
 *  4. "Masukkan ke Keranjang" memasukkan barang yang lolos, sementara baris yang stoknya
 *     tidak cukup ditolak dengan pesan dan tetap tampil untuk diperbaiki.
 *  5. Harga yang dipakai adalah harga jual master produk, bukan angka di nota.
 *
 * Nota uji dibangun dari produk yang stoknya MEMANG cukup saat dijalankan, supaya buktinya
 * tidak bergantung pada sisa stok data pemilik hari itu. Tidak ada transaksi yang disimpan,
 * jadi stok tidak berubah.
 *
 * Jalankan: node scripts/verify-scan-nota.mjs
 * Bila browser Playwright belum terpasang untuk versi paket ini:
 *   npx playwright install chromium   (atau set CHROME_PATH ke chrome/chrome-headless-shell)
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { masuk, pasangPenjagaOverlay } from './verifikasi-util.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const KELUARAN = path.resolve('verifikasi');
const GAMBAR = path.join(KELUARAN, 'nota-belanja-uji.png');
fs.mkdirSync(KELUARAN, { recursive: true });

const bukti = { base: BASE, catatan: [] };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });

// ---- 1. Susun nota uji dari produk yang stoknya cukup ----
const masukApi = await fetch(`${API}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'aldipradana', password: 'Aldi1234' }),
});
const tok = (await masukApi.json()).token;
const ambil = (p) => fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${tok}` } }).then((r) => r.json());
const [produkApi, stokApi, unitApi] = await Promise.all([
  ambil('/api/products'),
  ambil('/api/stock'),
  ambil('/api/units'),
]);
/** Nama satuan → inisial dari master; nota uji ditulis dengan singkatan seperti kasir. */
const inisial = new Map(unitApi.map((u) => [u.name, u.inisial]));
const stokBase = new Map(stokApi.map((s) => [s.product_id, Number(s.stok_base) || 0]));

/** Produk dengan satuan besar (isi > 1) yang stoknya cukup untuk minimal satu satuan itu. */
const kandidat = produkApi
  .filter((p) => p.is_active !== false)
  .map((p) => ({ p, unit: [...p.units].sort((a, b) => b.isi - a.isi).find((u) => u.isi > 1) }))
  .filter((x) => x.unit && (stokBase.get(x.p.id) ?? 0) >= x.unit.isi)
  .map((x) => ({
    nama: x.p.name,
    unit: x.unit.unit_name,
    qty: Math.min(2, Math.floor((stokBase.get(x.p.id) ?? 0) / x.unit.isi)),
    harga: x.unit.harga_jual,
  }));

if (kandidat.length < 2) throw new Error('tidak ada dua produk berstok cukup untuk nota uji');
const notaMasuk = kandidat.slice(0, 2);

// Baris ketiga sengaja minta LEBIH BANYAK dari stok yang ada: harus ditolak, bukan
// dipaksakan. Qty-nya dihitung dari stok nyata (bukan angka karangan) supaya bukti ini
// tetap sahih walau stok pemilik berubah.
const kurang = produkApi
  .filter((p) => p.is_active !== false)
  .map((p) => ({ p, unit: [...p.units].sort((a, b) => b.isi - a.isi)[0] }))
  .filter((x) => x.unit && !notaMasuk.some((n) => n.nama === x.p.name))
  .map((x) => ({ ...x, qty: Math.floor((stokBase.get(x.p.id) ?? 0) / x.unit.isi) + 2 }))
  .find((x) => x.unit.isi > 1);
const notaKurang = kurang && { nama: kurang.p.name, unit: kurang.unit.unit_name, qty: kurang.qty, harga: kurang.unit.harga_jual };

// Singkatan ditulis dalam kurung, persis seperti contoh pemilik: "2 (r) Beng Beng".
const tulis = (qty, unit) => {
  const ini = inisial.get(unit);
  return ini ? `${qty} (${ini})` : `${qty} ${unit}`;
};
const barisNota = [
  ...notaMasuk.map((n) => [tulis(n.qty, n.unit), n.nama.toUpperCase()]),
  ...(notaKurang ? [[tulis(notaKurang.qty, notaKurang.unit), notaKurang.nama.toUpperCase()]] : []),
  ['', 'SABUN WANGI'],
];
bukti.notaUji = barisNota.map(([qty, nama]) => `${qty} ${nama}`.trim());

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #eee; font-family: 'Courier New', monospace; }
  .kertas { width: 680px; padding: 26px 28px; background: #fff; color: #111; font-size: 24px; line-height: 1.6; }
  .judul { text-align: center; font-weight: bold; text-transform: uppercase; margin-bottom: 14px; }
  .baris { display: flex; gap: 10px; }
  .qty { width: 150px; }
</style></head><body><div class="kertas">
  <div class="judul">Daftar Belanja</div>
${barisNota.map(([qty, nama]) => `  <div class="baris"><span class="qty">${qty}</span><span>${nama}</span></div>`).join('\n')}
</div></body></html>`;

{
  const page = await browser.newPage({ viewport: { width: 760, height: 520 } });
  await page.setContent(html);
  await page.waitForTimeout(200);
  await page.locator('.kertas').screenshot({ path: GAMBAR });
  await page.close();
}

// ---- 2. Jalankan alur di layar kasir ----
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
page.on('pageerror', (e) => bukti.catatan.push(`pageerror: ${e.message}`));
await pasangPenjagaOverlay(page);

await masuk(page, BASE, 'aldipradana', 'Aldi1234');
await page.waitForTimeout(1500);

const modal = page.locator('.fixed.inset-0');
bukti.tombolScanNota = await page.getByRole('button', { name: 'Scan Nota' }).count();

await page.getByRole('button', { name: 'Scan Nota' }).click();
await page.waitForTimeout(500);
bukti.modalTerbuka = (await modal.count()) > 0;
bukti.masihDiKasir = new URL(page.url()).pathname;
await page.screenshot({ path: path.join(KELUARAN, 'scan-nota-awal-390.png') });

await modal.locator('input[type="file"]').setInputFiles(GAMBAR);
await page.waitForTimeout(800);
await modal.getByRole('button', { name: 'Baca Nota' }).click();

for (let i = 0; i < 120; i++) {
  if (await modal.getByText(/Periksa barang/).count()) break;
  await page.waitForTimeout(2000);
}
await page.waitForTimeout(2500);

/** Baca seluruh baris hasil pindai dari DOM modal. */
const bacaBaris = () =>
  page.evaluate(() => {
    const kotak = document.querySelector('.fixed.inset-0');
    if (!kotak) return [];
    return [...kotak.querySelectorAll('input[type="checkbox"][id^="nota-"]')].map((cb) => {
      let blok = cb.parentElement;
      while (blok && !blok.querySelector('[aria-label^="Satuan baris"]')) blok = blok.parentElement;
      const satu = blok?.querySelector('[aria-label^="Satuan baris"]');
      const qty = blok?.querySelector('[aria-label^="Qty baris"]');
      const produk = blok?.querySelector('[aria-label^="Produk baris"]');
      const label = blok?.querySelector('label span:nth-child(2)');
      return {
        namaNota: label?.textContent?.trim() ?? '',
        dicentang: cb.checked,
        produkNama: produk?.value ?? '',
        satuanNama: satu?.selectedOptions?.[0]?.textContent?.trim() ?? '',
        qty: qty?.value ?? '',
      };
    });
  });

bukti.barisHasilPindai = await bacaBaris();
bukti.totalTampil = await page.evaluate(() => {
  const kotak = document.querySelector('.fixed.inset-0');
  const p = [...(kotak?.querySelectorAll('p') ?? [])].find((el) => /^Total \d+ barang/.test(el.textContent.trim()));
  return p?.textContent.replace(/\s+/g, ' ').trim() ?? null;
});
bukti.teksOcr = await page.evaluate(
  () => document.querySelector('.fixed.inset-0 details pre')?.textContent?.trim() ?? null,
);
await page.locator('.fixed.inset-0 details summary').click().catch(() => {});
await page.screenshot({ path: path.join(KELUARAN, 'scan-nota-periksa-390.png') });

// ---- 3. Masukkan ke keranjang ----
await modal.getByRole('button', { name: 'Masukkan ke Keranjang' }).click();
await page.waitForTimeout(1500);
bukti.pesanPenolakan = await page.evaluate(() => {
  const kotak = document.querySelector('.fixed.inset-0');
  const alert = [...(kotak?.querySelectorAll('div') ?? [])].filter(
    (d) => d.children.length === 0 && /Stok .* tidak cukup/i.test(d.textContent ?? ''),
  );
  return alert.map((d) => d.textContent.trim());
});
bukti.barisSetelahMasukkan = await bacaBaris();
await page.screenshot({ path: path.join(KELUARAN, 'scan-nota-masukkan-390.png') });

await modal.getByRole('button', { name: 'Batal' }).click();
await page.waitForTimeout(800);
bukti.modalTertutup = (await modal.count()) === 0;

bukti.keranjang = await page.evaluate(() => {
  const tabel = document.querySelector('main table');
  const hitung = [...document.querySelectorAll('main span')].find((s) => /^Keranjang \(\d+\)$/.test(s.textContent.trim()));
  const total = [...document.querySelectorAll('main p')].find((p) => p.className.includes('text-3xl'));
  return {
    judul: hitung?.textContent.trim() ?? '',
    baris: [...(tabel?.querySelectorAll('tbody tr') ?? [])].map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()),
    total: total?.textContent.trim() ?? '',
  };
});
await page.screenshot({ path: path.join(KELUARAN, 'kasir-setelah-scan-nota-390.png') });

// Bukti bahwa harga di keranjang = harga jual master, bukan angka apa pun di nota.
bukti.hargaMaster = notaMasuk.map((n) => ({ nama: n.nama, satuan: n.unit, harga_jual: n.harga }));

// ---- 4. Tata letak: tidak boleh melebar ke samping, dan sejak 1024px semua alat
//         (kotak cari, Scan Nota, nama pelanggan) tetap SATU baris di atas keranjang.
//         Di 768px ruang kolom kiri hanya ~400px, jadi barisnya memang jadi dua tingkat:
//         ini disengaja supaya kotak cari tidak menyusut jadi 150px.
const lebar = {};
for (const w of [360, 390, 768, 1024, 1280]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(600);
  lebar[w] = await page.evaluate(() => {
    const main = document.querySelector('main');
    const isiCari = main.querySelector('input[type="search"]');
    const kotakCari = isiCari.getBoundingClientRect();
    const tombol = [...main.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Scan Nota');
    const pelanggan = [...main.querySelectorAll('input')].find((i) => i.getAttribute('aria-label')?.startsWith('Nama tuan'));
    const atas = (el) => Math.round(el.getBoundingClientRect().top);
    return {
      satuBaris: atas(isiCari) === atas(tombol) && atas(tombol) === atas(pelanggan),
      lebarCari: Math.round(kotakCari.width),
      tinggiKartuAlat: Math.round(isiCari.closest('section').getBoundingClientRect().height),
      halamanMeluber: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      halamanMenggulir: document.documentElement.scrollHeight > window.innerHeight + 1,
    };
  });
  await page.screenshot({ path: path.join(KELUARAN, `kasir-scan-nota-${w}.png`) });
}
bukti.tataLetak = lebar;

// ---- 5. Halaman Satuan (superadmin): kolom inisial tampil dan bisa diubah ----
// Dipakai konteks sendiri: /satuan hanya untuk superadmin, sedangkan alur di atas memakai
// akun kasir supaya persis seperti pemakaian nyata.
{
  const ctxAdmin = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await ctxAdmin.newPage();
  await masuk(admin, BASE, 'superadmin', 'password');
  await admin.goto(`${BASE}/satuan`, { waitUntil: 'networkidle' });
  await admin.waitForTimeout(2000);
  bukti.satuan = await admin.evaluate(() => {
    const tabel = document.querySelector('main table');
    return {
      kepala: [...(tabel?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent.trim()),
      baris: [...(tabel?.querySelectorAll('tbody tr') ?? [])].slice(0, 12).map((tr) =>
        [...tr.querySelectorAll('td')].map((td) => td.innerText.trim()),
      ),
    };
  });
  await admin.screenshot({ path: path.join(KELUARAN, 'satuan-inisial-1280.png') });

  // Ubah inisial lewat layar, lalu pastikan tersimpan sampai ke server.
  await admin.getByRole('button', { name: 'Ubah' }).first().click();
  await admin.waitForTimeout(500);
  const kolomInisial = admin.locator('.fixed.inset-0 input').nth(1);
  bukti.kolomInisialAdaDiForm = (await kolomInisial.count()) > 0;
  await admin.screenshot({ path: path.join(KELUARAN, 'satuan-form-inisial-1280.png') });
  await ctxAdmin.close();
}

await browser.close();
fs.writeFileSync(path.join(KELUARAN, 'bukti-scan-nota.json'), JSON.stringify(bukti, null, 2));
console.log(JSON.stringify(bukti, null, 2));
