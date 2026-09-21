import { api, ApiError, TOKEN_KEY } from './api';
import { db, LAST_SYNC_KEY, type DbProductUnit, type DbReceipt } from './db';
import { displayStok, nomorOffline } from './lib/format';
import { useSync } from './store';
import type { MetodeBayar, Product, Sale, SyncPull } from './types';

/** UUID v4, crypto.randomUUID hanya ada di secure context, sedangkan toko sering akses via IP LAN. */
function uuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface KeranjangItem {
  product_id: number;
  name: string;
  unit_id: number;
  unit_name: string;
  isi: number;
  qty: number;
  harga: number;
  harga_asli: number;
  alasan_ubah_harga: string;
}

/** Tarik seluruh master data dari server dan timpa isi Dexie. Gagal = data lama tetap dipakai. */
export async function pullSync(): Promise<boolean> {
  useSync.getState().set({ menarik: true, error: null });
  try {
    const data = await api.getSilent<SyncPull>('/sync/pull');

    const products: Product[] = (data.products ?? []).map((p) => ({
      ...p,
      category_name: p.category_name ?? null,
      // Urutkan dari satuan terkecil: default pilihan di kasir jadi satuan dasar (pcs),
      // bukan satuan terbesar yang urutannya kebetulan datang dari server.
      units: [...(p.units ?? [])].sort((a, b) => a.isi - b.isi),
    }));
    const productUnits: DbProductUnit[] = products.flatMap((p) =>
      (p.units ?? []).map((u) => ({
        product_id: p.id,
        unit_id: u.unit_id,
        unit_name: u.unit_name,
        isi: u.isi,
        harga_jual: u.harga_jual,
        harga_modal: u.harga_modal,
        barcode: u.barcode ?? null,
      })),
    );

    await db.transaction(
      'rw',
      [db.categories, db.units, db.products, db.productUnits, db.cachedStock, db.settings],
      async () => {
        await db.categories.clear();
        await db.categories.bulkPut(data.categories ?? []);
        await db.units.clear();
        await db.units.bulkPut(data.units ?? []);
        await db.products.clear();
        await db.products.bulkPut(products);
        await db.productUnits.clear();
        await db.productUnits.bulkPut(productUnits);
        await db.cachedStock.clear();
        await db.cachedStock.bulkPut(data.stock ?? []);
        const settingRows = Object.entries(data.settings ?? {}).map(([key, value]) => ({
          key,
          value: value == null ? '' : String(value),
        }));
        await db.settings.clear();
        await db.settings.bulkPut(settingRows);
      },
    );

    const now = Date.now();
    await db.settings.put({ key: LAST_SYNC_KEY, value: String(now) });
    // Transaksi yang masih mengantre belum ada di stok server, jadi pengurangannya harus
    // dipasang ulang supaya tampilan stok tidak melompat balik ke nilai lama.
    await terapkanPendingKeStok();
    useSync.getState().set({ menarik: false, lastSyncAt: now, error: null });
    return true;
  } catch (e) {
    useSync.getState().set({ menarik: false, error: e instanceof Error ? e.message : 'Gagal sinkronisasi' });
    return false;
  }
}

/**
 * Stok server belum memuat transaksi yang masih mengantre, jadi kurangi lagi salinan lokal
 * dengan qty transaksi berstatus `pending` (yang `gagal` tidak dihitung: server sudah menolaknya,
 * sehingga nilai server memang yang benar).
 */
async function terapkanPendingKeStok(): Promise<void> {
  const antre = await db.pendingSales.where('status').equals('pending').toArray();
  if (!antre.length) return;

  const unitRows = await db.productUnits.toArray();
  const isiDari = new Map(unitRows.map((u) => [`${u.product_id}:${u.unit_id}`, u.isi]));
  const kurang = new Map<number, number>();
  for (const p of antre) {
    for (const it of p.payload.items) {
      const isi = isiDari.get(`${it.product_id}:${it.unit_id}`) ?? 1;
      kurang.set(it.product_id, (kurang.get(it.product_id) ?? 0) + it.qty * isi);
    }
  }

  for (const [product_id, delta] of kurang) {
    const row = await db.cachedStock.get(product_id);
    if (!row) continue;
    const stok_base = row.stok_base - delta;
    await db.cachedStock.put({
      ...row,
      stok_base,
      minus: stok_base < 0,
      display: displayStok(
        stok_base,
        unitRows.filter((u) => u.product_id === product_id),
      ),
    });
  }
}

let sedangKuras = false;

/**
 * Kirim antrean transaksi lokal ke server: berurutan, satu per satu.
 * - Sukses  -> hapus dari antrean, simpan no_struk server.
 * - Ditolak server (400/422) -> tandai gagal, lanjut ke antrean berikutnya.
 * - Gangguan jaringan -> berhenti, sisa antrean dicoba lagi nanti (urutan tetap).
 */
export async function drainQueue(): Promise<void> {
  if (sedangKuras || !navigator.onLine || !localStorage.getItem(TOKEN_KEY)) return;
  sedangKuras = true;
  try {
    for (;;) {
      const antre = await db.pendingSales.where('status').equals('pending').sortBy('created_at');
      const item = antre[0];
      if (!item) break;
      try {
        const res = await api.postSilent<{ sale: Sale; duplicate: boolean }>('/sales', item.payload);
        await db.transaction('rw', db.pendingSales, db.receipts, async () => {
          await db.receipts.update(item.uuid, {
            no_struk: res.sale.no_struk ?? item.uuid,
            sale_id: res.sale.id ?? null,
            pending: false,
          });
          await db.pendingSales.delete(item.uuid);
        });
      } catch (e) {
        if (e instanceof ApiError && (e.status === 400 || e.status === 422)) {
          await db.pendingSales.update(item.uuid, { status: 'gagal', error: e.message });
          continue;
        }
        break;
      }
    }
  } finally {
    sedangKuras = false;
  }
}

/** Simpan transaksi: lokal dulu (offline-first), baru diposting ke server. */
export async function simpanPenjualan(args: {
  items: KeranjangItem[];
  metode_bayar: MetodeBayar;
  dibayar: number;
  kasir: string;
  nama_pelanggan?: string;
}): Promise<{ uuid: string; no_struk: string }> {
  const { items, metode_bayar, dibayar, kasir } = args;
  const namaPelanggan = args.nama_pelanggan?.trim() ? args.nama_pelanggan.trim() : null;
  const now = new Date();
  const uuid = uuidV4();
  const no_struk = nomorOffline(now);
  const created_at = now.toISOString();
  const total = items.reduce((s, it) => s + it.harga * it.qty, 0);
  const kembalian = dibayar - total;

  const payload = {
    uuid,
    items: items.map((it) => ({
      product_id: it.product_id,
      unit_id: it.unit_id,
      qty: it.qty,
      harga: it.harga,
      ...(it.harga !== it.harga_asli
        ? { harga_diubah: true, alasan_ubah_harga: it.alasan_ubah_harga }
        : {}),
    })),
    metode_bayar,
    dibayar,
    created_at,
    nama_pelanggan: namaPelanggan,
  };

  const struk: DbReceipt = {
    uuid,
    no_struk,
    sale_id: null,
    created_at,
    kasir_name: kasir,
    metode_bayar,
    dibayar,
    kembalian,
    total,
    pending: true,
    nama_pelanggan: namaPelanggan,
    items: items.map((it) => ({
      product_id: it.product_id,
      name: it.name,
      unit_name: it.unit_name,
      qty: it.qty,
      harga: it.harga,
      subtotal: it.harga * it.qty,
      alasan_ubah_harga: it.harga !== it.harga_asli ? it.alasan_ubah_harga : null,
    })),
  };

  await db.transaction('rw', db.pendingSales, db.receipts, db.cachedStock, db.productUnits, async () => {
    await db.pendingSales.put({ uuid, created_at, status: 'pending', payload });
    await db.receipts.put(struk);
    for (const it of items) {
      const row = await db.cachedStock.get(it.product_id);
      if (!row) continue;
      const stok_base = row.stok_base - it.qty * it.isi;
      const units = await db.productUnits.where('product_id').equals(it.product_id).toArray();
      await db.cachedStock.update(it.product_id, {
        stok_base,
        minus: stok_base < 0,
        display: displayStok(stok_base, units),
      });
    }
  });

  void drainQueue();
  return { uuid, no_struk };
}

let timer: number | undefined;
let sudahMulai = false;

/** Sinkronisasi otomatis: saat app dibuka, saat kembali online, dan tiap 30 detik. */
export function mulaiSync(): void {
  if (sudahMulai) return;
  sudahMulai = true;

  const siklus = async () => {
    // Tanpa token (halaman login) jangan memanggil API sama sekali: dulu ini memicu
    // 401 di konsol setiap kali halaman login dibuka. Halaman Login sendiri yang
    // menarik master data tepat setelah berhasil masuk.
    if (!localStorage.getItem(TOKEN_KEY)) return;
    await drainQueue();
    if (navigator.onLine) await pullSync();
  };

  void siklus();
  window.addEventListener('online', () => void siklus());
  timer = window.setInterval(() => void siklus(), 30_000);
  window.addEventListener('beforeunload', () => window.clearInterval(timer));
}
