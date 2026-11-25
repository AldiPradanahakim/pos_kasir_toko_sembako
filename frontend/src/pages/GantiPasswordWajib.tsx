import { useState } from 'react';
import { api } from '../api';
import { Alert, Button, Input, Label } from '../components/ui';
import { useAuth } from '../store';

/**
 * Layar yang muncul saat password akun masih password bawaan, atau baru direset superadmin.
 *
 * Password yang dipakai untuk masuk TIDAK salah — server hanya menolak semua endpoint lain
 * sampai passwordnya diganti. Karena itu teksnya menjelaskan hal itu, dan kolom pertama
 * memakai istilah "Password saat ini" (password yang baru saja diketik di halaman login).
 *
 * Salah ketik di kolom ini TIDAK mengeluarkan pengguna: permintaan dikirim sebagai `putSilent`
 * dan server menjawab 422, sehingga pesannya tampil di layar ini, bukan melempar ke /login.
 */
export default function GantiPasswordWajib() {
  const user = useAuth((s) => s.user);
  const muatUlangUser = useAuth((s) => s.muatUlangUser);
  const keluar = useAuth((s) => s.keluar);
  const [lama, setLama] = useState('');
  const [baru, setBaru] = useState('');
  const [ulangi, setUlangi] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (baru !== ulangi) {
      setError('Password baru dan ulangannya tidak sama.');
      return;
    }
    setLoading(true);
    try {
      await api.putSilent(`/users/${user?.id}`, { password: baru, password_lama: lama });
      await muatUlangUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengganti password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh justify-center overflow-y-auto bg-slate-100 p-4">
      <form onSubmit={kirim} className="my-auto w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h1 className="text-xl font-bold text-teal-800">Buat Password Baru</h1>
        <p className="mb-4 text-sm text-slate-600">
          Anda berhasil masuk. Akun <strong>{user?.username}</strong> masih memakai password bawaan
          atau password yang baru direset superadmin, jadi passwordnya harus diganti dulu sebelum
          aplikasi bisa dipakai.
        </p>
        <div className="mb-4 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
          <p className="font-medium">Aturan password baru:</p>
          <ul className="mt-1 list-inside list-disc text-slate-600">
            <li>minimal 10 karakter</li>
            <li>berisi huruf dan angka</li>
            <li>tidak sama dengan username</li>
          </ul>
        </div>

        <div className="mb-3">
          <Label>Password saat ini</Label>
          <Input
            type="password"
            value={lama}
            onChange={(e) => setLama(e.target.value)}
            autoComplete="current-password"
            required
            className="py-3"
          />
          <p className="mt-1 text-xs text-slate-500">Password yang baru saja Anda ketik di halaman masuk.</p>
        </div>
        <div className="mb-3">
          <Label>Password baru</Label>
          <Input
            type="password"
            value={baru}
            onChange={(e) => setBaru(e.target.value)}
            autoComplete="new-password"
            required
            className="py-3"
          />
        </div>
        <div className="mb-4">
          <Label>Ulangi password baru</Label>
          <Input
            type="password"
            value={ulangi}
            onChange={(e) => setUlangi(e.target.value)}
            autoComplete="new-password"
            required
            className="py-3"
          />
        </div>

        {error && (
          <div className="mb-3">
            <Alert>{error}</Alert>
          </div>
        )}

        <Button type="submit" ukuran="lg" disabled={loading} className="w-full">
          {loading ? 'Menyimpan…' : 'Simpan Password'}
        </Button>
        <Button type="button" variant="ghost" ukuran="lg" className="mt-2 w-full" onClick={() => void keluar()}>
          Keluar
        </Button>
      </form>
    </div>
  );
}
