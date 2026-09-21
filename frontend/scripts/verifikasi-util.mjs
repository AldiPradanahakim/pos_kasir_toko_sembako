/**
 * Utilitas bersama untuk skrip verifikasi UI.
 *
 * Berkas bisa sedang tertulis saat pembangunan berjalan, sehingga sesaat aplikasi bisa gagal
 * dirender (modul setengah jadi). Semua penantian di sini mengulang sampai aplikasi
 * BENAR-BENAR merender, bukan sekadar "selesai memuat", supaya hasil verifikasi
 * tidak pernah hijau palsu.
 */

/** true kalau stylesheet terpasang dan React sudah menanamkan isi ke #root. */
export const sudahDirender = (page) =>
  page.evaluate(
    () => document.styleSheets.length > 0 && (document.getElementById('root')?.childElementCount ?? 0) > 0,
  );

/** Buka rute dan tunggu sampai benar-benar dirender (ulangi bila modul masih setengah jadi). */
export async function bukaDanTunggu(page, url, { percobaan = 12, jedaMs = 2000 } = {}) {
  for (let i = 0; i < percobaan; i++) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    if (await sudahDirender(page)) {
      await page.waitForTimeout(700);
      return true;
    }
    await page.waitForTimeout(jedaMs);
  }
  return false;
}

/** Masuk lewat form login (token tersimpan seperti pemakaian nyata). */
export async function masuk(page, base, username, password) {
  if (!(await bukaDanTunggu(page, `${base}/login`))) {
    throw new Error(`Aplikasi tidak merender di /login (user ${username})`);
  }
  await page.fill('input[autocomplete="username"]', username);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/kasir', { timeout: 25000 });
  await page.waitForTimeout(2000);
}

/** Buang overlay galat Vite supaya tidak menghalangi klik saat sibling menulis berkas. */
export async function pasangPenjagaOverlay(page) {
  await page.addLocatorHandler(page.locator('vite-error-overlay'), async (ov) => {
    await ov.evaluate((el) => el.remove());
  });
}

/**
 * Tambah barang ke keranjang lewat kotak cari — sejak daftar produk dihapus, ini
 * SATU-SATUNYA jalan menambah barang di /kasir. `satuan` memilih tombol satuan ke-berapa
 * (0 = satuan terkecil, mis. pcs).
 */
export async function tambahProduk(page, kataCari, { nama, satuan = 0, jeda = 700 } = {}) {
  await page.fill('main input[type="search"]', kataCari);
  await page.waitForTimeout(jeda);
  const hasil = page.locator(
    nama ? `main button[aria-label^="Tambah ${nama} "]` : 'main button[aria-label^="Tambah "]',
  );
  const jumlahHasil = await hasil.count();
  const tombol = hasil.nth(satuan);
  const label = await tombol.getAttribute('aria-label');
  await tombol.click();
  await page.waitForTimeout(300);
  return { jumlahHasil, label };
}

/** Tabel keranjang (baris, kolom, total) — elemen utama halaman kasir sekarang. */
export async function bacaTabelKeranjang(page) {
  return page.evaluate(() => {
    const h2 = [...document.querySelectorAll('section > header > h2')].find((h) =>
      h.textContent.trim().startsWith('Keranjang'),
    );
    const tabel = h2?.closest('section')?.querySelector('table');
    if (!tabel) return null;
    const baris = [...tabel.querySelectorAll('tbody tr')];
    return {
      judul: h2.textContent.trim(),
      kolom: [...tabel.querySelectorAll('thead th')].map((th) => ({
        teks: th.textContent.trim(),
        terlihat: th.getBoundingClientRect().width > 0,
      })),
      jumlahBaris: baris.length,
      baris: baris.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim().replace(/\n/g, ' / '))),
      total: tabel.querySelector('tfoot')?.innerText.replace(/\n/g, ' | ') ?? '',
    };
  });
}
