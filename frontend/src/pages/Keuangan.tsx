import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Alert, Button, Card, Input, Kosong, Label, Modal, Select, Stat } from '../components/ui';
import { formatTanggal, parseUang, rupiah, tanggalLokal } from '../lib/format';
import { useOnline } from '../lib/useOnline';
import type { CashFlowKategori } from '../types';

/** Baris kas seperti yang dikirim server (kolom `keterangan`, bukan `note`). */
interface ArusKas {
  id: number;
  tanggal: string;
  tipe: string;
  kategori: string | null;
  jumlah: number;
  keterangan: string | null;
  /** Terisi bila baris ini lahir otomatis dari penjualan/pembelian/retur. */
  ref_type?: string | null;
  ref_id?: number | null;
  created_at?: string;
  user_name?: string | null;
  /** Saldo berjalan dari server, sudah termasuk saldo awal. */
  saldo?: number;
}

interface RingkasanArus {
  masuk: number;
  keluar: number;
  saldo: number;
  saldo_awal?: number;
  saldo_akhir?: number;
  by_kategori?: CashFlowKategori[];
}

interface FormArus {
  tanggal: string;
  tipe: string;
  kategori: string;
  jumlah: string;
  keterangan: string;
}

const LABEL_REF: Record<string, string> = {
  sale: 'Penjualan',
  purchase: 'Pembelian',
  return: 'Retur',
};

const angkaAtauNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Respons daftar: {rows, masuk, keluar, saldo_awal, saldo} — tapi terima array juga. */
function bacaDaftar(data: unknown): {
  rows: ArusKas[];
  masuk: number | null;
  keluar: number | null;
  saldoAwal: number | null;
  saldo: number | null;
} {
  const kosong = { rows: [] as ArusKas[], masuk: null, keluar: null, saldoAwal: null, saldo: null };
  if (Array.isArray(data)) return { ...kosong, rows: data as ArusKas[] };
  if (!data || typeof data !== 'object') return kosong;
  const o = data as Record<string, unknown>;
  return {
    rows: Array.isArray(o.rows) ? (o.rows as ArusKas[]) : Array.isArray(o.data) ? (o.data as ArusKas[]) : [],
    masuk: angkaAtauNull(o.masuk),
    keluar: angkaAtauNull(o.keluar),
    saldoAwal: angkaAtauNull(o.saldo_awal),
    saldo: angkaAtauNull(o.saldo),
  };
}

function bacaRingkas(data: unknown): RingkasanArus | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  const angka = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
  const masuk = angka(o.masuk);
  const keluar = angka(o.keluar);
  return {
    masuk,
    keluar,
    saldo: angka(o.saldo),
    saldo_awal: angkaAtauNull(o.saldo_awal) ?? undefined,
    saldo_akhir: angkaAtauNull(o.saldo_akhir) ?? undefined,
    by_kategori: Array.isArray(o.by_kategori) ? (o.by_kategori as CashFlowKategori[]) : [],
  };
}

/** Nama kategori bisa dikirim sebagai `kategori` atau `nama`; total sebagai `total` atau `jumlah`. */
const namaKategori = (k: CashFlowKategori): string => {
  const n = k.kategori ?? k.nama;
  return n === null || n === undefined || n === '' ? 'Tanpa kategori' : String(n);
};

const totalKategori = (k: CashFlowKategori): number => Number(k.total ?? k.jumlah ?? 0) || 0;

export default function Keuangan() {
  const online = useOnline();

  const [dari, setDari] = useState(tanggalLokal());
  const [sampai, setSampai] = useState(tanggalLokal());
  const [tipe, setTipe] = useState('');
  const [kategori, setKategori] = useState('');

  const [rows, setRows] = useState<ArusKas[]>([]);
  const [saldoAwalDaftar, setSaldoAwalDaftar] = useState<number | null>(null);
  const [ringkas, setRingkas] = useState<RingkasanArus | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [error, setError] = useState('');

  const [buka, setBuka] = useState(false);
  const [edit, setEdit] = useState<ArusKas | null>(null);
  const [form, setForm] = useState<FormArus>(() => ({
    tanggal: tanggalLokal(),
    tipe: 'masuk',
    kategori: '',
    jumlah: '',
    keterangan: '',
  }));
  const [errorForm, setErrorForm] = useState('');
  const [simpan, setSimpan] = useState(false);

  const muat = useCallback(async () => {
    const q = new URLSearchParams();
    if (dari) q.set('from', dari);
    if (sampai) q.set('to', sampai);
    if (tipe) q.set('tipe', tipe);
    if (kategori) q.set('kategori', kategori);

    // Ringkasan hanya memakai rentang tanggal, bukan filter tipe/kategori.
    const qr = new URLSearchParams();
    if (dari) qr.set('from', dari);
    if (sampai) qr.set('to', sampai);

    setError('');
    setMemuat(true);
    try {
      const daftar = bacaDaftar(await api.get<unknown>(`/cash-flows?${q}`));
      setRows(daftar.rows);
      setSaldoAwalDaftar(daftar.saldoAwal);
    } catch (err) {
      setRows([]);
      setSaldoAwalDaftar(null);
      setError(err instanceof Error ? err.message : 'Gagal memuat arus kas');
    }
    try {
      setRingkas(bacaRingkas(await api.get<unknown>(`/cash-flows/summary?${qr}`)));
    } catch (err) {
      setRingkas(null);
      // Ringkasan gagal bukan alasan menyembunyikan daftar yang sudah tampil.
      setError((lama) => lama || (err instanceof Error ? err.message : 'Gagal memuat ringkasan arus kas'));
    }
    setMemuat(false);
  }, [dari, sampai, tipe, kategori]);

  useEffect(() => {
    if (online) void muat();
  }, [muat, online]);

  const totalMasuk = rows.filter((r) => r.tipe === 'masuk').reduce((s, r) => s + (Number(r.jumlah) || 0), 0);
  const totalKeluar = rows.filter((r) => r.tipe === 'keluar').reduce((s, r) => s + (Number(r.jumlah) || 0), 0);
  const masuk = ringkas?.masuk ?? totalMasuk;
  const keluar = ringkas?.keluar ?? totalKeluar;
  const saldoAwal = saldoAwalDaftar ?? ringkas?.saldo_awal ?? 0;
  const saldoAkhir = ringkas?.saldo_akhir ?? saldoAwal + masuk - keluar;
  const rincian = ringkas?.by_kategori ?? [];

  const opsiKategori = Array.from(
    new Set([
      ...rows.map((r) => r.kategori).filter((k): k is string => !!k),
      ...rincian.map(namaKategori).filter((k) => k !== 'Tanpa kategori'),
    ]),
  ).sort((a, b) => a.localeCompare(b));

  // Server sudah mengirim saldo berjalan; hitung sendiri hanya bila tidak ada.
  const barisTampil = rows.reduce<{ r: ArusKas; saldo: number }[]>((acc, r) => {
    const saldo =
      typeof r.saldo === 'number'
        ? r.saldo
        : (acc.length ? acc[acc.length - 1].saldo : saldoAwal) + (r.tipe === 'masuk' ? r.jumlah : -r.jumlah);
    acc.push({ r, saldo });
    return acc;
  }, []);

  function bukaTambah() {
    setEdit(null);
    setForm({ tanggal: tanggalLokal(), tipe: 'masuk', kategori: '', jumlah: '', keterangan: '' });
    setErrorForm('');
    setBuka(true);
  }

  function bukaEdit(r: ArusKas) {
    setEdit(r);
    setForm({
      tanggal: r.tanggal,
      tipe: r.tipe === 'keluar' ? 'keluar' : 'masuk',
      kategori: r.kategori ?? '',
      jumlah: String(r.jumlah),
      keterangan: r.keterangan ?? '',
    });
    setErrorForm('');
    setBuka(true);
  }

  async function simpanArus(e: React.FormEvent) {
    e.preventDefault();
    setErrorForm('');
    const jumlah = parseUang(form.jumlah);
    if (!form.tanggal) {
      setErrorForm('Tanggal wajib diisi.');
      return;
    }
    if (!form.kategori.trim()) {
      setErrorForm('Kategori wajib diisi (mis. Listrik, Gaji, Setoran).');
      return;
    }
    if (jumlah <= 0) {
      setErrorForm('Jumlah harus lebih dari 0.');
      return;
    }
    setSimpan(true);
    try {
      const payload = {
        tanggal: form.tanggal,
        tipe: form.tipe,
        kategori: form.kategori.trim(),
        jumlah,
        keterangan: form.keterangan.trim() || null,
      };
      if (edit) await api.put(`/cash-flows/${edit.id}`, payload);
      else await api.post('/cash-flows', payload);
      setBuka(false);
      await muat();
    } catch (err) {
      setErrorForm(err instanceof Error ? err.message : 'Gagal menyimpan arus kas');
    } finally {
      setSimpan(false);
    }
  }

  async function hapus(r: ArusKas) {
    const label = r.tipe === 'masuk' ? 'kas masuk' : 'kas keluar';
    if (!window.confirm(`Hapus ${label} ${rupiah(r.jumlah)} (${r.kategori ?? 'tanpa kategori'})?`)) return;
    setError('');
    try {
      await api.del(`/cash-flows/${r.id}`);
      await muat();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus arus kas');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Keuangan</h1>
        <Button onClick={bukaTambah} disabled={!online}>
          + Catat Arus Kas
        </Button>
      </div>

      {!online && <Alert tone="info">Arus kas hanya bisa dibuka dan diubah saat online.</Alert>}
      {error && <Alert>{error}</Alert>}

      <Card title="Filter">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div>
            <Label>Dari tanggal</Label>
            <Input type="date" value={dari} onChange={(e) => setDari(e.target.value)} />
          </div>
          <div>
            <Label>Sampai tanggal</Label>
            <Input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} />
          </div>
          <div>
            <Label>Tipe</Label>
            <Select value={tipe} onChange={(e) => setTipe(e.target.value)}>
              <option value="">Semua</option>
              <option value="masuk">Masuk</option>
              <option value="keluar">Keluar</option>
            </Select>
          </div>
          <div>
            <Label>Kategori</Label>
            <Select value={kategori} onChange={(e) => setKategori(e.target.value)}>
              <option value="">Semua kategori</option>
              {opsiKategori.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={() => void muat()} disabled={!online || memuat}>
              {memuat ? 'Memuat…' : 'Tampilkan'}
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Saldo awal" nilai={rupiah(saldoAwal)} hint="sebelum tanggal dari" />
        <Stat label="Kas masuk" nilai={rupiah(masuk)} tone="hijau" />
        <Stat label="Kas keluar" nilai={rupiah(keluar)} tone="merah" />
        <Stat label="Saldo akhir" nilai={rupiah(saldoAkhir)} tone={saldoAkhir < 0 ? 'merah' : 'netral'} />
      </div>

      {rincian.length > 0 && (
        <Card title="Rincian per Kategori">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rincian.map((k, i) => (
              <div
                key={`${namaKategori(k)}-${i}`}
                className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2"
              >
                <span className="min-w-0 truncate text-sm">
                  {namaKategori(k)}
                  {k.tipe ? ` · ${k.tipe === 'masuk' ? 'masuk' : 'keluar'}` : ''}
                </span>
                <span className="shrink-0 text-sm font-semibold">{rupiah(totalKategori(k))}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title={`Arus Kas (${rows.length})`}>
        <p className="mb-3 text-xs text-slate-500">
          Saldo berjalan dihitung urut dari tanggal paling awal pada rentang ini. Baris bertanda "Otomatis" lahir dari
          penjualan, pembelian, atau retur — ubah lewat transaksinya.
        </p>

        {/* HP: satu kartu per entri supaya tidak perlu menggeser tabel. */}
        <div className="space-y-2 md:hidden">
          {barisTampil.map(({ r, saldo }) => (
            <div key={r.id} className="rounded-md border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.kategori || 'Tanpa kategori'}</p>
                  <p className="text-xs text-slate-500">{formatTanggal(r.tanggal)}</p>
                  {r.keterangan && <p className="mt-0.5 text-xs text-slate-500">{r.keterangan}</p>}
                </div>
                <p className={`shrink-0 text-sm font-semibold ${r.tipe === 'masuk' ? 'text-teal-700' : 'text-red-600'}`}>
                  {r.tipe === 'masuk' ? '+' : '−'}
                  {rupiah(r.jumlah)}
                </p>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-slate-500">Saldo {rupiah(saldo)}</span>
                {r.ref_type ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    Otomatis · {LABEL_REF[r.ref_type] ?? r.ref_type}
                  </span>
                ) : (
                  <div className="flex gap-1">
                    <Button variant="ghost" ukuran="sm" onClick={() => bukaEdit(r)} disabled={!online}>
                      Ubah
                    </Button>
                    <Button
                      variant="ghost"
                      ukuran="sm"
                      className="text-red-600"
                      onClick={() => void hapus(r)}
                      disabled={!online}
                    >
                      Hapus
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Tablet & desktop: tabel penuh. */}
        <div className="tabel-scroll hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-3">Tanggal</th>
                <th className="py-2 pr-3">Tipe</th>
                <th className="py-2 pr-3">Kategori</th>
                <th className="py-2 pr-3 text-right">Jumlah</th>
                <th className="py-2 pr-3 text-right">Saldo</th>
                <th className="py-2 pr-3">Catatan</th>
                <th className="py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {barisTampil.map(({ r, saldo }) => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="whitespace-nowrap py-2 pr-3">{formatTanggal(r.tanggal)}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        r.tipe === 'masuk' ? 'bg-teal-50 text-teal-700' : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {r.tipe === 'masuk' ? 'Masuk' : 'Keluar'}
                    </span>
                  </td>
                  <td className="py-2 pr-3">{r.kategori || 'Tanpa kategori'}</td>
                  <td className={`py-2 pr-3 text-right ${r.tipe === 'masuk' ? 'text-teal-700' : 'text-red-600'}`}>
                    {r.tipe === 'masuk' ? '+' : '−'}
                    {rupiah(r.jumlah)}
                  </td>
                  <td className="py-2 pr-3 text-right">{rupiah(saldo)}</td>
                  <td className="py-2 pr-3">
                    {r.keterangan ?? '-'}
                    {r.ref_type && (
                      <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        Otomatis · {LABEL_REF[r.ref_type] ?? r.ref_type}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 text-right">
                    {r.ref_type ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : (
                      <>
                        <Button variant="ghost" ukuran="sm" onClick={() => bukaEdit(r)} disabled={!online}>
                          Ubah
                        </Button>
                        <Button
                          variant="ghost"
                          ukuran="sm"
                          className="text-red-600"
                          onClick={() => void hapus(r)}
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
            {barisTampil.length > 0 && (
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold">
                  <td className="py-2 pr-3" colSpan={3}>
                    TOTAL ({barisTampil.length} entri)
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right">
                    <span className="text-teal-700">+{rupiah(totalMasuk)}</span>
                    <span className="px-1 text-slate-400">/</span>
                    <span className="text-red-600">−{rupiah(totalKeluar)}</span>
                  </td>
                  <td className="py-2 pr-3 text-right">{rupiah(saldoAkhir)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {!barisTampil.length && <Kosong>Belum ada arus kas pada rentang ini.</Kosong>}
      </Card>

      <Modal open={buka} title={edit ? 'Ubah Arus Kas' : 'Catat Arus Kas'} onClose={() => setBuka(false)} width="max-w-xl">
        <form onSubmit={simpanArus} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Tanggal</Label>
              <Input
                type="date"
                value={form.tanggal}
                onChange={(e) => setForm({ ...form, tanggal: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Tipe</Label>
              <Select value={form.tipe} onChange={(e) => setForm({ ...form, tipe: e.target.value })}>
                <option value="masuk">Kas masuk</option>
                <option value="keluar">Kas keluar</option>
              </Select>
            </div>
            <div>
              <Label>Kategori</Label>
              <Input
                value={form.kategori}
                onChange={(e) => setForm({ ...form, kategori: e.target.value })}
                placeholder="mis. Belanja, Listrik, Setoran"
                list="kategori-arus"
                required
              />
              <datalist id="kategori-arus">
                {opsiKategori.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </div>
            <div>
              <Label>Jumlah (Rp)</Label>
              <Input
                inputMode="numeric"
                value={form.jumlah}
                onChange={(e) => setForm({ ...form, jumlah: e.target.value.replace(/[^\d]/g, '') })}
                required
              />
            </div>
          </div>
          <div>
            <Label>Catatan (opsional)</Label>
            <Input
              value={form.keterangan}
              onChange={(e) => setForm({ ...form, keterangan: e.target.value })}
              placeholder="mis. bayar listrik bulan ini"
            />
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
