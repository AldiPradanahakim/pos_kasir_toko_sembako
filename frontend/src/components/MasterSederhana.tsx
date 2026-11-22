import { useLiveQuery } from 'dexie-react-hooks';
import type { Table } from 'dexie';
import { useMemo, useState } from 'react';
import { api } from '../api';
import { Alert, Button, Card, Input, Kosong, Label, Modal } from '../components/ui';
import { useOnline } from '../lib/useOnline';
import { pullSync } from '../sync';

interface Baris {
  id: number;
  name: string;
  /** Hanya satuan: singkatan yang dipakai membaca nota ("r" = renceng). */
  inisial?: string | null;
  is_active: boolean;
}

/** Halaman CRUD sederhana untuk kategori & satuan (bentuknya sama). */
export default function MasterSederhana({
  judul,
  path,
  tabel,
  cari,
  denganInisial = false,
}: {
  judul: string;
  path: '/categories' | '/units';
  tabel: Table<Baris, number>;
  /** Teks placeholder kolom pencarian; tanpa ini daftarnya tampil apa adanya. */
  cari?: string;
  /** Satuan: tampilkan kolom inisial (singkatan untuk membaca nota). */
  denganInisial?: boolean;
}) {
  const online = useOnline();
  const [buka, setBuka] = useState(false);
  const [edit, setEdit] = useState<Baris | null>(null);
  const [name, setName] = useState('');
  const [inisial, setInisial] = useState('');
  const [aktif, setAktif] = useState(true);
  const [error, setError] = useState('');
  const [simpanLoading, setSimpanLoading] = useState(false);

  // Tanpa nilai awal: `undefined` berarti data lokal belum terbaca, `[]` berarti benar-benar
  // kosong. Dengan nilai awal `[]`, pesan "Belum ada data" sempat tampil padahal masih memuat.
  const rows = useLiveQuery(() => tabel.toArray(), [tabel]);
  const [kata, setKata] = useState('');
  const daftar = useMemo(() => {
    const semua = rows ?? [];
    const q = kata.trim().toLowerCase();
    return q ? semua.filter((r) => r.name.toLowerCase().includes(q)) : semua;
  }, [rows, kata]);

  function bukaTambah() {
    setEdit(null);
    setName('');
    setInisial('');
    setAktif(true);
    setError('');
    setBuka(true);
  }

  function bukaEdit(row: Baris) {
    setEdit(row);
    setName(row.name);
    setInisial(row.inisial ?? '');
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
    // `inisial` hanya dikirim untuk satuan; kategori tidak punya kolom itu di server.
    const isi = denganInisial
      ? { name: name.trim(), inisial: inisial.trim() || null, is_active: aktif }
      : { name: name.trim(), is_active: aktif };
    try {
      if (edit) await api.put(`${path}/${edit.id}`, isi);
      else await api.post(path, isi);
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
        {cari && (
          <div className="mb-3">
            <Input
              type="search"
              value={kata}
              onChange={(e) => setKata(e.target.value)}
              placeholder={cari}
              aria-label={cari}
            />
          </div>
        )}
        {/* Di HP daftar dibaca sebagai kartu; tabel lebar hanya tampil dari md ke atas
            supaya kolomnya tidak melebarkan halaman. */}
        <ul className="space-y-2 md:hidden">
          {daftar.map((row) => (
            <li key={row.id} className="min-w-0 rounded-md border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-words font-medium">
                  {row.name}
                  {denganInisial && row.inisial && (
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">
                      ({row.inisial})
                    </span>
                  )}
                </span>
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
                {denganInisial && <th className="py-2">Inisial</th>}
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {daftar.map((row) => (
                <tr key={row.id} className="border-b border-slate-50">
                  <td className="min-w-0 break-words py-2">{row.name}</td>
                  {denganInisial && (
                    <td className="py-2 font-mono text-slate-700">{row.inisial ?? <span className="text-slate-500">—</span>}</td>
                  )}
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
        {!!rows?.length && !daftar.length && (
          <Kosong>Tidak ada {judul.toLowerCase()} yang cocok dengan pencarian "{kata.trim()}".</Kosong>
        )}
      </Card>

      <Modal open={buka} title={edit ? `Ubah ${judul}` : `Tambah ${judul}`} onClose={() => setBuka(false)}>
        <form onSubmit={simpan} className="space-y-3">
          <div>
            <Label>Nama</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </div>
          {denganInisial && (
            <div>
              <Label>Inisial (untuk membaca nota)</Label>
              <Input
                value={inisial}
                onChange={(e) => setInisial(e.target.value.replace(/[^a-zA-Z0-9/]/g, ''))}
                maxLength={4}
                placeholder="mis. r = renceng, p = pack"
                className="font-mono"
              />
              <p className="mt-1 text-xs text-slate-600">
                Satu–empat huruf, harus berbeda antar satuan. Kasir/pelanggan boleh menulis “2 (r) Beng Beng” atau
                “3 P Indomie” di nota.
              </p>
            </div>
          )}
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
