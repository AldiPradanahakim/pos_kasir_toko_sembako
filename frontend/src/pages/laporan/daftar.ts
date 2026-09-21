export type JenisLaporan = 'rentang' | 'harian' | 'khusus' | 'unduh';

/** Nilai filter yang dipakai untuk membangun query endpoint. */
export type Rentang = { dari: string; sampai: string; tanggal: string };

export interface EntriLaporan {
  slug: string;
  judul: string;
  ket: string;
  jenis: JenisLaporan;
  /** Path API (atau CSV) dari rentang tanggal terpilih. */
  path?: (q: Rentang) => string;
  /** Nama berkas untuk entri unduhan CSV. */
  berkas?: string;
  /**
   * Kolom/angka yang disembunyikan. Dipakai untuk laporan yang isinya sudah tidak
   * memakai uang (pembelian), supaya tidak ada baris "Rp 0" yang menyesatkan.
   */
  kolomSembunyi?: string[];
}

/**
 * Satu sumber kebenaran untuk hub `/laporan` dan strip tab di `/laporan/:slug`,
 * supaya menambah laporan baru cukup satu baris di sini.
 */
export const ENTRI: EntriLaporan[] = [
  {
    slug: 'umum',
    judul: 'Laporan Umum',
    ket: 'Ringkasan penjualan, pembelian, dan arus kas.',
    jenis: 'rentang',
    path: (q) => `/reports/umum?from=${q.dari}&to=${q.sampai}`,
    // Pembelian tidak lagi memakai uang, jadi "Pembelian: Rp 0" hanya menyesatkan.
    // Jumlah transaksinya tetap tampil lewat `pembelian_transaksi`.
    kolomSembunyi: ['pembelian'],
  },
  {
    slug: 'transaksi',
    judul: 'Laporan Semua Transaksi',
    ket: 'Daftar tiap transaksi beserta kasir dan metodenya.',
    jenis: 'rentang',
    path: (q) => `/reports/transactions?from=${q.dari}&to=${q.sampai}`,
  },
  {
    slug: 'arus-keuangan',
    judul: 'Laporan Arus Keuangan',
    ket: 'Uang masuk dan keluar per kategori.',
    jenis: 'rentang',
    path: (q) => `/reports/cash-flow?from=${q.dari}&to=${q.sampai}`,
  },
  {
    slug: 'penjualan',
    judul: 'Laporan Penjualan',
    ket: 'Omzet harian dalam rentang tanggal.',
    jenis: 'rentang',
    path: (q) => `/reports/sales?from=${q.dari}&to=${q.sampai}`,
  },
  {
    slug: 'kategori',
    judul: 'Data Penjualan per Kategori',
    ket: 'Omzet dan laba dipisah per kategori produk.',
    jenis: 'rentang',
    path: (q) => `/reports/sales-by-category?from=${q.dari}&to=${q.sampai}`,
  },
  {
    slug: 'pembelian',
    judul: 'Laporan Pembelian',
    ket: 'Jumlah barang yang dibeli dari supplier (qty, tanpa harga).',
    jenis: 'rentang',
    path: (q) => `/reports/purchases?from=${q.dari}&to=${q.sampai}`,
    // Pembelian dicatat tanpa harga: yang bermakna hanya qty dan qty_base.
    kolomSembunyi: ['total'],
  },
  {
    slug: 'modal',
    judul: 'Laporan Modal',
    ket: 'Nilai modal barang yang terjual.',
    jenis: 'rentang',
    path: (q) => `/reports/modal?from=${q.dari}&to=${q.sampai}`,
  },
  {
    slug: 'laba-rugi',
    judul: 'Laporan Laba Rugi',
    ket: 'Pendapatan dikurangi modal dan biaya.',
    jenis: 'rentang',
    path: (q) => `/reports/profit-loss?from=${q.dari}&to=${q.sampai}`,
  },
  {
    slug: 'retur',
    judul: 'Laporan Retur Transaksi dan Pembelian',
    ket: 'Barang yang dikembalikan pelanggan atau ke supplier.',
    jenis: 'rentang',
    path: (q) => `/reports/returns?from=${q.dari}&to=${q.sampai}`,
  },
  {
    slug: 'stok-opname',
    judul: 'Stok Opname',
    ket: 'Hitung stok fisik lalu bandingkan dengan catatan sistem.',
    jenis: 'khusus',
  },
  {
    slug: 'export-arus-stok',
    judul: 'Export Laporan Arus Stok',
    ket: 'Unduh pergerakan stok sebagai berkas CSV.',
    jenis: 'unduh',
    path: (q) => `/reports/stock-flow.csv?from=${q.dari}&to=${q.sampai}`,
    berkas: 'laporan-arus-stok.csv',
  },
  {
    slug: 'export-arus-keuangan',
    judul: 'Export Laporan Arus Keuangan',
    ket: 'Unduh arus keuangan sebagai berkas CSV.',
    jenis: 'unduh',
    path: (q) => `/reports/cash-flow.csv?from=${q.dari}&to=${q.sampai}`,
    berkas: 'laporan-arus-keuangan.csv',
  },
  {
    slug: 'harian',
    judul: 'Laporan Harian',
    ket: 'Rekap satu hari: omzet, transaksi, dan laba.',
    jenis: 'harian',
    path: (q) => `/reports/daily?date=${q.tanggal}`,
  },
  {
    slug: 'laba',
    judul: 'Laba Kotor',
    ket: 'Laba kotor harian dalam rentang tanggal.',
    jenis: 'rentang',
    path: (q) => `/reports/profit?from=${q.dari}&to=${q.sampai}`,
  },
  {
    slug: 'harga',
    judul: 'Perubahan Harga',
    ket: 'Riwayat harga jual yang diubah saat transaksi.',
    jenis: 'rentang',
    path: (q) => `/reports/price-changes?from=${q.dari}&to=${q.sampai}`,
  },
];

export const entriDari = (slug: string | undefined) => ENTRI.find((e) => e.slug === slug);
