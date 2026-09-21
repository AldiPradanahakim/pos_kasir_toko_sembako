import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Input, Label } from '../components/ui';
import { useAuth } from '../store';
import { pullSync } from '../sync';

export default function Login() {
  const masuk = useAuth((s) => s.masuk);
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await masuk(username.trim(), password);
      // Perangkat baru: tarik master data segera, jangan tunggu siklus 30 detik.
      void pullSync();
      navigate('/kasir', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk');
    } finally {
      setLoading(false);
    }
  }

  // dvh (bukan vh) supaya saat keyboard HP terbuka kartu tetap terlihat & bisa digeser.
  return (
    <div className="flex min-h-dvh justify-center overflow-y-auto bg-slate-100 p-4">
      <form
        onSubmit={kirim}
        className="my-auto w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
      >
        <h1 className="text-xl font-bold text-teal-800">Toko Hakim</h1>
        <p className="mb-5 text-sm text-slate-500">Masuk ke aplikasi kasir</p>

        <div className="mb-3">
          <Label>Username</Label>
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            className="py-3"
          />
        </div>
        <div className="mb-4">
          <Label>Password</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
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
          {loading ? 'Memproses…' : 'Masuk'}
        </Button>
      </form>
    </div>
  );
}
