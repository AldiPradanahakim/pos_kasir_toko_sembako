import { useEffect, useState } from 'react';
import { api } from '../api';
import { useOnline } from './useOnline';
import type { Omzet } from '../types';

const KEY = 'th_omzet_cache';

/** Simpanan terakhir supaya kartu omset tetap ada isinya saat sinyal hilang. */
function bacaCache(): Omzet | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Omzet) : null;
  } catch {
    return null;
  }
}

/**
 * Omset hari ini / bulan ini / tahun ini untuk kartu ringkasan superadmin di halaman
 * Laporan. Hanya superadmin yang memanggil ini: endpoint `/reports/omzet` menolak kasir
 * (403), jadi jangan pasang di layar kasir.
 * Saat offline (atau server menolak) nilai terakhir yang tersimpan tetap ditampilkan
 * dan ditandai `dariCache` supaya angkanya tidak disangka angka terkini.
 */
export function useOmzet(): { data: Omzet | null; dariCache: boolean; error: string; memuat: boolean } {
  const online = useOnline();
  const [data, setData] = useState<Omzet | null>(() => bacaCache());
  const [dariCache, setDariCache] = useState(true);
  const [error, setError] = useState('');
  const [memuat, setMemuat] = useState(false);

  useEffect(() => {
    if (!online) {
      setDariCache(true);
      return;
    }
    let batal = false;
    setMemuat(true);
    api
      .getSilent<Omzet>('/reports/omzet')
      .then((d) => {
        if (batal) return;
        setData(d);
        setDariCache(false);
        setError('');
        localStorage.setItem(KEY, JSON.stringify(d));
      })
      .catch((e) => {
        if (batal) return;
        setDariCache(true);
        setError(e instanceof Error ? e.message : 'Gagal memuat omset');
      })
      .finally(() => {
        if (!batal) setMemuat(false);
      });
    return () => {
      batal = true;
    };
  }, [online]);

  return { data, dariCache, error, memuat };
}
