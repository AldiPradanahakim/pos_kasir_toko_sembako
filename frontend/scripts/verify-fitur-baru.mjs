/**
 * Verifikasi fitur BARU di browser sungguhan terhadap build produksi (`frontend/dist`).
 *
 *  1. Dashboard analitik: kartu ringkasan berisi angka, grafik harian punya batang, empat
 *     tabel terisi — lalu kasir TIDAK melihat menunya dan dialihkan kalau membuka URL-nya.
 *  2. Saran pembelian: muat, ubah jendela analisis, cetak (memanggil window.print) dengan
 *     nama barang + jumlah di blok cetak, dan unduh CSV yang isinya benar-benar terbaca.
 *  3. Izin jual stok kosong alur penuh (superadmin mematikan -> kasir ditolak -> superadmin
 *     menyalakan -> kasir boleh), sekaligus membuktikan permintaannya PATCH bukan PUT.
 *  4. PUT /products tidak lagi mereset izin_minus + base_unit_id saat harga diubah.
 *  5. Stok tampil dalam satuan hitung (mis. "0,92 dus"), bukan hanya base.
 *  6. Pagination 10/20/50 + "Menampilkan 1–20 dari N" di /produk dan /stok.
 *  7. Kolom isian di dalam modal menerima ketikan utuh (regresi lama: hanya satu huruf).
 *  8. Offline: simpanPenjualan ikut memperbarui stok_hitung/display_hitung (dulu basi).
 *  9. Modal "+ Tambah Stok" tanpa kolom catatan; POST /stock/in mengirim note: null dan
 *     baris barunya tetap muncul di Riwayat Pergerakan Stok.
 *
 * Seluruh data uji dibuat lewat API lalu barisnya DIHAPUS dari database di akhir
 * (`DELETE /api/products/:id` hanya menonaktifkan, jadi pembersihannya lewat SQL langsung).
 *
 * Jalankan: BASE_URL=http://localhost:3000 node scripts/verify-fitur-baru.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { bacaTabelKeranjang, bukaDanTunggu, masuk, pasangPenjagaOverlay } from './verifikasi-util.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const KELUARAN = path.resolve('verifikasi');
fs.mkdirSync(KELUARAN, { recursive: true });

const cek = [];
const cekIt = (nama, lulus, detail) => {
  cek.push({ nama, lulus: !!lulus, detail });
  console.log(`${lulus ? 'OK  ' : 'GAGAL'} ${nama}`);
  if (!lulus) console.log(`      ${JSON.stringify(detail)?.slice(0, 400)}`);
};

// ------------------------------------------------------------------ API sisi Node
const lr = await fetch(`${API}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'superadmin', password: 'password' }),
});
if (!lr.ok) throw new Error(`login superadmin gagal: ${lr.status} ${await lr.text()}`);
const { token } = await lr.json();

const api = async (p, opts = {}) => {
  const res = await fetch(`${API}/api${p}`, {
    ...opts,
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...(opts.headers ?? {}),
    },
  });
  const teks = await res.text();
  let body = null;
  try {
    body = teks ? JSON.parse(teks) : null;
  } catch {
    body = teks;
  }
  return { status: res.status, body, teks };
};

const produkById = async (id) => (await api('/products')).body.find((p) => p.id === id);
const units = (await api('/units')).body;
const idUnit = (nama) => units.find((u) => u.name === nama).id;

// ------------------------------------------------------------------ data uji
const STAMP = Date.now().toString().slice(-7);
const NAMA_P1 = `UJI Baru Hitung ${STAMP}`;
const NAMA_P2 = `UJI Baru Catatan ${STAMP}`;
const NAMA_P3 = `UJI Baru Offline ${STAMP}`;

async function buatProduk(nama, { jualPcs, modalPcs, jualDus, modalDus }) {
  const res = await api('/products', {
    method: 'POST',
    body: JSON.stringify({
      name: nama,
      base_unit: 'pcs',
      is_active: true,
      izin_minus: false,
      units: [
        { unit_id: idUnit('pcs'), isi: 1, harga_jual: jualPcs, harga_modal: modalPcs },
        { unit_id: idUnit('dus'), isi: 12, harga_jual: jualDus, harga_modal: modalDus },
      ],
    }),
  });
  if (res.status !== 201) throw new Error(`buat produk uji gagal: ${res.status} ${res.teks}`);
  return res.body;
}

const P1 = await buatProduk(NAMA_P1, { jualPcs: 5000, modalPcs: 3000, jualDus: 54000, modalDus: 36000 });
const P2 = await buatProduk(NAMA_P2, { jualPcs: 2000, modalPcs: 1000, jualDus: 21600, modalDus: 12000 });
const P3 = await buatProduk(NAMA_P3, { jualPcs: 1000, modalPcs: 600, jualDus: 10800, modalDus: 7200 });
const idPcs = idUnit('pcs');
const unitDusP1 = P1.units.find((u) => u.unit_name === 'dus').unit_id;

/** Stok P1 sengaja 11 pcs: satu dus (isi 12) TIDAK cukup, jadi alur izin minus bisa diuji. */
const stokMasuk = async (id, unitId, qty) =>
  api('/stock/in', { method: 'POST', body: JSON.stringify({ product_id: id, unit_id: unitId, qty, note: null }) });
await stokMasuk(P1.id, idPcs, 11);
await stokMasuk(P3.id, idPcs, 100);
console.log(`produk uji: P1 #${P1.id} ${NAMA_P1} · P2 #${P2.id} ${NAMA_P2} · P3 #${P3.id} ${NAMA_P3}`);

// ------------------------------------------------------------------ util baca halaman
/** Isi kartu berjudul tertentu: tabel yang terlihat, barisnya, dan teks penghitung halaman. */
const bacaKartu = (page, judul) =>
  page.evaluate((judul) => {
    const sec = [...document.querySelectorAll('section')].find((s) =>
      (s.querySelector('h2')?.textContent ?? '').trim().startsWith(judul),
    );
    if (!sec) return null;
    const tabel = [...sec.querySelectorAll('table')].find((t) => t.offsetParent !== null) ?? sec.querySelector('table');
    const baris = tabel ? [...tabel.querySelectorAll('tbody tr')] : [];
    const pag = [...sec.querySelectorAll('p')]
      .map((p) => p.textContent.trim())
      .find((t) => t.startsWith('Menampilkan'));
    return {
      judul: sec.querySelector('h2').textContent.trim(),
      kolom: tabel ? [...tabel.querySelectorAll('thead th')].map((th) => th.textContent.trim()) : [],
      jumlahBaris: baris.length,
      baris: baris.map((r) => r.innerText.replace(/\s+/g, ' ').trim()),
      halaman: pag ?? '',
    };
  }, judul);

const gantiPerHalaman = async (page, judul, nilai) => {
  const sec = page.locator('section', { has: page.locator('h2', { hasText: judul }) }).first();
  await sec.locator('select[aria-label="Jumlah baris per halaman"]').selectOption(String(nilai));
  await page.waitForTimeout(400);
};

/** Nilai kartu angka (`Stat`): cari paragraf labelnya, lalu paragraf nilai di sebelahnya. */
const bacaStat = (page, label) =>
  page.evaluate((label) => {
    const p = [...document.querySelectorAll('main p')].find((x) => x.textContent.trim() === label);
    const nilai = p?.parentElement?.querySelector('p.font-bold');
    return nilai ? nilai.textContent.trim() : null;
  }, label);

/** Baris Dexie dibaca lewat IndexedDB mentah: modul `/src/db.ts` tidak ada di build produksi. */
const bacaDexie = (page, productId) =>
  page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('toko-hakim-pos');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const g = db.transaction('cachedStock', 'readonly').objectStore('cachedStock').get(id);
          g.onerror = () => reject(g.error);
          g.onsuccess = () => {
            const r = g.result ?? null;
            db.close();
            resolve(
              r && {
                stok_base: r.stok_base,
                stok_hitung: r.stok_hitung,
                display_hitung: r.display_hitung,
                display: r.display,
                minus: r.minus,
              },
            );
          };
        };
      }),
    productId,
  );

const browser = await chromium.launch();
const bukti = { base: BASE, produkUji: { P1: P1.id, P2: P2.id, P3: P3.id } };

// ==================================================================== 1. DASHBOARD
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
await pasangPenjagaOverlay(page);
// Penanda cetak: window.print diganti supaya tombol cetak bisa dibuktikan tanpa dialog.
await page.addInitScript(() => {
  window.__printDipanggil = false;
  window.print = () => {
    window.__printDipanggil = true;
  };
});
const permintaan = [];
page.on('request', (r) => {
  if (r.url().includes('/api/')) permintaan.push({ method: r.method(), url: r.url(), body: r.postData() });
});
await masuk(page, BASE, 'superadmin', 'password');

await bukaDanTunggu(page, `${BASE}/dashboard`);
await page.waitForTimeout(2500);
const menuDashboard = await page.locator('a[href="/dashboard"]').count();
const judulDashboard = await page.locator('main h1').first().innerText();
// `Alert` galat = bg-red-50 + text-red-700; kartu `Stat` tone merah juga bg-red-50,
// jadi warnanya saja tidak cukup untuk membedakan galat dari kartu angka.
const galatDashboard = await page.locator('main div.bg-red-50.text-red-700').count();
const statOmzet = await bacaStat(page, 'Omzet');
const statTransaksi = await bacaStat(page, 'Transaksi');
const batang = await page.evaluate(() => {
  const kolom = [...document.querySelectorAll('main div[role="img"]')];
  const teal = kolom.filter((k) => k.querySelector('div.bg-teal-600'));
  const label = teal[0]?.getAttribute('aria-label') ?? '';
  return { jumlahKolom: kolom.length, jumlahBatang: teal.length, labelContoh: label };
});
const tabelDashboard = {};
for (const judul of ['Terlaris', 'Stok Menipis', 'Per Kategori', 'Per Kasir']) {
  const k = await bacaKartu(page, judul);
  tabelDashboard[judul] = { judul: k?.judul ?? null, baris: k?.jumlahBaris ?? 0, contoh: k?.baris?.[0] ?? '' };
}
bukti.dashboard = { menuDashboard, judulDashboard, galatDashboard, statOmzet, statTransaksi, batang, tabel: tabelDashboard };

cekIt('Dashboard: superadmin melihat menunya', menuDashboard > 0, { menuDashboard });
cekIt('Dashboard: halaman memuat tanpa galat', judulDashboard === 'Dashboard Analitik' && galatDashboard === 0, {
  judulDashboard,
  galatDashboard,
});
cekIt(
  'Dashboard: kartu ringkasan berisi angka nyata (bukan 0 semua)',
  /Rp\s*[\d.]+/.test(statOmzet ?? '') && statOmzet !== 'Rp 0' && statTransaksi !== '0',
  { statOmzet, statTransaksi },
);
cekIt(
  'Dashboard: grafik harian punya batang bernilai',
  batang.jumlahKolom >= 20 && batang.jumlahBatang > 0 && /omzet Rp/.test(batang.labelContoh),
  batang,
);
cekIt(
  'Dashboard: Terlaris / Stok Menipis / Per Kategori / Per Kasir terisi',
  ['Terlaris', 'Stok Menipis', 'Per Kategori', 'Per Kasir'].every((j) => tabelDashboard[j].baris > 0),
  tabelDashboard,
);

// Kasir: menu Dashboard tidak boleh ada dan URL langsung harus dialihkan.
const ctxKasir = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const pageKasir = await ctxKasir.newPage();
await pasangPenjagaOverlay(pageKasir);
await masuk(pageKasir, BASE, 'aldipradana', 'Aldi1234');
await pageKasir.getByRole('button', { name: /Buka menu/ }).click().catch(() => {});
await pageKasir.waitForTimeout(700);
const menuKasirDashboard = await pageKasir.locator('a[href="/dashboard"]').count();
await bukaDanTunggu(pageKasir, `${BASE}/dashboard`);
await pageKasir.waitForTimeout(1500);
const urlKasirDashboard = new URL(pageKasir.url()).pathname;
const isiKasirDashboard = await pageKasir.locator('main h1').first().innerText().catch(() => '');
bukti.dashboardKasir = { menuKasirDashboard, urlKasirDashboard, isiKasirDashboard };
cekIt('Dashboard: kasir tidak melihat menu Dashboard', menuKasirDashboard === 0, { menuKasirDashboard });
cekIt(
  'Dashboard: kasir yang membuka /dashboard dialihkan, isinya tidak terlihat',
  urlKasirDashboard === '/kasir' && !/Dashboard Analitik/.test(isiKasirDashboard),
  { urlKasirDashboard, isiKasirDashboard },
);

// ==================================================================== 2. SARAN PEMBELIAN
await bukaDanTunggu(page, `${BASE}/pembelian`);
await page.waitForTimeout(1500);
const kartuSaran = page.locator('section', { has: page.locator('h2', { hasText: 'Saran Pembelian' }) }).first();
await kartuSaran.getByRole('button', { name: 'Muat Saran' }).click();
await page.waitForTimeout(2500);
const saran30 = await bacaKartu(page, 'Saran Pembelian');
const barisSaran = await kartuSaran.locator('table:visible tbody tr').count();
const isiCetak30 = (await page.locator('.area-laporan').first().textContent()) ?? '';

// Ubah jendela analisis: permintaan harus memakai hari yang baru dan hasilnya ikut berubah.
const sebelumUbah = permintaan.length;
await kartuSaran.locator('select').first().selectOption('90');
await kartuSaran.getByRole('button', { name: 'Muat Saran' }).click();
await page.waitForTimeout(2500);
const saran90 = await bacaKartu(page, 'Saran Pembelian');
const permintaanSaran = permintaan.slice(sebelumUbah).filter((r) => r.url.includes('purchase-suggestions'));
const isiCetak90 = (await page.locator('.area-laporan').first().textContent()) ?? '';
bukti.saran = {
  baris30: saran30?.jumlahBaris ?? 0,
  baris90: saran90?.jumlahBaris ?? 0,
  contoh30: saran30?.baris?.[0] ?? '',
  contoh90: saran90?.baris?.[0] ?? '',
  permintaanSaran: permintaanSaran.map((r) => r.url.replace(BASE, '')),
  isiCetakMemuatBaris: /Nama Barang/.test(isiCetak30) && isiCetak30.length > 80,
};
cekIt('Saran: tombol "Muat Saran" mengisi tabel', (saran30?.jumlahBaris ?? 0) > 0, {
  baris: saran30?.jumlahBaris ?? 0,
  contoh: saran30?.baris?.[0] ?? '',
});
cekIt(
  'Saran: mengubah "hari" mengirim permintaan baru dan mengubah hasil',
  permintaanSaran.some((r) => r.url.includes('hari=90')) && JSON.stringify(saran30?.baris) !== JSON.stringify(saran90?.baris),
  bukti.saran,
);

// Cetak: window.print benar-benar dipanggil, dan blok cetaknya memuat nama + jumlah.
const barisPertamaCetak = saran90?.baris?.[0] ?? '';
await kartuSaran.getByRole('button', { name: 'Cetak Saran' }).click();
await page.waitForTimeout(500);
const printDipanggil = await page.evaluate(() => window.__printDipanggil === true);
// Blok cetak ada di dalam DOM tapi `hidden print:block`, jadi dibaca textContent (bukan innerText).
const teksCetak = (await page.locator('.area-laporan').first().textContent()) ?? '';
const namaDiCetak = teksCetak.includes((saran90?.baris?.[0] ?? '').split(' ').slice(0, 2).join(' '));
const adaJumlah = /\d/.test(teksCetak) && /Satuan/.test(teksCetak);
bukti.cetakSaran = {
  printDipanggil,
  panjangTeksCetak: teksCetak.length,
  cuplikan: teksCetak.replace(/\s+/g, ' ').slice(0, 260),
  barisPertamaTabel: barisPertamaCetak.slice(0, 80),
};
cekIt('Saran: "Cetak Saran" memanggil window.print', printDipanggil, bukti.cetakSaran);
cekIt(
  'Saran: blok cetak memuat nama barang + jumlah',
  teksCetak.includes('Daftar Saran Pembelian') && namaDiCetak && adaJumlah,
  bukti.cetakSaran,
);

// Unduh CSV: tunggu kejadian unduhan sungguhan, lalu baca isi berkasnya.
const tungguUnduh = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
await kartuSaran.getByRole('button', { name: 'Unduh CSV' }).click();
const unduhan = await tungguUnduh;
let isiCsv = '';
if (unduhan) {
  const berkas = await unduhan.path();
  isiCsv = berkas ? fs.readFileSync(berkas, 'utf8') : '';
}
const pesanUnduh = await kartuSaran.locator('div.bg-teal-50').first().innerText().catch(() => '');
bukti.unduhCsv = {
  namaBerkas: unduhan?.suggestedFilename() ?? null,
  panjangIsi: isiCsv.length,
  tajuk: isiCsv.split('\n')[0]?.slice(0, 120) ?? '',
  barisData: isiCsv.split('\n').filter((b) => b.trim()).length - 1,
  pesan: pesanUnduh,
};
cekIt(
  'Saran: "Unduh CSV" benar-benar mengunduh berkas CSV berisi data',
  !!unduhan && /\.csv$/.test(unduhan.suggestedFilename()) && isiCsv.includes('Nama Barang') && bukti.unduhCsv.barisData > 0,
  bukti.unduhCsv,
);

// ==================================================================== 3. IZIN JUAL STOK KOSONG
// Pastikan izin mati dulu lewat endpoint sempit (bukan PUT).
await api(`/products/${P1.id}/pengaturan`, { method: 'PATCH', body: JSON.stringify({ izin_minus: false }) });
const stokP1 = (await api('/stock')).body.find((s) => s.product_id === P1.id);

const cariDiKasir = async (kata) => {
  await pageKasir.fill('main input[type="search"]', kata);
  await pageKasir.waitForTimeout(1200);
  return (await pageKasir.locator('main div.absolute.inset-x-0').first().innerText()).replace(/\s*\n\s*/g, ' | ');
};

await bukaDanTunggu(pageKasir, `${BASE}/kasir`);
const teksDilarang = await cariDiKasir(NAMA_P1);
await pageKasir.locator(`main button[aria-label="Tambah ${NAMA_P1} dus"]`).first().click();
await pageKasir.waitForTimeout(800);
const keranjangDitolak = await bacaTabelKeranjang(pageKasir);
const galatTolak = await pageKasir.locator('main div.bg-red-50').first().innerText().catch(() => '');
bukti.izinDitolak = { stokBase: stokP1?.stok_base, stokDisplay: stokP1?.display_hitung, teksDilarang: teksDilarang.slice(0, 200), baris: keranjangDitolak?.jumlahBaris, galat: galatTolak };
cekIt(
  'Izin minus: stok kosong ditolak di kasir + pesan menyebut izin',
  keranjangDitolak?.jumlahBaris === 0 && /tidak cukup/.test(galatTolak) && /izin jual stok kosong/i.test(galatTolak),
  bukti.izinDitolak,
);

// Superadmin menyalakan izin dari halaman /stok.
await bukaDanTunggu(page, `${BASE}/stok`);
await page.waitForTimeout(1200);
const cariStok = page.locator('section', { has: page.locator('h2', { hasText: 'Stok per Produk' }) }).first().locator('input').first();
await cariStok.fill(NAMA_P1);
await page.waitForTimeout(600);
const sebelumIzin = permintaan.length;
await page.locator(`button[aria-label="Izinkan penjualan saat stok \\"${NAMA_P1}\\" kosong"]:visible`).first().click();
await page.waitForTimeout(2500);
const panggilanIzin = permintaan.slice(sebelumIzin).filter((r) => r.url.includes('/products/'));
const p1SetelahIzin = await produkById(P1.id);
bukti.izinDinyalakan = {
  panggilan: panggilanIzin.map((r) => `${r.method} ${r.url.replace(BASE, '')}`),
  izin_minus: p1SetelahIzin.izin_minus,
};
cekIt(
  'Izin minus: tombol /stok memakai PATCH /products/:id/pengaturan (bukan PUT)',
  panggilanIzin.some((r) => r.method === 'PATCH' && r.url.includes('/pengaturan')) &&
    !panggilanIzin.some((r) => r.method === 'PUT'),
  bukti.izinDinyalakan,
);
cekIt('Izin minus: izin benar-benar menyala di server', p1SetelahIzin.izin_minus === true, bukti.izinDinyalakan);

// Kasir mengetuk lagi setelah halaman disegarkan (pullSync baru mengambil izin terbaru).
await bukaDanTunggu(pageKasir, `${BASE}/kasir`);
const teksDiizinkan = await cariDiKasir(NAMA_P1);
await pageKasir.locator(`main button[aria-label="Tambah ${NAMA_P1} dus"]`).first().click();
await pageKasir.waitForTimeout(800);
const keranjangDiizinkan = await bacaTabelKeranjang(pageKasir);
bukti.izinDiizinkan = { teks: teksDiizinkan.slice(0, 200), baris: keranjangDiizinkan?.jumlahBaris };
cekIt(
  'Izin minus: setelah izin menyala barang MASUK keranjang',
  keranjangDiizinkan?.jumlahBaris === 1,
  bukti.izinDiizinkan,
);
await pageKasir.getByRole('button', { name: 'Kosongkan' }).click();
await pageKasir.waitForTimeout(400);

// ==================================================================== 4. PUT TIDAK MERESET PENGATURAN
await api(`/products/${P1.id}/pengaturan`, {
  method: 'PATCH',
  body: JSON.stringify({ izin_minus: true, base_unit_id: unitDusP1 }),
});
const sebelumPut = await produkById(P1.id);
const hargaBaru = 5555;
await bukaDanTunggu(page, `${BASE}/produk`);
await page.waitForTimeout(1000);
const kartuProduk = page.locator('section', { has: page.locator('h2', { hasText: 'Daftar Produk' }) }).first();
const cariProduk = kartuProduk.locator('input').first();
await cariProduk.fill(NAMA_P1);
await page.waitForTimeout(700);
await page.locator('table:visible tbody tr', { hasText: NAMA_P1 }).first().getByRole('button', { name: 'Ubah' }).click();
await page.waitForTimeout(600);
const dialog = page.getByRole('dialog');
// Kolom harga jual baris pertama; ketik ulang nilainya supaya perubahan benar-benar terjadi.
const inputHarga = dialog.locator('input[inputmode="numeric"]').nth(1);
await inputHarga.fill(String(hargaBaru));
const sebelumSimpan = permintaan.length;
await dialog.getByRole('button', { name: 'Simpan', exact: true }).click();
await page.waitForTimeout(3000);
const putProduk = permintaan.slice(sebelumSimpan).find((r) => r.method === 'PUT' && r.url.includes('/products/'));
const payloadPut = putProduk ? JSON.parse(putProduk.body) : {};
const sesudahPut = await produkById(P1.id);
// Harga dibandingkan per NAMA satuan: urutan `units[]` di GET /products tidak dijamin
// sama dengan urutan baris di form, jadi `units[0]` bisa saja satuan yang berbeda.
const hargaPerSatuan = (p) => Object.fromEntries(p.units.map((u) => [u.unit_name, u.harga_jual]));
// Payload PUT memakai `unit_id` (tanpa nama), jadi namanya dipetakan dari produk sebelum simpan.
const namaSatuan = new Map(sebelumPut.units.map((u) => [u.unit_id, u.unit_name]));
const hargaPayload = Object.fromEntries((payloadPut.units ?? []).map((u) => [namaSatuan.get(u.unit_id) ?? u.unit_id, u.harga_jual]));
bukti.putProduk = {
  sebelum: { izin_minus: sebelumPut.izin_minus, base_unit_id: sebelumPut.base_unit_id, harga: hargaPerSatuan(sebelumPut) },
  payload: { izin_minus: payloadPut.izin_minus, base_unit_id: payloadPut.base_unit_id, harga: hargaPayload },
  sesudah: { izin_minus: sesudahPut.izin_minus, base_unit_id: sesudahPut.base_unit_id, harga: hargaPerSatuan(sesudahPut) },
};
cekIt(
  'PUT produk: harga baru benar-benar tersimpan (satuan pcs, bukan menimpa satuan lain)',
  sesudahPut.units.find((u) => u.unit_name === 'pcs').harga_jual === hargaBaru &&
    sesudahPut.units.find((u) => u.unit_name === 'dus').harga_jual === 54000,
  bukti.putProduk,
);
cekIt(
  'PUT produk: izin_minus + base_unit_id TIDAK tereset',
  sesudahPut.izin_minus === true && sesudahPut.base_unit_id === unitDusP1,
  bukti.putProduk,
);

// ==================================================================== 5. SATUAN HITUNG TAMPIL
await bukaDanTunggu(page, `${BASE}/stok`);
await page.waitForTimeout(1200);
const cariStok2 = page.locator('section', { has: page.locator('h2', { hasText: 'Stok per Produk' }) }).first().locator('input').first();
await cariStok2.fill(NAMA_P1);
await page.waitForTimeout(700);
const barisStok = await bacaKartu(page, 'Stok per Produk');
const kolomStok = barisStok?.baris?.[0] ?? '';
bukti.satuanHitung = { kolom: barisStok?.kolom, baris: kolomStok };
cekIt(
  'Stok: angka utama dalam satuan hitung (0,92 dus) + base sebagai keterangan',
  kolomStok.includes('0,92 dus') && kolomStok.includes('11 pcs'),
  bukti.satuanHitung,
);

// ==================================================================== 6. PAGINATION
const ujiPagination = async (judulKartu, namaHalaman) => {
  await bukaDanTunggu(page, `${BASE}${namaHalaman}`);
  await page.waitForTimeout(1200);
  const total = Number((await bacaKartu(page, judulKartu))?.judul.match(/\((\d+)\)/)?.[1] ?? 0);
  const awal = await bacaKartu(page, judulKartu);
  await gantiPerHalaman(page, judulKartu, 10);
  const sepuluh = await bacaKartu(page, judulKartu);
  await page.locator('button[aria-label="Halaman berikutnya"]').first().click();
  await page.waitForTimeout(500);
  const berikut = await bacaKartu(page, judulKartu);
  return {
    total,
    baris20: awal.jumlahBaris,
    halaman20: awal.halaman,
    baris10: sepuluh.jumlahBaris,
    halaman10: sepuluh.halaman,
    halamanBerikut: berikut.halaman,
    barisBerikut: berikut.jumlahBaris,
  };
};
const pagProduk = await ujiPagination('Daftar Produk', '/produk');
const pagStok = await ujiPagination('Stok per Produk', '/stok');
bukti.pagination = { produk: pagProduk, stok: pagStok };
const pagOk = (p) =>
  p.baris20 === 20 &&
  p.halaman20 === `Menampilkan 1–20 dari ${p.total}` &&
  p.baris10 === 10 &&
  p.halaman10 === `Menampilkan 1–10 dari ${p.total}` &&
  p.halamanBerikut === `Menampilkan 11–20 dari ${p.total}`;
cekIt('Pagination /produk: 20 baris, pilih 10, Berikutnya -> 11–20', pagOk(pagProduk), pagProduk);
cekIt('Pagination /stok: 20 baris, pilih 10, Berikutnya -> 11–20', pagOk(pagStok), pagStok);

// ==================================================================== 7. KETIKAN DI MODAL
await bukaDanTunggu(page, `${BASE}/produk`);
await page.waitForTimeout(1000);
await page.getByRole('button', { name: '+ Tambah Produk' }).click();
await page.waitForTimeout(500);
const dialogTambah = page.getByRole('dialog');
const KETIK = 'UJI Ketik 1234567890';
const kolomNama = dialogTambah.locator('input').first();
await kolomNama.pressSequentially(KETIK, { delay: 25 });
await page.waitForTimeout(300);
const nilaiNama = await kolomNama.inputValue();
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
bukti.ketikModal = { diharapkan: KETIK, nilaiNama };
cekIt('Modal: kolom isian menerima ketikan utuh (bukan satu huruf)', nilaiNama === KETIK, bukti.ketikModal);

// ==================================================================== 9. MODAL TAMBAH STOK TANPA CATATAN
await bukaDanTunggu(page, `${BASE}/stok`);
await page.waitForTimeout(1200);
await page.getByRole('button', { name: '+ Tambah Stok' }).click();
await page.waitForTimeout(600);
const dialogStok = page.getByRole('dialog');
const adaLabelCatatan = await dialogStok.getByText('Catatan (opsional)').count();
const adaInputCatatan = await dialogStok.locator('input[placeholder="mis. kulakan pasar"]').count();
const combobox = dialogStok.getByRole('combobox', { name: 'Pilih produk untuk tambah stok' });
await combobox.pressSequentially(NAMA_P2, { delay: 20 });
await page.waitForTimeout(700);
await dialogStok.getByRole('option', { name: NAMA_P2 }).first().click();
await page.waitForTimeout(300);
await dialogStok.locator('select').first().selectOption(String(P2.units.find((u) => u.unit_name === 'dus').unit_id));
await dialogStok.locator('input[type="number"]').fill('2');
const sebelumKirimStok = permintaan.length;
await dialogStok.getByRole('button', { name: 'Simpan', exact: true }).click();
await page.waitForTimeout(3000);
const kirimStok = permintaan.slice(sebelumKirimStok).find((r) => r.method === 'POST' && r.url.includes('/stock/in'));
const bodyStok = kirimStok ? JSON.parse(kirimStok.body) : {};
bukti.tambahStok = { adaLabelCatatan, adaInputCatatan, body: bodyStok };
cekIt(
  'Tambah Stok: kolom catatan sudah tidak ada di modal',
  adaLabelCatatan === 0 && adaInputCatatan === 0,
  bukti.tambahStok,
);
cekIt(
  'Tambah Stok: POST /stock/in mengirim note: null',
  bodyStok.note === null && bodyStok.product_id === P2.id && bodyStok.qty === 2,
  bukti.tambahStok,
);

// Baris barunya harus muncul di riwayat pergerakan (kolom Catatan boleh '-').
await page.getByRole('button', { name: 'Tampilkan' }).click();
await page.waitForTimeout(2500);
const kartuRiwayat = page.locator('section', { has: page.locator('h2', { hasText: 'Riwayat Pergerakan Stok' }) }).first();
const kolomRiwayat = (await kartuRiwayat.locator('thead th').allInnerTexts()).map((k) => k.trim().toLowerCase());
const selRiwayat = await kartuRiwayat
  .locator('tbody tr', { hasText: NAMA_P2 })
  .first()
  .locator('td')
  .allInnerTexts()
  .catch(() => []);
// Judul kolomnya ber-CSS `uppercase`, jadi `innerText` mengembalikan huruf besar semua.
const idxCatatan = kolomRiwayat.indexOf('catatan');
const idxTipe = kolomRiwayat.indexOf('tipe');
bukti.riwayatStok = { kolom: kolomRiwayat, sel: selRiwayat };
cekIt(
  'Tambah Stok: baris baru muncul di Riwayat Pergerakan Stok, kolom Catatan tetap ada dan berisi "-"',
  idxCatatan >= 0 && idxTipe >= 0 && selRiwayat[idxTipe]?.trim() === 'Masuk' && selRiwayat[idxCatatan]?.trim() === '-',
  bukti.riwayatStok,
);

// ==================================================================== 8. OFFLINE: simpanPenjualan
// Konteks bersih supaya salinan Dexie-nya pasti berasal dari data server terbaru.
const ctxOff = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const pageOff = await ctxOff.newPage();
await pasangPenjagaOverlay(pageOff);
await masuk(pageOff, BASE, 'superadmin', 'password');
await bukaDanTunggu(pageOff, `${BASE}/kasir`);
await pageOff.waitForTimeout(2500);

// Setelah data tersalin, kunci tarikan berikutnya: tanpa ini `terapkanPendingKeStok` yang
// sudah benar akan menutupi bug di `simpanPenjualan`.
await pageOff.route('**/api/sync/pull', (route) => route.abort());
await pageOff.route('**/api/sales', (route) => route.abort());

const sebelumJual = await bacaDexie(pageOff, P3.id);
await pageOff.fill('main input[type="search"]', NAMA_P3);
await pageOff.waitForTimeout(1200);
await pageOff.locator(`main button[aria-label="Tambah ${NAMA_P3} dus"]`).first().click();
await pageOff.waitForTimeout(700);
await pageOff.getByLabel('Jumlah dibayar').fill('1000000');
await pageOff.waitForTimeout(300);
await pageOff.getByRole('button', { name: 'Simpan Struk' }).first().click();
await pageOff.waitForTimeout(2500);
const sesudahJual = await bacaDexie(pageOff, P3.id);
const pending = await pageOff.evaluate(
  (pid) =>
    new Promise((resolve) => {
      const req = indexedDB.open('toko-hakim-pos');
      req.onsuccess = () => {
        const db = req.result;
        const g = db.transaction('pendingSales', 'readonly').objectStore('pendingSales').getAll();
        g.onsuccess = () => {
          const rows = g.result ?? [];
          db.close();
          resolve(rows.filter((r) => r.payload.items.some((it) => it.product_id === pid)).length);
        };
      };
    }),
  P3.id,
);
bukti.offline = { sebelum: sebelumJual, sesudah: sesudahJual, saleUjiDiAntre: pending };
cekIt(
  'Offline: simpanPenjualan memperbarui stok_base DAN stok_hitung/display_hitung',
  sebelumJual?.stok_base === 100 &&
    sebelumJual?.display_hitung === '8,33 dus' &&
    sesudahJual?.stok_base === 88 &&
    sesudahJual?.stok_hitung === 7.33 &&
    sesudahJual?.display_hitung === '7,33 dus',
  bukti.offline,
);
cekIt(
  'Offline: display_hitung TIDAK basi (bukan 8,33 dus) dan display base ikut berubah',
  sesudahJual?.display_hitung !== sebelumJual?.display_hitung && sesudahJual?.display === '7 dus 4 pcs',
  bukti.offline,
);
cekIt('Offline: transaksi tersimpan di antrean lokal (tidak hilang)', pending === 1, bukti.offline);

await ctxOff.close();
await ctxKasir.close();
await ctx.close();
await browser.close();

// ==================================================================== PEMBERSIHAN DATA UJI
// `pg` dipakai dari node_modules backend: skrip frontend tidak punya dependency database.
// `require()` sebuah paket CJS mengembalikan `module.exports` langsung (tanpa pembungkus
// `default` seperti pada `import()`), jadi `pg` diambil apa adanya.
const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend/package.json'));
const pg = require('pg');
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://pos_hakim:pos_hakim_dev@127.0.0.1:5433/pos_hakim',
});

/**
 * Semua produk berprefiks uji, bukan hanya yang dibuat proses ini: kalau satu jalankan
 * berhenti di tengah (galat tak terduga), sisa produknya tetap tersapu di jalankan berikutnya
 * sehingga database pemilik tidak pernah tertinggal data uji.
 */
const { rows: barisUji } = await pool.query(`SELECT id FROM products WHERE name LIKE 'UJI Baru %'`);
const ids = barisUji.map((r) => r.id);

const hitungBersih = async () => {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*) FROM products WHERE id = ANY($1::bigint[]))                                  AS produk_uji,
       (SELECT count(*) FROM product_units WHERE product_id = ANY($1::bigint[]))                     AS satuan_uji,
       (SELECT count(*) FROM stock_movements WHERE product_id = ANY($1::bigint[]))                   AS movement_uji,
       (SELECT count(*) FROM sale_items WHERE product_id = ANY($1::bigint[]))                        AS item_uji,
       (SELECT count(*) FROM stock_movements sm
         WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.id = sm.product_id))                    AS movement_yatim,
       (SELECT count(*) FROM cash_flows cf
         WHERE cf.ref_type = 'sale'
           AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = cf.ref_id))                           AS cashflow_yatim,
       (SELECT count(*) FROM sales)                                                                 AS total_sale,
       (SELECT count(*) FROM cash_flows)                                                            AS total_arus,
       (SELECT count(*) FROM products)                                                              AS total_produk`,
    [ids],
  );
  return rows[0];
};

const sebelumBersih = await hitungBersih();
// Urutan penting: baris yang mereferensikan produk tanpa ON DELETE CASCADE harus pergi dulu.
await pool.query('DELETE FROM sale_items WHERE product_id = ANY($1::bigint[])', [ids]);
await pool.query('DELETE FROM stock_movements WHERE product_id = ANY($1::bigint[])', [ids]);
await pool.query('DELETE FROM stock_opnames WHERE product_id = ANY($1::bigint[])', [ids]);
await pool.query('DELETE FROM purchase_items WHERE product_id = ANY($1::bigint[])', [ids]);
await pool.query('DELETE FROM returns WHERE product_id = ANY($1::bigint[])', [ids]);
await pool.query('DELETE FROM products WHERE id = ANY($1::bigint[])', [ids]);
const sesudahBersih = await hitungBersih();
await pool.end();

bukti.pembersihan = { ids, sebelum: sebelumBersih, sesudah: sesudahBersih };
cekIt(
  'Pembersihan: produk uji + satuan + pergerakan + item benar-benar hilang dari database',
  Number(sesudahBersih.produk_uji) === 0 &&
    Number(sesudahBersih.satuan_uji) === 0 &&
    Number(sesudahBersih.movement_uji) === 0 &&
    Number(sesudahBersih.item_uji) === 0,
  bukti.pembersihan,
);
cekIt(
  'Pembersihan: tidak ada pergerakan stok yatim',
  Number(sesudahBersih.movement_yatim) === 0,
  bukti.pembersihan,
);
cekIt(
  'Pembersihan: tidak ada arus kas yatim',
  Number(sesudahBersih.cashflow_yatim) === 0,
  bukti.pembersihan,
);

bukti.lulus = cek.every((c) => c.lulus);
bukti.cek = cek;
fs.writeFileSync(path.join(KELUARAN, 'bukti-fitur-baru.json'), JSON.stringify(bukti, null, 2));
console.log(`\n${bukti.lulus ? 'LULUS' : 'GAGAL'}: ${cek.filter((c) => c.lulus).length}/${cek.length} pemeriksaan.`);
console.log('bukti: verifikasi/bukti-fitur-baru.json');
if (!bukti.lulus) process.exitCode = 1;
