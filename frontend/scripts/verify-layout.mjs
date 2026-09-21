/**
 * Bukti tata letak berbasis DOM (bukan mata): mengukur geometri nyata elemen kunci pada
 * tiap ukuran layar, supaya bentuk sidebar, susunan kasir, dan "kasir satu layar penuh"
 * bisa dibuktikan angka.
 *
 * Kontrak yang diuji (perubahan atas permintaan pemilik toko):
 *  - /kasir TIDAK boleh menggulir halaman sejak tablet (>=768px), untuk peran kasir MAUPUN
 *    superadmin. Satu-satunya area yang bergulir di dalamnya adalah tabel keranjang
 *    (daftar produk sudah dihapus, hasil pencarian muncul sebagai daftar melayang).
 *    Di HP (<768px) menggulir masih wajar, tetapi baris aksi harus tetap terjangkau.
 *  - Susunan kasir gaya minimarket: kolom KIRI = nama pelanggan, kotak cari, lalu tabel
 *    keranjang; kolom KANAN = total pembayaran. Di HP keduanya menumpuk (keranjang dulu).
 *  - Sidebar hanya tampil kalau lebar >=1280px DAN penunjuknya presisi (mouse/trackpad).
 *    iPad Pro melaporkan pointer kasar, jadi sidebar hilang di 1024 (potret) dan 1366 (landscape).
 *  - Kasir tidak pernah dapat sidebar di lebar mana pun.
 *  - Navigasi bawah sudah DIHAPUS: satu-satunya navigasi di layar kecil adalah drawer
 *    hamburger, dan isinya lengkap sesuai peran.
 *
 * Jalankan: node scripts/verify-layout.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { bacaTabelKeranjang, bukaDanTunggu, masuk, pasangPenjagaOverlay, tambahProduk } from './verifikasi-util.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const KELUARAN = path.resolve('verifikasi');
fs.mkdirSync(KELUARAN, { recursive: true });

const browser = await chromium.launch();
const BAGIAN = process.env.BAGIAN ?? 'all';
const jalankan = (nama) => BAGIAN === 'all' || BAGIAN === nama;

const AKUN = {
  kasir: { username: 'aldipradana', password: 'Aldi1234' },
  superadmin: { username: 'superadmin', password: 'password' },
};

/**
 * Nama produk asli dari server, dipakai untuk mengisi keranjang sampai banyak baris —
 * jumlah baris yang muat terlihat adalah inti keluhan pemilik, jadi harus diukur dengan
 * keranjang yang benar-benar penuh.
 */
const namaProduk = await (async () => {
  const masukApi = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(AKUN.superadmin),
  });
  const { token } = await masukApi.json();
  const pull = await (await fetch(`${BASE}/api/sync/pull`, { headers: { Authorization: `Bearer ${token}` } })).json();
  return pull.products.filter((p) => p.is_active !== false).slice(0, 14).map((p) => p.name);
})();

/** Konteks baru; `sentuh` true = penunjuk kasar (tablet), false = penunjuk presisi (laptop). */
async function konteks({ w, h, sentuh }, akun) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    hasTouch: sentuh,
    isMobile: sentuh,
    serviceWorkers: 'block',
  });
  const page = await ctx.newPage();
  await pasangPenjagaOverlay(page);
  await masuk(page, BASE, akun.username, akun.password);
  return { ctx, page };
}

/** Geometri kasir + area yang boleh bergulir. */
const petakanKasir = (page) =>
  page.evaluate(() => {
    const kotak = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) };
    };
    const isiKartu = (awal) => {
      const h2 = [...document.querySelectorAll('section > header > h2')].find((h) =>
        h.textContent.trim().startsWith(awal),
      );
      const div = h2?.closest('section')?.querySelector(':scope > div');
      if (!div) return null;
      const cs = getComputedStyle(div);
      return {
        overflowY: cs.overflowY,
        scrollHeight: div.scrollHeight,
        clientHeight: div.clientHeight,
        bisaScroll: div.scrollHeight > div.clientHeight,
      };
    };
    const main = document.querySelector('main');
    const bar = document.querySelector('.bar-aksi-lengket');
    const asides = [...document.querySelectorAll('aside')];
    const sidebar = asides.find((a) => getComputedStyle(a).display !== 'none' && a.getBoundingClientRect().width > 0);
    // Tombol simpan/cetak tidak boleh terpotong keluar layar (halaman ini memang tidak bisa digulir).
    const tombolAksi = [...document.querySelectorAll('button')]
      .filter((b) => /Simpan Struk|Cetak Struk/.test(b.textContent))
      .map((b) => {
        const r = b.getBoundingClientRect();
        return {
          teks: b.textContent.trim(),
          atas: Math.round(r.top),
          bawah: Math.round(r.bottom),
          terlihat: r.width > 0 && r.bottom <= window.innerHeight + 1 && r.top >= -1,
        };
      });
    // Navigasi bawah sudah dihapus: tidak boleh ada <nav> fixed yang menempel di dasar layar.
    const navBawah = [...document.querySelectorAll('nav')].find(
      (n) => getComputedStyle(n).position === 'fixed' && n.getBoundingClientRect().bottom >= window.innerHeight - 1,
    );
    const judulKeranjang = [...document.querySelectorAll('section > header > h2')].find((h) =>
      h.textContent.trim().startsWith('Keranjang'),
    );
    const kartuKeranjang = judulKeranjang?.closest('section') ?? null;
    const kolomKeranjang = kartuKeranjang?.parentElement ?? null;
    const kartuPembayaran = [...document.querySelectorAll('section')].find((s) =>
      /Total Pembayaran/.test(s.innerText),
    );
    const namaPelanggan = [...document.querySelectorAll('main input')].find((i) =>
      /Bu Siti/.test(i.getAttribute('placeholder') ?? ''),
    );
    const kotakCari = document.querySelector('main input[type="search"]');
    return {
      dokumenScrollHeight: document.documentElement.scrollHeight,
      bodyScrollHeight: document.body.scrollHeight,
      tinggiJendela: window.innerHeight,
      halamanMenggulir: document.documentElement.scrollHeight > window.innerHeight + 1,
      mainOverflowY: main ? getComputedStyle(main).overflowY : null,
      mainScrollHeight: main?.scrollHeight ?? null,
      mainClientHeight: main?.clientHeight ?? null,
      keranjang: isiKartu('Keranjang'),
      // Kartu daftar produk lama harus benar-benar hilang.
      produkLamaAda: [...document.querySelectorAll('section > header > h2')].some((h) =>
        /Daftar produk/i.test(h.textContent),
      ),
      tombolAksi,
      sidebarTampil: !!sidebar,
      sidebarKotak: kotak(sidebar),
      sidebarPosisi: sidebar ? getComputedStyle(sidebar).position : null,
      navBawahTampil: !!navBawah,
      barAksiKotak: kotak(bar),
      barAksiLengket: bar ? getComputedStyle(bar).position : null,
      barAksiTerjangkau: bar ? bar.getBoundingClientRect().bottom <= window.innerHeight + 1 : null,
      // Susunan kolom: kiri (pelanggan + cari + keranjang) vs kanan (pembayaran).
      susunan: {
        namaPelanggan: kotak(namaPelanggan),
        kotakCari: kotak(kotakCari),
        keranjang: kotak(kolomKeranjang),
        kartuKeranjang: kotak(kartuKeranjang),
        pembayaran: kotak(kartuPembayaran),
        namaDiAtasCari:
          (namaPelanggan?.getBoundingClientRect().top ?? 1e9) < (kotakCari?.getBoundingClientRect().top ?? -1e9),
        cariDiAtasKeranjang:
          (kotakCari?.getBoundingClientRect().bottom ?? 1e9) <=
          (kartuKeranjang?.getBoundingClientRect().top ?? -1e9) + 2,
        keranjangDiKiriPembayaran:
          (kolomKeranjang?.getBoundingClientRect().left ?? 1e9) <
          (kartuPembayaran?.getBoundingClientRect().left ?? -1e9) - 8,
      },
    };
  });

// =====================================================================================
// A. /kasir tanpa gulir halaman sejak tablet, untuk kedua peran
// =====================================================================================
const kasusKasir = [
  { peran: 'kasir', w: 768, h: 1024, sentuh: true },
  { peran: 'kasir', w: 1024, h: 768, sentuh: true },
  { peran: 'kasir', w: 1280, h: 800, sentuh: false },
  // Permintaan lanjutan pemilik: kasir juga TIDAK boleh menggulir halaman di laptop/desktop.
  { peran: 'kasir', w: 1440, h: 900, sentuh: false },
  { peran: 'kasir', w: 1920, h: 1080, sentuh: false },
  { peran: 'superadmin', w: 768, h: 1024, sentuh: true },
  { peran: 'superadmin', w: 1024, h: 768, sentuh: true },
  { peran: 'superadmin', w: 1280, h: 800, sentuh: false },
  { peran: 'superadmin', w: 1440, h: 900, sentuh: false },
  { peran: 'superadmin', w: 1920, h: 1080, sentuh: false },
  { peran: 'kasir', w: 360, h: 740, sentuh: true },
  { peran: 'kasir', w: 390, h: 844, sentuh: true },
];

const kasir = [];
for (const k of kasusKasir) {
  if (!jalankan('kasir')) break;
  const { ctx, page } = await konteks(k, AKUN[k.peran]);
  await bukaDanTunggu(page, `${BASE}/kasir`);
  // Isi keranjang sampai banyak baris: area gulir di dalamnya harus punya isi lebih dari
  // tingginya, dan jumlah baris yang muat terlihat harus bisa diukur.
  for (const nama of namaProduk) {
    await tambahProduk(page, nama, { nama, jeda: 500 });
  }
  await page.waitForTimeout(500);

  const peta = await petakanKasir(page);
  // Keranjang harus terbaca sebagai tabel sungguhan sejak tablet: semua kolom terlihat.
  const kolomKeranjang = await page.evaluate(() => {
    const h2 = [...document.querySelectorAll('section > header > h2')].find((h) =>
      h.textContent.trim().startsWith('Keranjang'),
    );
    const tabel = h2?.closest('section')?.querySelector('table');
    if (!tabel) return null;
    return [...tabel.querySelectorAll('thead th')].map((th) => ({
      teks: th.textContent.trim(),
      lebar: Math.round(th.getBoundingClientRect().width),
    }));
  });
  // Area dalam harus bisa bergulir sendiri tanpa menggeser halaman.
  const gulirDalam = await page.evaluate(() => {
    const h2 = [...document.querySelectorAll('section > header > h2')].find((h) =>
      h.textContent.trim().startsWith('Keranjang'),
    );
    const div = h2?.closest('section')?.querySelector(':scope > div');
    if (!div) return null;
    const halamanSebelum = window.scrollY;
    div.scrollTop = 100;
    const hasil = {
      scrollTopSetelahDigeser: div.scrollTop,
      halamanIkutBergeser: window.scrollY !== halamanSebelum,
    };
    div.scrollTop = 0;
    return hasil;
  });
  // Berapa baris keranjang yang benar-benar muat terlihat (inti keluhan pemilik).
  const barisTerlihat = await page.evaluate(() => {
    const h2 = [...document.querySelectorAll('section > header > h2')].find((h) =>
      h.textContent.trim().startsWith('Keranjang'),
    );
    const div = h2?.closest('section')?.querySelector(':scope > div');
    if (!div) return null;
    const kotakIsi = div.getBoundingClientRect();
    const baris = [...div.querySelectorAll('tbody tr')].map((tr) => tr.getBoundingClientRect());
    return {
      tinggiAreaIsi: Math.round(kotakIsi.height),
      tinggiBaris: baris.length ? Math.round(baris[0].height) : 0,
      barisMuatUtuh: baris.filter((r) => r.top >= kotakIsi.top - 1 && r.bottom <= kotakIsi.bottom + 1).length,
    };
  });
  const tabel = await bacaTabelKeranjang(page);

  kasir.push({ ...k, ...peta, kolomKeranjang, gulirDalam, barisTerlihat, tabelKeranjang: tabel });
  await page.screenshot({ path: path.join(KELUARAN, `tata-kasir-${k.peran}-${k.w}.png`) });
  await ctx.close();
}

// =====================================================================================
// B. Drawer hamburger: satu-satunya navigasi di layar kecil
// =====================================================================================
const drawer = [];
for (const k of [
  { peran: 'kasir', w: 390, h: 844, sentuh: true },
  { peran: 'kasir', w: 768, h: 1024, sentuh: true },
  { peran: 'superadmin', w: 390, h: 844, sentuh: true },
]) {
  if (!jalankan('drawer')) break;
  const { ctx, page } = await konteks(k, AKUN[k.peran]);
  await bukaDanTunggu(page, `${BASE}/kasir`);
  await page.waitForTimeout(800);
  const sebelum = await page.evaluate(() => {
    const tombol = [...document.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Buka menu',
    );
    const r = tombol?.getBoundingClientRect();
    return {
      tombolMenuAda: !!tombol,
      terlihat: !!r && r.width > 0 && r.height > 0,
      kotak: r ? { atas: Math.round(r.top), kiri: Math.round(r.left), w: Math.round(r.width) } : null,
      navBawahTampil: [...document.querySelectorAll('nav')].some(
        (n) => getComputedStyle(n).position === 'fixed' && n.getBoundingClientRect().bottom >= window.innerHeight - 1,
      ),
    };
  });
  await page.getByRole('button', { name: 'Buka menu' }).click();
  await page.waitForTimeout(700);
  const isi = await page.evaluate(() => {
    const overlay = [...document.querySelectorAll('div')].find((d) => d.className.includes('fixed inset-0 z-40'));
    const panel = overlay?.querySelector('div.absolute');
    const tautan = [...(panel?.querySelectorAll('a') ?? [])].map((a) => a.textContent.trim());
    const r = panel?.getBoundingClientRect();
    return {
      drawerTerbuka: !!panel && (r?.width ?? 0) > 0,
      lebar: r ? Math.round(r.width) : 0,
      tautan,
      adaTombolKeluar: /Keluar/.test(panel?.innerText ?? ''),
    };
  });
  await page.screenshot({ path: path.join(KELUARAN, `drawer-${k.peran}-${k.w}.png`) });
  // Kembali ke halaman kasir lewat tautan drawer (navigasi benar-benar berfungsi).
  const tautanKasir = page.locator('.fixed.inset-0.z-40 a', { hasText: 'Kasir' }).first();
  await tautanKasir.click();
  await page.waitForTimeout(900);
  const setelahKlik = await page.evaluate(() => ({
    path: location.pathname,
    drawerTertutup: ![...document.querySelectorAll('div')].some(
      (d) => d.className.includes('fixed inset-0 z-40') && d.getBoundingClientRect().width > 0,
    ),
  }));
  drawer.push({ ...k, sebelum, isi, setelahKlik });
  await ctx.close();
}

// =====================================================================================
// C. Sidebar: lebar + jenis penunjuk
// =====================================================================================
const kasusSidebar = [
  { label: 'superadmin-1024-kasar', peran: 'superadmin', w: 1024, h: 1366, sentuh: true },
  { label: 'superadmin-1366-kasar', peran: 'superadmin', w: 1366, h: 1024, sentuh: true },
  { label: 'superadmin-1366-presisi', peran: 'superadmin', w: 1366, h: 768, sentuh: false },
  { label: 'superadmin-1280-presisi', peran: 'superadmin', w: 1280, h: 800, sentuh: false },
  { label: 'superadmin-1440-presisi', peran: 'superadmin', w: 1440, h: 900, sentuh: false },
  { label: 'superadmin-1920-presisi', peran: 'superadmin', w: 1920, h: 1080, sentuh: false },
  { label: 'kasir-1024-kasar', peran: 'kasir', w: 1024, h: 1366, sentuh: true },
  { label: 'kasir-1366-presisi', peran: 'kasir', w: 1366, h: 768, sentuh: false },
  { label: 'kasir-1920-presisi', peran: 'kasir', w: 1920, h: 1080, sentuh: false },
];

const sidebar = [];
for (const k of kasusSidebar) {
  if (!jalankan('sidebar')) break;
  const { ctx, page } = await konteks(k, AKUN[k.peran]);
  // Halaman /stok memuat 101 produk, jadi kontennya pasti lebih tinggi dari layar —
  // itulah yang membuat uji "konten bergulir, sidebar diam" bermakna.
  await bukaDanTunggu(page, `${BASE}/stok`);
  await page.waitForTimeout(2000);

  const peta = await page.evaluate(() => {
    const asides = [...document.querySelectorAll('aside')];
    const el = asides.find((a) => getComputedStyle(a).display !== 'none');
    const navMenu = el?.querySelector('nav');
    const r = el?.getBoundingClientRect();
    return {
      pointerFine: matchMedia('(pointer: fine)').matches,
      pointerCoarse: matchMedia('(pointer: coarse)').matches,
      sidebarTampil: !!el && (r?.width ?? 0) > 0,
      sidebarPosisi: el ? getComputedStyle(el).position : null,
      sidebarAtas: r ? Math.round(r.top) : null,
      sidebarKiri: r ? Math.round(r.left) : null,
      sidebarTinggi: r ? Math.round(r.height) : null,
      tinggiJendela: window.innerHeight,
      navMenuOverflowY: navMenu ? getComputedStyle(navMenu).overflowY : null,
      navMenuScrollHeight: navMenu?.scrollHeight ?? null,
      navMenuClientHeight: navMenu?.clientHeight ?? null,
      kontenPaddingKiri: getComputedStyle(document.querySelector('main')).paddingLeft,
      kontenKiri: Math.round(document.querySelector('main').getBoundingClientRect().left),
      navBawahTampil: [...document.querySelectorAll('nav')].some(
        (n) => getComputedStyle(n).position === 'fixed' && n.getBoundingClientRect().bottom >= window.innerHeight - 1,
      ),
      bisaGulirHalaman: document.documentElement.scrollHeight > window.innerHeight + 1,
    };
  });

  // Konten digulir: sidebar harus tetap di tempatnya.
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(300);
  const setelahKontenDigulir = await page.evaluate(() => {
    const el = [...document.querySelectorAll('aside')].find((a) => getComputedStyle(a).display !== 'none');
    const r = el?.getBoundingClientRect();
    return { windowY: window.scrollY, sidebarAtas: r ? Math.round(r.top) : null };
  });

  // Menu sidebar digulir sendiri (dipaksa pendek supaya pasti lebih tinggi dari kotaknya).
  const gulirSidebar = await page.evaluate(() => {
    const navMenu = [...document.querySelectorAll('aside')]
      .find((a) => getComputedStyle(a).display !== 'none')
      ?.querySelector('nav');
    if (!navMenu) return null;
    const asli = navMenu.style.maxHeight;
    navMenu.style.maxHeight = '100px';
    const halamanSebelum = window.scrollY;
    navMenu.scrollTop = 120;
    const hasil = {
      navScrollTop: navMenu.scrollTop,
      navScrollHeight: navMenu.scrollHeight,
      navClientHeight: navMenu.clientHeight,
      halamanIkutBergeser: window.scrollY !== halamanSebelum,
    };
    navMenu.style.maxHeight = asli;
    return hasil;
  });

  sidebar.push({ ...k, ...peta, setelahKontenDigulir, gulirSidebar });
  await page.screenshot({ path: path.join(KELUARAN, `tata-sidebar-${k.label}.png`) });
  await ctx.close();
}

await browser.close();
const keluaran = { kasir, drawer, sidebar };
fs.writeFileSync(path.join(KELUARAN, 'bukti-tata-letak.json'), JSON.stringify(keluaran, null, 2));
console.log(JSON.stringify(keluaran, null, 2));
