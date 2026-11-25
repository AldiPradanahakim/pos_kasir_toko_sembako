import { useSyncExternalStore } from 'react';

/**
 * Status "Online" = jaringan perangkat ada DAN server benar-benar menjawab.
 *
 * `navigator.onLine` saja tidak cukup: nilainya hanya "ada antarmuka jaringan", bukan
 * "server terjangkau". Di toko ini server berjalan di komputer jaringan lokal, jadi PC
 * server yang mati (atau Wi-Fi yang pindah jaringan) tetap membuat navigator bilang online
 * padahal aplikasi tidak bisa memuat apa pun — penanda di layar akan berbohong, dan kasir
 * baru sadar setelah transaksi gagal.
 *
 * Karena itu ada denyut ke `GET /api/health`:
 * - tiap 15 detik selama tab terlihat,
 * - segera setelah perangkat melaporkan jaringan kembali,
 * - segera saat tab kembali terlihat (HP sering menidurkan timer di latar belakang).
 *
 * Satu denyut dipakai bersama semua komponen (modul ini), bukan satu timer per pemanggil.
 */
const JEDA_DENYUT_MS = 15_000;
const BATAS_DENYUT_MS = 4_000;

let serverHidup = true;
let sedangDenyut = false;
const pendengar = new Set<() => void>();

function beritahu() {
  for (const f of pendengar) f();
}

async function denyut() {
  if (sedangDenyut) return;
  // Jaringan perangkat sudah mati: tidak perlu menembak apa pun.
  if (!navigator.onLine) {
    if (serverHidup) {
      serverHidup = false;
      beritahu();
    }
    return;
  }
  sedangDenyut = true;
  try {
    // `cache: 'no-store'` supaya service worker tidak menjawab dari cache: yang diuji
    // adalah server, bukan isi cache.
    const res = await fetch('/api/health', {
      cache: 'no-store',
      signal: AbortSignal.timeout(BATAS_DENYUT_MS),
    });
    const hidup = res.ok;
    if (hidup !== serverHidup) {
      serverHidup = hidup;
      beritahu();
    }
  } catch {
    if (serverHidup) {
      serverHidup = false;
      beritahu();
    }
  } finally {
    sedangDenyut = false;
  }
}

let jumlahPemakai = 0;
let timer: number | null = null;

function mulai() {
  jumlahPemakai += 1;
  if (jumlahPemakai > 1) return;

  window.addEventListener('online', denyut);
  window.addEventListener('offline', denyut);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void denyut();
  });
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') void denyut();
  }, JEDA_DENYUT_MS);
  void denyut();
}

function berhenti() {
  jumlahPemakai -= 1;
  if (jumlahPemakai > 0) return;
  window.removeEventListener('online', denyut);
  window.removeEventListener('offline', denyut);
  if (timer) clearInterval(timer);
  timer = null;
}

function langganan(f: () => void) {
  pendengar.add(f);
  mulai();
  return () => {
    pendengar.delete(f);
    berhenti();
  };
}

function bacaStatus(): boolean {
  return navigator.onLine && serverHidup;
}

/**
 * Dipakai semua layar: `true` berarti perangkat online DAN server menjawab.
 * Nilai awalnya mengikuti `navigator.onLine`, lalu dikoreksi hasil denyut pertama.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(langganan, bacaStatus, () => true);
}
