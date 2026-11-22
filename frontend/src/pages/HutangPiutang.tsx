import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Alert, Button, Card, Input, InputUang, Kosong, Label, Modal, Select, Stat } from '../components/ui';
import { formatTanggal, parseUang, rupiah, tanggalLokal } from '../lib/format';
import { useOnline } from '../lib/useOnline';
import { useAuth } from '../store';
import type { PelangganSaldo } from '../types';

/** Catatan hutang/piutang seperti yang dikirim server: `pihak`, bukan `nama`. */
interface CatatanHutang {
  id: number;
  /** 'utang' (kita yang berhutang) atau 'piutang' (pelanggan berhutang). */
  tipe: string;
  pihak: string;
  jumlah: number;
  dibayar: number;
  sisa: number;
  jatuh_tempo: string | null;
  keterangan: string | null;
  status: string | null;
  created_at?: string;
  user_name?: string | null;
}

/** Daftar bisa datang sebagai array, {data: []}, atau {rows: []}. */
function daftarDari(data: unknown): CatatanHutang[] {
  if (Array.isArray(data)) return data as CatatanHutang[];
  if (data && typeof data === 'object') {
    const o = data as { data?: unknown; rows?: unknown };
    if (Array.isArray(o.data)) return o.data as CatatanHutang[];
    if (Array.isArray(o.rows)) return o.rows as CatatanHutang[];
  }
  return [];
}

const sisaDari = (d: CatatanHutang): number => {
  if (typeof d.sisa === 'number' && Number.isFinite(d.sisa)) return Math.max(0, d.sisa);
  return Math.max(0, (Number(d.jumlah) || 0) - (Number(d.dibayar) || 0));
};

const lunas = (d: CatatanHutang): boolean => d.status === 'lunas' || sisaDari(d) <= 0;

export default function HutangPiutang() {
  /**
   * Kasir mencatat hutang/piutang baru dan pelunasan (itu pekerjaan meja kasir).
   * Mengubah nominal atau menghapus catatan adalah koreksi pembukuan: hanya superadmin.
   * Server menegakkan hal yang sama (PUT/DELETE /debts butuh superadmin).
   */
  const superadmin = useAuth((st) => st.user?.role) === 'superadmin';
  const online = useOnline();

  const [rows, setRows] = useState<CatatanHutang[]>([]);
  /** Saldo tagihan per pelanggan: yang dilihat pemilik saat menagih. */
  const [saldo, setSaldo] = useState<PelangganSaldo[]>([]);
  const [memuat, setMemuat] = useState(false);
  const [error, setError] = useState('');
  const [tipe, setTipe] = useState('');
  const [status, setStatus] = useState('');
  const [cari, setCari] = useState('');

  const [buka, setBuka] = useState(false);
  const [edit, setEdit] = useState<CatatanHutang | null>(null);
  const [formTipe, setFormTipe] = useState('utang');
  const [pihak, setPihak] = useState('');
  const [jumlah, setJumlah] = useState('');
  const [jatuhTempo, setJatuhTempo] = useState('');
  const [keterangan, setKeterangan] = useState('');
  const [errorForm, setErrorForm] = useState('');
  const [simpan, setSimpan] = useState(false);

  const [bayar, setBayar] = useState<CatatanHutang | null>(null);
  const [jumlahBayar, setJumlahBayar] = useState('');
  const [errorBayar, setErrorBayar] = useState('');
  const [proses, setProses] = useState(false);

  const muat = useCallback(async () => {
    setError('');
    setMemuat(true);
    try {
      const [daftarBon, perPelanggan] = await Promise.all([
        api.get<unknown>('/debts?limit=200'),
        api.get<{ rows: PelangganSaldo[] }>('/debts/pelanggan?tipe=piutang'),
      ]);
      setRows(daftarDari(daftarBon));
      setSaldo(perPelanggan.rows ?? []);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : 'Gagal memuat hutang & piutang');
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => {
    if (online) void muat();
  }, [muat, online]);

  const daftar = rows.filter((d) => {
    if (tipe && d.tipe !== tipe) return false;
    if (status === 'belum' && lunas(d)) return false;
    if (status === 'lunas' && !lunas(d)) return false;
    return true;
  });

  // Pencarian di memori atas baris yang sudah dimuat (server sudah mengirim 200 terakhir).
  const kata = cari.trim().toLowerCase();
  const tampil = kata
    ? daftar.filter((d) =>
        [
          d.pihak,
          d.keterangan,
          d.user_name,
          d.tipe === 'piutang' ? 'piutang' : 'hutang',
          lunas(d) ? 'lunas' : 'belum lunas',
        ].some((t) => (t ?? '').toLowerCase().includes(kata)),
      )
    : daftar;

  const belumLunasUtang = rows
    .filter((d) => d.tipe === 'utang' && !lunas(d))
    .reduce((s, d) => s + sisaDari(d), 0);
  const belumLunasPiutang = rows
    .filter((d) => d.tipe === 'piutang' && !lunas(d))
    .reduce((s, d) => s + sisaDari(d), 0);

  function bukaTambah() {
    setEdit(null);
    setFormTipe('utang');
    setPihak('');
    setJumlah('');
    setJatuhTempo('');
    setKeterangan('');
    setErrorForm('');
    setBuka(true);
  }

  function bukaEdit(d: CatatanHutang) {
    setEdit(d);
    setFormTipe(d.tipe === 'piutang' ? 'piutang' : 'utang');
    setPihak(d.pihak);
    setJumlah(String(d.jumlah));
    setJatuhTempo(d.jatuh_tempo ?? '');
    setKeterangan(d.keterangan ?? '');
    setErrorForm('');
    setBuka(true);
  }

  async function simpanCatatan(e: React.FormEvent) {
    e.preventDefault();
    setErrorForm('');
    const nominal = parseUang(jumlah);
    if (!pihak.trim()) {
      setErrorForm('Nama pihak wajib diisi.');
      return;
    }
    if (nominal <= 0) {
      setErrorForm('Jumlah harus lebih dari 0.');
      return;
    }
    if (edit && nominal < (Number(edit.dibayar) || 0)) {
      setErrorForm(`Jumlah tidak boleh lebih kecil dari yang sudah dibayar (${rupiah(edit.dibayar)}).`);
      return;
    }
    setSimpan(true);
    try {
      const payload = {
        tipe: formTipe,
        pihak: pihak.trim(),
        jumlah: nominal,
        jatuh_tempo: jatuhTempo || null,
        keterangan: keterangan.trim() || null,
      };
      if (edit) await api.put(`/debts/${edit.id}`, payload);
      else await api.post('/debts', payload);
      setBuka(false);
      await muat();
    } catch (err) {
      setErrorForm(err instanceof Error ? err.message : 'Gagal menyimpan catatan');
    } finally {
      setSimpan(false);
    }
  }

  async function simpanBayar(e: React.FormEvent) {
    e.preventDefault();
    if (!bayar) return;
    setErrorBayar('');
    const nominal = parseUang(jumlahBayar);
    const sisaKini = sisaDari(bayar);
    if (nominal <= 0) {
      setErrorBayar('Jumlah bayar harus lebih dari 0.');
      return;
    }
    if (nominal > sisaKini) {
      setErrorBayar(`Jumlah bayar melebihi sisa ${rupiah(sisaKini)}.`);
      return;
    }
    setProses(true);
    try {
      // Endpoint ini mencatat cicilan (tambahan), menulis riwayat, dan memasukkan
      // pelunasan piutang ke buku kas — bukan sekadar menimpa kolom `dibayar`.
      await api.post(`/debts/${bayar.id}/bayar`, { jumlah: nominal });
      setBayar(null);
      await muat();
    } catch (err) {
      setErrorBayar(err instanceof Error ? err.message : 'Gagal menyimpan pembayaran');
    } finally {
      setProses(false);
    }
  }

  async function hapus(d: CatatanHutang) {
    if (!window.confirm(`Hapus ${d.tipe === 'piutang' ? 'piutang' : 'hutang'} "${d.pihak}" senilai ${rupiah(d.jumlah)}?`))
      return;
    setError('');
    try {
      await api.del(`/debts/${d.id}`);
      await muat();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus catatan');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Hutang &amp; Piutang</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void muat()} disabled={!online || memuat}>
            {memuat ? 'Memuat…' : 'Muat ulang'}
          </Button>
          <Button onClick={bukaTambah} disabled={!online}>
            + Catat
          </Button>
        </div>
      </div>

      {!online && <Alert tone="info">Data hutang &amp; piutang hanya bisa dibuka dan diubah saat online.</Alert>}
      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Belum lunas (hutang)" nilai={rupiah(belumLunasUtang)} tone="merah" hint="kita yang berhutang" />
        <Stat label="Belum lunas (piutang)" nilai={rupiah(belumLunasPiutang)} tone="kuning" hint="pelanggan berhutang" />
        <Stat
          label="Total belum lunas"
          nilai={rupiah(belumLunasUtang + belumLunasPiutang)}
          className="col-span-2 sm:col-span-1"
        />
      </div>

      <Card title="Filter">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>Tipe</Label>
            <Select value={tipe} onChange={(e) => setTipe(e.target.value)}>
              <option value="">Semua</option>
              <option value="utang">Hutang (kita yang berhutang)</option>
              <option value="piutang">Piutang (pelanggan berhutang)</option>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Semua</option>
              <option value="belum">Belum lunas</option>
              <option value="lunas">Lunas</option>
            </Select>
          </div>
        </div>
      </Card>

      <Card
        title={`Piutang per Pelanggan (${saldo.length})`}
        actions={
          <span className="text-sm text-slate-600">
            Total {rupiah(saldo.reduce((a, r) => a + Number(r.sisa), 0))}
          </span>
        }
      >
        {!saldo.length ? (
          <Kosong>Belum ada pelanggan yang berutang.</Kosong>
        ) : (
          <div className="tabel-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-3">Pelanggan</th>
                  <th className="py-2 pr-3 text-right">Bon</th>
                  <th className="py-2 pr-3 text-right">Sisa</th>
                  <th className="py-2 pr-3">Bon tertua</th>
                  <th className="py-2 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {saldo.map((r) => (
                  <tr key={`${r.customer_id ?? 'x'}-${r.nama}`} className="border-b border-slate-50">
                    <td className="py-2 pr-3">
                      <p className="font-medium">{r.nama}</p>
                      {r.telepon && <p className="text-xs text-slate-500">{r.telepon}</p>}
                    </td>
                    <td className="py-2 pr-3 text-right">{r.jumlah_bon}</td>
                    <td className="py-2 pr-3 text-right font-semibold">{rupiah(Number(r.sisa))}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{formatTanggal(r.bon_tertua)}</td>
                    <td className="whitespace-nowrap py-2 text-right">
                      <Button
                        variant="ghost"
                        ukuran="sm"
                        className="text-teal-700"
                        onClick={() => {
                          setTipe('piutang');
                          setStatus('belum');
                          setCari(r.nama);
                        }}
                      >
                        Lihat bon
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Daftar (${tampil.length})`}>
        <div className="mb-3">
          <Input
            type="search"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Nama orang / supplier atau keterangan…"
            aria-label="Cari hutang piutang"
          />
        </div>

        {/* HP: kartu per catatan. */}
        <div className="space-y-2 md:hidden">
          {tampil.map((d) => (
            <div key={d.id} className="rounded-md border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{d.pihak}</p>
                  <p className="text-xs text-slate-500">
                    {d.tipe === 'piutang' ? 'Piutang' : 'Hutang'} · {formatTanggal(d.created_at)}
                  </p>
                  {d.jatuh_tempo && (
                    <p
                      className={`text-xs ${
                        !lunas(d) && d.jatuh_tempo < tanggalLokal() ? 'font-semibold text-red-700' : 'text-slate-500'
                      }`}
                    >
                      Jatuh tempo {formatTanggal(d.jatuh_tempo)}
                      {!lunas(d) && d.jatuh_tempo < tanggalLokal() ? ' (terlewat)' : ''}
                    </p>
                  )}
                  {d.keterangan && <p className="mt-0.5 text-xs text-slate-500">{d.keterangan}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-sm font-semibold ${lunas(d) ? 'text-slate-500' : 'text-slate-800'}`}>
                    {rupiah(sisaDari(d))}
                  </p>
                  <p className="text-xs text-slate-500">dari {rupiah(d.jumlah)}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    lunas(d) ? 'bg-teal-50 text-teal-700' : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {lunas(d) ? 'Lunas' : `Dibayar ${rupiah(d.dibayar ?? 0)}`}
                </span>
                <div className="flex gap-1">
                  {!lunas(d) && (
                    <Button
                      variant="secondary"
                      ukuran="sm"
                      onClick={() => {
                        setBayar(d);
                        setJumlahBayar('');
                        setErrorBayar('');
                      }}
                      disabled={!online}
                    >
                      Bayar
                    </Button>
                  )}
                  {superadmin && (
                    <>
                      <Button variant="ghost" ukuran="sm" onClick={() => bukaEdit(d)} disabled={!online}>
                        Ubah
                      </Button>
                      <Button
                        variant="ghost"
                        ukuran="sm"
                        className="text-red-700"
                        onClick={() => void hapus(d)}
                        disabled={!online}
                      >
                        Hapus
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Tablet & desktop: tabel penuh. */}
        <div className="tabel-scroll hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-3">Tipe</th>
                <th className="py-2 pr-3">Pihak</th>
                <th className="py-2 pr-3 text-right">Jumlah</th>
                <th className="py-2 pr-3 text-right">Dibayar</th>
                <th className="py-2 pr-3 text-right">Sisa</th>
                <th className="py-2 pr-3">Jatuh tempo</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {tampil.map((d) => (
                <tr key={d.id} className="border-b border-slate-50">
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        d.tipe === 'piutang' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-800'
                      }`}
                    >
                      {d.tipe === 'piutang' ? 'Piutang' : 'Hutang'}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <p className="font-medium">{d.pihak}</p>
                    {d.keterangan && <p className="text-xs text-slate-500">{d.keterangan}</p>}
                  </td>
                  <td className="py-2 pr-3 text-right">{rupiah(d.jumlah)}</td>
                  <td className="py-2 pr-3 text-right">{rupiah(d.dibayar ?? 0)}</td>
                  <td className="py-2 pr-3 text-right font-medium">{rupiah(sisaDari(d))}</td>
                  <td className="whitespace-nowrap py-2 pr-3">
                    {d.jatuh_tempo ? (
                      <span className={!lunas(d) && d.jatuh_tempo < tanggalLokal() ? 'font-semibold text-red-700' : ''}>
                        {formatTanggal(d.jatuh_tempo)}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        lunas(d) ? 'bg-teal-50 text-teal-700' : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {lunas(d) ? 'Lunas' : 'Belum lunas'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-2 text-right">
                    {!lunas(d) && (
                      <Button
                        variant="ghost"
                        ukuran="sm"
                        className="text-teal-700"
                        onClick={() => {
                          setBayar(d);
                          setJumlahBayar('');
                          setErrorBayar('');
                        }}
                        disabled={!online}
                      >
                        Bayar
                      </Button>
                    )}
                    {superadmin && (
                      <>
                        <Button variant="ghost" ukuran="sm" onClick={() => bukaEdit(d)} disabled={!online}>
                          Ubah
                        </Button>
                        <Button
                          variant="ghost"
                          ukuran="sm"
                          className="text-red-700"
                          onClick={() => void hapus(d)}
                          disabled={!online}
                        >
                          Hapus
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!daftar.length && <Kosong>Belum ada catatan hutang atau piutang.</Kosong>}
        {!!daftar.length && !tampil.length && (
          <Kosong>Tidak ada catatan yang cocok dengan pencarian "{cari.trim()}".</Kosong>
        )}
      </Card>

      <Modal
        open={buka}
        title={edit ? `Ubah ${formTipe === 'piutang' ? 'Piutang' : 'Hutang'}` : 'Catat Hutang / Piutang'}
        onClose={() => setBuka(false)}
        width="max-w-xl"
      >
        <form onSubmit={simpanCatatan} className="space-y-3">
          <div>
            <Label>Tipe</Label>
            <Select value={formTipe} onChange={(e) => setFormTipe(e.target.value)}>
              <option value="utang">Hutang (kita yang berhutang)</option>
              <option value="piutang">Piutang (pelanggan berhutang)</option>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Nama pihak</Label>
              <Input
                value={pihak}
                onChange={(e) => setPihak(e.target.value)}
                placeholder="mis. Toko Grosir Jaya / Bu Ani"
                required
              />
            </div>
            <div>
              <Label>Jumlah (Rp)</Label>
              <InputUang nilai={jumlah} onNilai={setJumlah} required />
            </div>
            <div>
              <Label>Jatuh tempo (opsional)</Label>
              <Input type="date" value={jatuhTempo} onChange={(e) => setJatuhTempo(e.target.value)} />
            </div>
            <div>
              <Label>Catatan (opsional)</Label>
              <Input value={keterangan} onChange={(e) => setKeterangan(e.target.value)} />
            </div>
          </div>

          {edit && (
            <p className="text-xs text-slate-500">
              Sudah dibayar {rupiah(edit.dibayar ?? 0)} · sisa {rupiah(sisaDari(edit))}. Pembayaran dicatat lewat tombol
              "Bayar".
            </p>
          )}
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

      <Modal open={!!bayar} title="Catat Pembayaran" onClose={() => setBayar(null)} width="max-w-md">
        {bayar && (
          <form onSubmit={simpanBayar} className="space-y-3">
            <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
              <p className="font-medium">{bayar.pihak}</p>
              <p className="text-xs text-slate-500">
                {bayar.tipe === 'piutang' ? 'Piutang' : 'Hutang'} · jumlah {rupiah(bayar.jumlah)}
              </p>
              <p className="text-xs text-slate-500">
                Sudah dibayar {rupiah(bayar.dibayar ?? 0)} · sisa {rupiah(sisaDari(bayar))}
              </p>
            </div>
            <div>
              <Label>Jumlah bayar (Rp)</Label>
              <InputUang nilai={jumlahBayar} onNilai={setJumlahBayar} autoFocus required />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                ukuran="sm"
                onClick={() => setJumlahBayar(String(sisaDari(bayar)))}
              >
                Lunasi ({rupiah(sisaDari(bayar))})
              </Button>
              <Button
                type="button"
                variant="secondary"
                ukuran="sm"
                onClick={() => setJumlahBayar(String(Math.floor(sisaDari(bayar) / 2)))}
              >
                Setengah
              </Button>
            </div>

            {errorBayar && <Alert>{errorBayar}</Alert>}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setBayar(null)}>
                Batal
              </Button>
              <Button type="submit" disabled={proses}>
                {proses ? 'Menyimpan…' : 'Simpan Pembayaran'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
