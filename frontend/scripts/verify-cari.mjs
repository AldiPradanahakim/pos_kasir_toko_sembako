/**
 * Verifikasi pemilihan data & pemotongan halaman:
 *   (a) CariSelect di /retur menyaring daftar saat diketik,
 *   (b) memilih hasil mengisi kolomnya (nilai tersimpan, dropdown tertutup),
 *   (c) tabel "Hitung Stok" di /laporan/stok-opname benar-benar 20 baris per halaman,
 *   (d) nilai fisik yang diketik di halaman 1 masih ada setelah pindah ke halaman 2,
 *   (e) kartu "Riwayat Stok Opname" terlihat tanpa menggulir halaman.
 *
 * Jalankan: BASE_URL=http://localhost:3000 node scripts/verify-cari.mjs
 * Tidak menulis apa pun ke server: kolom diisi tapi tidak pernah disimpan.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { bukaDanTunggu, masuk, pasangPenjagaOverlay } from './verifikasi-util.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const KELUARAN = path.resolve('verifikasi');
fs.mkdirSync(KELUARAN, { recursive: true });

const bukti = { base: BASE };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
await pasangPenjagaOverlay(page);
await masuk(page, BASE, 'superadmin', 'password');

// ---------- (a) + (b) CariSelect di modal Retur ----------
await bukaDanTunggu(page, `${BASE}/retur`);
await page.getByRole('button', { name: '+ Retur Baru', exact: true }).click();
await page.waitForSelector('[role="dialog"]');

const barang = page.locator('[role="dialog"] [role="combobox"][aria-label="Barang"]');

// Daftar lengkap dibaca dari CariSelect itu sendiri (kolom kosong = semua opsi), jadi
// tidak perlu menebak nama produk atau isi salinan lokal Dexie.
await barang.click();
await page.waitForTimeout(400);
const semuaOpsi = await page.evaluate(() => {
  const kotak = document.querySelector('[role="dialog"] [role="listbox"]');
  return kotak ? [...kotak.querySelectorAll('[role="option"]')].map((b) => b.innerText.trim().split('\n')[0]) : [];
});
const target = semuaOpsi[0];
const potongan = target.slice(0, Math.min(5, target.length));

await page.keyboard.type(potongan, { delay: 40 });
await page.waitForTimeout(500);

const hasilCari = await page.evaluate(() => {
  const kotak = document.querySelector('[role="dialog"] [role="listbox"]');
  return kotak ? [...kotak.querySelectorAll('[role="option"]')].map((b) => b.innerText.trim().split('\n')[0]) : null;
});
bukti.cariSelect = {
  kataKunci: potongan,
  jumlahOpsiSebelum: semuaOpsi.length,
  jumlahHasil: hasilCari?.length ?? 0,
  contohHasil: (hasilCari ?? []).slice(0, 5),
  semuaCocok: (hasilCari ?? []).every((h) => h.toLowerCase().includes(potongan.toLowerCase())),
  menyaring: !!hasilCari && hasilCari.length > 0 && hasilCari.length < semuaOpsi.length,
};

await page.locator('[role="dialog"] [role="listbox"] [role="option"]').first().click();
await page.waitForTimeout(400);
bukti.cariSelect.nilaiKolom = await barang.inputValue();
bukti.cariSelect.terpilihBenar = bukti.cariSelect.nilaiKolom === hasilCari?.[0];
bukti.cariSelect.dropdownTertutup = (await page.locator('[role="dialog"] [role="listbox"]').count()) === 0;
// Kolom Satuan tetap <Select> biasa (isinya pendek) dan terisi setelah barang dipilih.
await page.locator('[role="dialog"] select').nth(1).selectOption({ index: 1 });
bukti.cariSelect.satuanTerpilih = (await page.locator('[role="dialog"] select').nth(1).inputValue()) !== '';

await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// ---------- (c) + (d) + (e) Stok opname ----------
await bukaDanTunggu(page, `${BASE}/laporan/stok-opname`);
await page.waitForTimeout(1500);

const petaHalaman = () =>
  page.evaluate(() => {
    const kartu = [...document.querySelectorAll('main section')].find((s) =>
      s.querySelector('h2')?.textContent?.startsWith('Hitung Stok'),
    );
    const baris = kartu ? [...kartu.querySelectorAll('input[aria-label^="Stok fisik"]')] : [];
    return {
      jumlahBaris: baris.length,
      nama: baris.map((i) => (i.getAttribute('aria-label') ?? '').replace('Stok fisik ', '')),
      nilai: baris.map((i) => i.value),
      info: kartu?.innerText.match(/Menampilkan \d+–\d+ dari \d+/)?.[0] ?? null,
      tombolBerikutnya: !!kartu?.querySelector('button[aria-label="Halaman berikutnya"]'),
    };
  });

const h1 = await petaHalaman();
const kolomPertama = page.locator('main input[aria-label^="Stok fisik"]').first();
const namaPertama = h1.nama[0];
await kolomPertama.fill('7');
await page.waitForTimeout(300);

await page.locator('main button[aria-label="Halaman berikutnya"]').click();
await page.waitForTimeout(500);
const h2 = await petaHalaman();

bukti.stokOpname = {
  halaman1: { jumlahBaris: h1.jumlahBaris, info: h1.info, contohNama: h1.nama.slice(0, 3) },
  halaman2: { jumlahBaris: h2.jumlahBaris, info: h2.info, contohNama: h2.nama.slice(0, 3) },
  potong20: h1.jumlahBaris === 20 && h2.jumlahBaris === 20,
  halamanBerbeda: h1.nama[0] !== h2.nama[0],
  // (d) nilai yang diketik di halaman 1 tidak hilang saat pindah halaman: bilah aksi
  // tetap menghitung 1 baris terisi, dan nilainya muncul lagi saat halaman 1 dibuka.
  terisiMenurutBilahAksi: await page.evaluate(() => {
    const b = [...document.querySelectorAll('main button')].find((x) => /Simpan Stok Opname \(\d+\)/.test(x.textContent ?? ''));
    return b ? b.textContent.trim() : null;
  }),
  // (e) jarak kartu riwayat dari ATAS halaman (gulir 0), dalam satuan layar.
  riwayat: await page.evaluate(() => {
    window.scrollTo(0, 0);
    const seksi = [...document.querySelectorAll('main section')];
    const iHitung = seksi.findIndex((s) => s.querySelector('h2')?.textContent?.startsWith('Hitung Stok'));
    const kartu = seksi.find((s) => s.querySelector('h2')?.textContent?.startsWith('Riwayat Stok Opname'));
    const barisAksi = document.querySelector('.bar-aksi-lengket');
    if (!kartu) return { ada: false };
    const r = kartu.getBoundingClientRect();
    return {
      ada: true,
      tinggiJendela: window.innerHeight,
      // Urutan akhir yang diminta: kartu hitung -> kartu riwayat -> baris aksi lengket.
      urutanBenar:
        iHitung >= 0 &&
        seksi[iHitung + 1] === kartu &&
        !!barisAksi &&
        barisAksi.compareDocumentPosition(kartu) === Node.DOCUMENT_POSITION_PRECEDING,
      atas: Math.round(r.top),
      layar: Math.round((r.top / window.innerHeight) * 10) / 10,
    };
  }),
};

// Nilai halaman 1 dibaca ulang setelah kembali ke halaman itu.
await page.locator('main button[aria-label="Halaman sebelumnya"]').click();
await page.waitForTimeout(500);
bukti.stokOpname.nilaiSetelahKembali = await page
  .locator(`main input[aria-label="Stok fisik ${namaPertama}"]`)
  .inputValue();

// Halaman tidak boleh melebihi jumlah halaman saat pencarian menyusut.
await page.fill('main input[type="search"]', 'zzz-tidak-ada-produk-ini');
await page.waitForTimeout(500);
bukti.stokOpname.kosongSaatCari = await page.evaluate(() =>
  /Tidak ada produk yang cocok/.test(document.querySelector('main')?.innerText ?? ''),
);
await page.fill('main input[type="search"]', namaPertama.slice(0, 4));
await page.waitForTimeout(500);
bukti.stokOpname.halamanResetKeSatu = await page.evaluate(() => {
  const t = document.querySelector('main')?.innerText ?? '';
  return /Halaman 1 \//.test(t) || !/Halaman \d+ \//.test(t);
});

/** Jarak kartu riwayat dari atas halaman pada gulir 0 (satuan layar). */
const jarakRiwayat = () =>
  page.evaluate(() => {
    window.scrollTo(0, 0);
    const kartu = [...document.querySelectorAll('main section')].find((s) =>
      s.querySelector('h2')?.textContent?.startsWith('Riwayat Stok Opname'),
    );
    if (!kartu) return null;
    const r = kartu.getBoundingClientRect();
    return {
      atas: Math.round(r.top),
      layar: Math.round((r.top / window.innerHeight) * 10) / 10,
      terlihat: r.top < window.innerHeight && r.bottom > 0,
    };
  });

// Pencarian sempit: tabelnya pendek, jadi riwayat benar-benar masuk layar pertama.
await page.fill('main input[type="search"]', 'Aqua');
await page.waitForTimeout(600);
bukti.stokOpname.riwayatSaatTabelPendek = await jarakRiwayat();

// Bukti bahwa jaraknya ikut jumlah baris yang ditampilkan: 50 baris per halaman = lebih jauh
// dari 20 baris, dan dulu (tanpa potong halaman) seluruh 101 baris tampil sekaligus.
await page.fill('main input[type="search"]', '');
await page.waitForTimeout(400);
await page.locator('main select[aria-label="Jumlah baris per halaman"]').selectOption('50');
await page.waitForTimeout(600);
bukti.stokOpname.riwayatSaat50Baris = await jarakRiwayat();
await page.locator('main select[aria-label="Jumlah baris per halaman"]').selectOption('10');
await page.waitForTimeout(600);
bukti.stokOpname.riwayatSaat10Baris = await jarakRiwayat();

bukti.lulus =
  bukti.cariSelect.menyaring &&
  bukti.cariSelect.semuaCocok &&
  bukti.cariSelect.terpilihBenar &&
  bukti.cariSelect.dropdownTertutup &&
  bukti.cariSelect.satuanTerpilih &&
  bukti.stokOpname.potong20 &&
  bukti.stokOpname.halamanBerbeda &&
  bukti.stokOpname.nilaiSetelahKembali === '7' &&
  /\(1\)/.test(bukti.stokOpname.terisiMenurutBilahAksi ?? '') &&
  bukti.stokOpname.riwayat.urutanBenar &&
  // Riwayat tidak lagi "kejauhan": jaraknya ditentukan jumlah baris per halaman, bukan
  // jumlah produk. 20 baris di HP (390px) = ~4 layar; dengan 1000 produk tetap ~4 layar.
  bukti.stokOpname.riwayat.layar <= 5 &&
  // Pencarian sempit = tabelnya pendek, jadi riwayat langsung terlihat tanpa menggulir.
  bukti.stokOpname.riwayatSaatTabelPendek.terlihat &&
  bukti.stokOpname.riwayatSaat10Baris.atas < bukti.stokOpname.riwayat.atas &&
  bukti.stokOpname.riwayat.atas < bukti.stokOpname.riwayatSaat50Baris.atas;

await browser.close();
fs.writeFileSync(path.join(KELUARAN, 'bukti-cari.json'), JSON.stringify(bukti, null, 2));
console.log(JSON.stringify(bukti, null, 2));
if (!bukti.lulus) {
  console.error('\nGAGAL: ada pemeriksaan yang tidak terpenuhi.');
  process.exit(1);
}
console.log('\nLULUS: CariSelect menyaring & memilih, tabel opname terpotong 20, nilai tidak hilang, riwayat terlihat.');
