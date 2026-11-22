import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import CariSelect from '../components/CariSelect';
import Pagination, { potongHalaman } from '../components/Pagination';
import { Alert, Button, Card, Input, Kosong, Label, Modal, Select, Stat } from '../components/ui';
import { bacaSettings, db } from '../db';
import { formatTanggal, formatTanggalJam, parseUang, tanggalLokal } from '../lib/format';
import { useOnline } from '../lib/useOnline';
import { useAuth } from '../store';
import type { Product, Purchase } from '../types';

interface BarisBeli {
  product_id: string;
  unit_id: string;
  qty: string;
}

const barisKosong = (): BarisBeli => ({ product_id: '', unit_id: '', qty: '1' });

/* Bentuk respons GET /reports/purchase-suggestions. Tipe lokal: hanya halaman ini pemakainya. */
interface SaranItem {
  product_id: number;
  nama: string;
  stok_base: number;
  stok_display: string;
  satuan_hitung: string;
  satuan_hitung_isi: number;
  stok_hitung: number;
  terjual: number;
  rata_per_hari: number;
  /** null = belum pernah terjual dalam jendela analisis. */
  hari_tersisa: number | null;
  saran_qty: number;
  alasan: string;
}

interface HasilSaran {
  hari: number;
  ambang: number;
  items: SaranItem[];
}

const PILIHAN_HARI = [7, 14, 30, 60, 90];
const PILIHAN_AMBANG = [3, 7, 14, 30];

const angka = (n: number | null | undefined): string => Number(n || 0).toLocaleString('id-ID');

/** Sama presisinya dengan server (dua desimal), tanpa nol ekor: 2,03 · 2,5 · 30. */
const desimal = (n: number): string => n.toLocaleString('id-ID', { maximumFractionDigits: 2 });

/** Daftar bisa datang sebagai array, {data: []}, atau {rows: []}. */
function daftarDari(data: unknown): Purchase[] {
  if (Array.isArray(data)) return data as Purchase[];
  if (data && typeof data === 'object') {
    const o = data as { data?: unknown; rows?: unknown };
    if (Array.isArray(o.data)) return o.data as Purchase[];
    if (Array.isArray(o.rows)) return o.rows as Purchase[];
  }
  return [];
}

export default function Pembelian() {
  /**
   * Kasir mencatat barang masuk dari supplier (barang datang saat dia jaga). Menghapus
   * pembelian membalik stok yang sudah tercatat, jadi koreksi itu milik superadmin saja —
   * server menegakkan hal yang sama (DELETE /purchases butuh superadmin).
   */
  const superadmin = useAuth((st) => st.user?.role) === 'superadmin';
  const online = useOnline();
  const products = useLiveQuery(() => db.products.toArray(), [], [] as Product[]);
  const setting = useLiveQuery(() => bacaSettings(), []);

  const [dari, setDari] = useState(tanggalLokal());
  const [sampai, setSampai] = useState(tanggalLokal());
  const [rows, setRows] = useState<Purchase[]>([]);
  const [memuat, setMemuat] = useState(false);
  const [error, setError] = useState('');
  const [cariBeli, setCariBeli] = useState('');

  const [buka, setBuka] = useState(false);
  const [tanggal, setTanggal] = useState(tanggalLokal());
  const [supplier, setSupplier] = useState('');
  const [note, setNote] = useState('');
  const [baris, setBaris] = useState<BarisBeli[]>([barisKosong()]);
  const [errorForm, setErrorForm] = useState('');
  const [simpan, setSimpan] = useState(false);

  const [detail, setDetail] = useState<Purchase | null>(null);
  const [detailMemuat, setDetailMemuat] = useState(false);
  const [cariItem, setCariItem] = useState('');

  const [saranHari, setSaranHari] = useState('30');
  const [saranAmbang, setSaranAmbang] = useState('7');
  const [saran, setSaran] = useState<HasilSaran | null>(null);
  const [saranMemuat, setSaranMemuat] = useState(false);
  const [saranError, setSaranError] = useState('');
  const [saranPesan, setSaranPesan] = useState('');
  const [saranKata, setSaranKata] = useState('');
  const [saranHalaman, setSaranHalaman] = useState(1);
  const [saranPerHalaman, setSaranPerHalaman] = useState(20);

  const opsiProduk = useMemo(() => products.map((p) => ({ value: p.id, label: p.name })), [products]);

  const muat = useCallback(async () => {
    const q = new URLSearchParams();
    if (dari) q.set('from', dari);
    if (sampai) q.set('to', sampai);
    q.set('limit', '200');
    setError('');
    setMemuat(true);
    try {
      setRows(daftarDari(await api.get<unknown>(`/purchases?${q}`)));
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : 'Gagal memuat pembelian');
    } finally {
      setMemuat(false);
    }
  }, [dari, sampai]);

  useEffect(() => {
    if (online) void muat();
  }, [muat, online]);

  // Pembelian dicatat tanpa harga: yang bisa direkap hanya jumlah nota dan jumlah barang.
  const totalItem = rows.reduce((s, r) => s + (Number(r.items_count) || 0), 0);

  // Pencarian di memori atas nota yang sudah dimuat: supplier, tanggal, jumlah item, catatan.
  const kataBeli = cariBeli.trim().toLowerCase();
  const rowsTampil = kataBeli
    ? rows.filter((r) =>
        `${r.supplier ?? ''} ${formatTanggal(r.tanggal)} ${r.items_count ?? ''} ${r.note ?? ''}`
          .toLowerCase()
          .includes(kataBeli),
      )
    : rows;

  const kataSaran = saranKata.trim().toLowerCase();
  const saranTersaring = saran
    ? kataSaran
      ? saran.items.filter((it) =>
          `${it.nama} ${it.stok_display} ${it.satuan_hitung} ${it.terjual} ${it.alasan}`
            .toLowerCase()
            .includes(kataSaran),
        )
      : saran.items
    : [];
  const saranTampil = potongHalaman(saranTersaring, saranHalaman, saranPerHalaman);

  const kataItem = cariItem.trim().toLowerCase();
  const itemTampil = (detail?.items ?? []).filter(
    (it) => !kataItem || `${it.product_name ?? ''} ${it.unit_name ?? ''}`.toLowerCase().includes(kataItem),
  );

  async function muatSaran() {
    setSaranError('');
    setSaranPesan('');
    setSaranMemuat(true);
    try {
      setSaran(
        await api.get<HasilSaran>(`/reports/purchase-suggestions?hari=${saranHari}&ambang=${saranAmbang}`),
      );
      setSaranKata('');
      setSaranHalaman(1);
    } catch (e) {
      setSaran(null);
      setSaranError(e instanceof Error ? e.message : 'Gagal memuat saran pembelian');
    } finally {
      setSaranMemuat(false);
    }
  }

  async function unduhSaran() {
    if (!saran) return;
    setSaranError('');
    setSaranPesan('');
    try {
      await api.unduh(`/reports/purchase-suggestions.csv?hari=${saran.hari}&ambang=${saran.ambang}`, 'saran-pembelian.csv');
      setSaranPesan('Berkas saran-pembelian.csv berhasil diunduh.');
    } catch (e) {
      setSaranError(e instanceof Error ? e.message : 'Gagal mengunduh berkas');
    }
  }

  function bukaTambah() {
    setTanggal(tanggalLokal());
    setSupplier('');
    setNote('');
    setBaris([barisKosong()]);
    setErrorForm('');
    setBuka(true);
  }

  function ubahBaris(idx: number, patch: Partial<BarisBeli>) {
    setBaris((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  }

  async function simpanBeli(e: React.FormEvent) {
    e.preventDefault();
    setErrorForm('');
    if (!tanggal) {
      setErrorForm('Tanggal wajib diisi.');
      return;
    }
    if (!baris.length) {
      setErrorForm('Minimal satu item harus diisi.');
      return;
    }
    for (const [i, b] of baris.entries()) {
      if (!b.product_id) {
        setErrorForm(`Baris ${i + 1}: produk belum dipilih.`);
        return;
      }
      if (!b.unit_id) {
        setErrorForm(`Baris ${i + 1}: satuan belum dipilih.`);
        return;
      }
      const qty = parseUang(b.qty);
      if (!Number.isInteger(qty) || qty <= 0) {
        setErrorForm(`Baris ${i + 1}: qty harus bilangan bulat lebih dari 0.`);
        return;
      }
    }

    setSimpan(true);
    try {
      await api.post('/purchases', {
        tanggal,
        supplier: supplier.trim() || null,
        note: note.trim() || null,
        items: baris.map((b) => ({
          product_id: Number(b.product_id),
          unit_id: Number(b.unit_id),
          qty: parseUang(b.qty),
        })),
      });
      setBuka(false);
      await muat();
    } catch (err) {
      setErrorForm(err instanceof Error ? err.message : 'Gagal menyimpan pembelian');
    } finally {
      setSimpan(false);
    }
  }

  async function bukaDetail(id: number) {
    setError('');
    setCariItem('');
    setDetailMemuat(true);
    try {
      const data = await api.get<Purchase | { purchase: Purchase }>(`/purchases/${id}`);
      setDetail('purchase' in data ? data.purchase : data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat detail pembelian');
    } finally {
      setDetailMemuat(false);
    }
  }

  async function hapus(r: Purchase) {
    if (
      !window.confirm(
        `Hapus pembelian ${formatTanggal(r.tanggal)} (${r.items_count ?? 0} item)? Stok barang dikembalikan otomatis.`,
      )
    )
      return;
    setError('');
    try {
      await api.del(`/purchases/${r.id}`);
      await muat();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus pembelian');
    }
  }

  return (
    <div className="space-y-4">
      {/* Seluruh tampilan layar disembunyikan saat mencetak; yang tercetak hanya daftar saran
          di bawah (`.area-laporan`), sama seperti mekanisme cetak di halaman Struk/Laporan. */}
      <div className="no-print space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">Pembelian</h1>
          <div className="flex flex-wrap gap-2">
            <Link to="/stok/scan">
              <Button variant="secondary">Scan struk supplier</Button>
            </Link>
            <Button onClick={bukaTambah} disabled={!online}>
              + Pembelian Baru
            </Button>
          </div>
        </div>

        {!online && <Alert tone="info">Data pembelian hanya bisa dibuka dan diubah saat online.</Alert>}
        {error && <Alert>{error}</Alert>}

        <Card title="Filter">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label>Dari tanggal</Label>
              <Input type="date" value={dari} onChange={(e) => setDari(e.target.value)} />
            </div>
            <div>
              <Label>Sampai tanggal</Label>
              <Input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button className="w-full" onClick={() => void muat()} disabled={!online || memuat}>
                {memuat ? 'Memuat…' : 'Tampilkan'}
              </Button>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-2">
          <Stat label="Jumlah nota" nilai={rows.length.toLocaleString('id-ID')} />
          <Stat label="Jumlah item" nilai={totalItem.toLocaleString('id-ID')} tone="kuning" />
        </div>

        <Card title={`Daftar Pembelian (${rowsTampil.length})`}>
          <p className="mb-3 text-xs text-slate-500">
            Pembelian dicatat tanpa harga: cukup nama barang dan jumlahnya. Stok produk bertambah otomatis di server
            saat pembelian disimpan. Gunakan "Scan struk supplier" untuk mengisi item dari foto struk.
          </p>

          {rows.length > 0 && (
            <div className="mb-3">
              <Input
                type="search"
                value={cariBeli}
                onChange={(e) => setCariBeli(e.target.value)}
                placeholder="Cari supplier, tanggal, atau jumlah item…"
                aria-label="Cari pembelian"
              />
            </div>
          )}

          {/* HP: kartu per nota. */}
          <div className="space-y-2 md:hidden">
            {rowsTampil.map((r) => (
              <div key={r.id} className="rounded-md border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.supplier || 'Tanpa supplier'}</p>
                    <p className="text-xs text-slate-500">{formatTanggal(r.tanggal)}</p>
                    {r.note && <p className="mt-0.5 text-xs text-slate-500">{r.note}</p>}
                  </div>
                  <p className="shrink-0 text-sm font-semibold">{r.items_count ?? 0} item</p>
                </div>
                <div className="mt-2 flex items-center justify-end gap-1">
                  <Button variant="ghost" ukuran="sm" onClick={() => void bukaDetail(r.id)} disabled={!online}>
                    Detail
                  </Button>
                  {superadmin && (
                    <Button
                      variant="ghost"
                      ukuran="sm"
                      className="text-red-700"
                      onClick={() => void hapus(r)}
                      disabled={!online}
                    >
                      Hapus
                    </Button>
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
                  <th className="py-2 pr-3">Supplier</th>
                  <th className="py-2 pr-3 text-right">Item</th>
                  <th className="py-2 pr-3">Catatan</th>
                  <th className="py-2 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rowsTampil.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50">
                    <td className="whitespace-nowrap py-2 pr-3">{formatTanggal(r.tanggal)}</td>
                    <td className="py-2 pr-3">{r.supplier || 'Tanpa supplier'}</td>
                    <td className="py-2 pr-3 text-right">{r.items_count ?? '-'}</td>
                    <td className="py-2 pr-3">{r.note ?? '-'}</td>
                    <td className="whitespace-nowrap py-2 text-right">
                      <Button variant="ghost" ukuran="sm" onClick={() => void bukaDetail(r.id)} disabled={!online}>
                        Detail
                      </Button>
                      {superadmin && (
                        <Button
                          variant="ghost"
                          ukuran="sm"
                          className="text-red-700"
                          onClick={() => void hapus(r)}
                          disabled={!online}
                        >
                          Hapus
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {rowsTampil.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-200 font-semibold">
                    <td className="py-2 pr-3" colSpan={2}>
                      TOTAL
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {rowsTampil.reduce((s, r) => s + (Number(r.items_count) || 0), 0).toLocaleString('id-ID')}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {!rows.length ? (
            <Kosong>Belum ada pembelian pada rentang ini.</Kosong>
          ) : !rowsTampil.length ? (
            <Kosong>Tidak ada pembelian yang cocok dengan pencarian "{cariBeli.trim()}".</Kosong>
          ) : null}
        </Card>

        <Card title="Saran Pembelian">
          <p className="mb-3 text-xs text-slate-500">
            Saran dihitung dari penjualan pada jendela analisis dan target hari persediaan. Hasilnya bisa dicetak
            sebagai daftar belanja atau diunduh sebagai CSV.
          </p>

          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
            <div>
              <Label>Jendela penjualan</Label>
              <Select value={saranHari} onChange={(e) => setSaranHari(e.target.value)}>
                {PILIHAN_HARI.map((n) => (
                  <option key={n} value={n}>
                    {n} hari terakhir
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Target persediaan</Label>
              <Select value={saranAmbang} onChange={(e) => setSaranAmbang(e.target.value)}>
                {PILIHAN_AMBANG.map((n) => (
                  <option key={n} value={n}>
                    Stok untuk {n} hari
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Button className="w-full" onClick={() => void muatSaran()} disabled={!online || saranMemuat}>
                {saranMemuat ? 'Memuat…' : 'Muat Saran'}
              </Button>
            </div>
          </div>

          <div className="mt-3 space-y-3">
            {saranError && <Alert>{saranError}</Alert>}
            {saranPesan && <Alert tone="sukses">{saranPesan}</Alert>}

            {!saran ? (
              <Kosong>Tekan "Muat Saran" untuk menghitung barang yang perlu dibeli.</Kosong>
            ) : !saran.items.length ? (
              <Kosong>Tidak ada barang yang perlu dibeli sekarang.</Kosong>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => window.print()}>
                    Cetak Saran
                  </Button>
                  <Button variant="secondary" onClick={() => void unduhSaran()} disabled={!online}>
                    Unduh CSV
                  </Button>
                </div>

                <Input
                  type="search"
                  value={saranKata}
                  onChange={(e) => {
                    setSaranKata(e.target.value);
                    setSaranHalaman(1);
                  }}
                  placeholder="Cari barang di saran…"
                  aria-label="Cari barang di saran pembelian"
                />

                {!saranTampil.length ? (
                  <Kosong>Tidak ada barang yang cocok dengan pencarian "{saranKata.trim()}".</Kosong>
                ) : (
                  <>
                    {/* HP: satu kartu per barang; tabelnya punya delapan kolom. */}
                    <div className="space-y-2 md:hidden">
                      {saranTampil.map((it) => (
                        <div
                          key={it.product_id}
                          className={`rounded-md border border-slate-200 p-3 ${
                            it.hari_tersisa === null ? 'bg-slate-50' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="min-w-0 text-sm font-medium">{it.nama}</p>
                            <p className="shrink-0 text-sm font-semibold">
                              {it.saran_qty} {it.satuan_hitung}
                            </p>
                          </div>
                          <p className="mt-1 text-xs text-slate-600">
                            Stok {it.stok_display} · Terjual {angka(it.terjual)}
                          </p>
                          <p className="text-xs text-slate-600">
                            Rata {desimal(it.rata_per_hari)}/hari ·{' '}
                            {it.hari_tersisa === null ? 'belum pernah terjual' : `${desimal(it.hari_tersisa)} hari lagi`}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">{it.alasan}</p>
                        </div>
                      ))}
                    </div>

                    <div className="tabel-scroll hidden md:block">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                            <th className="py-2 pr-3">Nama Barang</th>
                            <th className="py-2 pr-3 text-right">Stok Sekarang</th>
                            <th className="py-2 pr-3">Satuan Hitung</th>
                            <th className="py-2 pr-3 text-right">Terjual</th>
                            <th className="py-2 pr-3 text-right">Rata/hari</th>
                            <th className="py-2 pr-3 text-right">Hari Tersisa</th>
                            <th className="py-2 pr-3 text-right">Saran</th>
                            <th className="py-2">Alasan</th>
                          </tr>
                        </thead>
                        <tbody>
                          {saranTampil.map((it) => (
                            <tr
                              key={it.product_id}
                              className={`border-b border-slate-50 ${it.hari_tersisa === null ? 'bg-slate-50' : ''}`}
                            >
                              <td className="py-2 pr-3">{it.nama}</td>
                              <td className="py-2 pr-3 text-right">{it.stok_display}</td>
                              <td className="py-2 pr-3">{it.satuan_hitung}</td>
                              <td className="py-2 pr-3 text-right">{angka(it.terjual)}</td>
                              <td className="py-2 pr-3 text-right">{desimal(it.rata_per_hari)}</td>
                              <td className="py-2 pr-3 text-right">
                                {it.hari_tersisa === null ? (
                                  <span className="text-slate-500">Belum terjual</span>
                                ) : (
                                  desimal(it.hari_tersisa)
                                )}
                              </td>
                              <td className="whitespace-nowrap py-2 pr-3 text-right font-semibold">
                                {it.saran_qty} {it.satuan_hitung}
                              </td>
                              <td className="max-w-[20rem] py-2">
                                <span className="block truncate" title={it.alasan}>
                                  {it.alasan}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <Pagination
                      total={saranTersaring.length}
                      halaman={saranHalaman}
                      perHalaman={saranPerHalaman}
                      onHalaman={setSaranHalaman}
                      onPerHalaman={(n) => {
                        setSaranPerHalaman(n);
                        setSaranHalaman(1);
                      }}
                    />
                  </>
                )}
              </>
            )}
          </div>
        </Card>

        <Modal open={buka} title="Pembelian Baru" onClose={() => setBuka(false)} width="max-w-4xl" tinggiPenuh>
          <form onSubmit={simpanBeli} className="space-y-3">
            <Alert tone="info">
              Cukup isi barang dan jumlahnya, karena pembelian tidak memakai harga. Stok produk bertambah otomatis di server
              setelah pembelian disimpan.
            </Alert>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label>Tanggal</Label>
                <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} required />
              </div>
              <div>
                <Label>Supplier (opsional)</Label>
                <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="mis. Toko Grosir Jaya" />
              </div>
              <div>
                <Label>Catatan (opsional)</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. nomor nota" />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-700">Item pembelian</span>
                <Button type="button" variant="secondary" onClick={() => setBaris((prev) => [...prev, barisKosong()])}>
                  + Baris
                </Button>
              </div>

              <div className="space-y-2">
                {baris.map((b, i) => {
                  const produk = products.find((p) => p.id === Number(b.product_id));
                  return (
                    <div key={i} className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 p-2 md:grid-cols-12">
                      <div className="col-span-2 md:col-span-6">
                        <Label>Produk</Label>
                        {/* Produk bisa ribuan: dipilih lewat pencarian, bukan menggulir daftar. */}
                        <CariSelect
                          value={b.product_id}
                          onChange={(v) => ubahBaris(i, { product_id: v, unit_id: '' })}
                          options={opsiProduk}
                          ariaLabel={`Produk baris ${i + 1}`}
                        />
                      </div>
                      <div className="col-span-1 md:col-span-3">
                        <Label>Satuan</Label>
                        <Select
                          value={b.unit_id}
                          disabled={!produk}
                          onChange={(e) => ubahBaris(i, { unit_id: e.target.value })}
                        >
                          <option value="">Pilih satuan…</option>
                          {(produk?.units ?? []).map((u) => (
                            <option key={u.unit_id} value={u.unit_id}>
                              {u.unit_name} (isi {u.isi})
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="col-span-1 md:col-span-2">
                        <Label>Qty</Label>
                        <Input
                          inputMode="numeric"
                          value={b.qty}
                          onChange={(e) => ubahBaris(i, { qty: e.target.value.replace(/[^\d]/g, '') })}
                        />
                      </div>
                      <div className="col-span-2 flex items-end md:col-span-1">
                        <Button
                          type="button"
                          variant="ghost"
                          className="w-full text-red-700"
                          onClick={() => setBaris((prev) => prev.filter((_, x) => x !== i))}
                          disabled={baris.length <= 1}
                          aria-label={`Hapus baris ${i + 1}`}
                        >
                          Hapus
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {errorForm && <Alert>{errorForm}</Alert>}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setBuka(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={simpan}>
                {simpan ? 'Menyimpan…' : 'Simpan Pembelian'}
              </Button>
            </div>
          </form>
        </Modal>

        <Modal
          open={!!detail || detailMemuat}
          title={`Detail Pembelian ${detail ? formatTanggal(detail.tanggal) : ''}`}
          onClose={() => setDetail(null)}
          width="max-w-2xl"
        >
          {detailMemuat && <p className="text-sm text-slate-500">Memuat…</p>}
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-1 gap-1 text-slate-600 sm:grid-cols-2">
                <p>Tanggal: {formatTanggal(detail.tanggal)}</p>
                <p>Supplier: {detail.supplier || '-'}</p>
                <p>Dicatat oleh: {detail.user_name ?? '-'}</p>
                <p>Catatan: {detail.note ?? '-'}</p>
              </div>
              {(detail.items?.length ?? 0) > 0 && (
                <Input
                  type="search"
                  value={cariItem}
                  onChange={(e) => setCariItem(e.target.value)}
                  placeholder="Cari barang di rincian…"
                  aria-label="Cari barang di rincian pembelian"
                />
              )}
              <div className="tabel-scroll">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                      <th className="py-2 pr-3">Produk</th>
                      <th className="py-2 pr-3">Satuan</th>
                      <th className="py-2 pr-3 text-right">Qty</th>
                      <th className="py-2 text-right">Qty Dasar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemTampil.map((it, i) => (
                      <tr key={it.id ?? i} className="border-b border-slate-50">
                        <td className="py-2 pr-3">{it.product_name ?? `#${it.product_id}`}</td>
                        <td className="py-2 pr-3">{it.unit_name ?? '-'}</td>
                        <td className="py-2 pr-3 text-right">{it.qty.toLocaleString('id-ID')}</td>
                        <td className="py-2 text-right">
                          {(it.qty * (it.isi_snapshot ?? 1)).toLocaleString('id-ID')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {itemTampil.length > 0 && (
                    <tfoot>
                      <tr className="border-t border-slate-200 font-semibold">
                        <td className="py-2 pr-3" colSpan={2}>
                          TOTAL
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {itemTampil.reduce((s, it) => s + it.qty, 0).toLocaleString('id-ID')}
                        </td>
                        <td className="py-2 text-right">
                          {itemTampil
                            .reduce((s, it) => s + it.qty * (it.isi_snapshot ?? 1), 0)
                            .toLocaleString('id-ID')}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              {!detail.items?.length ? (
                <Kosong>Rincian item tidak dikirim server.</Kosong>
              ) : !itemTampil.length ? (
                <Kosong>Tidak ada barang yang cocok dengan pencarian "{cariItem.trim()}".</Kosong>
              ) : null}
            </div>
          )}
        </Modal>
      </div>

      {/* Yang tercetak: nama barang + jumlah yang dibeli, dengan kolom kosong untuk
          dicentang/ditulis tangan saat belanja. */}
      {saran && saran.items.length > 0 && (
        <div className="area-laporan hidden print:block">
          <div className="mb-3">
            <p className="text-base font-bold">{setting?.toko_nama || 'Toko Hakim'}</p>
            {setting?.alamat && <p className="text-xs">{setting.alamat}</p>}
            <p className="mt-1 text-sm font-semibold">Daftar Saran Pembelian</p>
            <p className="text-xs">
              Dicetak {formatTanggalJam(new Date().toISOString())} · Analisis penjualan {saran.hari} hari terakhir ·
              target stok {saran.ambang} hari
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-2 pr-3">Nama Barang</th>
                <th className="py-2 pr-3 text-right">Jumlah</th>
                <th className="py-2 pr-3">Satuan</th>
                <th className="py-2">Sudah dibeli</th>
              </tr>
            </thead>
            <tbody>
              {saran.items.map((it) => (
                <tr key={it.product_id} className="border-b border-slate-300">
                  <td className="py-2 pr-3">{it.nama}</td>
                  <td className="py-2 pr-3 text-right font-semibold">{it.saran_qty}</td>
                  <td className="py-2 pr-3">{it.satuan_hitung}</td>
                  <td className="py-2" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
