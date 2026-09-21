import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Alert, Button, Card, Input, Kosong, Label, Modal, Select } from '../components/ui';
import { useOnline } from '../lib/useOnline';
import { useAuth } from '../store';
import type { UserRow } from '../types';

export default function Users() {
  const online = useOnline();
  const saya = useAuth((s) => s.user);

  const [rows, setRows] = useState<UserRow[]>([]);
  const [error, setError] = useState('');
  const [buka, setBuka] = useState(false);
  const [edit, setEdit] = useState<UserRow | null>(null);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'kasir' | 'superadmin'>('kasir');
  const [aktif, setAktif] = useState(true);

  const muat = useCallback(async () => {
    if (!online) return;
    setError('');
    try {
      const data = await api.get<UserRow[] | { data: UserRow[] }>('/users');
      setRows(Array.isArray(data) ? data : (data.data ?? []));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat pengguna');
    }
  }, [online]);

  useEffect(() => {
    void muat();
  }, [muat]);

  function bukaTambah() {
    setEdit(null);
    setName('');
    setUsername('');
    setPassword('');
    setRole('kasir');
    setAktif(true);
    setError('');
    setBuka(true);
  }

  function bukaEdit(row: UserRow) {
    setEdit(row);
    setName(row.name);
    setUsername(row.username);
    setPassword('');
    setRole(row.role);
    setAktif(row.is_active);
    setError('');
    setBuka(true);
  }

  async function simpan(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim() || !username.trim()) {
      setError('Nama dan username wajib diisi.');
      return;
    }
    if (!edit && password.length < 6) {
      setError('Password minimal 6 karakter.');
      return;
    }
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        username: username.trim(),
        role,
        is_active: aktif,
      };
      if (password) payload.password = password;
      if (edit) await api.put(`/users/${edit.id}`, payload);
      else await api.post('/users', payload);
      await muat();
      setBuka(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan pengguna');
    } finally {
      setLoading(false);
    }
  }

  async function hapus(row: UserRow) {
    if (!window.confirm(`Hapus pengguna "${row.name}"?`)) return;
    setError('');
    try {
      await api.del(`/users/${row.id}`);
      await muat();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menghapus pengguna');
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="min-w-0 text-lg font-semibold">Pengguna</h1>
        <Button onClick={bukaTambah} disabled={!online}>
          + Tambah Pengguna
        </Button>
      </div>

      {!online && <Alert tone="info">Manajemen pengguna hanya bisa dibuka saat online.</Alert>}
      {error && <Alert>{error}</Alert>}

      <Card title={`Daftar Pengguna (${rows.length})`}>
        {/* Di HP dibaca sebagai kartu; tabelnya hanya muncul dari md ke atas. */}
        <ul className="space-y-2 md:hidden">
          {rows.map((u) => (
            <li key={u.id} className="min-w-0 rounded-md border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-words font-medium">
                  {u.name}
                  {u.id === saya?.id && <span className="ml-2 text-xs text-slate-500">(Anda)</span>}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                    u.is_active ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {u.is_active ? 'Aktif' : 'Nonaktif'}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {u.username} · {u.role === 'superadmin' ? 'Superadmin' : 'Kasir'}
              </p>
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => bukaEdit(u)}>
                  Ubah
                </Button>
                <Button
                  variant="ghost"
                  className="text-red-700"
                  onClick={() => hapus(u)}
                  disabled={u.id === saya?.id}
                  title={u.id === saya?.id ? 'Tidak dapat menghapus akun sendiri' : ''}
                >
                  Hapus
                </Button>
              </div>
            </li>
          ))}
        </ul>

        <div className="tabel-scroll hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <th className="py-2">Nama</th>
                <th className="py-2">Username</th>
                <th className="py-2">Role</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-b border-slate-50">
                  <td className="min-w-0 break-words py-2 font-medium">
                    {u.name}
                    {u.id === saya?.id && <span className="ml-2 text-xs text-slate-500">(Anda)</span>}
                  </td>
                  <td className="py-2">{u.username}</td>
                  <td className="py-2">{u.role === 'superadmin' ? 'Superadmin' : 'Kasir'}</td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        u.is_active ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {u.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-2 text-right">
                    <Button variant="ghost" onClick={() => bukaEdit(u)}>
                      Ubah
                    </Button>
                    <Button
                      variant="ghost"
                      className="text-red-700"
                      onClick={() => hapus(u)}
                      disabled={u.id === saya?.id}
                      title={u.id === saya?.id ? 'Tidak dapat menghapus akun sendiri' : ''}
                    >
                      Hapus
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <Kosong>{online ? 'Belum ada pengguna.' : 'Menyambung ke server…'}</Kosong>}
      </Card>

      <Modal open={buka} title={edit ? `Ubah Pengguna: ${edit.name}` : 'Tambah Pengguna'} onClose={() => setBuka(false)}>
        <form onSubmit={simpan} className="space-y-3">
          <div>
            <Label>Nama lengkap</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div>
            <Label>Username</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div>
            <Label>{edit ? 'Password baru (kosongkan bila tidak diganti)' : 'Password'}</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required={!edit}
              autoComplete="new-password"
            />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onChange={(e) => setRole(e.target.value as 'kasir' | 'superadmin')}>
              <option value="kasir">Kasir</option>
              <option value="superadmin">Superadmin</option>
            </Select>
          </div>
          {/* Baris checkbox setinggi 44px supaya nyaman dipencet di HP. */}
          <label className="flex min-h-sentuh cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0"
              checked={aktif}
              onChange={(e) => setAktif(e.target.checked)}
            />
            Aktif
          </label>

          {error && <Alert>{error}</Alert>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setBuka(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
