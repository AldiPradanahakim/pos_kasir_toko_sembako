export type Role = 'kasir' | 'superadmin';

export interface AuthUser {
  id: number;
  name: string;
  username: string;
  role: Role;
}

export interface UserRow extends AuthUser {
  is_active: boolean;
}

export interface Category {
  id: number;
  name: string;
  is_active: boolean;
}

export interface Unit {
  id: number;
  name: string;
  is_active: boolean;
}

export interface ProductUnit {
  id?: number;
  unit_id: number;
  unit_name: string;
  isi: number;
  harga_jual: number;
  harga_modal: number;
  barcode: string | null;
}

export interface Product {
  id: number;
  name: string;
  category_id: number | null;
  category_name: string | null;
  base_unit: string;
  barcode: string | null;
  is_active: boolean;
  units: ProductUnit[];
}

export interface StockRow {
  product_id: number;
  name: string;
  base_unit: string;
  stok_base: number;
  display: string;
  minus: boolean;
}

export interface StockMovement {
  id: number;
  product_id: number;
  product_name: string;
  type: 'masuk' | 'keluar' | 'penyesuaian' | 'pembatalan' | string;
  qty_base: number;
  note: string | null;
  user_name: string | null;
  created_at: string;
  reference_type: string | null;
  reference_id: number | null;
}

/** Toko hanya menerima tunai; QRIS dan transfer dihapus. */
export type MetodeBayar = 'tunai';

export interface SaleItemPayload {
  product_id: number;
  unit_id: number;
  qty: number;
  harga: number;
  harga_diubah?: boolean;
  alasan_ubah_harga?: string | null;
}

export interface SalePayload {
  uuid: string;
  items: SaleItemPayload[];
  metode_bayar: MetodeBayar;
  dibayar: number;
  created_at: string;
  nama_pelanggan?: string | null;
}

export interface SaleItem {
  id?: number;
  product_id: number;
  product_name?: string | null;
  unit_id: number;
  unit_name: string;
  qty: number;
  harga_snapshot: number;
  subtotal: number;
  harga_diubah?: boolean;
  alasan_ubah_harga?: string | null;
}

export interface Sale {
  id: number;
  uuid: string;
  no_struk: string | null;
  user_id?: number;
  /** Hanya ada di respons detail (GET /sales/:id, /sales/by-uuid/:uuid, POST /sales). */
  user?: { id: number; name: string } | null;
  user_name?: string | null;
  total: number;
  metode_bayar: MetodeBayar;
  dibayar: number;
  kembalian: number;
  status: 'selesai' | 'dibatalkan';
  alasan_batal?: string | null;
  nama_pelanggan?: string | null;
  created_at: string;
  items?: SaleItem[];
}

export interface SettingsMap {
  toko_nama: string;
  alamat: string;
  telepon: string;
}

/* ---------- Fitur baru ---------- */

export interface OmzetBucket {
  total: number;
  transaksi: number;
}

export interface Omzet {
  hari_ini: OmzetBucket;
  bulan_ini: OmzetBucket;
  tahun_ini: OmzetBucket;
}

export type TipeArus = 'masuk' | 'keluar';

export interface CashFlow {
  id: number;
  tanggal: string;
  tipe: TipeArus | string;
  kategori: string | null;
  jumlah: number;
  note: string | null;
  user_name?: string | null;
  created_at?: string;
}

export interface CashFlowKategori {
  kategori: string | null;
  tipe?: string | null;
  total?: number;
  jumlah?: number;
  [key: string]: unknown;
}

export interface CashFlowSummary {
  masuk: number;
  keluar: number;
  saldo: number;
  by_kategori?: CashFlowKategori[];
}

export interface PurchaseItem {
  id?: number;
  product_id: number;
  product_name?: string | null;
  unit_id: number;
  unit_name?: string | null;
  qty: number;
  /** Isi satuan saat pembelian dicatat; qty_base = isi_snapshot × qty. */
  isi_snapshot?: number;
}

export interface Purchase {
  id: number;
  tanggal: string;
  supplier: string | null;
  note: string | null;
  /** Selalu 0 sejak pembelian tidak lagi memakai harga (ditinggalkan server untuk klien lama). */
  total?: number;
  /** Jumlah baris barang pada nota (hanya di daftar `GET /purchases`). */
  items_count?: number;
  user_name?: string | null;
  created_at?: string;
  items?: PurchaseItem[];
}

export interface Debt {
  id: number;
  tipe: 'hutang' | 'piutang' | string;
  nama: string;
  jumlah: number;
  dibayar?: number;
  sisa?: number;
  tanggal?: string | null;
  jatuh_tempo?: string | null;
  status?: string | null;
  note?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

export interface ReturItem {
  id?: number;
  product_id: number;
  product_name?: string | null;
  unit_id?: number | null;
  unit_name?: string | null;
  qty: number;
  harga?: number;
  subtotal?: number;
  [key: string]: unknown;
}

export interface Retur {
  id: number;
  tipe: string;
  sale_id?: number | null;
  purchase_id?: number | null;
  no_struk?: string | null;
  tanggal: string;
  total?: number;
  note?: string | null;
  user_name?: string | null;
  created_at?: string;
  items?: ReturItem[];
  [key: string]: unknown;
}

export interface StockOpname {
  id: number;
  product_id: number;
  product_name?: string | null;
  stok_sistem: number;
  stok_fisik: number;
  selisih: number;
  note?: string | null;
  user_name?: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface ProductAlias {
  id: number;
  alias: string;
  product_id: number;
  product_name?: string | null;
  [key: string]: unknown;
}

export interface StockInBulkResult {
  ok: boolean;
  applied: number;
  movements?: unknown[];
  [key: string]: unknown;
}

export interface SyncPull {
  server_time: string;
  categories: Category[];
  units: Unit[];
  products: Product[];
  settings: Partial<SettingsMap>;
  stock: StockRow[];
}

export interface DailyReport {
  date?: string;
  total_omzet?: number;
  total_transaksi?: number;
  total_laba?: number;
  total_item?: number;
  [key: string]: unknown;
}

export interface SalesReportRow {
  date?: string;
  total?: number;
  jumlah?: number;
  [key: string]: unknown;
}

export interface ProfitReportRow {
  date?: string;
  omzet?: number;
  laba_kotor?: number;
  [key: string]: unknown;
}

export interface PriceChangeReportRow {
  created_at?: string;
  no_struk?: string | null;
  product_name?: string;
  unit_name?: string;
  harga_normal?: number;
  harga_diubah?: number;
  qty?: number;
  alasan_ubah_harga?: string | null;
  user_name?: string | null;
  [key: string]: unknown;
}
