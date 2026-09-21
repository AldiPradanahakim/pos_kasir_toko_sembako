/**
 * Verifikasi halaman Kasir di browser sungguhan (kontrak setelah perubahan permintaan pemilik):
 *  1. Daftar produk DIHAPUS: kotak cari adalah satu-satunya jalan menambah barang, hasilnya
 *     muncul sebagai daftar di bawah kotak cari; Enter menambah hasil paling atas.
 *  2. Keranjang = elemen utama (tabel besar di bawah kotak cari), kolom
 *     Barang/Qty/Harga/Subtotal/Hapus tetap ada.
 *  3. Tidak ada pilihan metode bayar di layar kasir (toko hanya menerima tunai), dan
 *     transaksi yang tersimpan tetap punya `metode_bayar: 'tunai'`.
 *  4. Kolom Dibayar adalah TOMBOL (bukan input), jadi menyentuhnya TIDAK memunculkan
 *     keyboard HP/tablet; kalkulatornya menerima keypad sentuh DAN papan ketik fisik
 *     (angka 0-9, Backspace, Escape, Enter).
 *  5. "Simpan Struk" menyimpan TANPA memanggil window.print; "Cetak Struk" menyimpan DAN mencetak.
 *  6. Nama pelanggan ada di paling atas kolom kiri, dan ikut tersimpan + tampil di struk.
 *
 * Transaksi uji dihapus lagi di akhir (stok dikembalikan server) supaya data pemilik utuh.
 *
 * Jalankan: node scripts/verify-kasir.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { bacaTabelKeranjang, bukaDanTunggu, masuk, pasangPenjagaOverlay, tambahProduk } from './verifikasi-util.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const KELUARAN = path.resolve('verifikasi');
fs.mkdirSync(KELUARAN, { recursive: true });

const bukti = { catatan: [] };
const browser = await chromium.launch();
// HP + layar sentuh: justru di perangkat inilah keyboard lembut muncul kalau kolomnya input.
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

// Instrumentasi window.print: di headless dialog cetak tidak bisa diamati, jadi kita catat
// pemanggilannya. Ini membuktikan HANYA tombol cetak yang memanggil print.
await context.addInitScript(() => {
  window.__printDipanggil = 0;
  window.print = () => {
    window.__printDipanggil += 1;
  };
});

const page = await context.newPage();
page.on('pageerror', (e) => bukti.catatan.push(`pageerror: ${e.message}`));
const permintaanOmzet = [];
const respons403 = [];
page.on('request', (r) => {
  if (r.url().includes('/reports/omzet')) permintaanOmzet.push(r.url());
});
page.on('response', (r) => {
  if (r.status() === 403) respons403.push(`${r.status()} ${r.url()}`);
});
await pasangPenjagaOverlay(page);

const kotakCari = page.locator('main input[type="search"]');
const modal = page.locator('.fixed.inset-0');
const tombolDibayar = page.locator('main button[aria-haspopup="dialog"]');

/** Klik tombol simpan lalu tunggu navigasi ke struk dan ambil uuid-nya. */
async function simpanDanAmbilUuid(namaTombol) {
  await page.getByRole('button', { name: namaTombol, exact: true }).click();
  try {
    await page.waitForURL('**/kasir/struk/**', { timeout: 20000 });
  } catch {
    const pesanGalat = await page.evaluate(() =>
      [...document.querySelectorAll('div')]
        .map((d) => d.textContent?.trim() ?? '')
        .filter((t) => /kurang|wajib|harus|kosong|Gagal/i.test(t))
        .slice(-3),
    );
    throw new Error(`Tidak pindah ke struk setelah "${namaTombol}". Pesan di layar: ${JSON.stringify(pesanGalat)}`);
  }
  await page.waitForTimeout(1500);
  return { uuid: page.url().split('/kasir/struk/')[1].split('?')[0], url: page.url() };
}

await masuk(page, BASE, 'aldipradana', 'Aldi1234');
await page.waitForTimeout(2500);

// ---------- 1. Susunan halaman: tanpa daftar produk, tanpa metode bayar ----------
bukti.susunan = await page.evaluate(() => {
  const main = document.querySelector('main');
  const cari = main.querySelector('input[type="search"]');
  const h2 = [...main.querySelectorAll('section > header > h2')].map((h) => h.textContent.trim());
  const namaPelanggan = [...main.querySelectorAll('input')].find((i) =>
    /Bu Siti/.test(i.getAttribute('placeholder') ?? ''),
  );
  const kotak = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { atas: Math.round(r.top), kiri: Math.round(r.left), lebar: Math.round(r.width) };
  };
  const judulKeranjang = [...main.querySelectorAll('section > header > h2')].find((h) =>
    h.textContent.trim().startsWith('Keranjang'),
  );
  const kartuPembayaran = [...main.querySelectorAll('section')].find((s) =>
    /Total Pembayaran/.test(s.innerText),
  );
  return {
    judulKartu: h2,
    // Kartu hasil produk lama harus hilang: tidak ada judul "Daftar produk" lagi.
    adaJudulDaftarProduk: h2.some((t) => /Daftar produk/i.test(t)),
    kartuProduk: main.querySelectorAll('button[aria-label^="Tambah "]').length,
    tombolMetodeBayar: [...main.querySelectorAll('button')]
      .map((b) => b.textContent.trim().toLowerCase())
      .filter((t) => ['tunai', 'transfer', 'qris'].includes(t)),
    teksMetodeBayar: /\b(tunai|transfer|qris)\b/i.test(main.innerText),
    // Urutan kolom kiri: nama pelanggan di atas, lalu kotak cari, lalu tabel keranjang.
    kotakNamaPelanggan: kotak(namaPelanggan),
    kotakCari: kotak(cari),
    kotakKeranjang: kotak(judulKeranjang?.closest('section')),
    kolomKeranjang: kotak(judulKeranjang?.closest('section')?.parentElement),
    kolomPembayaran: kotak(kartuPembayaran),
    urutanBenar:
      (namaPelanggan?.getBoundingClientRect().top ?? 1e9) < (cari?.getBoundingClientRect().top ?? -1e9) &&
      (cari?.getBoundingClientRect().top ?? 1e9) <
        (judulKeranjang?.closest('section')?.getBoundingClientRect().top ?? -1e9),
    keranjangDiAtasPembayaran:
      (judulKeranjang?.closest('section')?.getBoundingClientRect().top ?? 1e9) <
      (kartuPembayaran?.getBoundingClientRect().top ?? -1e9),
    placeholderCari: cari?.getAttribute('placeholder') ?? '',
    judulTotal: kartuPembayaran?.querySelector('p')?.textContent?.trim() ?? '',
  };
});

// ---------- 2. Pencarian: hasil muncul di bawah kotak cari ----------
await kotakCari.fill('sedaap');
await page.waitForTimeout(700);
bukti.hasilCari = await page.evaluate(() => {
  const main = document.querySelector('main');
  const tombol = [...main.querySelectorAll('button[aria-label^="Tambah "]')];
  const cari = main.querySelector('input[type="search"]');
  const bawahKotakCari = tombol.map((b) => {
    const r = b.getBoundingClientRect();
    return {
      label: b.getAttribute('aria-label'),
      teks: b.textContent.trim(),
      diBawahKotakCari: r.top >= (cari?.getBoundingClientRect().bottom ?? 0) - 2,
    };
  });
  return {
    jumlah: tombol.length,
    tombol: bawahKotakCari,
    namaTampil: [...main.querySelectorAll('p')].map((p) => p.textContent.trim()).filter(Boolean).slice(0, 8),
  };
});
await page.screenshot({ path: path.join(KELUARAN, 'kasir-cari-390.png') });

// Kategori juga harus menemukan barang (perilaku lama dipertahankan).
await kotakCari.fill('mie');
await page.waitForTimeout(700);
bukti.hasilCariKategori = {
  jumlah: await page.locator('main button[aria-label^="Tambah "]').count(),
  contoh: (await page.locator('main button[aria-label^="Tambah "]').all()).length
    ? await page.locator('main button[aria-label^="Tambah "]').first().getAttribute('aria-label')
    : null,
};

// ---------- 3. Ketuk hasil -> masuk keranjang dengan harga yang benar ----------
await kotakCari.fill('');
await page.waitForTimeout(300);
const tambah = await tambahProduk(page, 'Sedaap Soto');
bukti.tambahLewatKetuk = tambah;
bukti.setelahTambah = await bacaTabelKeranjang(page);

// ---------- 4. Enter menambah hasil paling atas ----------
await kotakCari.fill('Indomie Goreng');
await page.waitForTimeout(700);
const sebelumEnter = (await bacaTabelKeranjang(page)).jumlahBaris;
await kotakCari.press('Enter');
await page.waitForTimeout(600);
const setelahEnter = await bacaTabelKeranjang(page);
bukti.tambahLewatEnter = {
  barisSebelum: sebelumEnter,
  barisSesudah: setelahEnter.jumlahBaris,
  barisTerakhir: setelahEnter.baris.at(-1),
  pesan: await page.locator('main p.text-teal-700').first().innerText().catch(() => null),
};

// ---------- 5. Kolom Dibayar = tombol, kalkulator menerima papan ketik fisik ----------
bukti.kolomDibayar = await tombolDibayar.evaluate((el) => ({
  tag: el.tagName,
  type: el.getAttribute('type'),
  contenteditable: el.getAttribute('contenteditable'),
  inputDiDalamnya: el.querySelectorAll('input, textarea').length,
}));
await tombolDibayar.click();
await page.waitForTimeout(600);
bukti.saatKalkulatorTerbuka = await page.evaluate(() => {
  const m = document.querySelector('.fixed.inset-0');
  const aktif = document.activeElement;
  return {
    adaModal: !!m,
    judulModal: m?.querySelector('h3')?.textContent?.trim() ?? '',
    kolomEditableDiModal: m?.querySelectorAll('input, textarea, [contenteditable="true"]').length ?? -1,
    elemenAktif: aktif?.tagName,
    // Satu kalkulator saja: tidak boleh ada tab/pilihan mode.
    jumlahTab: document.querySelectorAll('[role="tablist"]').length,
    teksModeKembalian: /Hitung Kembalian/i.test(m?.innerText ?? ''),
  };
});

// Ketik di papan ketik fisik TANPA mengklik apa pun di dalam modal.
for (const t of ['5', '0', '0', '0', '0']) await page.keyboard.press(t);
await page.waitForTimeout(300);
bukti.papanKetikFisik = { tampilanAngka: (await modal.locator('p.text-3xl').innerText()).trim() };
// Backspace harus menghapus satu digit.
await page.keyboard.press('Backspace');
await page.waitForTimeout(300);
bukti.papanKetikFisik.setelahBackspace = (await modal.locator('p.text-3xl').innerText()).trim();
// Kembalikan ke 50.000 lewat keypad sentuh supaya jalur sentuh juga terbukti.
await modal.getByRole('button', { name: '0', exact: true }).click();
await page.waitForTimeout(200);
bukti.papanKetikFisik.setelahKeypadSentuh = (await modal.locator('p.text-3xl').innerText()).trim();
// Enter mengisi kolom Dibayar dan menutup modal.
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
bukti.setelahEnter = await page.evaluate(() => {
  const main = document.querySelector('main');
  const teks = main.innerText;
  const baris = teks.split('\n').map((t) => t.trim());
  const tombolDibayar = main.querySelector('button[aria-haspopup="dialog"]');
  const keranjang = [...main.querySelectorAll('section > header > h2')].find((h) =>
    h.textContent.trim().startsWith('Keranjang'),
  );
  return {
    modalMasihTerbuka: !!document.querySelector('.fixed.inset-0'),
    nilaiDibayar: tombolDibayar?.textContent.trim() ?? null,
    kembalian: baris[baris.findIndex((t) => t === 'Kembalian') + 1] ?? null,
    totalTabel: keranjang?.closest('section')?.querySelector('tfoot')?.innerText.replace(/\n/g, ' | ') ?? '',
  };
});
await page.screenshot({ path: path.join(KELUARAN, 'kasir-dibayar-390.png') });

// Escape menutup modal.
await tombolDibayar.click();
await page.waitForTimeout(500);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
bukti.escape = { modalMasihTerbuka: await page.evaluate(() => !!document.querySelector('.fixed.inset-0')) };

// ---------- 6. Simpan Struk (tanpa cetak) ----------
await page.locator('main input[placeholder*="Bu Siti"]').fill('Pelanggan Uji Simpan');
await page.waitForTimeout(300);
const printSebelumSimpan = await page.evaluate(() => window.__printDipanggil);
const { uuid: uuidSimpan } = await simpanDanAmbilUuid('Simpan Struk');
const printSetelahSimpan = await page.evaluate(() => window.__printDipanggil);
const strukSimpan = await page.locator('.struk').innerText();
bukti.simpanStruk = {
  uuid: uuidSimpan,
  printSebelum: printSebelumSimpan,
  printSesudah: printSetelahSimpan,
  adaNamaPelanggan: /Pelanggan Uji Simpan/.test(strukSimpan),
  struk: strukSimpan,
};
await page.screenshot({ path: path.join(KELUARAN, 'struk-simpan-390.png') });

// Transaksi tersimpan harus punya metode_bayar yang sah (server mewajibkannya).
{
  const tok = await page.evaluate(() => localStorage.getItem('th_token'));
  const r = await fetch(`${API}/api/sales/by-uuid/${uuidSimpan}`, { headers: { Authorization: `Bearer ${tok}` } });
  const sale = await r.json();
  bukti.penjualanTersimpan = {
    status: r.status,
    id: sale.id,
    metode_bayar: sale.metode_bayar,
    dibayar: sale.dibayar,
    kembalian: sale.kembalian,
    total: sale.total,
    nama_pelanggan: sale.nama_pelanggan,
  };
}

// ---------- 7. Cetak Struk (simpan + cetak) ----------
await bukaDanTunggu(page, `${BASE}/kasir`);
await page.waitForTimeout(1200);
await tambahProduk(page, 'Sedaap Soto');
await page.locator('main input[placeholder*="Bu Siti"]').fill('Pelanggan Uji Cetak');
// Dibayar lewat kalkulator; kali ini memakai keypad sentuh + tombol "Uang Pas".
await tombolDibayar.click();
await page.waitForTimeout(500);
await modal.getByRole('button', { name: /Uang Pas/ }).click();
await page.waitForTimeout(300);
await modal.getByRole('button', { name: 'Isi Dibayar' }).click();
await page.waitForTimeout(400);
const { uuid: uuidCetak } = await simpanDanAmbilUuid('Cetak Struk');
await page.waitForTimeout(1200);
const printSetelahCetak = await page.evaluate(() => window.__printDipanggil);
bukti.cetakStruk = {
  uuid: uuidCetak,
  printSesudah: printSetelahCetak,
  struk: await page.locator('.struk').innerText(),
};

// ---------- 8. Tidak ada permintaan omset sama sekali ----------
bukti.omzet = { permintaanOmzet, respons403 };

// ---------- Bersihkan transaksi uji (stok dikembalikan server) ----------
// Hapus transaksi hanya boleh superadmin, jadi pembersihan memakai token superadmin.
const masukSuper = await fetch(`${API}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'superadmin', password: 'password' }),
});
const tokSuper = (await masukSuper.json()).token;
const bersih = [];
for (const uuid of [uuidSimpan, uuidCetak]) {
  const cari = await fetch(`${API}/api/sales/by-uuid/${uuid}`, { headers: { Authorization: `Bearer ${tokSuper}` } });
  if (!cari.ok) {
    bersih.push({ uuid, catatan: `tidak ditemukan (${cari.status})` });
    continue;
  }
  const sale = await cari.json();
  const hapus = await fetch(`${API}/api/sales/${sale.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokSuper}` },
  });
  bersih.push({ uuid, id: sale.id, statusHapus: hapus.status, hasil: await hapus.json().catch(() => null) });
}
bukti.pembersihan = bersih;

await browser.close();
fs.writeFileSync(path.join(KELUARAN, 'bukti-kasir.json'), JSON.stringify(bukti, null, 2));
console.log(JSON.stringify(bukti, null, 2));
