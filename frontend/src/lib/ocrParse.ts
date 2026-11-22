/**
 * Pengurai teks struk belanja hasil OCR.
 *
 * Murni teks: tanpa DOM, React, atau impor apa pun, supaya bisa dijalankan
 * langsung oleh Node pada `scripts/check-ocr-parse.mjs`.
 */

export type BarisStruk = {
  nama: string;
  /** Nama satuan yang tertulis di nota ("renteng", "dus", …); null kalau tidak ada. */
  satuan?: string | null;
  qty: number;
  harga: number;
  subtotal: number;
  mentah: string;
};

/** Bukan barang: header, alamat, baris pembayaran, dan penutup struk/nota. */
const KATA_LEWAT =
  /\b(total|subtotal|grand\s+total|jumlah|bayar|kembali|tunai|ppn|pajak|diskon|disc|terima\s+kasih|kasir|tanggal|invoice|faktur|harga|qty|nota|daftar|belanja|jl|jalan|alamat|telp|tlp|hp|wa|whatsapp)\b|\bno\./i;

/**
 * Ejaan satuan yang ditulis pembeli vs nama satuan di master. Hanya padanan yang
 * benar-benar sama artinya; "karton" bukan "dus" (isinya beda), jadi tidak dipetakan.
 */
const SINONIM_SATUAN: Record<string, string> = {
  renteng: 'renceng',
  rentengan: 'renceng',
  rencengan: 'renceng',
  pak: 'pack',
  packs: 'pack',
  bungkus: 'pack',
  bungkusnya: 'pack',
  bks: 'pack',
  pc: 'pcs',
  pieces: 'pcs',
  biji: 'pcs',
  butir: 'pcs',
  ball: 'bal',
  kardus: 'dus',
};

/** Satuan yang dikenal pengurai: nama lengkap dan/atau singkatannya ("r" = renceng). */
export type SatuanDikenal = { name: string; inisial?: string | null };

/** Nama satuan dibandingkan dalam bentuk baku: huruf kecil, tanpa tanda baca. */
export function normalSatuan(kata: string): string {
  const bersih = kata.toLowerCase().replace(/[^\p{L}\d]/gu, '');
  return SINONIM_SATUAN[bersih] ?? bersih;
}

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

function bacaBaris(baris: string, opsi: OpsiParseStruk): BarisStruk | null {
  const tanpaHarga = opsi.tanpaHarga === true;
  const polaKali = baris.match(/(\d+)\s*[x×]\s*([\d.,]+)/i);
  const { nama, satuan, kata } = pisahkanSatuan(
    bersihkanNama(polaKali ? baris.replace(polaKali[0], ' ') : baris),
    opsi.satuan,
  );
  if (nama.replace(/[^\p{L}]/gu, '').length < 2) return null;

  const angka: { nilai: number; pemisah: boolean }[] = [];
  // "2x40.000" menempel jadi satu token; pisahkan dulu supaya ikut terbaca.
  for (const t of baris.replace(/(\d)\s*[x×]\s*(?=[\d])/gi, '$1 ').split(' ')) {
    const mentah = tokenAngka(t);
    if (!mentah) continue;
    const nilai = bacaAngka(mentah);
    if (nilai !== null && nilai > 0) angka.push({ nilai, pemisah: /[.,]/.test(mentah) });
  }

  /** Baris tanpa harga: qty hanya dipercaya bila menempel pada kata satuan. */
  const tanpaAngkaHarga = (): BarisStruk => ({
    nama,
    satuan,
    qty: kata ? qtyDekatSatuan(baris, kata) : 1,
    harga: 0,
    subtotal: 0,
    mentah: baris,
  });

  if (!angka.length) return tanpaHarga ? tanpaAngkaHarga() : null;

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
  if (harga < 100) return tanpaHarga ? tanpaAngkaHarga() : null;

  // Nota belanja: qty yang sahih adalah angka yang menempel ke kata satuan ("2 dus"),
  // bukan hasil tafsir harga. Tanpa ini "2 dus MIE 128.000" bisa terbaca qty 2 dari
  // harga, atau qty 1 kalau angkanya kebetulan tidak berbentuk harga.
  if (tanpaHarga && kata) qty = qtyDekatSatuan(baris, kata);

  return { nama, satuan, qty, harga, subtotal: qty * harga, mentah: baris };
}

export type OpsiParseStruk = {
  /**
   * Nota daftar belanja pelanggan: harganya sering tidak ditulis, jadi baris tanpa
   * harga tetap dibaca (harga 0). Nota supplier (Scan Struk) memakai perilaku lama:
   * baris tanpa harga dibuang karena di nota supplier harga selalu ada.
   */
  tanpaHarga?: boolean;
  /**
   * Satuan yang dikenal (dari master Satuan): nama dan singkatannya. Bila diisi, kata
   * satuan dipisahkan dari nama barang ("GUDANG GARAM RENTENG" → "GUDANG GARAM" +
   * "renceng", "2 (r) Beng Beng" → "Beng Beng" + "renceng").
   */
  satuan?: SatuanDikenal[];
};

/**
 * Pisahkan kata satuan dari nama barang. Yang dikenali: nama lengkap ("RENTENG", "dus"),
 * ejaan pembeli lewat `SINONIM_SATUAN` ("bungkus" → pack), dan **inisial** dari master
 * Satuan ("(r)" → renceng, "P" → pack) — kasir dan pelanggan menulis nota dengan singkatan.
 *
 * Nama lengkap selalu menang atas inisial; di antara sesama jenis, yang paling kanan
 * dipakai karena satuan lazim ditulis di belakang nama barang.
 */
export function pisahkanSatuan(
  nama: string,
  satuan: SatuanDikenal[] = [],
): { nama: string; satuan: string | null; kata: string | null } {
  if (!satuan.length) return { nama, satuan: null, kata: null };
  const kata = nama.split(' ');
  const kosong = { nama, satuan: null, kata: null };

  // 1. Nama lengkap. Satuan majemuk ("1/2 kg") dilewati: angkanya sudah dibuang dari nama,
  //    jadi yang tersisa hanya "kg" — satuan lain, dan akan salah tebak.
  let posisi = -1;
  let ketemu: string | null = null;
  for (const s of satuan) {
    if (!/^\p{L}+$/u.test(s.name)) continue;
    const baku = normalSatuan(s.name);
    const i = kata.reduce((akhir, k, idx) => (normalSatuan(k) === baku ? idx : akhir), -1);
    if (i > posisi) {
      posisi = i;
      ketemu = s.name;
    }
  }
  if (posisi >= 0) return { nama: kata.filter((_, i) => i !== posisi).join(' '), satuan: ketemu, kata: kata[posisi] };

  // 2. Inisial. Tanda kurung sudah dibuang `bersihkanNama`, jadi "(r)" sampai di sini
  //    sebagai kata "r" — bentuk yang sama dengan "R" tanpa kurung.
  for (const s of satuan) {
    const ini = (s.inisial ?? '').trim().toLowerCase();
    if (!ini) continue;
    const i = kata.reduce((akhir, k, idx) => (normalSatuan(k) === ini ? idx : akhir), -1);
    if (i > posisi) {
      posisi = i;
      ketemu = s.name;
    }
  }
  if (posisi < 0) return kosong;
  return { nama: kata.filter((_, i) => i !== posisi).join(' '), satuan: ketemu, kata: kata[posisi] };
}

/**
 * Qty yang menempel pada kata satuan ("2 RENTENG" → 2). Angka tanpa satuan TIDAK
 * dipakai sebagai qty: di nota nyata "GUDANG GARAM 12" berarti merk, bukan 12 bungkus.
 */
function qtyDekatSatuan(baris: string, kata: string): number {
  // Kejadian TERAKHIR dipakai: satuan ditulis di belakang nama, dan "2 (r) Beng Beng"
  // maupun "Beng Beng 2 r" sama-sama menghasilkan angka 2.
  const posisi = baris.toLowerCase().lastIndexOf(kata.trim().toLowerCase());
  if (posisi < 0) return 1;
  // Isi dalam tanda kurung dibuang: itu tempat satuan ditulis ("(r)"), dan kotoran OCR
  // di dalamnya ("(4d)" terbaca dari "(d)") tidak boleh dianggap qty.
  const kiri = baris.slice(0, posisi).replace(/\([^)]*\)?/g, ' ');
  let qty = 1;
  for (const m of kiri.matchAll(/\d+/g)) {
    const n = Number(m[0]);
    // Angka yang menempel pada huruf bukan qty: itu ukuran ("350ML", "1L") atau
    // kotoran OCR di dalam kurung ("(4d)" terbaca dari "(d)").
    const sesudah = kiri[m.index + m[0].length] ?? ' ';
    if (/\p{L}/u.test(sesudah)) continue;
    // Ambil angka TERDEKAT sebelum satuan; angka lain di kiri biasanya ukuran/merk.
    if (n >= 1 && n <= 999) qty = n;
  }
  return qty;
}

/** Ubah teks mentah OCR jadi baris belanja. Baris yang tak masuk akal dibuang. */
export function parseStruk(text: string, opsi: OpsiParseStruk = {}): BarisStruk[] {
  const hasil: BarisStruk[] = [];
  for (const mentah of text.split(/\r?\n/)) {
    const baris = mentah.replace(/\s+/g, ' ').trim();
    if (!baris || KATA_LEWAT.test(baris)) continue;
    // Nota supplier selalu memuat angka; daftar belanja pelanggan boleh tanpa harga.
    if (!opsi.tanpaHarga && !/\d/.test(baris)) continue;
    const row = bacaBaris(baris, opsi);
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
 * ("Sedaap Soto" vs "Sedaap Ayam"), cukup untuk mengisi pilihan awal, dan
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

  // 1. Alias hasil koreksi kasir sebelumnya, paling bisa dipercaya.
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
