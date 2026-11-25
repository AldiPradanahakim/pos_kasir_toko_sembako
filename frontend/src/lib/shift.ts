import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '../api';
import type { KasShift, Shift } from '../types';
import { useOnline } from './useOnline';

/**
 * Shift kas disimpan di localStorage supaya layar kasir tahu "kas sudah dibuka" walau
 * sedang offline (toko tetap bisa jual saat internet mati). Server tetap sumber kebenaran
 * saat online: shift lokal yang belum terdaftar didaftarkan sekali, lalu id server dipakai.
 *
 * ponytail: shift offline tidak punya rekap selisih (kas_seharusnya hanya dari server),
 * jadi tutup kas butuh koneksi. Naikkan ke antrean Dexie kalau toko mulai tutup kas offline.
 */
const KEY = 'th_shift';

export interface ShiftLokal {
  id: number | null;
  dibuka_pada: string;
  modal_awal: number;
  kas_seharusnya?: number;
  kas_masuk?: number;
  kas_keluar?: number;
  transaksi?: number;
  omzet?: number;
  rincian?: KasShift[];
}

const baca = (): ShiftLokal | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ShiftLokal) : null;
  } catch {
    return null;
  }
};

let adaShiftLokal = baca() !== null;
const pendengarShift = new Set<() => void>();

const tulis = (s: ShiftLokal | null) => {
  const sebelumnyaAda = adaShiftLokal;
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
  // "Ada shift atau tidak" dibaca header di SEMUA halaman (tombol Keluar dikunci selama
  // kas terbuka), jadi perubahannya harus langsung tersiar, bukan hanya saat pindah halaman.
  adaShiftLokal = s !== null;
  if (adaShiftLokal !== sebelumnyaAda) {
    for (const f of pendengarShift) f();
    window.dispatchEvent(new Event('th-shift-berubah'));
  }
};

const dariServer = (s: Shift): ShiftLokal => ({
  id: s.id,
  dibuka_pada: s.dibuka_pada,
  modal_awal: s.modal_awal,
  kas_seharusnya: s.kas_seharusnya,
  kas_masuk: s.kas_masuk,
  kas_keluar: s.kas_keluar,
  transaksi: s.transaksi,
  omzet: s.omzet,
  rincian: s.rincian ?? [],
});

/**
 * Shift yang dibuka saat offline belum punya id server. HARUS didaftarkan sebelum
 * antrean transaksi dikuras: server menempelkan `shift_id` dari shift yang sedang
 * terbuka saat transaksi masuk, jadi transaksi yang sync lebih dulu akan tercatat
 * tanpa shift dan uangnya hilang dari rekap tutup kas (selisih jadi minus palsu).
 * Aman dipanggil berkali-kali: kalau server sudah punya shift terbuka, itu yang dipakai.
 */
export async function pastikanShiftTerdaftar(): Promise<void> {
  const lokal = baca();
  if (!lokal || lokal.id !== null) return;
  const server = await api.getSilent<Shift | null>('/shifts/aktif', 15_000);
  const s = server
    ? dariServer(server)
    : dariServer(await api.postSilent<Shift>('/shifts/buka', { modal_awal: lokal.modal_awal }, 15_000));
  tulis(s);
  // Kabari layar kasir yang sedang terbuka supaya tombol Tutup Kas langsung aktif.
  window.dispatchEvent(new Event('th-shift-berubah'));
}

export function useShift() {
  const online = useOnline();
  const [shift, setShift] = useState<ShiftLokal | null>(baca);
  const [memuat, setMemuat] = useState(true);
  const [error, setError] = useState('');

  const muat = useCallback(async () => {
    setMemuat(true);
    setError('');
    const lokal = baca();
    if (!online) {
      setShift(lokal);
      setMemuat(false);
      return;
    }
    try {
      const server = await api.getSilent<Shift | null>('/shifts/aktif');
      if (server) {
        const s = dariServer(server);
        tulis(s);
        setShift(s);
      } else if (lokal) {
        // Shift dibuka saat offline: daftarkan sekarang, modal awalnya sama.
        const dibuat = await api.post<Shift>('/shifts/buka', { modal_awal: lokal.modal_awal });
        const s = dariServer(dibuat);
        tulis(s);
        setShift(s);
      } else {
        tulis(null);
        setShift(null);
      }
    } catch (e) {
      setShift(lokal);
      setError(e instanceof Error ? e.message : 'Gagal memuat status kas');
    } finally {
      setMemuat(false);
    }
  }, [online]);

  useEffect(() => {
    void muat();
  }, [muat]);

  // Shift yang didaftarkan oleh drainQueue (lihat pastikanShiftTerdaftar) harus terbaca
  // di layar ini juga, tanpa menunggu pindah halaman.
  useEffect(() => {
    const muatUlang = () => setShift(baca());
    window.addEventListener('th-shift-berubah', muatUlang);
    return () => window.removeEventListener('th-shift-berubah', muatUlang);
  }, []);

  const buka = useCallback(async (modalAwal: number) => {
    setError('');
    const lokal: ShiftLokal = { id: null, dibuka_pada: new Date().toISOString(), modal_awal: modalAwal };
    if (!online) {
      tulis(lokal);
      setShift(lokal);
      return lokal;
    }
    const dibuat = dariServer(await api.post<Shift>('/shifts/buka', { modal_awal: modalAwal }));
    tulis(dibuat);
    setShift(dibuat);
    return dibuat;
  }, [online]);

  /**
   * Catat uang laci yang dipakai selama shift. Butuh koneksi: barisnya menempel ke shift
   * di server, dan server yang menghitung ulang "seharusnya di laci".
   */
  const catatPengeluaran = useCallback(async (jumlah: number, keterangan: string) => {
    setError('');
    const hasil = await api.post<{ shift: Shift }>('/shifts/pengeluaran', { jumlah, keterangan });
    const s = dariServer(hasil.shift);
    tulis(s);
    setShift(s);
    return s;
  }, []);

  /** Batalkan pengeluaran yang salah catat, selama kas masih terbuka. */
  const batalPengeluaran = useCallback(async (id: number) => {
    setError('');
    const hasil = await api.del<{ shift: Shift }>(`/shifts/pengeluaran/${id}`);
    const s = dariServer(hasil.shift);
    tulis(s);
    setShift(s);
    return s;
  }, []);

  const tutup = useCallback(async (uangFisik: number, catatan: string) => {
    setError('');
    const hasil = await api.post<Shift>('/shifts/tutup', { uang_fisik: uangFisik, catatan });
    tulis(null);
    setShift(null);
    return hasil;
  }, []);

  return { shift, memuat, error, online, muat, buka, tutup, catatPengeluaran, batalPengeluaran };
}

/**
 * Apakah perangkat ini sedang memegang kas terbuka.
 *
 * Dipakai header (Layout) di semua halaman: selama kas terbuka, tombol Keluar dikunci.
 * Sumbernya localStorage yang sama dengan `useShift`, bukan state per halaman — kalau
 * diambil dari state, pindah ke halaman lain membuat kuncinya hilang dan kasir bisa
 * keluar dengan kas masih terbuka.
 */
export function useKasTerbuka(): boolean {
  return useSyncExternalStore(
    (f) => {
      pendengarShift.add(f);
      // Tab lain menutup kas: localStorage berubah tanpa lewat `tulis` di tab ini.
      const dariTabLain = (e: StorageEvent) => {
        if (e.key !== KEY) return;
        adaShiftLokal = baca() !== null;
        f();
      };
      window.addEventListener('storage', dariTabLain);
      return () => {
        pendengarShift.delete(f);
        window.removeEventListener('storage', dariTabLain);
      };
    },
    () => adaShiftLokal,
    () => false,
  );
}
