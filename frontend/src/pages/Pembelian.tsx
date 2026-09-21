import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Alert, Button, Card, Input, Kosong, Label, Modal, Select, Stat } from '../components/ui';
import { db } from '../db';
import { formatTanggal, parseUang, tanggalLokal } from '../lib/format';
import { useOnline } from '../lib/useOnline';
import type { Product, Purchase } from '../types';

interface BarisBeli {
  product_id: string;
  unit_id: string;
  qty: string;
}

const barisKosong = (): BarisBeli => ({ product_id: '', unit_id: '', qty: '1' });

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
  const online = useOnline();
  const products = useLiveQuery(() => db.products.toArray(), [], [] as Product[]);

  const [dari, setDari] = useState(tanggalLokal());
  const [sampai, setSampai] = useState(tanggalLokal());
  const [rows, setRows] = useState<Purchase[]>([]);
  const [memuat, setMemuat] = useState(false);
  const [error, setError] = useState('');

  const [buka, setBuka] = useState(false);
  const [tanggal, setTanggal] = useState(tanggalLokal());
  const [supplier, setSupplier] = useState('');
  const [note, setNote] = useState('');
  const [baris, setBaris] = useState<BarisBeli[]>([barisKosong()]);
  const [errorForm, setErrorForm] = useState('');
  const [simpan, setSimpan] = useState(false);

  const [detail, setDetail] = useState<Purchase | null>(null);
  const [detailMemuat, setDetailMemuat] = useState(false);

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

      <Card title={`Daftar Pembelian (${rows.length})`}>
        <p className="mb-3 text-xs text-slate-500">
          Pembelian dicatat tanpa harga: cukup nama barang dan jumlahnya. Stok produk bertambah otomatis di server
          saat pembelian disimpan. Gunakan "Scan struk supplier" untuk mengisi item dari foto struk.
        </p>

        {/* HP: kartu per nota. */}
        <div className="space-y-2 md:hidden">
          {rows.map((r) => (
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
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="whitespace-nowrap py-2 pr-3">{formatTanggal(r.tanggal)}</td>
                  <td className="py-2 pr-3">{r.supplier || 'Tanpa supplier'}</td>
                  <td className="py-2 pr-3 text-right">{r.items_count ?? '-'}</td>
                  <td className="py-2 pr-3">{r.note ?? '-'}</td>
                  <td className="whitespace-nowrap py-2 text-right">
                    <Button variant="ghost" ukuran="sm" onClick={() => void bukaDetail(r.id)} disabled={!online}>
                      Detail
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
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold">
                  <td className="py-2 pr-3" colSpan={2}>
                    TOTAL
                  </td>
                  <td className="py-2 pr-3 text-right">{totalItem.toLocaleString('id-ID')}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {!rows.length && <Kosong>Belum ada pembelian pada rentang ini.</Kosong>}
      </Card>

      <Modal open={buka} title="Pembelian Baru" onClose={() => setBuka(false)} width="max-w-4xl" tinggiPenuh>
        <form onSubmit={simpanBeli} className="space-y-3">
          <Alert tone="info">
            Cukup isi barang dan jumlahnya — pembelian tidak memakai harga. Stok produk bertambah otomatis di server
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
                      <Select
                        value={b.product_id}
                        onChange={(e) => ubahBaris(i, { product_id: e.target.value, unit_id: '' })}
                      >
                        <option value="">Pilih produk…</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
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
                        className="w-full text-red-600"
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
                  {(detail.items ?? []).map((it, i) => (
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
                <tfoot>
                  <tr className="border-t border-slate-200 font-semibold">
                    <td className="py-2 pr-3" colSpan={2}>
                      TOTAL
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {(detail.items ?? []).reduce((s, it) => s + it.qty, 0).toLocaleString('id-ID')}
                    </td>
                    <td className="py-2 text-right">
                      {(detail.items ?? [])
                        .reduce((s, it) => s + it.qty * (it.isi_snapshot ?? 1), 0)
                        .toLocaleString('id-ID')}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {!detail.items?.length && <Kosong>Rincian item tidak dikirim server.</Kosong>}
          </div>
        )}
      </Modal>
    </div>
  );
}
