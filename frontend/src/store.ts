import { create } from 'zustand';
import { api, TOKEN_KEY, USER_KEY } from './api';
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
    set({ token: null, user: null });
  },

  async muatUlangUser() {
    if (!get().token) {
      set({ siap: true });
      return;
    }
    try {
      const res = await api.getSilent<{ user: AuthUser }>('/me');
      localStorage.setItem(USER_KEY, JSON.stringify(res.user));
      set({ user: res.user });
    } catch {
      // Offline: pakai data user yang tersimpan supaya aplikasi tetap jalan.
    }
    set({ siap: true });
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
