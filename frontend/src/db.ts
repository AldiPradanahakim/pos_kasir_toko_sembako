import Dexie, { type Table } from 'dexie';
import type {
  Category,
  MetodeBayar,
  Product,
  SaleItemPayload,
  SettingsMap,
  StockRow,
  Unit,
} from './types';

/** Baris satuan produk yang diratakan, untuk pencarian barcode super cepat. */
export interface DbProductUnit {
  product_id: number;
  unit_id: number;
  unit_name: string;
  isi: number;
  harga_jual: number;
  harga_modal: number;
  barcode: string | null;
}

export interface DbSetting {
  key: string;
  value: string;
}

export interface DbPendingSale {
  uuid: string;
  created_at: string;
  status: 'pending' | 'gagal';
  error?: string;
  payload: {
    uuid: string;
    items: SaleItemPayload[];
    metode_bayar: MetodeBayar;
    dibayar: number;
    created_at: string;
    /** Nama pelanggan (opsional) — dicatat supaya bisa ditagih/dicari nanti. */
    nama_pelanggan?: string | null;
  };
}

/** Salinan struk lokal supaya struk bisa dibuka/dicetak walau offline. */
export interface DbReceipt {
  uuid: string;
  no_struk: string;
  sale_id: number | null;
  created_at: string;
  kasir_name: string;
  metode_bayar: MetodeBayar;
  dibayar: number;
  kembalian: number;
  total: number;
  pending: boolean;
  nama_pelanggan?: string | null;
  items: {
    product_id: number;
    name: string;
    unit_name: string;
    qty: number;
    harga: number;
    subtotal: number;
    alasan_ubah_harga?: string | null;
  }[];
}

class PosDatabase extends Dexie {
  categories!: Table<Category, number>;
  units!: Table<Unit, number>;
  products!: Table<Product, number>;
  productUnits!: Table<DbProductUnit, [number, number]>;
  settings!: Table<DbSetting, string>;
  pendingSales!: Table<DbPendingSale, string>;
  cachedStock!: Table<StockRow, number>;
  receipts!: Table<DbReceipt, string>;

  constructor() {
    super('toko-hakim-pos');
    this.version(1).stores({
      categories: 'id, name',
      units: 'id, name',
      products: 'id, name, barcode, category_id',
      productUnits: '[product_id+unit_id], barcode, product_id, unit_id',
      settings: 'key',
      pendingSales: 'uuid, status, created_at',
      cachedStock: 'product_id, name',
      receipts: 'uuid, created_at',
    });
  }
}

export const db = new PosDatabase();

export const LAST_SYNC_KEY = '_last_sync_at';

const SETTING_DEFAULT: SettingsMap = {
  toko_nama: 'Toko Hakim',
  alamat: '',
  telepon: '',
};

export async function bacaSettings(): Promise<SettingsMap> {
  const rows = await db.settings.toArray();
  const out: Record<string, string> = { ...SETTING_DEFAULT };
  for (const r of rows) out[r.key] = r.value;
  return out as unknown as SettingsMap;
}
