import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Alert, Button, Card, Input, Kosong, Label, Modal } from '../components/ui';
import { rupiah } from '../lib/format';
import { useOnline } from '../lib/useOnline';

interface Pelanggan {
  id: number;
  nama: string;
  telepon: string | null;
  catatan: string | null;
  is_active: boolean;
  jumlah_transaksi: number;
  sisa_piutang: number;
}

/**
 * Master pelanggan. Barisnya sudah terbuat sendiri saat kasir mengisi nama di bon;
 * halaman ini untuk merapikan (nama/telepon) dan menonaktifkan yang sudah tidak datang.
 */
export default function PelangganPage() {
  const online = useOnline();
  const [rows, setRows] = useState<Pelanggan[]>([]);
  const [memuat, setMemuat] = useState(false);
  const [error, setError] = useState('');
  const [cari, setCari] = useState('');
  const [hanyaAktif, setHanyaAktif] = useState(true);

  const [buka, setBuka] = useState(false);
  const [edit, setEdit] = useState<Pelanggan | null>(null);
  const [nama, setNama] = useState('');
  const [telepon, setTelepon] = useState('');
  const [catatan, setCatatan] = useState('');
  const [errorForm, setErrorForm] = useState('');
  const [simpan, setSimpan] = useState(false);

  const muat = useCallback(async () => {
    setError('');
    setMemuat(true);
    try {
      const q = new URLSearchParams({ limit: '500' });
      if (cari.trim()) q.set('q', cari.trim());
      if (hanyaAktif) q.set('aktif', 'true');
      setRows(await api.get<Pelanggan[]>(`/customers?${q}`));
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : 'Gagal memuat pelanggan');
    } finally {
      setMemuat(false);
    }
  }, [cari, hanyaAktif]);

  useEffect(() => {
    if (online) void muat();
  }, [muat, online]);

  function bukaTambah() {
    setEdit(null);
    setNama('');
    setTelepon('');
    setCatatan('');
    setErrorForm('');
    setBuka(true);
  }

  function bukaEdit(p: Pelanggan) {
    setEdit(p);
    setNama(p.nama);
    setTelepon(p.telepon ?? '');
    setCatatan(p.catatan ?? '');
    setErrorForm('');
    setBuka(true);
  }

  async function simpanForm(e: React.FormEvent) {
    e.preventDefault();
    setErrorForm('');
    if (!nama.trim()) {
      setErrorForm('Nama wajib diisi.');
      return;
    }
    setSimpan(true);
    try {
      const payload = {
        nama: nama.trim(),
        telepon: telepon.trim() || null,
        catatan: catatan.trim() || null,
        is_active: edit ? edit.is_active : true,
      };
      if (edit) await api.put(`/customers/${edit.id}`, payload);
      else await api.post('/customers', payload);
      setBuka(false);
      await muat();
    } catch (err) {
      setErrorForm(err instanceof Error ? err.message : 'Gagal menyimpan pelanggan');
    } finally {
      setSimpan(false);
    }
  }

  async function nonaktifkan(p: Pelanggan) {
    if (!window.confirm(`Nonaktifkan pelanggan "${p.nama}"? Riwayat bon dan transaksinya tetap tersimpan.`)) return;
    setError('');
    try {
      await api.del(`/customers/${p.id}`);
      await muat();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menonaktifkan pelanggan');
    }
  }

  const totalPiutang = rows.reduce((a, r) => a + Number(r.sisa_piutang ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Pelanggan</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void muat()} disabled={!online || memuat}>
            {memuat ? 'Memuat…' : 'Muat ulang'}
          </Button>
          <Button onClick={bukaTambah} disabled={!online}>
            + Pelanggan
          </Button>
        </div>
      </div>

      {!online && <Alert tone="info">Data pelanggan hanya bisa dibuka dan diubah saat online.</Alert>}
      {error && <Alert>{error}</Alert>}

      <Card title={`Daftar (${rows.length})`} actions={<span className="text-sm text-slate-600">Piutang {rupiah(totalPiutang)}</span>}>
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            type="search"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Cari nama atau telepon…"
            aria-label="Cari pelanggan"
          />
          <Button variant={hanyaAktif ? 'secondary' : 'ghost'} onClick={() => setHanyaAktif(!hanyaAktif)}>
            {hanyaAktif ? 'Aktif saja' : 'Semua'}
          </Button>
        </div>

        {!rows.length ? (
          <Kosong>Belum ada pelanggan. Nama yang diketik di bon kasir otomatis tercatat di sini.</Kosong>
        ) : (
          <div className="tabel-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-3">Nama</th>
                  <th className="py-2 pr-3">Telepon</th>
                  <th className="py-2 pr-3 text-right">Transaksi</th>
                  <th className="py-2 pr-3 text-right">Sisa Piutang</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50">
                    <td className="py-2 pr-3">
                      <p className="font-medium">{p.nama}</p>
                      {p.catatan && <p className="text-xs text-slate-500">{p.catatan}</p>}
                    </td>
                    <td className="py-2 pr-3">{p.telepon || '-'}</td>
                    <td className="py-2 pr-3 text-right">{p.jumlah_transaksi}</td>
                    <td className={`py-2 pr-3 text-right font-medium ${Number(p.sisa_piutang) > 0 ? 'text-amber-800' : ''}`}>
                      {rupiah(Number(p.sisa_piutang))}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          p.is_active ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {p.is_active ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-2 text-right">
                      <Button variant="ghost" ukuran="sm" onClick={() => bukaEdit(p)} disabled={!online}>
                        Ubah
                      </Button>
                      {p.is_active && (
                        <Button
                          variant="ghost"
                          ukuran="sm"
                          className="text-red-700"
                          onClick={() => void nonaktifkan(p)}
                          disabled={!online}
                        >
                          Nonaktifkan
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={buka} title={edit ? 'Ubah Pelanggan' : 'Pelanggan Baru'} onClose={() => setBuka(false)} width="max-w-md">
        <form onSubmit={simpanForm} className="space-y-3">
          <div>
            <Label>Nama</Label>
            <Input value={nama} onChange={(e) => setNama(e.target.value)} required autoFocus />
          </div>
          <div>
            <Label>Telepon (opsional)</Label>
            <Input inputMode="tel" value={telepon} onChange={(e) => setTelepon(e.target.value)} />
          </div>
          <div>
            <Label>Catatan (opsional)</Label>
            <Input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. langganan, bayar tiap awal bulan" />
          </div>
          {errorForm && <Alert>{errorForm}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setBuka(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={simpan}>
              {simpan ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
