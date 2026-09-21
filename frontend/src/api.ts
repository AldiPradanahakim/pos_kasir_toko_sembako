export const TOKEN_KEY = 'th_token';
export const USER_KEY = 'th_user';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type Options = {
  method?: string;
  body?: unknown;
  /** lewati redirect otomatis ke /login saat 401 (dipakai proses sync background). */
  silent?: boolean;
};

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: opts.method ?? 'GET', headers, body });
  } catch {
    throw new ApiError(0, 'Tidak dapat menghubungi server. Periksa koneksi.');
  }

  if (res.status === 401) {
    if (!opts.silent) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      if (window.location.pathname !== '/login') window.location.replace('/login');
    }
    throw new ApiError(401, 'Sesi berakhir, silakan masuk ulang.');
  }

  const teks = await res.text();
  let data: unknown = null;
  if (teks) {
    try {
      data = JSON.parse(teks);
    } catch {
      data = teks;
    }
  }

  if (!res.ok) {
    const pesan =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : typeof data === 'string' && data
          ? data
          : `Gagal (${res.status})`;
    throw new ApiError(res.status, pesan);
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body ?? {} }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /** Varian untuk proses background: tidak memaksa logout saat 401. */
  postSilent: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body, silent: true }),
  getSilent: <T>(path: string) => request<T>(path, { silent: true }),
  /** Unduh berkas (CSV) lewat fetch supaya header Authorization tetap terkirim. */
  unduh: (path: string, namaBerkas: string) => unduhBerkas(path, namaBerkas),
};

async function unduhBerkas(path: string, namaBerkas: string): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const teks = await res.text();
    throw new ApiError(res.status, teks || `Gagal mengunduh (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = namaBerkas;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
