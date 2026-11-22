/**
 * Verifikasi halaman Kasir di browser sungguhan (kontrak setelah perubahan permintaan pemilik):
 *  1. Daftar produk DIHAPUS: kotak cari adalah satu-satunya jalan menambah barang, hasilnya
 *     muncul sebagai daftar di bawah kotak cari; Enter menambah hasil paling atas.
 *  2. Keranjang = elemen utama (tabel besar), kolom Barang/Qty/Harga/Subtotal/Hapus.
 *     Kolom Subtotal/Harga disembunyikan di layar sempit supaya nama barang tetap terbaca.
 *  3. Tidak ada pilihan metode bayar di layar kasir (toko hanya menerima tunai), dan
 *     transaksi yang tersimpan tetap punya `metode_bayar: 'tunai'`.
 *  4. Qty diubah LANGSUNG dari barisnya lewat tombol − dan + (tanpa membuka apa pun, tanpa
 *     keyboard), dan berhenti di 1. Kotak − dan + kecil (28px) di dalam tombol 44×44px.
 *     Ketuk nama barang atau angka qty membuka POP UP berisi qty, harga, dan hapus —
 *     bukan baris tambahan di dalam tabel. Tiap baris bernomor di samping nama barangnya.
 *  5. Kolom Dibayar selalu kolom angka yang bisa diketik (laptop: klik lalu ketik). Menyentuhnya
 *     dengan JARI membuka kalkulator besar tanpa memunculkan keyboard lembut, dibedakan per
 *     kejadian lewat `pointerType` — bukan media query `pointer: fine`.
 *  6. "Simpan Struk" menyimpan TANPA memanggil window.print; "Cetak Struk" menyimpan DAN mencetak.
 *  7. Nama tuan/nyonya ada di baris yang sama dengan kotak cari, hanya menerima huruf, dan ikut
 *     tersimpan + tampil di struk.
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
const kolomDibayar = page.locator('main input[aria-label="Jumlah dibayar"]');

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
    /^Nama tuan\/nyonya/.test(i.getAttribute('aria-label') ?? ''),
  );
  const kotak = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { atas: Math.round(r.top), kiri: Math.round(r.left), lebar: Math.round(r.width) };
  };
  const kartuKeranjang = main.querySelector('table')?.closest('section') ?? null;
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
    // Urutan kolom kiri: cari + pelanggan, lalu tabel keranjang di bawahnya.
    // (Di HP kotak cari memang mengambil satu baris penuh; kesebarisan diukur verify-layout.mjs.)
    kotakNamaPelanggan: kotak(namaPelanggan),
    kotakCari: kotak(cari),
    kotakKeranjang: kotak(kartuKeranjang),
    kolomKeranjang: kotak(kartuKeranjang?.parentElement),
    kolomPembayaran: kotak(kartuPembayaran),
    urutanBenar:
      (cari?.getBoundingClientRect().bottom ?? 1e9) <=
      (kartuKeranjang?.getBoundingClientRect().top ?? -1e9) + 2,
    keranjangDiAtasPembayaran:
      (kartuKeranjang?.getBoundingClientRect().top ?? 1e9) <
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
// Nomor baris ikut tampil di samping nama barang.
bukti.nomorBaris = bukti.setelahTambah.baris.map((b) => b[0].split('/')[0].trim());

// Nama tuan/nyonya hanya menerima huruf: angka dan lambang dibuang saat diketik.
{
  const kolomPelanggan = page.locator('main input[aria-label^="Nama tuan/nyonya"]');
  await kolomPelanggan.fill('Bu Siti 88 !!');
  await page.waitForTimeout(400);
  bukti.namaPelangganHuruf = { diketik: 'Bu Siti 88 !!', tersimpan: await kolomPelanggan.inputValue() };
  await kolomPelanggan.fill('');
  await page.waitForTimeout(200);
}

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

// ---------- 4b. Qty langsung dari baris + pop up (permintaan pemilik) ----------
{
  const baris0 = page.locator('main tbody tr').first();
  const qty = () => baris0.locator('button[aria-label^="Ubah qty"]').innerText();
  const sebelum = (await qty()).trim();
  await baris0.locator('button[aria-label^="Tambah qty"]').click();
  await page.waitForTimeout(400);
  const setelahPlus = (await qty()).trim();
  await baris0.locator('button[aria-label^="Kurangi qty"]').click();
  await page.waitForTimeout(400);
  const setelahMinus = (await qty()).trim();
  bukti.qtyLangsung = {
    sebelum,
    setelahPlus,
    setelahMinus,
    // Tanpa pop up: tidak boleh ada dialog yang terbuka dari tombol + / −.
    dialogTerbuka: await page.evaluate(() => !!document.querySelector('[role="dialog"]')),
  };

  // − berhenti di 1 (qty 0 tidak masuk akal untuk penjualan).
  await baris0.locator('button[aria-label^="Tambah qty"]').click();
  await baris0.locator('button[aria-label^="Tambah qty"]').click();
  await page.waitForTimeout(400);
  const sebelumDikurangi = (await qty()).trim();
  for (let i = 0; i < 5; i++) {
    if (await baris0.locator('button[aria-label^="Kurangi qty"]').isDisabled()) break;
    await baris0.locator('button[aria-label^="Kurangi qty"]').click();
    await page.waitForTimeout(250);
  }
  bukti.qtyMinimum = {
    sebelumDikurangi,
    qty: (await qty()).trim(),
    tombolMinusNonaktif: await baris0.locator('button[aria-label^="Kurangi qty"]').isDisabled(),
  };

  // Ketuk nama barang -> pop up, dan pop up TIDAK dirender di dalam tabel.
  await baris0.locator('td button').first().click();
  await page.waitForTimeout(500);
  bukti.popUp = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const barisTabel = document.querySelectorAll('main tbody tr').length;
    return {
      terbuka: !!dlg,
      judul: dlg?.querySelector('h3')?.textContent?.trim() ?? '',
      diDalamTabel: !!dlg?.closest('table'),
      barisTabelSaatPopUp: barisTabel,
      adaTombolQty: !!dlg?.querySelector('button[aria-label="Tambah qty"]'),
      adaHapus: /Hapus barang/.test(dlg?.innerText ?? ''),
      // Kolom alasan hanya muncul kalau harga diubah.
      adaAlasanAwal: !!dlg?.querySelector('input[placeholder^="mis."]'),
    };
  });
  // Ubah harga -> kolom alasan muncul dan Simpan terkunci sampai alasannya diisi.
  await page.locator('[role="dialog"] input[inputmode="numeric"]').first().fill('9999');
  await page.waitForTimeout(400);
  bukti.popUp.alasanSetelahHargaDiubah = await page.evaluate(
    () => !!document.querySelector('[role="dialog"] input[placeholder^="mis."]'),
  );
  bukti.popUp.simpanTerkunciTanpaAlasan = await page
    .locator('[role="dialog"] button', { hasText: 'Simpan' })
    .isDisabled();
  await page.locator('[role="dialog"] input[placeholder^="mis."]').fill('uji verifikasi');
  await page.waitForTimeout(300);
  await page.locator('[role="dialog"] button', { hasText: 'Simpan' }).click();
  await page.waitForTimeout(600);
  bukti.popUp.setelahSimpan = await page.evaluate(() => {
    const tr = document.querySelector('main tbody tr');
    return {
      dialogTertutup: !document.querySelector('[role="dialog"]'),
      baris: tr?.innerText.replace(/\s+/g, ' ').trim() ?? '',
      adaPenandaHargaDiubah: /harga diubah/.test(tr?.innerText ?? ''),
      judulAlasan: tr?.querySelector('button')?.getAttribute('title') ?? '',
    };
  });
  await page.screenshot({ path: path.join(KELUARAN, 'kasir-popup-390.png') });
}

// ---------- 5. Kolom Dibayar: diketik, dan sentuhan jari membuka kalkulator ----------
// Kolomnya harus SELALU ada dan bisa diketik — di laptop layar sentuh, deteksi media query
// pernah salah dan kolomnya hilang sama sekali, sehingga pemilik tidak bisa mengetik.
bukti.kolomDibayar = await page.evaluate(() => {
  const el = document.querySelector('input[aria-label="Jumlah dibayar"]');
  return {
    ada: !!el,
    terlihat: !!el && el.getBoundingClientRect().width > 0,
    type: el?.getAttribute('type') ?? null,
    inputmode: el?.getAttribute('inputmode') ?? null,
  };
});
// Jari (sentuh) membuka kalkulator dan TIDAK memfokuskan kolomnya (keyboard lembut tidak muncul).
await kolomDibayar.tap();
await page.waitForTimeout(600);
bukti.saatKalkulatorTerbuka = await page.evaluate(() => {
  const m = document.querySelector('.fixed.inset-0');
  const aktif = document.activeElement;
  return {
    adaModal: !!m,
    judulModal: m?.querySelector('h3')?.textContent?.trim() ?? '',
    kolomEditableDiModal: m?.querySelectorAll('input, textarea, [contenteditable="true"]').length ?? -1,
    elemenAktif: aktif?.tagName,
    kolomDibayarTerfokus: aktif?.getAttribute?.('aria-label') === 'Jumlah dibayar',
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
  const kolomDibayar = main.querySelector('input[aria-label="Jumlah dibayar"]');
  // Baris TOTAL di dalam tabel keranjang sudah dihapus; totalnya dibaca dari kartu Pembayaran.
  const angkaTotal = [...main.querySelectorAll('p')].find(
    (p) => p.className.includes('text-3xl') && /Rp/.test(p.textContent),
  );
  return {
    modalMasihTerbuka: !!document.querySelector('.fixed.inset-0'),
    nilaiDibayar: kolomDibayar?.value ?? null,
    kembalian: baris[baris.findIndex((t) => t === 'Kembalian') + 1] ?? null,
    totalTabel: angkaTotal?.textContent.trim() ?? '',
  };
});
await page.screenshot({ path: path.join(KELUARAN, 'kasir-dibayar-390.png') });

// Escape menutup modal.
await kolomDibayar.tap();
await page.waitForTimeout(500);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
bukti.escape = { modalMasihTerbuka: await page.evaluate(() => !!document.querySelector('.fixed.inset-0')) };

// ---------- 6. Simpan Struk (tanpa cetak) ----------
await page.locator('main input[aria-label^="Nama tuan/nyonya"]').fill('Pelanggan Uji Simpan');
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
await page.locator('main input[aria-label^="Nama tuan/nyonya"]').fill('Pelanggan Uji Cetak');
// Dibayar lewat kalkulator; kali ini memakai keypad sentuh + tombol "Uang Pas".
await kolomDibayar.tap();
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

// ---------- 9. Laptop: kolom Dibayar diketik, jari tetap membuka kalkulator ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });
  const laptop = await ctx.newPage();
  await pasangPenjagaOverlay(laptop);
  await masuk(laptop, BASE, 'aldipradana', 'Aldi1234');
  await laptop.waitForTimeout(2000);
  await tambahProduk(laptop, 'Sedaap Soto');
  const kolom = laptop.locator('main input[aria-label="Jumlah dibayar"]');
  bukti.laptop = await laptop.evaluate(() => {
    const el = document.querySelector('input[aria-label="Jumlah dibayar"]');
    const terlihat = (e) => !!e && e.getBoundingClientRect().width > 0;
    return {
      pointerFine: matchMedia('(pointer: fine)').matches,
      inputTampil: terlihat(el),
      // Tidak ada lagi tombol terpisah: satu kolom untuk semua perangkat.
      tombolKalkulatorTerpisah: terlihat(document.querySelector('main button[aria-haspopup="dialog"]')),
    };
  });
  // Klik dengan mouse lalu ketik dengan papan ketik laptop — inilah yang dulu tidak bisa.
  await kolom.click();
  await laptop.waitForTimeout(200);
  bukti.laptop.terfokusSetelahKlik = await laptop.evaluate(
    () => document.activeElement?.getAttribute('aria-label') === 'Jumlah dibayar',
  );
  bukti.laptop.kalkulatorTerbukaSetelahKlik = await laptop.evaluate(() => !!document.querySelector('.fixed.inset-0'));
  for (const t of ['5', '0', '0', '0', '0']) await laptop.keyboard.press(t);
  await laptop.waitForTimeout(400);
  bukti.laptop.nilaiDiketik = await kolom.inputValue();
  bukti.laptop.kembalian = await laptop.evaluate(() => {
    const baris = document.querySelector('main').innerText.split('\n').map((t) => t.trim());
    return baris[baris.findIndex((t) => t === 'Kembalian') + 1] ?? null;
  });
  bukti.laptop.kalkulatorTerbuka = await laptop.evaluate(() => !!document.querySelector('.fixed.inset-0'));
  // Nomor baris juga harus ada di laptop.
  bukti.laptop.nomorBarisPertama = await laptop.evaluate(
    () => document.querySelector('main tbody tr td')?.innerText.replace(/\s+/g, ' ').trim().slice(0, 30) ?? null,
  );
  await laptop.screenshot({ path: path.join(KELUARAN, 'kasir-laptop-1280.png') });
  await ctx.close();
}

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
