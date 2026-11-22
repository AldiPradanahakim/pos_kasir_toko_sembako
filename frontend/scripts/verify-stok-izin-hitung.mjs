/**
 * Verifikasi pekerjaan gelombang "satuan hitung + izin jual stok kosong".
 *
 * Yang dibuktikan (semuanya lewat UI atau lewat jalur produksi yang sesungguhnya):
 *  A. Pagination 10/20/50 di /produk dan /stok (default 20) benar-benar memotong daftarnya.
 *  B. PUT /products/:id dari form Produk TIDAK lagi mereset `izin_minus` dan `base_unit_id`
 *     (bug lama: dua field itu tidak ikut terkirim sehingga server menimpanya dengan default).
 *  C. Satuan hitung yang baris satuannya dihapus dikirim `null` (server tidak menolak 422).
 *  D. Kasir menolak barang yang stoknya tidak cukup saat `izin_minus` false, dan mengizinkannya
 *     setelah superadmin menyalakan izin lewat PATCH /products/:id/pengaturan (bukan PUT).
 *  E. `terapkanPendingKeStok()` menghitung ulang `stok_hitung`/`display_hitung`, bukan hanya
 *     `stok_base`/`display` — angka yang dilihat kasir saat offline tidak boleh basi.
 *
 * Data pemilik TIDAK diubah permanen: satu produk (pilih otomatis) disunting lalu dikembalikan
 * ke nilai awalnya dan dibandingkan lagi di akhir. Bagian E memakai payload /api/sync/pull
 * buatan sendiri (route mock) sehingga tidak menyentuh database sama sekali.
 *
 * Jalankan: BASE_URL=http://localhost:5199 node scripts/verify-stok-izin-hitung.mjs
 * Prasyarat: backend di API_URL (default http://127.0.0.1:3000) dan dev/preview server frontend.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { bacaTabelKeranjang, bukaDanTunggu, masuk, pasangPenjagaOverlay } from './verifikasi-util.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:5199';
const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const KELUARAN = path.resolve('verifikasi');
fs.mkdirSync(KELUARAN, { recursive: true });

const cek = [];
const cekIt = (nama, lulus, detail) => {
  cek.push({ nama, lulus: Boolean(lulus), detail });
  console.log(`${lulus ? 'OK  ' : 'GAGAL'} ${nama} — ${JSON.stringify(detail)}`);
};

// ------------------------------------------------------------------ API sisi Node
const lr = await fetch(`${API}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'superadmin', password: 'password' }),
});
const { token } = await lr.json();
const api = async (p, opts = {}) => {
  const res = await fetch(`${API}/api${p}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  const teks = await res.text();
  return { status: res.status, body: teks ? JSON.parse(teks) : null };
};

const produkAsli = (await api('/products')).body;
/** GET /products/:id tidak ada; produk dibaca dari daftar. */
const produkById = async (id) => (await api('/products')).body.find((p) => p.id === id);
const stokAwal = (await api('/stock')).body;
const units = (await api('/units')).body;
const payloadPull = (await api('/sync/pull')).body;
const idUnit = (nama) => units.find((u) => u.name === nama).id;

// Produk uji: stok kosong/minus, izin mati, punya satuan isi > 1 (supaya satuan hitungnya jelas).
const kandidat = stokAwal.find(
  (s) => s.stok_base <= 0 && !s.izin_minus && (produkAsli.find((p) => p.id === s.product_id)?.units ?? []).some((u) => u.isi > 1),
);
if (!kandidat) throw new Error('Tidak ada produk bersatuan ganda dengan stok <= 0 untuk diuji');
const pUji = produkAsli.find((p) => p.id === kandidat.product_id);
const snapshot = {
  name: pUji.name,
  category_id: pUji.category_id,
  base_unit: pUji.base_unit,
  barcode: pUji.barcode,
  is_active: pUji.is_active,
  base_unit_id: pUji.base_unit_id,
  izin_minus: pUji.izin_minus,
  units: pUji.units.map((u) => ({
    unit_id: u.unit_id,
    isi: u.isi,
    harga_jual: u.harga_jual,
    harga_modal: u.harga_modal,
    barcode: u.barcode,
  })),
};
const satuanHitungAwal = [...pUji.units].filter((u) => u.isi > 1).sort((a, b) => b.isi - a.isi)[0].unit_name;
const unitHitungId = pUji.units.find((u) => u.unit_name === satuanHitungAwal).unit_id;
console.log(`produk uji: #${pUji.id} ${pUji.name} (stok ${kandidat.stok_base}, hitung ${satuanHitungAwal}, izin ${pUji.izin_minus})`);

// ------------------------------------------------------------------ util baca halaman
/** Isi kartu (section) berjudul tertentu: tabel yang terlihat, barisnya, dan teks pagination. */
const bacaKartu = (page, judul) =>
  page.evaluate((judul) => {
    const sec = [...document.querySelectorAll('main section')].find((s) => {
      const h = s.querySelector(':scope > header h2');
      return h && h.textContent.trim().startsWith(judul);
    });
    if (!sec) return null;
    const tabel = [...sec.querySelectorAll('table')].find((t) => t.offsetParent !== null) ?? null;
    const baris = tabel ? [...tabel.querySelectorAll('tbody tr')] : [];
    return {
      ada: true,
      halaman:
        [...sec.querySelectorAll('p')].map((p) => p.textContent.trim()).find((t) => t.startsWith('Menampilkan')) ?? '',
      jumlahBaris: baris.length,
      baris: baris.map((tr) => tr.innerText.replace(/\s*\n\s*/g, ' | ').trim()),
      sel: baris.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.replace(/\s*\n\s*/g, ' ').trim())),
      teks: sec.innerText.replace(/\s*\n\s*/g, ' | '),
      adaSelectPerHalaman: Boolean(sec.querySelector('select[aria-label="Jumlah baris per halaman"]')),
    };
  }, judul);

const gantiPerHalaman = async (page, judul, nilai) => {
  const sec = page.locator('section', { has: page.locator('h2', { hasText: judul }) }).first();
  await sec.locator('select[aria-label="Jumlah baris per halaman"]').selectOption(String(nilai));
  await page.waitForTimeout(300);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
await pasangPenjagaOverlay(page);
const permintaan = [];
page.on('request', (r) => {
  if (r.url().includes('/api/products')) permintaan.push({ method: r.method(), url: r.url(), body: r.postData() });
});
await masuk(page, BASE, 'superadmin', 'password');
const bukti = { base: BASE, produkUji: { id: pUji.id, nama: pUji.name, satuanHitung: satuanHitungAwal } };

// ============================================================ A. pagination Produk
await bukaDanTunggu(page, `${BASE}/produk`);
await page.waitForTimeout(800);
const produkTotal = Number((await bacaKartu(page, 'Daftar Produk')).teks.match(/Daftar Produk \((\d+)\)/)[1]);
const p20 = await bacaKartu(page, 'Daftar Produk');
bukti.paginationProduk = { total: produkTotal, awal: p20.halaman, baris20: p20.jumlahBaris };
cekIt('Produk: default 20 baris + penghitung halaman', p20.jumlahBaris === 20 && p20.halaman === `Menampilkan 1–20 dari ${produkTotal}`, {
  baris: p20.jumlahBaris,
  halaman: p20.halaman,
});

await gantiPerHalaman(page, 'Daftar Produk', 10);
const p10 = await bacaKartu(page, 'Daftar Produk');
cekIt('Produk: pilihan 10 baris', p10.jumlahBaris === 10 && p10.halaman === `Menampilkan 1–10 dari ${produkTotal}`, {
  baris: p10.jumlahBaris,
  halaman: p10.halaman,
});

await page.locator('button[aria-label="Halaman berikutnya"]').first().click();
await page.waitForTimeout(300);
const p10b = await bacaKartu(page, 'Daftar Produk');
cekIt('Produk: halaman berikutnya menggeser daftar', p10b.halaman === `Menampilkan 11–20 dari ${produkTotal}`, {
  halaman: p10b.halaman,
  baris: p10b.jumlahBaris,
});

await gantiPerHalaman(page, 'Daftar Produk', 50);
const p50 = await bacaKartu(page, 'Daftar Produk');
cekIt('Produk: pilihan 50 baris', p50.jumlahBaris === 50 && p50.halaman === `Menampilkan 1–50 dari ${produkTotal}`, {
  baris: p50.jumlahBaris,
  halaman: p50.halaman,
});
await gantiPerHalaman(page, 'Daftar Produk', 20);

const kotakCariProduk = page.locator('section', { has: page.locator('h2', { hasText: 'Daftar Produk' }) }).locator('input').first();

// Pencarian nama satuan: 'dus' tidak ada di nama produk mana pun, jadi hasilnya hanya bisa
// datang dari nama satuan (satuan hitung atau baris satuan).
await kotakCariProduk.fill(satuanHitungAwal);
await page.waitForTimeout(500);
const cariSatuan = await bacaKartu(page, 'Daftar Produk');
const semuaPunyaSatuan = cariSatuan.baris.every((b) => b.toLowerCase().includes(satuanHitungAwal.toLowerCase()));
bukti.cariProduk = { kataKunci: satuanHitungAwal, jumlah: cariSatuan.jumlahBaris, semuaPunyaSatuan };
cekIt(
  'Produk: pencarian menjangkau nama satuan',
  cariSatuan.jumlahBaris > 0 && semuaPunyaSatuan && cariSatuan.halaman.startsWith('Menampilkan 1–'),
  { jumlah: cariSatuan.jumlahBaris, halaman: cariSatuan.halaman, contoh: cariSatuan.baris[0]?.slice(0, 120) },
);

await kotakCariProduk.fill(pUji.name);
await page.waitForTimeout(500);
const cariNama = await bacaKartu(page, 'Daftar Produk');
const kolomSatuanHitung = cariNama.sel[0] ?? [];
bukti.kolomSatuanHitung = kolomSatuanHitung.slice(0, 5);
cekIt(
  'Produk: kolom Satuan hitung terisi sesuai aturan server (otomatis = satuan terbesar)',
  kolomSatuanHitung[3] === satuanHitungAwal,
  { kolom: kolomSatuanHitung[3], diharapkan: satuanHitungAwal, baris: kolomSatuanHitung.slice(0, 5) },
);
await kotakCariProduk.fill('');
await page.waitForTimeout(300);

// ============================================================ B/C. form Produk: PUT tidak mereset pengaturan
// Siapkan: satuan hitung = satuan terbesar produk ini (bukan otomatis lagi).
const setPengaturan = await api(`/products/${pUji.id}/pengaturan`, {
  method: 'PATCH',
  body: JSON.stringify({ base_unit_id: unitHitungId, izin_minus: false }),
});
const sesudahPatch = await produkById(pUji.id);
bukti.patchPengaturan = { status: setPengaturan.status, base_unit_id: sesudahPatch.base_unit_id, izin_minus: sesudahPatch.izin_minus };
cekIt('PATCH /products/:id/pengaturan menyalakan satuan hitung', setPengaturan.status === 200 && sesudahPatch.base_unit_id === unitHitungId, {
  status: setPengaturan.status,
  base_unit_id: sesudahPatch.base_unit_id,
});

await bukaDanTunggu(page, `${BASE}/produk`);
await kotakCariProduk.fill(pUji.name);
await page.waitForTimeout(500);
const barisUji = page.locator('table:visible tbody tr', { hasText: pUji.name }).first();
await barisUji.getByRole('button', { name: 'Ubah' }).click();
await page.waitForTimeout(500);
const dialog = page.getByRole('dialog');
const selectHitung = dialog.locator('select').nth(2); // 0 kategori, 1 base_unit, 2 satuan hitung
const nilaiSelectAwal = await selectHitung.inputValue();
const labelSelectAwal = await selectHitung.locator('option:checked').innerText();
const checkIzin = dialog.locator('input[type="checkbox"]').nth(1);
const izinTercentangAwal = await checkIzin.isChecked();
bukti.formProduk = { nilaiSelectAwal, labelSelectAwal, izinTercentangAwal };
cekIt('Form Produk: satuan hitung terisi dari produk', nilaiSelectAwal === String(unitHitungId), {
  nilai: nilaiSelectAwal,
  label: labelSelectAwal,
});
cekIt('Form Produk: checkbox izin jual stok kosong ada dan mengikuti produk', izinTercentangAwal === false, {
  tercentang: izinTercentangAwal,
});

// Nyalakan izin lewat form, lalu simpan: dua field itu harus ikut terkirim.
await checkIzin.check();
const sebelumSimpan = permintaan.length;
await dialog.getByRole('button', { name: 'Simpan', exact: true }).click();
await page.waitForTimeout(2500);
const putPertama = permintaan.slice(sebelumSimpan).find((r) => r.method === 'PUT');
const kiriman = putPertama ? JSON.parse(putPertama.body) : {};
const sesudahPut = await produkById(pUji.id);
bukti.putPertama = {
  payload: { base_unit_id: kiriman.base_unit_id, izin_minus: kiriman.izin_minus },
  produk: { base_unit_id: sesudahPut.base_unit_id, izin_minus: sesudahPut.izin_minus },
};
cekIt(
  'PUT /products: izin_minus + base_unit_id ikut terkirim',
  kiriman.izin_minus === true && kiriman.base_unit_id === unitHitungId,
  bukti.putPertama.payload,
);
cekIt(
  'PUT /products: pengaturan TIDAK tereset sesudah simpan',
  sesudahPut.izin_minus === true && sesudahPut.base_unit_id === unitHitungId,
  bukti.putPertama.produk,
);

// Kembalikan izin ke false lewat form (jalur yang sama), pastikan base_unit_id tetap bertahan.
await bukaDanTunggu(page, `${BASE}/produk`);
await kotakCariProduk.fill(pUji.name);
await page.waitForTimeout(500);
await page.locator('table:visible tbody tr', { hasText: pUji.name }).first().getByRole('button', { name: 'Ubah' }).click();
await page.waitForTimeout(500);
await dialog.locator('input[type="checkbox"]').nth(1).uncheck();
await dialog.getByRole('button', { name: 'Simpan', exact: true }).click();
await page.waitForTimeout(2500);
const sesudahPut2 = await produkById(pUji.id);
cekIt(
  'PUT /products: mematikan izin lewat form tidak menghapus satuan hitung',
  sesudahPut2.izin_minus === false && sesudahPut2.base_unit_id === unitHitungId,
  { izin_minus: sesudahPut2.izin_minus, base_unit_id: sesudahPut2.base_unit_id },
);

// C. Baris satuan hitung dihapus -> payload harus null (server menolak 422 kalau bukan null yang benar).
await bukaDanTunggu(page, `${BASE}/produk`);
await kotakCariProduk.fill(pUji.name);
await page.waitForTimeout(500);
await page.locator('table:visible tbody tr', { hasText: pUji.name }).first().getByRole('button', { name: 'Ubah' }).click();
await page.waitForTimeout(500);
const barisSatuan = dialog.locator('form div.grid').filter({ has: page.locator('select') });
const jumlahBarisSatuan = await barisSatuan.count();
await barisSatuan.last().getByRole('button', { name: 'Hapus baris' }).click();
await page.waitForTimeout(300);
const nilaiSelectSesudahHapus = await selectHitung.inputValue();
// PUT dibatalkan sebelum sampai server: yang diuji hanya isi payload-nya.
let payloadHapus = null;
await page.route('**/api/products/*', async (route) => {
  if (route.request().method() === 'PUT') {
    payloadHapus = JSON.parse(route.request().postData() ?? '{}');
    await route.abort();
    return;
  }
  await route.continue();
});
await dialog.getByRole('button', { name: 'Simpan', exact: true }).click();
await page.waitForTimeout(1500);
await page.unroute('**/api/products/*');
bukti.hapusBarisSatuan = {
  jumlahBarisAwal: jumlahBarisSatuan,
  nilaiSelectSesudahHapus,
  base_unit_idTerkirim: payloadHapus?.base_unit_id,
  satuanTerkirim: payloadHapus?.units?.length,
};
cekIt('Satuan hitung hilang -> pilihan jatuh ke Otomatis', nilaiSelectSesudahHapus === '', nilaiSelectSesudahHapus);
cekIt('Satuan hitung hilang -> payload mengirim null (bukan id satuan yang sudah dihapus)', payloadHapus?.base_unit_id === null, bukti.hapusBarisSatuan);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
// Produk di server tidak berubah (PUT dibatalkan) — pastikan begitu.
const sesudahBatal = await produkById(pUji.id);
cekIt('PUT yang dibatalkan tidak mengubah produk di server', sesudahBatal.base_unit_id === unitHitungId, {
  base_unit_id: sesudahBatal.base_unit_id,
});

// ============================================================ A/D. halaman Stok
await bukaDanTunggu(page, `${BASE}/stok`);
await page.waitForTimeout(800);
const s20 = await bacaKartu(page, 'Stok per Produk');
const stokTotal = Number(s20.teks.match(/Stok per Produk \((\d+)\)/)[1]);
bukti.paginationStok = { total: stokTotal, awal: s20.halaman, baris20: s20.jumlahBaris };
cekIt('Stok: default 20 baris + penghitung halaman', s20.jumlahBaris === 20 && s20.halaman === `Menampilkan 1–20 dari ${stokTotal}`, {
  baris: s20.jumlahBaris,
  halaman: s20.halaman,
});
await gantiPerHalaman(page, 'Stok per Produk', 10);
const s10 = await bacaKartu(page, 'Stok per Produk');
await page.locator('button[aria-label="Halaman berikutnya"]').first().click();
await page.waitForTimeout(300);
const s10b = await bacaKartu(page, 'Stok per Produk');
await gantiPerHalaman(page, 'Stok per Produk', 50);
const s50 = await bacaKartu(page, 'Stok per Produk');
cekIt(
  'Stok: 10 / berikutnya / 50 baris',
  s10.jumlahBaris === 10 && s10b.halaman === `Menampilkan 11–20 dari ${stokTotal}` && s50.jumlahBaris === 50,
  { baris10: s10.jumlahBaris, halaman10b: s10b.halaman, baris50: s50.jumlahBaris },
);
await gantiPerHalaman(page, 'Stok per Produk', 20);

const kotakCariStok = page.locator('section', { has: page.locator('h2', { hasText: 'Stok per Produk' }) }).locator('input').first();
await kotakCariStok.fill(satuanHitungAwal);
await page.waitForTimeout(400);
const cariStok = await bacaKartu(page, 'Stok per Produk');
const semuaStokPunyaSatuan = cariStok.baris.every((b) => b.toLowerCase().includes(satuanHitungAwal.toLowerCase()));
bukti.cariStok = { jumlah: cariStok.jumlahBaris, semuaStokPunyaSatuan };
cekIt('Stok: pencarian menjangkau satuan hitung', cariStok.jumlahBaris > 0 && semuaStokPunyaSatuan, {
  jumlah: cariStok.jumlahBaris,
  contoh: cariStok.baris[0]?.slice(0, 120),
});
await kotakCariStok.fill(pUji.name);
await page.waitForTimeout(400);
const barisStok = await bacaKartu(page, 'Stok per Produk');
const kolomStok = barisStok.sel[0] ?? [];
bukti.barisStok = kolomStok.slice(0, 5);
cekIt(
  'Stok: angka utama dalam satuan hitung + kolom Satuan hitung',
  kolomStok[0] === pUji.name && kolomStok[1] === kandidat.satuan_hitung && kolomStok[2] === kandidat.display_hitung,
  { kolom: kolomStok.slice(0, 4), diharapkan: [pUji.name, kandidat.satuan_hitung, kandidat.display_hitung] },
);
cekIt(
  'Stok: base tetap ditampilkan sebagai keterangan sekunder',
  (kolomStok[3] ?? '').includes(kandidat.display) && (kolomStok[3] ?? '').includes(pUji.base_unit),
  kolomStok[3],
);

// Riwayat pergerakan: pencarian memfilter baris yang sudah dimuat.
await page.getByRole('button', { name: 'Tampilkan' }).click();
await page.waitForTimeout(2500);
const kartuRiwayat = page.locator('section', { has: page.locator('h2', { hasText: 'Riwayat Pergerakan Stok' }) }).first();
const jumlahRiwayat = await kartuRiwayat.locator('tbody tr').count();
const tipeContoh = (await kartuRiwayat.locator('tbody tr').first().locator('td').nth(2).innerText()).trim();
const produkContoh = (await kartuRiwayat.locator('tbody tr').first().locator('td').nth(1).innerText()).trim();
const kotakCariRiwayat = kartuRiwayat.locator('input[aria-label="Cari di riwayat pergerakan stok"]');
await kotakCariRiwayat.fill('zzz-tidak-ada');
await page.waitForTimeout(300);
const riwayatKosong = await kartuRiwayat.locator('tbody tr').count();
const pesanKosong = await kartuRiwayat.getByText('Tidak ada baris yang cocok.').isVisible();
await kotakCariRiwayat.fill(tipeContoh.toLowerCase());
await page.waitForTimeout(300);
const riwayatTipe = await kartuRiwayat.locator('tbody tr').count();
const semuaTipeCocok = await kartuRiwayat
  .locator('tbody tr')
  .evaluateAll((tr, q) => tr.every((t) => t.innerText.toLowerCase().includes(q)), tipeContoh.toLowerCase());
await kotakCariRiwayat.fill(produkContoh);
await page.waitForTimeout(300);
const riwayatProduk = await kartuRiwayat.locator('tbody tr').count();
const semuaProdukCocok = await kartuRiwayat
  .locator('tbody tr')
  .evaluateAll((tr, q) => tr.every((t) => t.innerText.includes(q)), produkContoh);
bukti.riwayat = { jumlahRiwayat, tipeContoh, produkContoh, riwayatKosong, pesanKosong, riwayatTipe, semuaTipeCocok, riwayatProduk, semuaProdukCocok };
cekIt(
  'Riwayat stok: pencarian menyaring baris yang dimuat (produk + tipe)',
  jumlahRiwayat > 0 &&
    riwayatKosong === 0 &&
    pesanKosong &&
    riwayatTipe > 0 &&
    semuaTipeCocok &&
    riwayatProduk > 0 &&
    semuaProdukCocok,
  bukti.riwayat,
);
await kotakCariRiwayat.fill('');

// D. kontrol izin per baris (superadmin): PATCH, bukan PUT.
const tombolIzin = page.locator(`button[aria-label="Izinkan penjualan saat stok \\"${pUji.name}\\" kosong"]:visible`).first();
const kartuStok = page.locator('section', { has: page.locator('h2', { hasText: 'Stok per Produk' }) }).first();
// Baris produk yang sedang disaring: satu-satunya baris tabel yang terlihat.
const selStatusStok = () => kartuStok.locator('table:visible tbody tr').first().locator('td').nth(4).innerText();
const statusSebelum = await selStatusStok();
const lencanaSebelum = statusSebelum.includes('Tidak boleh minus') && !statusSebelum.includes('Boleh minus');
const sebelumPatch = permintaan.length;
await tombolIzin.click();
await page.waitForTimeout(2500);
const panggilan = permintaan.slice(sebelumPatch);
const produkSesudahIzin = await produkById(pUji.id);
const statusSesudah = await selStatusStok();
const lencanaSesudah = statusSesudah.includes('Boleh minus') && !statusSesudah.includes('Tidak boleh minus');
bukti.kontrolIzin = {
  statusSebelum,
  statusSesudah,
  lencanaSebelum,
  lencanaSesudah,
  metode: panggilan.map((r) => `${r.method} ${r.url.split('/api')[1]}`),
  body: panggilan.map((r) => r.body),
  izinServer: produkSesudahIzin.izin_minus,
};
cekIt(
  'Stok: tombol izin memakai PATCH /products/:id/pengaturan dan mengubah server',
  panggilan.some((r) => r.method === 'PATCH' && r.url.includes('/pengaturan')) &&
    !panggilan.some((r) => r.method === 'PUT') &&
    produkSesudahIzin.izin_minus === true,
  bukti.kontrolIzin,
);
cekIt('Stok: lencana berubah Tidak boleh minus -> Boleh minus', lencanaSebelum && lencanaSesudah, {
  sebelum: statusSebelum,
  sesudah: statusSesudah,
});

// Kartu HP: satuan hitung + lencana juga tampil di daftar kartu.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const kartuHp = await bacaKartu(page, 'Stok per Produk');
bukti.kartuHp = kartuHp.teks.slice(0, 400);
cekIt(
  'Stok HP: kartu menampilkan satuan hitung + lencana izin',
  kartuHp.teks.includes(pUji.name) && kartuHp.teks.includes(satuanHitungAwal) && kartuHp.teks.includes('Boleh minus'),
  kartuHp.teks.slice(0, 200),
);
await page.setViewportSize({ width: 1280, height: 900 });

// ============================================================ D. kasir menolak lalu mengizinkan
await bukaDanTunggu(page, `${BASE}/kasir`);
await page.fill('main input[type="search"]', pUji.name);
await page.waitForTimeout(900);
const teksHasil = await page.locator('main div.absolute.inset-x-0').first().innerText();
const tombolSatuan = page.locator(`main button[aria-label^="Tambah ${pUji.name} ${satuanHitungAwal}"]`).first();
await tombolSatuan.click();
await page.waitForTimeout(600);
const keranjangDiizinkan = await bacaTabelKeranjang(page);
bukti.kasirDiizinkan = { teksHasil: teksHasil.replace(/\n/g, ' | '), jumlahBaris: keranjangDiizinkan.jumlahBaris };
cekIt(
  'Kasir: stok ditampilkan di hasil pencarian dalam satuan hitung',
  /Sisa\s+0\s/i.test(teksHasil) && teksHasil.includes(satuanHitungAwal),
  teksHasil.replace(/\n/g, ' | ').slice(0, 160),
);
cekIt('Kasir: izin menyala -> barang boleh masuk keranjang', keranjangDiizinkan.jumlahBaris === 1, {
  jumlahBaris: keranjangDiizinkan.jumlahBaris,
});
await page.getByRole('button', { name: 'Kosongkan' }).click();
await page.waitForTimeout(400);

// Matikan izin lewat UI Stok, lalu kasir harus ditolak.
await bukaDanTunggu(page, `${BASE}/stok`);
await kotakCariStok.fill(pUji.name);
await page.waitForTimeout(400);
await page.locator(`button[aria-label="Larang penjualan saat stok \\"${pUji.name}\\" kosong"]:visible`).first().click();
await page.waitForTimeout(2500);
const produkSetelahLarang = await produkById(pUji.id);
cekIt('Stok: tombol Larang minus mematikan izin di server', produkSetelahLarang.izin_minus === false, {
  izin_minus: produkSetelahLarang.izin_minus,
});

await bukaDanTunggu(page, `${BASE}/kasir`);
await page.fill('main input[type="search"]', pUji.name);
await page.waitForTimeout(900);
const teksHasilDilarang = await page.locator('main div.absolute.inset-x-0').first().innerText();
await page.locator(`main button[aria-label^="Tambah ${pUji.name} ${satuanHitungAwal}"]`).first().click();
await page.waitForTimeout(700);
const keranjangDitolak = await bacaTabelKeranjang(page);
const galat = await page.locator('main div.bg-red-50').first().innerText().catch(() => '');
const isi = pUji.units.find((u) => u.unit_name === satuanHitungAwal).isi;
bukti.kasirDitolak = {
  teksHasil: teksHasilDilarang.replace(/\n/g, ' | '),
  jumlahBaris: keranjangDitolak.jumlahBaris,
  galat,
};
cekIt('Kasir: stok kosong ditandai jelas di hasil pencarian', /stok kosong/i.test(teksHasilDilarang), bukti.kasirDitolak.teksHasil.slice(0, 200));
cekIt(
  'Kasir: menambah barang melebihi stok DITOLAK dan keranjang tidak berubah',
  keranjangDitolak.jumlahBaris === 0 && galat.includes('tidak cukup') && galat.includes(`butuh ${isi}`),
  { baris: keranjangDitolak.jumlahBaris, galat },
);

// ============================================================ E. stok offline: display_hitung tidak basi
// Payload /api/sync/pull buatan sendiri: satu produk dus isi 144 dengan stok 300 base.
const ID_UJI = 987654;
const ID_UJI2 = 987655;
const payloadUji = {
  ...payloadPull,
  products: [
    ...payloadPull.products,
    {
      id: ID_UJI,
      name: 'UJI Hitung Dus 144',
      category_id: null,
      category_name: null,
      base_unit: 'pcs',
      barcode: null,
      is_active: true,
      base_unit_id: idUnit('dus'),
      izin_minus: false,
      units: [
        { id: 0, unit_id: idUnit('pcs'), unit_name: 'pcs', isi: 1, harga_jual: 1000, harga_modal: 800, barcode: null },
        { id: 0, unit_id: idUnit('dus'), unit_name: 'dus', isi: 144, harga_jual: 144000, harga_modal: 120000, barcode: null },
      ],
    },
    // Stok 1 pcs: dipakai membuktikan penjagaan saat qty DINAIKKAN (bukan hanya saat menambah).
    {
      id: ID_UJI2,
      name: 'UJI Stok Satu Pcs',
      category_id: null,
      category_name: null,
      base_unit: 'pcs',
      barcode: null,
      is_active: true,
      base_unit_id: null,
      izin_minus: false,
      units: [
        { id: 0, unit_id: idUnit('pcs'), unit_name: 'pcs', isi: 1, harga_jual: 2000, harga_modal: 1500, barcode: null },
      ],
    },
  ],
  stock: [
    ...payloadPull.stock,
    {
      product_id: ID_UJI,
      name: 'UJI Hitung Dus 144',
      base_unit: 'pcs',
      stok_base: 300,
      display: '2 dus 12 pcs',
      minus: false,
      base_unit_id: idUnit('dus'),
      satuan_hitung: 'dus',
      stok_hitung: 2.08,
      display_hitung: '2,08 dus',
      izin_minus: false,
    },
    {
      product_id: ID_UJI2,
      name: 'UJI Stok Satu Pcs',
      base_unit: 'pcs',
      stok_base: 1,
      display: '1 pcs',
      minus: false,
      base_unit_id: null,
      satuan_hitung: 'pcs',
      stok_hitung: 1,
      display_hitung: '1 pcs',
      izin_minus: false,
    },
  ],
};
await page.route('**/api/sync/pull', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payloadUji) }));
await page.route('**/api/sales', (route) => route.abort());
await bukaDanTunggu(page, `${BASE}/kasir`);
await page.waitForTimeout(1500);

/**
 * Akses Dexie lewat IndexedDB mentah, TANPA `import('/src/db.ts')`.
 * Server produksi (BASE_URL :3000) hanya menyajikan `dist/`, jadi `/src/*.ts` tidak ada di
 * sana — jalur itu hanya hidup di server dev Vite. Nama database dan tabelnya tetap sama
 * karena Dexie menyimpan ke IndexedDB apa adanya.
 */
const dbDexie = (namaTabel, aksi, argumen) =>
  page.evaluate(
    ({ namaTabel, aksi, argumen }) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('toko-hakim-pos');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(namaTabel, aksi === 'get' ? 'readonly' : 'readwrite');
          const st = tx.objectStore(namaTabel);
          if (aksi === 'get') {
            const g = st.get(argumen);
            g.onerror = () => reject(g.error);
            g.onsuccess = () => {
              const r = g.result ?? null;
              db.close();
              resolve(r);
            };
            return;
          }
          if (aksi === 'put') st.put(argumen);
          else st.delete(argumen);
          tx.oncomplete = () => {
            db.close();
            resolve(true);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { namaTabel, aksi, argumen },
  );
const bacaDexie = (tabel, key) => dbDexie(tabel, 'get', key);
const tulisDexie = (tabel, nilai) => dbDexie(tabel, 'put', nilai);
const hapusDexie = (tabel, key) => dbDexie(tabel, 'delete', key);

/**
 * Tarik ulang master data lewat jalur aplikasinya sendiri: memuat ulang halaman membuat
 * `mulaiSync()` di `main.tsx` memanggil `pullSync()` persis seperti saat kasir membuka
 * aplikasi. Jadi yang diuji jalur nyata, bukan pemanggilan modul dari luar.
 */
const tarikSync = async () => {
  await bukaDanTunggu(page, `${BASE}/kasir`);
  await page.waitForTimeout(1500);
  const row = await bacaDexie('cachedStock', 987654);
  return { ok: !!row, row };
};

const sebelum = await tarikSync();
const bersih = { stok_base: sebelum.row.stok_base, stok_hitung: sebelum.row.stok_hitung, display_hitung: sebelum.row.display_hitung, display: sebelum.row.display };
cekIt(
  'Offline: keadaan awal 300 base = 2,08 dus',
  bersih.stok_base === 300 && bersih.stok_hitung === 2.08 && bersih.display_hitung === '2,08 dus',
  bersih,
);

const uuidUji = 'uji-offline-hitung-0001';
await tulisDexie('pendingSales', {
  uuid: uuidUji,
  created_at: new Date().toISOString(),
  status: 'pending',
  payload: {
    uuid: uuidUji,
    items: [{ product_id: ID_UJI, unit_id: idUnit('dus'), qty: 1, harga: 144000 }],
    metode_bayar: 'tunai',
    dibayar: 144000,
    created_at: new Date().toISOString(),
  },
});

const sesudah = await tarikSync();
const nilaiDexie = {
  stok_base: sesudah.row.stok_base,
  stok_hitung: sesudah.row.stok_hitung,
  display_hitung: sesudah.row.display_hitung,
  display: sesudah.row.display,
  satuan_hitung: sesudah.row.satuan_hitung,
  minus: sesudah.row.minus,
};
bukti.offline = { sebelum: bersih, sesudah: nilaiDexie };
cekIt(
  'Offline: penjualan 1 dus (144 base) memotong stok_base DAN memperbarui stok_hitung/display_hitung',
  nilaiDexie.stok_base === 156 && nilaiDexie.stok_hitung === 1.08 && nilaiDexie.display_hitung === '1,08 dus',
  nilaiDexie,
);
cekIt('Offline: display_hitung TIDAK basi (bukan 2,08 dus)', nilaiDexie.display_hitung !== bersih.display_hitung, nilaiDexie.display_hitung);
cekIt('Offline: display base ikut diperbarui', nilaiDexie.display === '1 dus 12 pcs', nilaiDexie.display);

// E3. Sisa stok di hasil pencarian mengikuti isi keranjang, bukan stok total.
await bukaDanTunggu(page, `${BASE}/kasir`);
const teksHasilCari = async (kata) => {
  await page.fill('main input[type="search"]', kata);
  await page.waitForTimeout(900);
  return (await page.locator('main div.absolute.inset-x-0').first().innerText()).replace(/\s*\n\s*/g, ' | ');
};

// Produk dus isi 144: stok tersisa 156 base = 1,08 dus (pending offline sudah diterapkan).
const dusSebelum = await teksHasilCari('UJI Hitung Dus 144');
await page.locator('main button[aria-label^="Tambah UJI Hitung Dus 144 dus"]').first().click();
await page.waitForTimeout(700);
const dusSesudah = await teksHasilCari('UJI Hitung Dus 144');
bukti.sisaKeranjangDus = { sebelum: dusSebelum, sesudah: dusSesudah };
cekIt(
  'Kasir: sisa stok berkurang setelah barang masuk keranjang (satuan hitung, koma Indonesia)',
  /Sisa 1,08 dus/.test(dusSebelum) && /Sisa 0,08 dus/.test(dusSesudah),
  bukti.sisaKeranjangDus,
);
await page.fill('main input[type="search"]', '');
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Kosongkan' }).click();
await page.waitForTimeout(400);

// Produk pcs: stok 1. Sebelum masuk keranjang "Sisa 1 pcs", sesudah "Sisa 0 pcs" + penanda.
const pcsSebelum = await teksHasilCari('UJI Stok Satu Pcs');
await page.locator('main button[aria-label^="Tambah UJI Stok Satu Pcs pcs"]').first().click();
await page.waitForTimeout(700);
const pcsSesudah = await teksHasilCari('UJI Stok Satu Pcs');
const setelahTambah = await bacaTabelKeranjang(page);
bukti.sisaKeranjangPcs = { sebelum: pcsSebelum, sesudah: pcsSesudah };
cekIt(
  'Kasir: sisa stok di hasil pencarian jadi 0 setelah keranjang memakai seluruh stok',
  /Sisa 1 pcs/.test(pcsSebelum) && /Sisa 0 pcs/.test(pcsSesudah) && !/Sisa 1 pcs/.test(pcsSesudah),
  bukti.sisaKeranjangPcs,
);
cekIt(
  'Kasir: penanda stok kosong ikut menyebut sisa yang sama',
  /stok kosong \(sisa 0 pcs\), minta izin superadmin/.test(pcsSesudah),
  pcsSesudah,
);
await page.fill('main input[type="search"]', '');
await page.waitForTimeout(400);

// Penjagaan saat qty DINAIKKAN (bukan hanya saat menambah barang baru).
await page.locator('button[aria-label="Tambah qty UJI Stok Satu Pcs"]').first().click();
await page.waitForTimeout(500);
const setelahPlus = await bacaTabelKeranjang(page);
const qtySetelahPlus = await page.locator('button[aria-label="Ubah qty UJI Stok Satu Pcs"]').first().innerText();
const galatPlus = await page.locator('main div.bg-red-50').first().innerText().catch(() => '');
bukti.qtyNaik = { setelahTambah: setelahTambah.baris[0] ?? '', qtySetelahPlus, galat: galatPlus };
cekIt(
  'Kasir: tombol + melebihi stok ditolak, qty tetap',
  setelahTambah.jumlahBaris === 1 && setelahPlus.jumlahBaris === 1 && qtySetelahPlus.trim() === '1' && galatPlus.includes('butuh 2'),
  bukti.qtyNaik,
);

// Lewat pop up baris (qty diubah di dialog, bukan di tabel).
await page.locator('button[aria-label="Ubah qty UJI Stok Satu Pcs"]').first().click();
await page.waitForTimeout(400);
await page.getByRole('dialog').getByRole('button', { name: 'Tambah qty' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Simpan', exact: true }).click();
await page.waitForTimeout(500);
const setelahDialog = await bacaTabelKeranjang(page);
const galatDialog = await page.locator('main div.bg-red-50').first().innerText().catch(() => '');
const dialogMasihTerbuka = await page.getByRole('dialog').getByRole('button', { name: 'Tambah qty' }).isVisible().catch(() => false);
bukti.qtyDialog = { baris: setelahDialog.baris[0] ?? '', galat: galatDialog, dialogMasihTerbuka };
cekIt(
  'Kasir: qty dinaikkan lewat pop up juga ditolak, baris tidak berubah',
  setelahDialog.jumlahBaris === 1 && galatDialog.includes('butuh 2') && dialogMasihTerbuka,
  bukti.qtyDialog,
);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

await hapusDexie('pendingSales', uuidUji);
await hapusDexie('receipts', uuidUji);
await page.unroute('**/api/sync/pull');
await page.unroute('**/api/sales');

// ============================================================ E2. lencana untuk kasir (tanpa kontrol)
const ctxKasir = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const pageKasir = await ctxKasir.newPage();
await pasangPenjagaOverlay(pageKasir);
await masuk(pageKasir, BASE, 'aldipradana', 'Aldi1234');
await bukaDanTunggu(pageKasir, `${BASE}/stok`);
await pageKasir.waitForTimeout(1200);
const tombolIzinKasir = await pageKasir.locator('button[aria-label^="Izinkan penjualan saat stok"]').count();
const lencanaKasir = await pageKasir.getByText('Tidak boleh minus').first().isVisible();
bukti.kasirLencana = { tombolIzin: tombolIzinKasir, lencanaTerlihat: lencanaKasir };
cekIt('Kasir (bukan superadmin): hanya lencana, tanpa tombol izin', tombolIzinKasir === 0 && lencanaKasir, bukti.kasirLencana);
await ctxKasir.close();

// ============================================================ pemulihan data
const restore = await api(`/products/${pUji.id}`, { method: 'PUT', body: JSON.stringify(snapshot) });
const akhir = await produkById(pUji.id);
const sama = (a, b) =>
  a.name === b.name &&
  a.category_id === b.category_id &&
  a.base_unit === b.base_unit &&
  a.barcode === b.barcode &&
  a.is_active === b.is_active &&
  a.base_unit_id === b.base_unit_id &&
  a.izin_minus === b.izin_minus &&
  a.units.length === b.units.length &&
  a.units.every((u, i) => u.unit_id === b.units[i].unit_id && u.isi === b.units[i].isi && u.harga_jual === b.units[i].harga_jual);
bukti.pemulihan = { status: restore.status, produk: { base_unit_id: akhir.base_unit_id, izin_minus: akhir.izin_minus, units: akhir.units.length }, utuh: sama(snapshot, akhir) };
cekIt('Produk uji dikembalikan persis ke keadaan awal', restore.status === 200 && sama(snapshot, akhir), bukti.pemulihan);

await browser.close();

bukti.lulus = cek.every((c) => c.lulus);
bukti.cek = cek;
fs.writeFileSync(path.join(KELUARAN, 'bukti-stok-izin-hitung.json'), JSON.stringify(bukti, null, 2));
console.log(`\n${bukti.lulus ? 'LULUS' : 'GAGAL'}: ${cek.filter((c) => c.lulus).length}/${cek.length} pemeriksaan.`);
console.log('bukti: verifikasi/bukti-stok-izin-hitung.json');
if (!bukti.lulus) process.exitCode = 1;
