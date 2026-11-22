/**
 * Pemetaan baris nota hasil OCR ke barang jual.
 *
 * Murni data: tanpa DOM/React, supaya bisa diuji langsung dari Node
 * (`scripts/check-nota-kasir.mjs`). Harga TIDAK diambil dari nota — nota pelanggan
 * sering tanpa harga, dan nota supplier berisi harga modal. Harga jual selalu dari
 * master produk; kasir tetap bisa mengubahnya lewat pop up baris (dengan alasan).
 */

// Ekstensi `.ts` ditulis eksplisit: berkas ini ikut diimpor skrip uji Node
// (scripts/check-nota-kasir.mjs) yang tidak punya pemecah modul seperti Vite.
import { normalSatuan, tebakProduk, type BarisStruk, type SatuanDikenal } from './ocrParse.ts';
import type { Product, ProductAlias, ProductUnit } from '../types';

export type BarisNotaKasir = {
  /** Identitas baris di layar; tidak ikut dikirim ke server. */
  kunci: number;
  /** Nama barang hasil OCR (sudah tanpa kata satuan), ditampilkan sebagai bukti. */
  nama: string;
  /** Baris apa adanya dari nota, untuk memeriksa hasil baca. */
  mentah: string;
  /** Satuan yang tertulis di nota, mis. "renteng". */
  satuanNota: string | null;
  productId: number | null;
  unitId: number | null;
  qty: number;
  /** true = dicentang untuk masuk keranjang. Baris tanpa produk mulai tidak dicentang. */
  pilih: boolean;
  /** Peringatan yang harus dibaca kasir sebelum memasukkan baris ini. */
  catatan: string | null;
};

/**
 * Satuan produk yang paling cocok dengan kata di nota. Tanpa kata satuan, dipakai
 * satuan terkecil produk (pcs) — sama dengan default kasir saat mengetuk hasil cari.
 * `cocok` false = kata satuannya tidak ada di produk ini, jadi pilihan di atas hanya
 * tebakan dan layar wajib menampilkannya.
 */
export function pilihSatuan(
  units: ProductUnit[],
  kata: string | null,
): { unit: ProductUnit | null; cocok: boolean } {
  if (!units.length) return { unit: null, cocok: false };
  if (!kata) return { unit: units[0], cocok: true };
  const baku = normalSatuan(kata);
  const ketemu = units.find((u) => normalSatuan(u.unit_name) === baku);
  return ketemu ? { unit: ketemu, cocok: true } : { unit: units[0], cocok: false };
}

/**
 * Daftar satuan yang dikenal pengurai: nama + inisial dari master Satuan, ditambah nama
 * satuan yang terpasang di produk (mis. produk lama yang satuannya sudah nonaktif).
 */
export function daftarSatuan(produk: Product[], satuanMaster: { name: string; inisial?: string | null }[]): SatuanDikenal[] {
  const peta = new Map<string, SatuanDikenal>();
  for (const s of satuanMaster) {
    const name = s.name.trim();
    if (name) peta.set(name, { name, inisial: s.inisial?.trim() || null });
  }
  for (const p of produk) {
    for (const u of p.units) {
      const name = u.unit_name.trim();
      if (name && !peta.has(name)) peta.set(name, { name, inisial: null });
    }
  }
  return [...peta.values()];
}

/**
 * Ubah baris OCR jadi baris siap dimasukkan ke keranjang. Baris yang produknya tidak
 * dikenali tetap ditampilkan (tidak dicentang) supaya kasir bisa memilih produknya
 * sendiri, bukan hilang diam-diam.
 */
export function susunBarisNota(
  hasil: BarisStruk[],
  produk: Product[],
  alias: { alias: string; product_id: number }[] = [],
  mulaiKunci = 0,
): { baris: BarisNotaKasir[]; kunciBerikut: number } {
  const peta = new Map(produk.map((p) => [p.id, p]));
  let kunci = mulaiKunci;

  const baris = hasil.map((b) => {
    const tebakan = tebakProduk(b.nama, produk, alias);
    const p = tebakan === null ? undefined : peta.get(tebakan);
    const { unit, cocok } = p ? pilihSatuan(p.units, b.satuan ?? null) : { unit: null, cocok: false };
    const catatan = !p
      ? 'Produk belum dikenali. Pilih sendiri atau biarkan tidak dicentang.'
      : b.satuan && !cocok
        ? `Satuan "${b.satuan}" tidak ada di produk ini (${p.units.map((u) => u.unit_name).join(', ')}).`
        : null;
    return {
      kunci: ++kunci,
      nama: b.nama,
      mentah: b.mentah,
      satuanNota: b.satuan ?? null,
      productId: p?.id ?? null,
      unitId: unit?.unit_id ?? null,
      qty: Number.isInteger(b.qty) && b.qty > 0 ? b.qty : 1,
      pilih: p !== undefined,
      catatan,
    };
  });

  return { baris, kunciBerikut: kunci };
}

/** Normalisasi balasan `/product-aliases`: array langsung atau dibungkus `{ rows }`. */
export function bacaDaftarAlias(data: unknown): ProductAlias[] {
  if (Array.isArray(data)) return data as ProductAlias[];
  if (data && typeof data === 'object' && Array.isArray((data as { rows?: unknown }).rows)) {
    return (data as { rows: ProductAlias[] }).rows;
  }
  return [];
}
