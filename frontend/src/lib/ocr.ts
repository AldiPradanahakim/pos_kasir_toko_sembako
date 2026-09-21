import { createWorker } from 'tesseract.js';

/** Lebar maksimum gambar yang dikirim ke OCR: lebih besar hanya memperlambat. */
const LEBAR_MAKS = 1600;
/** Seberapa jauh piksel dijauhkan dari rata-rata kecerahan saat kontras dinaikkan. */
const FAKTOR_KONTRAS = 1.8;

export type Progres = { status: string; progress: number };

const LABEL_PROGRES: Record<string, string> = {
  'loading tesseract core': 'Menyiapkan mesin pembaca',
  'initializing tesseract': 'Menyalakan mesin pembaca',
  'loading language traineddata': 'Mengunduh data bahasa Indonesia',
  'loading language traineddata (from cache)': 'Memuat data bahasa dari simpanan',
  'initializing api': 'Menyiapkan pembaca teks',
  'recognizing text': 'Membaca teks struk',
};

export function labelProgres(status: string): string {
  return LABEL_PROGRES[status] ?? 'Memproses gambar';
}

/**
 * Siapkan foto struk sebelum OCR: foto dari HP sering gelap dan kurang kontras
 * sehingga huruf tipis hilang. Gambar diperkecil (lebih dari 1600px hanya
 * memperlambat), dijadikan abu-abu, lalu kontrasnya direntangkan di sekitar
 * rata-rata kecerahan.
 */
export async function siapkanGambar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const skala = Math.min(1, LEBAR_MAKS / bitmap.width);
  const lebar = Math.max(1, Math.round(bitmap.width * skala));
  const tinggi = Math.max(1, Math.round(bitmap.height * skala));

  const kanvas = document.createElement('canvas');
  kanvas.width = lebar;
  kanvas.height = tinggi;
  const ctx = kanvas.getContext('2d');
  if (!ctx) throw new Error('Kanvas gambar tidak tersedia di peramban ini.');
  ctx.drawImage(bitmap, 0, 0, lebar, tinggi);
  bitmap.close();

  const gambar = ctx.getImageData(0, 0, lebar, tinggi);
  const px = gambar.data;
  const abu = new Uint8ClampedArray(lebar * tinggi);
  let jumlah = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const v = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    abu[j] = v;
    jumlah += v;
  }
  const rata = jumlah / abu.length;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    // Uint8ClampedArray sudah membatasi 0..255 sendiri.
    px[i] = px[i + 1] = px[i + 2] = rata + (abu[j] - rata) * FAKTOR_KONTRAS;
    px[i + 3] = 255;
  }
  ctx.putImageData(gambar, 0, 0);

  return await new Promise<Blob>((selesai, gagal) => {
    kanvas.toBlob((b) => (b ? selesai(b) : gagal(new Error('Gagal menyiapkan gambar.'))), 'image/png');
  });
}

/**
 * Baca teks dari foto struk dengan bahasa Indonesia. Worker dibuat sekali per
 * panggilan lalu dimatikan supaya tidak tertinggal di memori; data bahasanya
 * di-cache tesseract.js di IndexedDB sehingga panggilan berikutnya cepat.
 */
export async function bacaTeks(file: File, lapor?: (p: Progres) => void): Promise<string> {
  const gambar = await siapkanGambar(file);
  const worker = await createWorker('ind', 1, {
    logger: (m: { status: string; progress: number }) => lapor?.(m),
  });
  try {
    const hasil = await worker.recognize(gambar);
    return hasil.data.text ?? '';
  } finally {
    await worker.terminate();
  }
}
