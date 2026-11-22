import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import CariSelect from '../components/CariSelect';
import Pagination, { potongHalaman } from '../components/Pagination';
import { Alert, Button, Card, Input, Kosong, Label, Modal, Select } from '../components/ui';
import { db } from '../db';
import { formatTanggalJam, parseUang } from '../lib/format';
import { useOnline } from '../lib/useOnline';
import { useAuth } from '../store';
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
  const superadmin = useAuth((s) => s.user?.role === 'superadmin');
  const stok = useLiveQuery(() => db.cachedStock.toArray(), [], [] as StockRow[]);
  const products = useLiveQuery(() => db.products.toArray(), [], [] as Product[]);

  const [cari, setCari] = useState('');
  const [hanyaMinus, setHanyaMinus] = useState(false);
  const [halaman, setHalaman] = useState(1);
  const [perHalaman, setPerHalaman] = useState(20);
  const [bukaTambah, setBukaTambah] = useState(false);
  const [izinProses, setIzinProses] = useState<number | null>(null);
  const [errorIzin, setErrorIzin] = useState('');

  const [productId, setProductId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [qty, setQty] = useState('1');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Riwayat pergerakan
  const [mvProduct, setMvProduct] = useState('');
  const [mvCari, setMvCari] = useState('');
  const [mvDari, setMvDari] = useState('');
  const [mvSampai, setMvSampai] = useState('');
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [mvMemuat, setMvMemuat] = useState(false);
  const [mvError, setMvError] = useState('');

  const daftar = stok.filter((s) => {
    if (hanyaMinus && !s.minus) return false;
    const q = cari.trim().toLowerCase();
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      s.base_unit.toLowerCase().includes(q) ||
      (s.satuan_hitung ?? '').toLowerCase().includes(q)
    );
  });

  const jumlahHalaman = Math.max(1, Math.ceil(daftar.length / perHalaman));
  const hal = Math.min(halaman, jumlahHalaman);
  const halamanIni = potongHalaman(daftar, hal, perHalaman);

  /** Riwayat yang sudah dimuat disaring di memori: server hanya mengirim 100 baris terakhir. */
  const mvCariTeks = mvCari.trim().toLowerCase();
  const movementsTampil = movements.filter(
    (m) =>
      !mvCariTeks ||
      m.product_name.toLowerCase().includes(mvCariTeks) ||
      (LABEL_TIPE[m.type] ?? m.type).toLowerCase().includes(mvCariTeks) ||
      (m.note ?? '').toLowerCase().includes(mvCariTeks),
  );

  /**
   * Nyalakan/matikan izin jual stok kosong lewat endpoint sempit: PUT /products/:id mengganti
   * seluruh produk, jadi memakainya di sini akan mereset nama, satuan, dan harga.
   */
  async function ubahIzin(s: StockRow, nilai: boolean) {
    setErrorIzin('');
    setIzinProses(s.product_id);
    try {
      await api.patch(`/products/${s.product_id}/pengaturan`, { izin_minus: nilai });
      await pullSync();
    } catch (e) {
      setErrorIzin(e instanceof Error ? e.message : 'Gagal mengubah izin jual stok kosong');
    } finally {
      setIzinProses(null);
    }
  }

  /** Lencana + (untuk superadmin) tombol pengubah izin. Dipakai kartu HP maupun tabel. */
  function kontrolIzin(s: StockRow) {
    const izin = s.izin_minus === true;
    const lencana = (
      <span
        className={`rounded-full px-2 py-0.5 text-xs ${
          izin ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'
        }`}
      >
        {izin ? 'Boleh minus' : 'Tidak boleh minus'}
      </span>
    );
    if (!superadmin) return lencana;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {lencana}
        <Button
          variant="ghost"
          ukuran="sm"
          aria-label={
            izin
              ? `Larang penjualan saat stok "${s.name}" kosong`
              : `Izinkan penjualan saat stok "${s.name}" kosong`
          }
          disabled={!online || izinProses === s.product_id}
          onClick={() => void ubahIzin(s, !izin)}
        >
          {izinProses === s.product_id ? 'Menyimpan…' : izin ? 'Larang minus' : 'Izinkan minus'}
        </Button>
      </div>
    );
  }

  const produkTerpilih = products.find((p) => p.id === Number(productId));
  const satuanTerpilih = produkTerpilih?.units.find((u) => u.unit_id === Number(unitId));
  const konversi = satuanTerpilih ? parseUang(qty) * satuanTerpilih.isi : 0;

  function buka() {
    setProductId('');
    setUnitId('');
    setQty('1');
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
        // Catatan tidak pernah ditampilkan di layar, jadi tidak diminta ke pengguna.
        // Kolom "Catatan" di riwayat pergerakan tetap ada: isinya diisi server.
        note: null,
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
            <Input
              value={cari}
              onChange={(e) => {
                setCari(e.target.value);
                setHalaman(1);
              }}
              placeholder="Cari produk / satuan…"
            />
          </div>
          {/* `.centang` memberi area sentuh 44×44px sambil menjaga kotak yang terlihat
              tetap 20px; lihat catatannya di index.css. */}
          <label className="flex min-h-sentuh cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="centang"
              checked={hanyaMinus}
              onChange={(e) => setHanyaMinus(e.target.checked)}
            />
            Hanya tampilkan minus
          </label>
        </div>

        {errorIzin && <Alert>{errorIzin}</Alert>}

        {/* HP: daftar kartu supaya tidak perlu menggeser tabel ke samping. */}
        <div className="space-y-2 md:hidden">
          {halamanIni.map((s) => (
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
              {/* Angka utama dalam satuan hitung (dus/karton/bal); base jadi keterangan sekunder. */}
              <p className="mt-1 text-sm text-slate-600">
                Stok: <b>{s.display_hitung ?? s.display}</b>
              </p>
              <p className="text-xs text-slate-500">{s.display}</p>
              <div className="mt-2">{kontrolIzin(s)}</div>
            </div>
          ))}
        </div>

        <div className="tabel-scroll hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <th className="py-2">Produk</th>
                <th className="py-2">Satuan hitung</th>
                <th className="py-2 text-right">Stok</th>
                <th className="py-2">Base</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {halamanIni.map((s) => (
                <tr key={s.product_id} className={`border-b border-slate-50 ${s.minus ? 'bg-red-50' : ''}`}>
                  <td className="py-2 font-medium">{s.name}</td>
                  <td className="py-2">{s.satuan_hitung ?? s.base_unit}</td>
                  <td className="py-2 text-right font-semibold">{s.display_hitung ?? s.display}</td>
                  <td className="py-2 text-xs text-slate-500">{s.display}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {s.minus ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          minus, perlu dicek
                        </span>
                      ) : (
                        <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">normal</span>
                      )}
                      {kontrolIzin(s)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!daftar.length && <Kosong>Belum ada data stok. Jalankan sinkronisasi terlebih dahulu.</Kosong>}
        <Pagination
          total={daftar.length}
          halaman={hal}
          perHalaman={perHalaman}
          onHalaman={setHalaman}
          onPerHalaman={(n) => {
            setPerHalaman(n);
            setHalaman(1);
          }}
        />
      </Card>

      <Card title="Riwayat Pergerakan Stok">
        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <Label>Produk</Label>
            {/* Daftar produk bisa ribuan: kolom cari lebih cepat daripada <select> panjang. */}
            <CariSelect
              value={mvProduct}
              onChange={setMvProduct}
              ariaLabel="Saring riwayat per produk"
              placeholder="Semua produk"
              options={[
                { value: '', label: 'Semua produk' },
                ...products.map((p) => ({ value: p.id, label: p.name, hint: p.category_name ?? undefined })),
              ]}
            />
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

        <div className="mb-3 max-w-sm">
          <Input
            value={mvCari}
            onChange={(e) => setMvCari(e.target.value)}
            placeholder="Cari produk / tipe / catatan…"
            aria-label="Cari di riwayat pergerakan stok"
          />
        </div>

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
              {movementsTampil.map((m) => (
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
        {!!movements.length && !movementsTampil.length && <Kosong>Tidak ada baris yang cocok.</Kosong>}
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
            {/* Produk bisa 1000 baris: <select> sepanjang itu tidak terpakai di HP. */}
            <CariSelect
              value={productId}
              onChange={(v) => {
                setProductId(v);
                setUnitId('');
              }}
              ariaLabel="Pilih produk untuk tambah stok"
              autoFocus
              required
              options={products.map((p) => ({
                value: p.id,
                label: p.name,
                hint: p.category_name ?? undefined,
              }))}
            />
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
