import { Card, Kosong, Stat } from '../../components/ui';
import { formatTanggal, formatTanggalJam, labelMetode, rupiah } from '../../lib/format';

/** Judul kolom bahasa Indonesia. Kolom baru dari laporan lanjutan cukup ditambah di sini. */
export const LABEL: Record<string, string> = {
  date: 'Tanggal',
  tanggal: 'Tanggal',
  from: 'Dari',
  to: 'Sampai',
  created_at: 'Waktu',
  no_struk: 'No Struk',
  nama: 'Nama',
  nama_pelanggan: 'Pelanggan',
  tipe: 'Jenis',
  tipe_arus: 'Jenis',
  kategori: 'Kategori',
  supplier: 'Supplier',
  transactions: 'Transaksi',
  transaksi: 'Transaksi',
  items_count: 'Jumlah Item',
  total: 'Total',
  total_omzet: 'Total Omzet',
  total_modal: 'Total Modal',
  total_item: 'Jumlah Item',
  total_transaksi: 'Jumlah Transaksi',
  total_laba: 'Total Laba',
  omzet: 'Omzet',
  modal: 'Modal',
  laba: 'Laba',
  laba_kotor: 'Laba Kotor',
  laba_bersih: 'Laba Bersih',
  pendapatan: 'Pendapatan',
  biaya: 'Biaya',
  masuk: 'Masuk',
  keluar: 'Keluar',
  saldo: 'Saldo',
  sisa: 'Sisa',
  dibayar: 'Dibayar',
  jumlah: 'Jumlah',
  selisih: 'Selisih',
  subtotal: 'Subtotal',
  diskon: 'Diskon',
  hutang: 'Hutang',
  piutang: 'Piutang',
  metode_bayar: 'Metode',
  by_kategori: 'Per Kategori',
  product_name: 'Produk',
  unit_name: 'Satuan',
  qty: 'Qty',
  harga: 'Harga',
  harga_normal: 'Harga Normal',
  harga_snapshot: 'Harga Jual',
  harga_modal_snapshot: 'Harga Modal',
  harga_beli: 'Harga Beli',
  harga_jual: 'Harga Jual',
  alasan_ubah_harga: 'Alasan',
  alasan: 'Alasan',
  kasir: 'Kasir',
  user_name: 'Petugas',
  status: 'Status',
  sale_id: 'ID Transaksi',
  purchase_id: 'ID Pembelian',
  stok_sistem: 'Stok Sistem',
  stok_fisik: 'Stok Fisik',
  stok_awal: 'Stok Awal',
  stok_akhir: 'Stok Akhir',
  catatan: 'Catatan',
  note: 'Catatan',
  keterangan: 'Keterangan',
  qty_masuk: 'Masuk',
  qty_keluar: 'Keluar',
  omzet_periode: 'Omzet Periode',
  modal_tersimpan: 'Modal Tersimpan',
  modal_terjual: 'Modal Terjual',
  produk_bersaldo: 'Produk Bersaldo',
  hpp: 'HPP',
  pengeluaran_operasional: 'Pengeluaran Operasional',
  pembelian_transaksi: 'Transaksi Pembelian',
  pemasukan: 'Pemasukan',
  pengeluaran: 'Pengeluaran',
  saldo_kas: 'Saldo Kas',
  saldo_awal: 'Saldo Awal',
  saldo_akhir: 'Saldo Akhir',
  total_masuk: 'Total Masuk',
  total_keluar: 'Total Keluar',
  produk_terlaris: 'Produk Terlaris',
  penjualan: 'Penjualan',
  pembelian: 'Pembelian',
  baris: 'Baris',
  qty_base: 'Qty Dasar',
  category_name: 'Kategori',
  category_id: 'ID Kategori',
  ref_id: 'ID Rujukan',
  item_id: 'ID Item',
  isi_snapshot: 'Isi Satuan',
  harga_diubah: 'Harga Diubah',
  alasan_batal: 'Alasan Batal',
  penyesuaian: 'Penyesuaian',
  pembatalan: 'Pembatalan',
  minus: 'Stok Minus',
  base_unit: 'Satuan',
  display: 'Stok',
};

/** Kolom rupiah. `(^|_)saldo` supaya `produk_bersaldo` (jumlah produk) tidak ikut diformat uang. */
const KOLOM_UANG =
  /(total|omzet|harga|jual|beli|pembelian|penjualan|laba|modal|dibayar|kembalian|masuk|keluar|(^|_)saldo|sisa|subtotal|pendapatan|biaya|hpp|pengeluaran|pembatalan|nilai|diskon|hutang|piutang|jumlah$|tunai)/;

/** Kolom hitungan (qty, selisih stok, jumlah transaksi): tampil apa adanya, bukan rupiah. */
const KOLOM_HITUNG = /^(qty|jumlah_|produk_|stok_|selisih|total_qty)|(^|_)transaksi$/;

/** Kolom yang tidak bermakna kalau dijumlahkan: harga satuan, isi satuan, persentase, dan id. */
const TIDAK_DIJUMLAH = /(^harga|^isi_|snapshot|persen|rata|_id$|^id$)/;

/** Kolom teknis yang tidak perlu dilihat staf toko. */
const KOLOM_SEMBUNYI = /(^id$|_id$|^from$|^to$)/;

export const judulKolom = (k: string) => LABEL[k] ?? k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const tampilNilai = (k: string, v: unknown): string => {
  if (v === null || v === undefined || v === '') return '-';
  if (typeof v === 'number') {
    return !KOLOM_HITUNG.test(k) && KOLOM_UANG.test(k) ? rupiah(v) : v.toLocaleString('id-ID');
  }
  if (typeof v === 'boolean') return v ? 'Ya' : 'Tidak';
  if (k === 'metode_bayar') return labelMetode(String(v));
  if (k === 'tipe' || k === 'tipe_arus' || k === 'status') return String(v).charAt(0).toUpperCase() + String(v).slice(1);
  if (k === 'created_at' || k === 'synced_at') return formatTanggalJam(String(v));
  if (k === 'date' || k === 'tanggal') return formatTanggal(String(v));
  if (typeof v === 'object') {
    // mis. by_kategori: {Kopi: 1159000, Rokok: 0}
    return Object.entries(v as Record<string, unknown>)
      .map(([kk, vv]) => `${labelMetode(kk)}: ${typeof vv === 'number' ? rupiah(vv) : String(vv)}`)
      .join(' · ');
  }
  return String(v);
};

export type HasilLaporan = { rows: Record<string, unknown>[]; ringkas: Record<string, unknown> | null };

/**
 * Respons laporan bisa berupa array, `{rows, ...ringkasan}`, `{data, ...ringkasan}`,
 * objek ringkasan dengan beberapa daftar di dalamnya (mis. `by_supplier` + `by_product`),
 * atau objek angka murni (mis. Laporan Modal). Daftar terpanjang jadi tabel utama,
 * sisanya ikut ke ringkasan dan ditampilkan sebagai tabel kecil.
 */
export function normalisasi(data: unknown): HasilLaporan {
  if (Array.isArray(data)) return { rows: data as Record<string, unknown>[], ringkas: null };
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.rows)) {
      const { rows, ...ringkas } = obj;
      return { rows: rows as Record<string, unknown>[], ringkas };
    }
    if (Array.isArray(obj.data)) {
      const { data: rows, ...ringkas } = obj;
      return { rows: rows as Record<string, unknown>[], ringkas };
    }
    const kunci = Object.keys(obj).filter((k) => Array.isArray(obj[k]));
    if (kunci.length) {
      const utama = kunci.reduce((a, b) => ((obj[b] as unknown[]).length > (obj[a] as unknown[]).length ? b : a));
      const { [utama]: rows, ...ringkas } = obj;
      return { rows: rows as Record<string, unknown>[], ringkas };
    }
    // Angka murni: tampilkan sebagai kartu ringkasan, bukan tabel satu baris.
    return { rows: [], ringkas: obj };
  }
  return { rows: [], ringkas: null };
}

/** Kolom yang muncul di tabel + nilainya untuk baris TOTAL. */
function hitung(rows: Record<string, unknown>[], sembunyi: string[]) {
  const kolom = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter(
    (k) => !KOLOM_SEMBUNYI.test(k) && !sembunyi.includes(k),
  );
  const total: Record<string, number> = {};
  for (const k of kolom) {
    if (TIDAK_DIJUMLAH.test(k)) continue;
    if (!rows.every((r) => typeof r[k] === 'number')) continue;
    const angka = rows.map((r) => r[k] as number);
    // Saldo berjalan: totalnya adalah nilai terakhir, bukan penjumlahannya.
    total[k] = /(^|_)saldo$/.test(k) ? angka[angka.length - 1] : angka.reduce((s, n) => s + n, 0);
  }
  return { kolom, total };
}

export function TabelLaporan({
  rows,
  kosong,
  sembunyi = [],
}: {
  rows: Record<string, unknown>[];
  kosong?: string;
  /** Nama kolom yang tidak ditampilkan (mis. `total` pada laporan pembelian yang kini berbasis qty). */
  sembunyi?: string[];
}) {
  if (!rows.length) return <Kosong>{kosong ?? 'Tidak ada data pada rentang ini.'}</Kosong>;
  const { kolom, total } = hitung(rows, sembunyi);
  const adaTotal = Object.keys(total).length > 0;

  return (
    <div className="tabel-scroll">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
            {kolom.map((k) => (
              <th key={k} className="whitespace-nowrap py-2 pr-3">
                {judulKolom(k)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-50">
              {kolom.map((k) => (
                <td key={k} className="whitespace-nowrap py-2 pr-3">
                  {tampilNilai(k, r[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200 font-semibold">
            {kolom.map((k, i) => (
              <td key={k} className="whitespace-nowrap py-2 pr-3">
                {i === 0
                  ? // Kolom pertama tetap menampilkan nilainya kalau bisa dijumlahkan (mis. tabel per kategori).
                    k in total
                    ? `TOTAL · ${tampilNilai(k, total[k])}`
                    : 'TOTAL'
                  : k in total
                    ? tampilNilai(k, total[k])
                    : !adaTotal && i === kolom.length - 1
                      ? `${rows.length} baris`
                      : ''}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const toneStat = (k: string, n: number): 'netral' | 'hijau' | 'merah' | 'kuning' => {
  if (k === 'masuk' || k === 'pendapatan' || k === 'laba' || k === 'laba_kotor' || k === 'laba_bersih') {
    return n < 0 ? 'merah' : 'hijau';
  }
  if (k === 'keluar' || k === 'biaya' || k === 'saldo' || k === 'sisa' || k === 'hutang' || k === 'piutang') {
    return n < 0 ? 'merah' : 'kuning';
  }
  return 'netral';
};

/**
 * Ringkasan di atas tabel: angka/teks jadi kartu Stat, daftar dan objek bersarang
 * (mis. `by_kategori`, `metode_bayar`) jadi tabel kecil.
 */
export function Ringkasan({
  ringkas,
  sembunyi = [],
}: {
  ringkas: Record<string, unknown>;
  /** Nama kolom/angka yang tidak ditampilkan (lihat `TabelLaporan`). */
  sembunyi?: string[];
}) {
  const isi = Object.entries(ringkas).filter(
    ([k, v]) =>
      !KOLOM_SEMBUNYI.test(k) && !sembunyi.includes(k) && v !== null && v !== undefined && v !== '',
  );
  const skalar = isi.filter(([, v]) => typeof v === 'number' || typeof v === 'string') as [string, number | string][];
  const daftar = isi.filter(([, v]) => Array.isArray(v) && (v as unknown[]).length > 0) as [
    string,
    Record<string, unknown>[],
  ][];
  const objek = isi.filter(
    ([, v]) => typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length > 0,
  ) as [string, Record<string, unknown>][];
  if (!skalar.length && !daftar.length && !objek.length) return null;

  return (
    <>
      {skalar.length > 0 && (
        <Card title="Ringkasan">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {skalar.map(([k, v]) => (
              <Stat
                key={k}
                label={judulKolom(k)}
                nilai={tampilNilai(k, v)}
                tone={typeof v === 'number' ? toneStat(k, v) : 'netral'}
              />
            ))}
          </div>
        </Card>
      )}
      {[...objek.map(([k, o]) => [k, [o]] as [string, Record<string, unknown>[]]), ...daftar].map(([k, v]) => (
        <Card key={k} title={judulKolom(k)}>
          <TabelLaporan rows={v} sembunyi={sembunyi} />
        </Card>
      ))}
    </>
  );
}
