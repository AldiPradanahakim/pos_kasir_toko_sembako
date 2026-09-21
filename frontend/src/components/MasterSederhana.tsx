import { useLiveQuery } from 'dexie-react-hooks';
import type { Table } from 'dexie';
import { useState } from 'react';
import { api } from '../api';
import { Alert, Button, Card, Input, Kosong, Label, Modal } from '../components/ui';
import { useOnline } from '../lib/useOnline';
import { pullSync } from '../sync';

interface Baris {
  id: number;
  name: string;
  is_active: boolean;
}

/** Halaman CRUD sederhana untuk kategori & satuan (bentuknya sama). */
export default function MasterSederhana({
  judul,
  path,
  tabel,
}: {
  judul: string;
  path: '/categories' | '/units';
  tabel: Table<Baris, number>;
}) {
  const online = useOnline();
  const [buka, setBuka] = useState(false);
  const [edit, setEdit] = useState<Baris | null>(null);
  const [name, setName] = useState('');
  const [aktif, setAktif] = useState(true);
  const [error, setError] = useState('');
  const [simpanLoading, setSimpanLoading] = useState(false);

  // Tanpa nilai awal: `undefined` berarti data lokal belum terbaca, `[]` berarti benar-benar
  // kosong. Dengan nilai awal `[]`, pesan "Belum ada data" sempat tampil padahal masih memuat.
  const rows = useLiveQuery(() => tabel.toArray(), [tabel]);
  const daftar = rows ?? [];

  function bukaTambah() {
    setEdit(null);
    setName('');
    setAktif(true);
    setError('');
    setBuka(true);
  }

  function bukaEdit(row: Baris) {
    setEdit(row);
    setName(row.name);
    setAktif(row.is_active);
    setError('');
    setBuka(true);
  }

  async function simpan(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Nama wajib diisi.');
      return;
    }
    setSimpanLoading(true);
    try {
      if (edit) await api.put(`${path}/${edit.id}`, { name: name.trim(), is_active: aktif });
      else await api.post(path, { name: name.trim(), is_active: aktif });
      await pullSync();
      setBuka(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan');
    } finally {
      setSimpanLoading(false);
    }
  }

  async function hapus(row: Baris) {
    if (!window.confirm(`Hapus "${row.name}"?`)) return;
    setError('');
    try {
      await api.del(`${path}/${row.id}`);
      await pullSync();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus');
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="min-w-0 text-lg font-semibold">{judul}</h1>
        <Button onClick={bukaTambah} disabled={!online} title={online ? '' : 'Perlu koneksi internet'}>
          + Tambah
        </Button>
      </div>

      {!online && <Alert tone="info">Perubahan data master memerlukan koneksi internet.</Alert>}
      {error && <Alert>{error}</Alert>}

      <Card>
        {/* Di HP daftar dibaca sebagai kartu; tabel lebar hanya tampil dari md ke atas
            supaya kolomnya tidak melebarkan halaman. */}
        <ul className="space-y-2 md:hidden">
          {daftar.map((row) => (
            <li key={row.id} className="min-w-0 rounded-md border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-words font-medium">{row.name}</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                    row.is_active ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {row.is_active ? 'Aktif' : 'Nonaktif'}
                </span>
              </div>
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => bukaEdit(row)}>
                  Ubah
                </Button>
                <Button variant="ghost" className="text-red-700" onClick={() => hapus(row)}>
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
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {daftar.map((row) => (
                <tr key={row.id} className="border-b border-slate-50">
                  <td className="min-w-0 break-words py-2">{row.name}</td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        row.is_active ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {row.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-2 text-right">
                    <Button variant="ghost" onClick={() => bukaEdit(row)}>
                      Ubah
                    </Button>
                    <Button variant="ghost" className="text-red-700" onClick={() => hapus(row)}>
                      Hapus
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows === undefined && <Kosong>Memuat data…</Kosong>}
        {rows?.length === 0 && <Kosong>Belum ada data. Jalankan sinkronisasi bila baru memasang aplikasi.</Kosong>}
      </Card>

      <Modal open={buka} title={edit ? `Ubah ${judul}` : `Tambah ${judul}`} onClose={() => setBuka(false)}>
        <form onSubmit={simpan} className="space-y-3">
          <div>
            <Label>Nama</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </div>
          {/* Baris checkbox dibuat setinggi 44px supaya mudah dipencet di HP. */}
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
            <Button type="submit" disabled={simpanLoading}>
              {simpanLoading ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
