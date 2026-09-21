import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Alert, Button, Card, Input, Kosong, Label, Modal, Select, Stat } from '../components/ui';
import { db } from '../db';
import { formatTanggal, formatTanggalJam, parseUang, rupiah, tanggalLokal } from '../lib/format';
import { useOnline } from '../lib/useOnline';
import type { Product, Purchase, Sale } from '../types';

/** Satu retur = satu barang (server menyimpan per baris, bukan per dokumen). */
interface BarisRetur {
  id: number;
  tipe: string;
  ref_id: number | null;
  product_id: number;
  product_name?: string | null;
  unit_id: number | null;
  unit_name?: string | null;
  qty: number;
  /** Uang yang keluar (retur penjualan) atau masuk (retur pembelian). */
  jumlah: number;
  alasan: string | null;
  created_at?: string;
  user_name?: string | null;
}

interface ItemDokumen {
  product_id: number;
  unit_id: number;
  qty: number;
  harga: number;
  label: string;
}

/** Daftar bisa datang sebagai array, {data: []}, atau {rows: []}. */
function daftarDari<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const o = data as { data?: unknown; rows?: unknown };
    if (Array.isArray(o.data)) return o.data as T[];
    if (Array.isArray(o.rows)) return o.rows as T[];
  }
  return [];
}

const labelTipe = (t: string): string => (t === 'pembelian' ? 'Retur pembelian' : 'Retur penjualan');

export default function Retur() {
  const online = useOnline();
  const products = useLiveQuery(() => db.products.toArray(), [], [] as Product[]);

  const [dari, setDari] = useState(tanggalLokal());
  const [sampai, setSampai] = useState(tanggalLokal());
  const [filterTipe, setFilterTipe] = useState('');
  const [rows, setRows] = useState<BarisRetur[]>([]);
  const [memuat, setMemuat] = useState(false);
  const [error, setError] = useState('');

  const [buka, setBuka] = useState(false);
  const [tipe, setTipe] = useState('penjualan');
  const [dokumen, setDokumen] = useState<{ id: number; label: string }[]>([]);
  const [itemDok, setItemDok] = useState<ItemDokumen[]>([]);
  const [memuatDok, setMemuatDok] = useState(false);
  const [refId, setRefId] = useState('');
  const [productId, setProductId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [qty, setQty] = useState('1');
  const [jumlah, setJumlah] = useState('');
  const [alasan, setAlasan] = useState('');
  const [errorForm, setErrorForm] = useState('');
  const [simpan, setSimpan] = useState(false);

  const muat = useCallback(async () => {
    const q = new URLSearchParams();
    if (dari) q.set('from', dari);
    if (sampai) q.set('to', sampai);
    if (filterTipe) q.set('tipe', filterTipe);
    setError('');
    setMemuat(true);
    try {
      setRows(daftarDari<BarisRetur>(await api.get<unknown>(`/returns?${q}`)));
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : 'Gagal memuat retur');
    } finally {
      setMemuat(false);
    }
  }, [dari, sampai, filterTipe]);

  useEffect(() => {
    if (online) void muat();
  }, [muat, online]);

  // Daftar dokumen sumber ikut berubah saat tipe retur diganti.
  useEffect(() => {
    if (!buka) return;
    let batal = false;
    setDokumen([]);
    setItemDok([]);
    setMemuatDok(true);
    setErrorForm('');
    void (async () => {
      try {
        if (tipe === 'penjualan') {
          const data = await api.get<unknown>('/sales?limit=200');
          if (batal) return;
          setDokumen(
            daftarDari<Sale>(data).map((s) => ({
              id: s.id,
              label: `${s.no_struk ?? `#${s.id}`} · ${formatTanggalJam(s.created_at)} · ${rupiah(s.total)}`,
            })),
          );
        } else {
          const data = await api.get<unknown>('/purchases?limit=200');
          if (batal) return;
          setDokumen(
            daftarDari<Purchase>(data).map((p) => ({
              id: p.id,
              // Pembelian tanpa harga: yang bisa ditampilkan hanya supplier, tanggal, jumlah item.
              label: `${p.supplier ?? 'Tanpa supplier'} · ${formatTanggal(p.tanggal)} · ${p.items_count ?? 0} item`,
            })),
          );
        }
      } catch (err) {
        if (!batal) setErrorForm(err instanceof Error ? err.message : 'Gagal memuat daftar dokumen');
      } finally {
        if (!batal) setMemuatDok(false);
      }
    })();
    return () => {
      batal = true;
    };
  }, [buka, tipe]);

  const totalDaftar = rows.reduce((s, r) => s + (Number(r.jumlah) || 0), 0);
  const jumlahPenjualan = rows.filter((r) => r.tipe !== 'pembelian').length;
  const produkTerpilih = products.find((p) => p.id === Number(productId));

  function bukaTambah() {
    setTipe('penjualan');
    setRefId('');
    setItemDok([]);
    setProductId('');
    setUnitId('');
    setQty('1');
    setJumlah('');
    setAlasan('');
    setErrorForm('');
    setBuka(true);
  }

  /** Rincian item dokumen sumber, supaya tidak perlu mengetik ulang. */
  async function pilihDokumen(id: string) {
    setRefId(id);
    setItemDok([]);
    if (!id) return;
    setErrorForm('');
    setMemuatDok(true);
    try {
      const items: ItemDokumen[] =
        tipe === 'penjualan'
          ? ((await api.get<Sale>(`/sales/${id}`)).items ?? []).map((it) => ({
              product_id: it.product_id,
              unit_id: it.unit_id,
              qty: it.qty,
              harga: it.harga_snapshot,
              label: `${it.product_name ?? `#${it.product_id}`} · ${it.unit_name} · ${it.qty} × ${rupiah(it.harga_snapshot)}`,
            }))
          : ((await api.get<Purchase>(`/purchases/${id}`)).items ?? []).map((it) => ({
              product_id: it.product_id,
              unit_id: it.unit_id,
              qty: it.qty,
              // Pembelian tidak punya harga, jadi nilainya 0 dan jumlah uang retur diisi manual.
              harga: 0,
              label: `${it.product_name ?? `#${it.product_id}`} · ${it.unit_name ?? ''} · ${it.qty}`,
            }));
      setItemDok(items);
      if (items.length === 1) pilihItem(items[0]);
    } catch (err) {
      setErrorForm(
        err instanceof Error
          ? `${err.message}. Isi barang secara manual di bawah.`
          : 'Gagal memuat rincian dokumen. Isi barang secara manual di bawah.',
      );
    } finally {
      setMemuatDok(false);
    }
  }

  function pilihItem(it: ItemDokumen) {
    setProductId(String(it.product_id));
    setUnitId(String(it.unit_id));
    setQty(String(it.qty));
    // Pembelian tanpa harga (0) → kolom uang dibiarkan kosong supaya kasir mengisinya sendiri.
    setJumlah(it.harga > 0 ? String(it.qty * it.harga) : '');
  }

  async function simpanRetur(e: React.FormEvent) {
    e.preventDefault();
    setErrorForm('');
    if (!productId) {
      setErrorForm('Barang yang diretur belum dipilih.');
      return;
    }
    if (!unitId) {
      setErrorForm('Satuan belum dipilih.');
      return;
    }
    const qtyAngka = parseUang(qty);
    if (!Number.isInteger(qtyAngka) || qtyAngka <= 0) {
      setErrorForm('Qty harus bilangan bulat lebih dari 0.');
      return;
    }
    if (!alasan.trim()) {
      setErrorForm('Alasan retur wajib diisi.');
      return;
    }

    setSimpan(true);
    try {
      await api.post('/returns', {
        tipe,
        ref_id: refId ? Number(refId) : null,
        product_id: Number(productId),
        unit_id: Number(unitId),
        qty: qtyAngka,
        jumlah: parseUang(jumlah),
        alasan: alasan.trim(),
      });
      setBuka(false);
      await muat();
    } catch (err) {
      setErrorForm(err instanceof Error ? err.message : 'Gagal menyimpan retur');
    } finally {
      setSimpan(false);
    }
  }

  async function hapus(r: BarisRetur) {
    if (
      !window.confirm(
        `Hapus ${labelTipe(r.tipe).toLowerCase()} "${r.product_name ?? `#${r.product_id}`}" ${r.qty} unit? Stok dan kas dikembalikan otomatis.`,
      )
    )
      return;
    setError('');
    try {
      await api.del(`/returns/${r.id}`);
      await muat();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus retur');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Retur</h1>
        <Button onClick={bukaTambah} disabled={!online}>
          + Retur Baru
        </Button>
      </div>

      {!online && <Alert tone="info">Data retur hanya bisa dibuka dan diubah saat online.</Alert>}
      {error && <Alert>{error}</Alert>}

      <Card title="Filter">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
            <Select value={filterTipe} onChange={(e) => setFilterTipe(e.target.value)}>
              <option value="">Semua</option>
              <option value="penjualan">Retur penjualan</option>
              <option value="pembelian">Retur pembelian</option>
            </Select>
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={() => void muat()} disabled={!online || memuat}>
              {memuat ? 'Memuat…' : 'Tampilkan'}
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Jumlah retur"
          nilai={rows.length.toLocaleString('id-ID')}
          hint={`${jumlahPenjualan} penjualan · ${rows.length - jumlahPenjualan} pembelian`}
        />
        <Stat label="Total nilai retur" nilai={rupiah(totalDaftar)} tone="kuning" />
      </div>

      <Card title={`Daftar Retur (${rows.length})`}>
        <p className="mb-3 text-xs text-slate-500">
          Satu baris retur = satu barang. Retur penjualan menambah stok, retur pembelian mengurangi stok (diproses di
          server).
        </p>

        {/* HP: kartu per retur. */}
        <div className="space-y-2 md:hidden">
          {rows.map((r) => (
            <div key={r.id} className="rounded-md border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.product_name ?? `#${r.product_id}`}</p>
                  <p className="text-xs text-slate-500">
                    {labelTipe(r.tipe)} · {formatTanggalJam(r.created_at)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {r.qty} unit{r.unit_name ? ` ${r.unit_name}` : ''}
                    {r.ref_id ? ` · dokumen #${r.ref_id}` : ''}
                  </p>
                  {r.alasan && <p className="mt-0.5 text-xs text-slate-500">{r.alasan}</p>}
                </div>
                <p className="shrink-0 text-sm font-semibold">{rupiah(r.jumlah)}</p>
              </div>
              <div className="mt-2 flex justify-end">
                <Button
                  variant="ghost"
                  ukuran="sm"
                  className="text-red-700"
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
                <th className="py-2 pr-3">Tipe</th>
                <th className="py-2 pr-3">Waktu</th>
                <th className="py-2 pr-3">Barang</th>
                <th className="py-2 pr-3 text-right">Qty</th>
                <th className="py-2 pr-3 text-right">Jumlah</th>
                <th className="py-2 pr-3">Alasan</th>
                <th className="py-2 pr-3">Oleh</th>
                <th className="py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        r.tipe === 'pembelian' ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-700'
                      }`}
                    >
                      {r.tipe === 'pembelian' ? 'Pembelian' : 'Penjualan'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3">{formatTanggalJam(r.created_at)}</td>
                  <td className="py-2 pr-3">
                    {r.product_name ?? `#${r.product_id}`}
                    {r.ref_id ? <span className="ml-1 text-xs text-slate-500">(dokumen #{r.ref_id})</span> : null}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {r.qty.toLocaleString('id-ID')}
                    {r.unit_name ? ` ${r.unit_name}` : ''}
                  </td>
                  <td className="py-2 pr-3 text-right font-medium">{rupiah(r.jumlah)}</td>
                  <td className="py-2 pr-3">{r.alasan ?? '-'}</td>
                  <td className="py-2 pr-3">{r.user_name ?? '-'}</td>
                  <td className="whitespace-nowrap py-2 text-right">
                    <Button
                      variant="ghost"
                      ukuran="sm"
                      className="text-red-700"
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
                  <td className="py-2 pr-3" colSpan={4}>
                    TOTAL
                  </td>
                  <td className="py-2 pr-3 text-right">{rupiah(totalDaftar)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {!rows.length && <Kosong>Belum ada retur pada rentang ini.</Kosong>}
      </Card>

      <Modal open={buka} title="Retur Baru" onClose={() => setBuka(false)} width="max-w-2xl" tinggiPenuh>
        <form onSubmit={simpanRetur} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Tipe retur</Label>
              <Select
                value={tipe}
                onChange={(e) => {
                  setTipe(e.target.value);
                  setRefId('');
                  setItemDok([]);
                  setProductId('');
                  setUnitId('');
                  setQty('1');
                  setJumlah('');
                }}
              >
                <option value="penjualan">Retur penjualan (barang dari pelanggan)</option>
                <option value="pembelian">Retur pembelian (barang ke supplier)</option>
              </Select>
            </div>
            <div>
              <Label>{tipe === 'penjualan' ? 'Struk penjualan' : 'Nota pembelian'} (opsional)</Label>
              <Select
                value={refId}
                onChange={(e) => void pilihDokumen(e.target.value)}
                disabled={memuatDok || !dokumen.length}
              >
                <option value="">
                  {memuatDok
                    ? 'Memuat daftar…'
                    : dokumen.length
                      ? 'Tanpa referensi dokumen'
                      : 'Tidak ada dokumen yang bisa dirujuk'}
                </option>
                {dokumen.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {itemDok.length > 1 && (
            <div>
              <Label>Barang dari dokumen</Label>
              <Select value="" onChange={(e) => e.target.value && pilihItem(itemDok[Number(e.target.value)])}>
                <option value="">Pilih barang yang diretur…</option>
                {itemDok.map((it, i) => (
                  <option key={i} value={i}>
                    {it.label}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Barang</Label>
              <Select
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  setUnitId('');
                }}
                required
              >
                <option value="">Pilih barang…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Satuan</Label>
              <Select
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                disabled={!produkTerpilih}
                required
              >
                <option value="">Pilih satuan…</option>
                {(produkTerpilih?.units ?? []).map((u) => (
                  <option key={u.unit_id} value={u.unit_id}>
                    {u.unit_name} (isi {u.isi})
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Qty</Label>
              <Input
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))}
                required
              />
            </div>
            <div>
              <Label>{tipe === 'penjualan' ? 'Uang kembali ke pembeli (Rp)' : 'Uang diterima dari supplier (Rp)'}</Label>
              <Input
                inputMode="numeric"
                value={jumlah}
                onChange={(e) => setJumlah(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="0"
              />
            </div>
          </div>

          <div>
            <Label>Alasan retur</Label>
            <Input
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder="mis. barang rusak / kadaluarsa / salah kirim"
              required
            />
          </div>

          {errorForm && <Alert>{errorForm}</Alert>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setBuka(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={simpan}>
              {simpan ? 'Menyimpan…' : 'Simpan Retur'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
