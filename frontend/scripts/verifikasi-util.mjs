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

/**
 * Buat satu transaksi uji lewat API. Dipakai skrip yang memeriksa tombol per baris di
 * halaman riwayat: tombol itu hanya ada di DOM kalau ada barisnya, dan database pemilik
 * belum tentu punya transaksi hari ini. Kembalikan transaksinya supaya bisa dihapus lagi.
 */
export async function buatPenjualanUji(api, token, namaPelanggan = 'Uji Verifikasi') {
  const ambil = (p) => fetch(`${api}${p}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const [produk, stok] = await Promise.all([ambil('/api/products'), ambil('/api/stock')]);
  // Produk harus punya stok: server menolak penjualan barang yang stoknya kosong, dan
  // mengambil produk aktif pertama saja dulu membuat skrip ini gagal 422 tanpa sebab.
  const adaStok = new Map(stok.map((s) => [s.product_id, Number(s.stok_base) || 0]));
  const pilihan = produk.find(
    (p) => p.is_active !== false && p.units?.length && (adaStok.get(p.id) ?? 0) >= (Number(p.units[0].isi) || 1),
  );
  if (!pilihan) throw new Error('tidak ada produk aktif yang stoknya cukup untuk transaksi uji');
  const res = await fetch(`${api}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      uuid: crypto.randomUUID(),
      items: [{ product_id: pilihan.id, unit_id: pilihan.units[0].unit_id, qty: 1 }],
      metode_bayar: 'tunai',
      dibayar: 1_000_000,
      nama_pelanggan: namaPelanggan,
    }),
  });
  if (!res.ok) throw new Error(`buat transaksi uji gagal: ${res.status} ${await res.text()}`);
  return (await res.json()).sale;
}

/** Hapus transaksi uji (stok dikembalikan server) supaya data pemilik utuh. */
export async function hapusPenjualanUji(api, token, id) {
  const res = await fetch(`${api}/api/sales/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  return { id, status: res.status, hasil: await res.json().catch(() => null) };
}

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
  await pastikanKasTerbuka(page);
}

/**
 * Kasir tidak bisa berjualan sebelum kas dibuka (modal awal). Semua skrip verifikasi
 * yang menguji layar kasir harus melewati gerbang ini dulu, kalau tidak keranjang dan
 * tombol simpan tidak pernah muncul.
 */
export async function pastikanKasTerbuka(page, modalAwal = '0') {
  const tombol = page.getByRole('button', { name: 'Buka Kas' });
  if (!(await tombol.count())) return;
  const kolom = page.locator('main input[inputmode="numeric"]').first();
  if (await kolom.count()) await kolom.fill(modalAwal);
  await tombol.first().click();
  await page.waitForTimeout(1200);
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

/**
 * Tabel keranjang (baris, kolom, total) — elemen utama halaman kasir.
 *
 * Sejak keranjang dipadatkan, judulnya bukan lagi header kartu melainkan penghitung
 * "Keranjang (n)" di baris alat, dan baris TOTAL di dalam tabel dihapus: totalnya dibaca
 * dari kartu Pembayaran (angka yang sama yang dilihat kasir).
 */
export async function bacaTabelKeranjang(page) {
  return page.evaluate(() => {
    const tabel = document.querySelector('main table');
    if (!tabel) return null;
    const hitung = [...document.querySelectorAll('main span')].find((s) =>
      /^Keranjang \(\d+\)$/.test(s.textContent.trim()),
    );
    const angkaTotal = [...document.querySelectorAll('main p')].find(
      (p) => p.className.includes('text-3xl') && /Rp/.test(p.textContent),
    );
    const baris = [...tabel.querySelectorAll('tbody tr')];
    return {
      judul: hitung?.textContent.trim() ?? '',
      kolom: [...tabel.querySelectorAll('thead th')].map((th) => ({
        teks: th.textContent.trim(),
        terlihat: th.getBoundingClientRect().width > 0,
      })),
      jumlahBaris: baris.length,
      baris: baris.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim().replace(/\n/g, ' / '))),
      total: angkaTotal?.textContent.trim() ?? '',
    };
  });
}
