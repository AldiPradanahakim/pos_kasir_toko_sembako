import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Alert, Button, Card, Input, Kosong, Label, Modal, Select } from '../components/ui';
import { db } from '../db';
import { formatTanggalJam, parseUang } from '../lib/format';
import { useOnline } from '../lib/useOnline';
import { pullSync } from '../sync';
import type { Product, StockMovement, StockRow } from '../types';

const LABEL_TIPE: Record<string, string> = {
  masuk: 'Masuk',
  keluar: 'Keluar',
  penyesuaian: 'Penyesuaian',
  pembatalan: 'Pembatalan',
};

export default function Stok() {
  const online = useOnline();
  const stok = useLiveQuery(() => db.cachedStock.toArray(), [], [] as StockRow[]);
  const products = useLiveQuery(() => db.products.toArray(), [], [] as Product[]);

  const [cari, setCari] = useState('');
  const [hanyaMinus, setHanyaMinus] = useState(false);
  const [bukaTambah, setBukaTambah] = useState(false);

  const [productId, setProductId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Riwayat pergerakan
  const [mvProduct, setMvProduct] = useState('');
  const [mvDari, setMvDari] = useState('');
  const [mvSampai, setMvSampai] = useState('');
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [mvMemuat, setMvMemuat] = useState(false);
  const [mvError, setMvError] = useState('');

  const daftar = stok.filter((s) => {
    if (hanyaMinus && !s.minus) return false;
    const q = cari.trim().toLowerCase();
    return !q || s.name.toLowerCase().includes(q);
  });

  const produkTerpilih = products.find((p) => p.id === Number(productId));
  const satuanTerpilih = produkTerpilih?.units.find((u) => u.unit_id === Number(unitId));
  const konversi = satuanTerpilih ? parseUang(qty) * satuanTerpilih.isi : 0;

  function buka() {
    setProductId('');
    setUnitId('');
    setQty('1');
    setNote('');
    setError('');
    setBukaTambah(true);
  }

  async function simpanMasuk(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const q = parseUang(qty);
    if (!productId || !unitId) {
      setError('Pilih produk dan satuan.');
      return;
    }
    if (!Number.isInteger(q) || q <= 0) {
      setError('Qty harus bilangan bulat lebih dari 0.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/stock/in', {
        product_id: Number(productId),
        unit_id: Number(unitId),
        qty: q,
        note: note.trim() || null,
      });
      await pullSync();
      setBukaTambah(false);
      setMvProduct(productId);
      void muatMovements(productId, mvDari, mvSampai);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menambah stok');
    } finally {
      setLoading(false);
    }
  }

  async function muatMovements(pid = mvProduct, dari = mvDari, sampai = mvSampai) {
    setMvError('');
    setMvMemuat(true);
    try {
      const p = new URLSearchParams();
      if (pid) p.set('product_id', pid);
      if (dari) p.set('from', dari);
      if (sampai) p.set('to', sampai);
      p.set('limit', '100');
      const data = await api.get<StockMovement[] | { data: StockMovement[] }>(`/stock/movements?${p}`);
      setMovements(Array.isArray(data) ? data : (data.data ?? []));
    } catch (e) {
      setMvError(e instanceof Error ? e.message : 'Gagal memuat riwayat stok');
    } finally {
      setMvMemuat(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Stok</h1>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Link
            to="/stok/scan"
            className="inline-flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-md bg-teal-700 px-4 py-3 text-base font-medium text-white transition hover:bg-teal-800 active:bg-teal-900 sm:flex-none"
          >
            Scan Struk
          </Link>
          <Button ukuran="lg" variant="secondary" onClick={buka} disabled={!online} className="flex-1 sm:flex-none">
            + Tambah Stok
          </Button>
        </div>
      </div>

      {!online && <Alert tone="info">Data stok di bawah berasal dari salinan lokal. Tambah stok butuh koneksi.</Alert>}

      <Card title={`Stok per Produk (${daftar.length})`}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="max-w-xs flex-1">
            <Input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari produk…" />
          </div>
          <label className="flex min-h-sentuh items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={hanyaMinus}
              onChange={(e) => setHanyaMinus(e.target.checked)}
            />
            Hanya tampilkan minus
          </label>
        </div>

        {/* HP: daftar kartu supaya tidak perlu menggeser tabel ke samping. */}
        <div className="space-y-2 md:hidden">
          {daftar.map((s) => (
            <div
              key={s.product_id}
              className={`min-w-0 rounded-lg border p-3 ${s.minus ? 'border-red-200 bg-red-50' : 'border-slate-200'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 break-words text-sm font-semibold text-slate-800">{s.name}</p>
                {s.minus ? (
                  <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                    minus
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">normal</span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-600">
                Stok: <b>{s.display}</b>
              </p>
              <p className="text-xs text-slate-500">
                Base {s.base_unit}: {s.stok_base.toLocaleString('id-ID')}
              </p>
            </div>
          ))}
        </div>

        <div className="tabel-scroll hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <th className="py-2">Produk</th>
                <th className="py-2">Base</th>
                <th className="py-2 text-right">Stok (base)</th>
                <th className="py-2">Tampilan</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {daftar.map((s) => (
                <tr key={s.product_id} className={`border-b border-slate-50 ${s.minus ? 'bg-red-50' : ''}`}>
                  <td className="py-2 font-medium">{s.name}</td>
                  <td className="py-2">{s.base_unit}</td>
                  <td className="py-2 text-right">{s.stok_base.toLocaleString('id-ID')}</td>
                  <td className="py-2">{s.display}</td>
                  <td className="py-2">
                    {s.minus ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        minus, perlu dicek
                      </span>
                    ) : (
                      <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">normal</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!daftar.length && <Kosong>Belum ada data stok. Jalankan sinkronisasi terlebih dahulu.</Kosong>}
      </Card>

      <Card title="Riwayat Pergerakan Stok">
        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <Label>Produk</Label>
            <Select value={mvProduct} onChange={(e) => setMvProduct(e.target.value)}>
              <option value="">Semua produk</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Dari tanggal</Label>
            <Input type="date" value={mvDari} onChange={(e) => setMvDari(e.target.value)} />
          </div>
          <div>
            <Label>Sampai tanggal</Label>
            <Input type="date" value={mvSampai} onChange={(e) => setMvSampai(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={() => void muatMovements()} disabled={!online || mvMemuat}>
              {mvMemuat ? 'Memuat…' : 'Tampilkan'}
            </Button>
          </div>
        </div>

        {mvError && <Alert>{mvError}</Alert>}

        <div className="tabel-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <th className="py-2">Waktu</th>
                <th className="py-2">Produk</th>
                <th className="py-2">Tipe</th>
                <th className="py-2 text-right">Qty (base)</th>
                <th className="py-2">Catatan</th>
                <th className="py-2">Oleh</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} className="border-b border-slate-50">
                  <td className="py-2 whitespace-nowrap">{formatTanggalJam(m.created_at)}</td>
                  <td className="py-2">{m.product_name}</td>
                  <td className="py-2">{LABEL_TIPE[m.type] ?? m.type}</td>
                  <td className={`py-2 text-right ${m.qty_base < 0 ? 'text-red-700' : 'text-teal-700'}`}>
                    {m.qty_base > 0 ? '+' : ''}
                    {m.qty_base.toLocaleString('id-ID')}
                  </td>
                  <td className="py-2">{m.note ?? '-'}</td>
                  <td className="py-2">{m.user_name ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!movements.length && <Kosong>Klik "Tampilkan" untuk memuat riwayat pergerakan stok.</Kosong>}
      </Card>

      <Modal open={bukaTambah} title="Tambah Stok" onClose={() => setBukaTambah(false)}>
        <form onSubmit={simpanMasuk} className="space-y-3">
          <Link
            to="/stok/scan"
            onClick={() => setBukaTambah(false)}
            className="block rounded-md bg-teal-50 px-3 py-3 text-sm font-medium text-teal-800"
          >
            Punya nota supplier? Pakai <b>Scan Struk</b>, stok masuk sekaligus banyak.
          </Link>
          <div>
            <Label>Produk</Label>
            <Select
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value);
                setUnitId('');
              }}
              required
            >
              <option value="">Pilih produk…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Satuan</Label>
              <Select value={unitId} onChange={(e) => setUnitId(e.target.value)} required disabled={!produkTerpilih}>
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
                type="number"
                min={1}
                step={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                required
              />
            </div>
          </div>
          {satuanTerpilih && (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {parseUang(qty)} {satuanTerpilih.unit_name} × isi {satuanTerpilih.isi} ={' '}
              <b>{konversi.toLocaleString('id-ID')} {produkTerpilih?.base_unit}</b> ditambahkan ke stok.
            </p>
          )}
          <div>
            <Label>Catatan (opsional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. kulakan pasar" />
          </div>

          {error && <Alert>{error}</Alert>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setBukaTambah(false)}>
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
