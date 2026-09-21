/**
 * Verifikasi lanjutan perubahan UX atas permintaan pemilik Toko Hakim.
 * (Bukti tata letak kasir/sidebar ada di `verify-layout.mjs`; bukti kasir & kalkulator ada
 * di `verify-kasir.mjs`. Berkas ini menutup sisanya.)
 *
 *  1. Kartu omset ada di halaman Laporan (superadmin) dan TIDAK ada di /kasir; kasir juga
 *     tidak pernah memanggil `/reports/omzet` (endpoint itu kini menolak kasir dengan 403).
 *  2. Pembelian tanpa harga: formulir hanya minta produk + satuan + qty, dan body yang
 *     dikirim tidak memuat `harga_beli`.
 *  3. Cetak/PDF laporan lewat media cetak (`@media print` + window.print, tanpa pustaka).
 *  4. Offline: transaksi disimpan lokal (OFF-), tersinkron tepat sekali, lalu dibersihkan.
 *  5. Data pemilik utuh sebelum vs sesudah pengujian.
 *
 * Jalankan: node scripts/verify-ux-owner.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { bukaDanTunggu, masuk, pasangPenjagaOverlay, tambahProduk } from './verifikasi-util.mjs';

// Node me-resolve `localhost` ke ::1, sedangkan Express mendengarkan di IPv4 — pakai 127.0.0.1
// supaya fetch dari skrip ini tidak pernah salah alamat (lihat catatan di vite.config.ts).
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const KELUARAN = path.resolve('verifikasi');
fs.mkdirSync(KELUARAN, { recursive: true });

const bukti = { catatan: [] };
const simpanBukti = () =>
  fs.writeFileSync(path.join(KELUARAN, 'bukti-ux-owner.json'), JSON.stringify(bukti, null, 2));

const browser = await chromium.launch();

async function api(tok, p, init = {}) {
  const r = await fetch(`${API}/api${p}`, {
    ...init,
    headers: { Authorization: `Bearer ${tok}`, ...(init.headers ?? {}) },
  });
  const teks = await r.text();
  let body;
  try {
    body = JSON.parse(teks);
  } catch {
    body = teks;
  }
  return { status: r.status, body };
}

const daftar = (body) => (Array.isArray(body) ? body : (body?.rows ?? body?.data ?? []));

async function snapshot(tok) {
  const [pull, sales, purchases, omzet] = await Promise.all([
    api(tok, '/sync/pull'),
    api(tok, '/sales?limit=500'),
    api(tok, '/purchases?limit=500'),
    api(tok, '/reports/omzet'),
  ]);
  return {
    produk: pull.body.products.length,
    sedaap: pull.body.stock.find((s) => s.product_id === 1)?.stok_base,
    penjualan: daftar(sales.body).length,
    pembelian: daftar(purchases.body).length,
    omzet,
  };
}

const login = async (username, password) => {
  const r = await fetch(`${API}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) throw new Error(`Login API gagal (${r.status})`);
  return (await r.json()).token;
};

const tok = await login('superadmin', 'password');
const tokKasir = await login('aldipradana', 'Aldi1234');
const sebelum = await snapshot(tok);
/** Nota pembelian & transaksi milik pemilik SEBELUM pengujian — hanya yang BARU boleh dihapus. */
const idBeliAwal = new Set(daftar((await api(tok, '/purchases?limit=500')).body).map((p) => p.id));
const uuidJualAwal = new Set(daftar((await api(tok, '/sales?limit=500')).body).map((s) => s.uuid));
bukti.dataSebelum = sebelum;
bukti.kasir403Omzet = (await api(tokKasir, '/reports/omzet')).status;
bukti.bundel = await (async () => {
  const r = await fetch(`${BASE}/`);
  return /assets\/index-[\w-]+\.js/.exec(await r.text())?.[0] ?? '';
})();

const ctxBaru = ({ width, height, sentuh = false }) =>
  browser.newContext({ viewport: { width, height }, hasTouch: sentuh, isMobile: sentuh, serviceWorkers: 'block' });

/** Jalankan satu bagian; kegagalan bagian ini tidak membatalkan bukti bagian lain. */
async function bagian(nama, fn) {
  try {
    bukti[nama] = await fn();
  } catch (e) {
    bukti[nama] = { GAGAL: e instanceof Error ? e.message : String(e) };
    bukti.catatan.push(`${nama}: ${e instanceof Error ? e.message : String(e)}`);
  }
  simpanBukti();
}

// =====================================================================================
// 1. Omset: hanya superadmin, dan tidak ada di /kasir
// =====================================================================================
await bagian('omset', async () => {
  const hasil = {};
  for (const [label, akun] of [
    ['superadmin', { u: 'superadmin', p: 'password' }],
    ['kasir', { u: 'aldipradana', p: 'Aldi1234' }],
  ]) {
    const ctx = await ctxBaru({ width: 1440, height: 900 });
    const page = await ctx.newPage();
    const permintaanOmzet = [];
    const respons403 = [];
    page.on('request', (r) => {
      if (r.url().includes('/reports/omzet')) permintaanOmzet.push(r.url());
    });
    page.on('response', (r) => {
      if (r.status() === 403) respons403.push(`${r.status()} ${r.url()}`);
    });
    await pasangPenjagaOverlay(page);
    await masuk(page, BASE, akun.u, akun.p);

    await bukaDanTunggu(page, `${BASE}/kasir`);
    await page.waitForTimeout(2500);
    const diKasir = await page.evaluate(() => {
      const main = document.querySelector('main');
      return {
        teksOmset: /omset/i.test(main.innerText),
        elemenOmset: [...main.querySelectorAll('p')].filter((p) => /Omset/i.test(p.textContent)).length,
      };
    });

    let diLaporan = null;
    if (label === 'superadmin') {
      await bukaDanTunggu(page, `${BASE}/laporan`);
      await page.waitForTimeout(3000);
      diLaporan = await page.evaluate(() => {
        const main = document.querySelector('main');
        return {
          kartu: [...main.querySelectorAll('div')]
            .filter((d) => /Omset Hari Ini|Omset Bulan Ini|Omset Tahun Ini/.test(d.innerText))
            .slice(-1)
            .map((d) => d.innerText.replace(/\n/g, ' | ')),
          teks: [...main.querySelectorAll('p')]
            .map((p) => p.textContent.trim())
            .filter((t) => /Omset|transaksi/.test(t)),
        };
      });
      await page.screenshot({ path: path.join(KELUARAN, 'omset-superadmin.png') });
    }
    hasil[label] = { diKasir, diLaporan, permintaanOmzet, respons403 };
    await ctx.close();
  }
  return hasil;
});

// =====================================================================================
// 2. Pembelian tanpa harga
// =====================================================================================
await bagian('pembelian', async () => {
  const ctx = await ctxBaru({ width: 1440, height: 900 });
  const page = await ctx.newPage();
  let kirimBody = null;
  let balasan = null;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/purchases')) kirimBody = r.postDataJSON();
  });
  page.on('response', async (r) => {
    if (r.request().method() === 'POST' && r.url().endsWith('/api/purchases')) {
      balasan = { status: r.status(), body: await r.json().catch(() => null) };
    }
  });
  await pasangPenjagaOverlay(page);
  await masuk(page, BASE, 'superadmin', 'password');
  await bukaDanTunggu(page, `${BASE}/pembelian`);
  await page.waitForTimeout(1500);

  const sebelumBeli = await snapshot(tok);
  await page.getByRole('button', { name: '+ Pembelian Baru' }).click();
  await page.waitForTimeout(600);

  const modal = page.locator('.fixed.inset-0');
  const formulir = await modal.evaluate((m) => ({
    teks: m.innerText.replace(/\n+/g, ' | '),
    adaKataHarga: /harga/i.test(m.innerText),
    adaSubtotal: /subtotal/i.test(m.innerText),
    adaTotalPembelian: /total pembelian/i.test(m.innerText),
    label: [...m.querySelectorAll('span')]
      .map((s) => s.textContent.trim())
      .filter((t) => t && t.length < 30),
    jumlahInputAngka: m.querySelectorAll('input[inputmode="numeric"]').length,
  }));

  await modal.locator('select').first().selectOption({ index: 1 });
  await page.waitForTimeout(300);
  await modal.locator('select').nth(1).selectOption({ index: 1 });
  await modal.locator('input[inputmode="numeric"]').first().fill('2');
  await page.getByRole('button', { name: 'Simpan Pembelian' }).click();
  await page.waitForTimeout(3000);

  const setelahBeli = await snapshot(tok);
  const pesanDiLayar = await page.locator('.fixed.inset-0').innerText().catch(() => '(modal tertutup)');

  // Bersihkan HANYA nota uji yang baru lahir (stok dikembalikan server). Nota pemilik tidak disentuh.
  const dihapus = [];
  for (const p of daftar((await api(tok, '/purchases?limit=500')).body)) {
    if (idBeliAwal.has(p.id)) continue;
    const d = await api(tok, `/purchases/${p.id}`, { method: 'DELETE' });
    dihapus.push({ id: p.id, status: d.status });
  }
  const setelahBersih = await snapshot(tok);

  await page.screenshot({ path: path.join(KELUARAN, 'pembelian.png') });
  await ctx.close();
  return { formulir, kirimBody, balasan, pesanDiLayar: pesanDiLayar.slice(0, 300), sebelumBeli, setelahBeli, dihapus, setelahBersih };
});

// =====================================================================================
// 3. Cetak / PDF laporan (media cetak) — termasuk struk 58mm tetap utuh
// =====================================================================================
await bagian('cetak', async () => {
  const ctx = await ctxBaru({ width: 1440, height: 900 });
  const page = await ctx.newPage();
  await pasangPenjagaOverlay(page);
  await masuk(page, BASE, 'superadmin', 'password');
  const hasil = {};

  // Laporan hanya bermakna kalau ada datanya, jadi satu transaksi & satu pembelian uji dibuat
  // lebih dulu lewat API, lalu dihapus lagi di akhir bagian ini.
  const hariIni = new Date().toISOString().slice(0, 10);
  const uuidUji = crypto.randomUUID();
  const jual = await api(tok, '/sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uuid: uuidUji,
      items: [{ product_id: 1, unit_id: 1, qty: 3, harga: 2700 }],
      metode_bayar: 'tunai',
      dibayar: 10000,
      created_at: new Date().toISOString(),
      nama_pelanggan: 'Uji Cetak Laporan',
    }),
  });
  const beli = await api(tok, '/purchases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tanggal: hariIni,
      supplier: 'Supplier Uji Cetak',
      note: 'uji',
      items: [{ product_id: 1, unit_id: 1, qty: 2 }],
    }),
  });
  // POST /sales membalas `{sale, duplicate}`, jadi id-nya ada di dalam `sale`.
  const idJual = jual.body?.sale?.id;
  hasil.dataUji = { jual: { status: jual.status, id: idJual }, beli: { status: beli.status, id: beli.body?.id } };

  for (const slug of ['umum', 'pembelian', 'penjualan', 'transaksi', 'laba-rugi']) {
    await bukaDanTunggu(page, `${BASE}/laporan/${slug}`);
    await page.waitForTimeout(2500);
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(400);
    hasil[slug] = await page.evaluate(() => {
      const terlihat = (el) => {
        if (!el) return false;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };
      const kop = [...document.querySelectorAll('main div')].find(
        (d) => /Periode:/.test(d.textContent ?? '') && (d.className ?? '').includes('print:block'),
      );
      const area = document.querySelector('.area-laporan');
      const tabel = document.querySelector('main table');
      const rentang = [...document.querySelectorAll('section > header > h2')].find((h) => h.textContent === 'Rentang');
      const tombolCetak = [...document.querySelectorAll('button')].find((b) => /Cetak \/ PDF/.test(b.textContent));
      return {
        pageProp: area ? getComputedStyle(area).page : null,
        kopTampil: terlihat(kop),
        kopTeks: (kop?.innerText ?? '').replace(/\n+/g, ' | '),
        sidebarTampil: terlihat(document.querySelector('aside')),
        headerTampil: terlihat(document.querySelector('header.no-print')),
        tabTampil: terlihat(document.querySelector('[role="tablist"]')),
        tombolCetakTampil: terlihat(tombolCetak),
        kartuRentangTampil: terlihat(rentang?.closest('section')),
        tabelTampil: terlihat(tabel),
        barisTabel: document.querySelectorAll('main table tbody tr').length,
        barisTotal: (document.querySelector('main table tfoot')?.innerText ?? '').replace(/\n+/g, ' | '),
        judulKartu: [...document.querySelectorAll('main h2')].map((h) => h.textContent.trim()),
      };
    });
    await page.emulateMedia({ media: null });
    await page.waitForTimeout(300);
  }

  // Struk 58mm tetap memakai halaman bernama `struk`.
  if (jual.status === 201 || jual.status === 200) {
    await bukaDanTunggu(page, `${BASE}/kasir/struk/${uuidUji}`);
    await page.waitForTimeout(2000);
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(400);
    hasil.struk58 = await page.evaluate(() => {
      const area = document.querySelector('.area-cetak');
      const struk = document.querySelector('.struk');
      const r = area?.getBoundingClientRect();
      const tombol = [...document.querySelectorAll('button')].find((b) => /Cetak/.test(b.textContent));
      return {
        pageProp: area ? getComputedStyle(area).page : null,
        posisi: area ? getComputedStyle(area).position : null,
        kiriPx: r ? Math.round(r.left) : null,
        atasPx: r ? Math.round(r.top) : null,
        lebarPx: r ? Math.round(r.width) : null,
        lebarMm: r ? Math.round((r.width / 96) * 25.4 * 10) / 10 : null,
        strukTerlihat: !!struk && struk.getBoundingClientRect().width > 0,
        barisAwal: (struk?.innerText ?? '').split('\n').slice(0, 4).join(' | '),
        tombolCetakTampil: tombol
          ? getComputedStyle(tombol).display !== 'none' && tombol.getBoundingClientRect().width > 0
          : null,
      };
    });
    await page.emulateMedia({ media: null });
  } else {
    hasil.struk58 = { catatan: `Transaksi uji gagal dibuat (status ${jual.status}).` };
  }

  // Semua laporan (kecuali halaman unduh CSV yang memang tanpa tabel) harus punya tombol
  // Cetak/PDF, dan tombolnya harus hilang saat media cetak.
  hasil.tombolSemuaLaporan = {};
  for (const slug of [
    'umum',
    'transaksi',
    'arus-keuangan',
    'penjualan',
    'kategori',
    'pembelian',
    'modal',
    'laba-rugi',
    'retur',
    'stok-opname',
    'harian',
    'laba',
    'harga',
    'export-arus-stok',
  ]) {
    await bukaDanTunggu(page, `${BASE}/laporan/${slug}`);
    await page.waitForTimeout(1200);
    const layar = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Cetak \/ PDF/.test(x.textContent));
      return b ? getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0 : false;
    });
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(200);
    const cetak = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Cetak \/ PDF/.test(x.textContent));
      const kop = [...document.querySelectorAll('main div')].find(
        (d) => /Periode:/.test(d.textContent ?? '') && (d.className ?? '').includes('print:block'),
      );
      return {
        tombol: b ? getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0 : false,
        kop: !!kop && kop.getBoundingClientRect().width > 0,
      };
    });
    await page.emulateMedia({ media: null });
    hasil.tombolSemuaLaporan[slug] = { diLayar: layar, ...cetak };
  }

  // Bersihkan data uji (stok dikembalikan server).
  hasil.pembersihan = {
    jual: idJual ? (await api(tok, `/sales/${idJual}`, { method: 'DELETE' })).status : 'tidak dibuat',
    beli: beli.body?.id ? (await api(tok, `/purchases/${beli.body.id}`, { method: 'DELETE' })).status : 'tidak dibuat',
  };
  await ctx.close();
  return hasil;
});

// =====================================================================================
// 4. Offline: simpan lokal -> sinkron sekali -> dibersihkan
// =====================================================================================
await bagian('offline', async () => {
  const ctx = await ctxBaru({ width: 390, height: 844, sentuh: true });
  const page = await ctx.newPage();
  await pasangPenjagaOverlay(page);
  await masuk(page, BASE, 'aldipradana', 'Aldi1234');
  await page.waitForTimeout(2500);
  const sebelumOffline = await snapshot(tok);
  const uuidAwal = uuidJualAwal;

  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForTimeout(600);

  await tambahProduk(page, 'Sedaap');
  await page.fill('main input[placeholder*="Bu Siti"]', 'Pelanggan Uji Offline');
  // Dibayar lewat kalkulator (satu-satunya cara mengisi kolom itu).
  await page.locator('main button[aria-haspopup="dialog"]').click();
  await page.waitForTimeout(500);
  const modal = page.locator('.fixed.inset-0');
  for (const t of ['1', '0', '0', '0', '0']) await modal.getByRole('button', { name: t, exact: true }).click();
  await modal.getByRole('button', { name: 'Isi Dibayar' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Simpan Struk', exact: true }).click();
  await page.waitForURL('**/kasir/struk/**', { timeout: 20000 });
  await page.waitForTimeout(1500);
  const uuidOffline = page.url().split('/kasir/struk/')[1].split('?')[0];
  const strukOffline = await page.locator('.struk').innerText();
  const offline = {
    uuid: uuidOffline,
    nomorSementara: /OFF-\d{14}/.test(strukOffline),
    pelangganTersimpan: /Pelanggan Uji Offline/.test(strukOffline),
  };

  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  let sesudahSinkron = null;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);
    sesudahSinkron = await snapshot(tok);
    if (sesudahSinkron.penjualan > sebelumOffline.penjualan) break;
  }
  await page.waitForTimeout(8000);
  const tenang = await snapshot(tok);
  const uuidTerdaftar = daftar((await api(tok, '/sales?limit=500')).body).filter((s) => s.uuid === uuidOffline);

  // Bersihkan transaksi uji (stok dikembalikan server).
  const hapus = [];
  for (const s of daftar((await api(tok, '/sales?limit=500')).body)) {
    if (uuidAwal.has(s.uuid)) continue;
    hapus.push({ uuid: s.uuid, id: s.id, status: (await api(tok, `/sales/${s.id}`, { method: 'DELETE' })).status });
  }
  const setelahBersih = await snapshot(tok);
  await ctx.close();
  return {
    offline,
    sebelumOffline: { penjualan: sebelumOffline.penjualan, sedaap: sebelumOffline.sedaap },
    sesudahSinkron: { penjualan: sesudahSinkron?.penjualan, sedaap: sesudahSinkron?.sedaap },
    tenang: { penjualan: tenang.penjualan, sedaap: tenang.sedaap },
    duplikatDenganUuidSama: uuidTerdaftar.length,
    hapus,
    setelahBersih: { penjualan: setelahBersih.penjualan, sedaap: setelahBersih.sedaap },
  };
});

// =====================================================================================
// 5. Data pemilik utuh
// =====================================================================================
await bagian('data', async () => {
  const sesudah = await snapshot(tok);
  return {
    sebelum: { produk: sebelum.produk, sedaap: sebelum.sedaap, penjualan: sebelum.penjualan, pembelian: sebelum.pembelian },
    sesudah: { produk: sesudah.produk, sedaap: sesudah.sedaap, penjualan: sesudah.penjualan, pembelian: sesudah.pembelian },
  };
});

simpanBukti();
console.log(JSON.stringify(bukti, null, 2));
await browser.close();
