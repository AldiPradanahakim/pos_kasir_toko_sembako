/**
 * Pengurai teks struk belanja hasil OCR.
 *
 * Murni teks: tanpa DOM, React, atau impor apa pun, supaya bisa dijalankan
 * langsung oleh Node pada `scripts/check-ocr-parse.mjs`.
 */

export type BarisStruk = {
  nama: string;
  qty: number;
  harga: number;
  subtotal: number;
  mentah: string;
};

/** Bukan barang: header, baris pembayaran, dan penutup struk. */
const KATA_LEWAT =
  /\b(total|subtotal|grand\s+total|jumlah|bayar|kembali|tunai|ppn|pajak|diskon|disc|terima\s+kasih|kasir|tanggal|invoice|faktur|harga|qty)\b|\bno\./i;

const POLA_TOKEN = /^[\d][\d.,]*$/;

/** "Rp40.000" → "40.000"; "1kg" → null (itu bagian nama, bukan harga). */
function tokenAngka(teks: string): string | null {
  const bersih = teks.replace(/^rp\.?/i, '');
  return POLA_TOKEN.test(bersih) ? bersih : null;
}

/**
 * Baca angka gaya Indonesia: titik DAN koma sama-sama bisa jadi pemisah ribuan
 * ("40.000" dan "40,000" sama-sama 40000). Bila hanya ada satu pemisah dan
 * ekornya bukan 3 digit, itu desimal ("2,5" = 2.5).
 */
export function bacaAngka(teks: string): number | null {
  const t = teks.replace(/[^\d.,]/g, '');
  if (!t) return null;
  const titik = t.lastIndexOf('.');
  const koma = t.lastIndexOf(',');
  let bersih = t;
  if (titik >= 0 && koma >= 0) {
    const desimal = titik > koma ? '.' : ',';
    bersih = t.split(desimal === '.' ? ',' : '.').join('').replace(desimal, '.');
  } else {
    const sep = titik >= 0 ? '.' : koma >= 0 ? ',' : '';
    if (sep) {
      const bagian = t.split(sep);
      bersih = bagian.length > 2 || bagian[bagian.length - 1].length === 3 ? bagian.join('') : bagian.join('.');
    }
  }
  const n = Number(bersih);
  return Number.isFinite(n) ? n : null;
}

/** Sisakan huruf saja: buang angka, "Rp", dan simbol struk. */
function bersihkanNama(baris: string): string {
  return baris
    .replace(/\brp\.?/gi, ' ')
    .replace(/\d[\d.,]*/g, ' ')
    .replace(/(?:^|\s)[x×](?=\s|$)/gi, ' ')
    .replace(/[^\p{L}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bacaBaris(baris: string): BarisStruk | null {
  const polaKali = baris.match(/(\d+)\s*[x×]\s*([\d.,]+)/i);
  const nama = bersihkanNama(polaKali ? baris.replace(polaKali[0], ' ') : baris);
  if (nama.replace(/[^\p{L}]/gu, '').length < 2) return null;

  const angka: { nilai: number; pemisah: boolean }[] = [];
  // "2x40.000" menempel jadi satu token; pisahkan dulu supaya ikut terbaca.
  for (const t of baris.replace(/(\d)\s*[x×]\s*(?=[\d])/gi, '$1 ').split(' ')) {
    const mentah = tokenAngka(t);
    if (!mentah) continue;
    const nilai = bacaAngka(mentah);
    if (nilai !== null && nilai > 0) angka.push({ nilai, pemisah: /[.,]/.test(mentah) });
  }
  if (!angka.length) return null;

  const awal = angka[0];
  const akhir = angka[angka.length - 1];
  let qty = 1;
  let harga = awal.nilai;

  if (polaKali) {
    // "2 x 40.000" / "2x40.000" / "2 X 40.000"
    qty = Math.max(1, Math.round(bacaAngka(polaKali[1]) ?? 1));
    harga = bacaAngka(polaKali[2]) ?? awal.nilai;
  } else if (angka.length >= 2 && !akhir.pemisah && akhir.nilai <= 999 && awal.nilai >= 1000) {
    // "40.000 2" = dua biji @ 40.000
    qty = Math.round(akhir.nilai);
    harga = awal.nilai;
  } else if (angka.length >= 2 && awal.nilai < 1000 && akhir.nilai >= 1000) {
    // "2 40.000"
    qty = Math.max(1, Math.round(awal.nilai));
    harga = akhir.nilai;
  } else if (angka.length >= 2) {
    // "40.000 80.000" = harga satuan lalu subtotal → qty diturunkan dari bagi hasil.
    const bagi = akhir.nilai / awal.nilai;
    qty = Number.isInteger(bagi) && bagi > 1 ? bagi : 1;
    harga = awal.nilai;
  }

  // Harga di bawah Rp100 tidak masuk akal untuk barang toko; angka kecil yang
  // tersisa biasanya bagian alamat atau nomor telepon, bukan barang.
  if (harga < 100) return null;

  return { nama, qty, harga, subtotal: qty * harga, mentah: baris };
}

/** Ubah teks mentah OCR jadi baris belanja. Baris yang tak masuk akal dibuang. */
export function parseStruk(text: string): BarisStruk[] {
  const hasil: BarisStruk[] = [];
  for (const mentah of text.split(/\r?\n/)) {
    const baris = mentah.replace(/\s+/g, ' ').trim();
    if (!baris || !/\d/.test(baris) || KATA_LEWAT.test(baris)) continue;
    const row = bacaBaris(baris);
    if (row) hasil.push(row);
  }
  return hasil;
}

function normal(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\d+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigram(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Dice coefficient pada bigram huruf. */
function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigram(a);
  const gb = bigram(b);
  let sama = 0;
  for (const [g, n] of ga) sama += Math.min(n, gb.get(g) ?? 0);
  return (2 * sama) / (a.length + b.length - 2);
}

/** Skor 0..1: Dice bigram, dinaikkan bila salah satu memuat yang lain atau banyak kata sama. */
function skorKemiripan(a: string, b: string): number {
  if (a.includes(b) || b.includes(a)) return Math.max(dice(a, b), 0.75);
  const ka = new Set(a.split(' '));
  const kb = b.split(' ');
  const sama = kb.filter((t) => ka.has(t)).length;
  return Math.max(dice(a, b), sama / Math.max(ka.size, kb.length));
}

const AMBANG = 0.55;

/**
 * Tebak produk dari nama hasil OCR: alias kasir lebih dulu, lalu nama persis,
 * terakhir kemiripan teks. `null` = tidak ada yang cukup meyakinkan.
 *
 * ponytail: plafon heuristik ini adalah produk yang namanya mirip-mirip
 * ("Sedaap Soto" vs "Sedaap Ayam") — cukup untuk mengisi pilihan awal, dan
 * hasilnya tetap wajib diperiksa kasir. Kalau salah tebak mulai sering,
 * upgrade: simpan koreksi kasir ke product_aliases lalu pakai Levenshtein
 * ber-bobot kata atau embedding.
 */
export function tebakProduk(
  nama: string,
  produk: { id: number; name: string }[],
  alias: { alias: string; product_id: number }[] = [],
): number | null {
  const q = normal(nama);
  if (!q) return null;

  // 1. Alias hasil koreksi kasir sebelumnya — paling bisa dipercaya.
  let aliasCocok: number | null = null;
  let aliasTerpanjang = 0;
  for (const a of alias) {
    const n = normal(a.alias);
    if (!n) continue;
    if (n === q) return a.product_id;
    if (n.length >= 3 && q.includes(n) && n.length > aliasTerpanjang) {
      aliasTerpanjang = n.length;
      aliasCocok = a.product_id;
    }
  }
  if (aliasCocok !== null) return aliasCocok;

  // 2. Nama produk persis.
  for (const p of produk) if (normal(p.name) === q) return p.id;

  // 3. Kemiripan teks.
  let terbaik: number | null = null;
  let skorTerbaik = 0;
  for (const p of produk) {
    const s = skorKemiripan(q, normal(p.name));
    if (s > skorTerbaik) {
      skorTerbaik = s;
      terbaik = p.id;
    }
  }
  return skorTerbaik >= AMBANG ? terbaik : null;
}
