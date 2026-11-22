import { create } from 'zustand';
import { api, ApiError, TERBUKA_KEY, TOKEN_KEY, USER_KEY } from './api';
import type { AuthUser } from './types';

function bacaUserTersimpan(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  /** true setelah percobaan /me pertama selesai (online maupun offline). */
  siap: boolean;
  masuk: (username: string, password: string) => Promise<void>;
  keluar: () => Promise<void>;
  muatUlangUser: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  token: localStorage.getItem(TOKEN_KEY),
  user: bacaUserTersimpan(),
  siap: false,

  async masuk(username, password) {
    const res = await api.post<{ token: string; user: AuthUser }>('/login', { username, password });
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    sessionStorage.setItem(TERBUKA_KEY, '1');
    set({ token: res.token, user: res.user, siap: true });
  },

  async keluar() {
    try {
      await api.post('/logout');
    } catch {
      // Offline / token sudah mati: tetap keluar secara lokal.
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(TERBUKA_KEY);
    set({ token: null, user: null });
  },

  async muatUlangUser() {
    if (!get().token) {
      set({ siap: true });
      return;
    }
    const lupakanSesi = () => {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      set({ token: null, user: null, siap: true });
    };

    // Aplikasi baru dibuka (tab/PWA baru): kredensial wajib diketik lagi walau token tersimpan
    // masih sah, supaya siapa pun yang memegang perangkat tidak memakai sesi orang sebelumnya.
    const sudahDibuka = sessionStorage.getItem(TERBUKA_KEY) === '1';

    // Pengecualian: perangkat memang tidak punya jaringan, sehingga login mustahil. Sesi
    // tersimpan dipakai supaya kasir tetap bisa melayani pembeli secara offline.
    if (!sudahDibuka && !navigator.onLine) {
      sessionStorage.setItem(TERBUKA_KEY, '1');
      set({ siap: true });
      return;
    }

    try {
      const res = await api.getSilent<{ user: AuthUser }>('/me');
      localStorage.setItem(USER_KEY, JSON.stringify(res.user));
      if (!sudahDibuka) {
        lupakanSesi();
        return;
      }
      set({ user: res.user, siap: true });
    } catch (err) {
      // Server MENOLAK token (kedaluwarsa, dicabut, atau akun dinonaktifkan): sesi benar-benar
      // berakhir. Tanpa cabang ini, token mati yang masih tersimpan di localStorage tetap
      // membuka aplikasi lewat URL apa pun, hanya dengan API yang gagal 401 di belakangnya.
      if (err instanceof ApiError && err.status === 401) {
        lupakanSesi();
        return;
      }
      // Server tidak menjawab. Sesi yang sudah dibuka di tab ini tetap lanjut supaya muat ulang
      // di tengah gangguan tidak mengunci kasir; aplikasi yang baru dibuka harus lewat login.
      if (sudahDibuka) {
        set({ siap: true });
        return;
      }
      lupakanSesi();
    }
  },
}));

interface SyncState {
  menarik: boolean;
  lastSyncAt: number | null;
  error: string | null;
  set: (p: Partial<Omit<SyncState, 'set'>>) => void;
}

export const useSync = create<SyncState>((set) => ({
  menarik: false,
  lastSyncAt: null,
  error: null,
  set: (p) => set(p),
}));
