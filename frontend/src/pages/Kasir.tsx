import { useLiveQuery } from 'dexie-react-hooks';
import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Kalkulator from '../components/Kalkulator';
import { ActionBar, Alert, Button, Card, Input, Kosong, Label } from '../components/ui';
import { db } from '../db';
import { rupiah, parseUang } from '../lib/format';
import { useOnline } from '../lib/useOnline';
import { useAuth } from '../store';
import { simpanPenjualan, type KeranjangItem } from '../sync';
import type { Product, ProductUnit } from '../types';

/** Banyak hasil pencarian yang ditampilkan sekaligus di bawah kotak cari. */
const MAKS_HASIL = 8;

export default function Kasir() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const online = useOnline();

  const products = useLiveQuery(
    () => db.products.filter((p) => p.is_active !== false).toArray(),
    [],
    [] as Product[],
  );
  const pending = useLiveQuery(() => db.pendingSales.where('status').equals('pending').count(), [], 0);

  const [cari, setCari] = useState('');
  const [keranjang, setKeranjang] = useState<KeranjangItem[]>([]);
  const [dibayar, setDibayar] = useState('');
  const [namaPelanggan, setNamaPelanggan] = useState('');
  const [pesan, setPesan] = useState('');
  const [error, setError] = useState('');
  const [sedangSimpan, setSedangSimpan] = useState(false);
  const [editBaris, setEditBaris] = useState<number | null>(null);
  const [bukaKalkulator, setBukaKalkulator] = useState(false);

  /**
   * Kotak cari adalah SATU-SATUNYA jalan menambah barang (daftar produk dihapus atas
   * permintaan pemilik). Hasilnya muncul sebagai daftar di bawah kotak cari; sekali ketuk
   * pada satuan yang diinginkan, barang langsung masuk keranjang.
   */
  const hasil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || (p.category_name ?? '').toLowerCase().includes(q))
      .slice(0, MAKS_HASIL);
  }, [cari, products]);

  const total = keranjang.reduce((s, it) => s + it.harga * it.qty, 0);
  const dibayarAngka = parseUang(dibayar);
  const kembalian = dibayarAngka - total;

  /** Tambah satu satuan produk; baris dengan produk + satuan + harga sama digabung qty-nya. */
  function tambahItem(p: Product, u: ProductUnit) {
    if (!Number.isInteger(u.harga_jual) || u.harga_jual < 0) {
      setError(`Harga jual "${p.name}" (${u.unit_name}) belum diisi.`);
      return;
    }
    setError('');
    setKeranjang((prev) => {
      const idx = prev.findIndex(
        (x) => x.product_id === p.id && x.unit_id === u.unit_id && x.harga === u.harga_jual,
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [
        ...prev,
        {
          product_id: p.id,
          name: p.name,
          unit_id: u.unit_id,
          unit_name: u.unit_name,
          isi: u.isi,
          qty: 1,
          harga: u.harga_jual,
          harga_asli: u.harga_jual,
          alasan_ubah_harga: '',
        },
      ];
    });
    setCari('');
    setPesan(`Ditambahkan: ${p.name} (${u.unit_name})`);
  }

  /** Enter di kotak cari = tambah hasil paling atas (satuannya yang terkecil, mis. pcs). */
  function tambahHasilTeratas() {
    const p = hasil[0];
    const u = p?.units[0];
    if (p && u) tambahItem(p, u);
  }

  function ubahQty(idx: number, delta: number) {
    setKeranjang((prev) => {
      const next = [...prev];
      const q = next[idx].qty + delta;
      if (q < 1) return prev;
      next[idx] = { ...next[idx], qty: q };
      return next;
    });
  }

  function ubahHarga(idx: number, harga: number, alasan: string) {
    setKeranjang((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], harga, alasan_ubah_harga: alasan };
      return next;
    });
    setEditBaris(null);
  }

  function hapusBaris(idx: number) {
    setKeranjang((prev) => prev.filter((_, i) => i !== idx));
    setEditBaris(null);
  }

  /**
   * Simpan transaksi. `cetak` hanya menentukan apakah dialog cetak dibuka setelahnya ,
   * keduanya tetap menyimpan transaksi (lokal + antrean sinkron).
   */
  async function simpan(cetak: boolean) {
    setError('');
    if (!keranjang.length) {
      setError('Keranjang masih kosong.');
      return;
    }
    for (const it of keranjang) {
      if (!Number.isInteger(it.qty) || it.qty <= 0) {
        setError(`Qty "${it.name}" harus bilangan bulat lebih dari 0.`);
        return;
      }
      if (!Number.isInteger(it.harga) || it.harga < 0) {
        setError(`Harga "${it.name}" harus bilangan bulat dan tidak negatif.`);
        return;
      }
      if (it.harga !== it.harga_asli && !it.alasan_ubah_harga.trim()) {
        setError(`Perubahan harga "${it.name}" wajib disertai alasan.`);
        return;
      }
    }
    if (dibayarAngka < total) {
      setError('Jumlah dibayar kurang dari total.');
      return;
    }

    setSedangSimpan(true);
    try {
      const { uuid } = await simpanPenjualan({
        items: keranjang,
        // Toko hanya menerima tunai; pilihan metode bayar sudah dihapus dari layar kasir.
        // Server mewajibkan `metode_bayar`, jadi nilainya tetap dikirim.
        metode_bayar: 'tunai',
        dibayar: dibayarAngka,
        kasir: user?.name ?? user?.username ?? '-',
        nama_pelanggan: namaPelanggan,
      });
      setKeranjang([]);
      setDibayar('');
      setNamaPelanggan('');
      setPesan('');
      navigate(`/kasir/struk/${uuid}${cetak ? '?cetak=1' : ''}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan transaksi');
    } finally {
      setSedangSimpan(false);
    }
  }

  const bisaSimpan = !sedangSimpan && keranjang.length > 0;

  /**
   * Dua tombol simpan/cetak. Jumlah kolomnya berbeda menurut tempat: di baris lengket HP
   * selalu dua kolom (mendatar, hemat tinggi), sedangkan di kartu pembayaran baru dua kolom
   * sejak `lg`, di kolom sempit 768px teks "Simpan Struk" tidak muat satu baris.
   */
  const tombolSimpan = (kolom: string) => (
    <div className={`grid gap-2 ${kolom}`}>
      <Button ukuran="lg" variant="secondary" disabled={!bisaSimpan} onClick={() => void simpan(false)}>
        {sedangSimpan ? 'Menyimpan…' : 'Simpan Struk'}
      </Button>
      <Button ukuran="lg" disabled={!bisaSimpan} onClick={() => void simpan(true)}>
        {sedangSimpan ? 'Menyimpan…' : 'Cetak Struk'}
      </Button>
    </div>
  );

  return (
    // Tata letak kasir gaya minimarket: kiri = pelanggan, kotak cari, lalu tabel keranjang
    // yang besar; kanan = total & pembayaran. Halaman ini tidak menggulir sejak tablet ,
    // yang bergulir hanya daftar hasil cari dan tabel keranjang.
    <div className="flex flex-col gap-3 md:min-h-0 md:flex-1">
      <div className="grid min-w-0 grid-cols-1 gap-3 md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,1fr)_minmax(0,300px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)] xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        {/* ---------- Kolom kiri: pelanggan, cari barang, keranjang ---------- */}
        <div className="flex min-w-0 flex-col gap-3 md:min-h-0">
          <Card className="shrink-0">
            <Label>Nama pelanggan (opsional)</Label>
            <Input
              value={namaPelanggan}
              onChange={(e) => setNamaPelanggan(e.target.value)}
              placeholder="mis. Bu Siti"
              maxLength={100}
            />
          </Card>

          <Card className="shrink-0">
            {/* Daftar hasil sengaja menumpuk di atas keranjang (absolute), bukan mendorongnya:
                tinggi tabel keranjang tidak berubah-ubah setiap kali kasir mengetik. */}
            <div className="relative">
              <Input
                type="search"
                value={cari}
                aria-label="Cari barang"
                placeholder="Ketik nama barang, lalu ketuk untuk menambah…"
                onChange={(e) => setCari(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    tambahHasilTeratas();
                  }
                }}
              />

              {cari.trim() !== '' && (
                <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-[50vh] overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                  {hasil.map((p) => (
                    <div key={p.id} className="border-b border-slate-100 px-2 py-2 last:border-0">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="text-xs text-slate-500">{p.category_name ?? 'Tanpa kategori'}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {p.units.map((u) => (
                          <button
                            key={u.unit_id}
                            type="button"
                            // Label lengkap: teks yang terlihat ("pcs · Rp 2.700") tidak
                            // menyebut nama barangnya, jadi pembaca layar butuh ini.
                            aria-label={`Tambah ${p.name} ${u.unit_name}`}
                            onClick={() => tambahItem(p, u)}
                            className="min-h-sentuh rounded-md border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-900 active:bg-teal-100"
                          >
                            {u.unit_name} · {rupiah(u.harga_jual)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {!hasil.length && <Kosong>Tidak ada produk yang cocok.</Kosong>}
                </div>
              )}
            </div>

            {pesan && <p className="mt-2 text-sm text-teal-700">{pesan}</p>}
          </Card>

          <Card
            title={`Keranjang (${keranjang.length})`}
            actions={
              keranjang.length ? (
                <Button variant="ghost" ukuran="sm" className="text-red-700" onClick={() => setKeranjang([])}>
                  Kosongkan
                </Button>
              ) : null
            }
            className="flex min-h-0 flex-col md:flex-1"
            isiClassName="max-h-[45vh] min-h-0 overflow-y-auto md:max-h-none md:flex-1"
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-2">Barang</th>
                  <th className="py-2 pr-2 text-center">Qty</th>
                  <th className="hidden py-2 pr-2 text-right md:table-cell">Harga</th>
                  <th className="py-2 pr-2 text-right">Subtotal</th>
                  <th className="py-2 text-right">Hapus</th>
                </tr>
              </thead>
              <tbody>
                {keranjang.map((it, idx) => (
                  <Fragment key={`${it.product_id}-${it.unit_id}`}>
                    <tr className="border-b border-slate-50">
                      <td className="py-2 pr-2">
                        <button
                          type="button"
                          className="block w-full text-left"
                          onClick={() => setEditBaris(editBaris === idx ? null : idx)}
                        >
                          <span className="block font-medium">{it.name}</span>
                          <span className="block text-xs text-slate-500">
                            {it.unit_name}
                            {it.harga !== it.harga_asli && <span className="ml-1 text-amber-700">· harga diubah</span>}
                          </span>
                          {it.harga !== it.harga_asli && it.alasan_ubah_harga && (
                            <span className="block text-xs text-amber-700">Alasan: {it.alasan_ubah_harga}</span>
                          )}
                        </button>
                      </td>
                      <td className="py-2 pr-2 text-center">
                        <button
                          type="button"
                          aria-label={`Ubah qty ${it.name}`}
                          onClick={() => setEditBaris(editBaris === idx ? null : idx)}
                          className="min-h-sentuh min-w-sentuh rounded-md bg-slate-100 px-2 font-semibold text-slate-700 active:bg-slate-200"
                        >
                          {it.qty}
                        </button>
                      </td>
                      <td className="hidden py-2 pr-2 text-right md:table-cell">{rupiah(it.harga)}</td>
                      <td className="py-2 pr-2 text-right font-semibold">{rupiah(it.harga * it.qty)}</td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          aria-label={`Hapus ${it.name}`}
                          onClick={() => hapusBaris(idx)}
                          className="min-h-sentuh min-w-sentuh rounded-md text-lg text-red-700 active:bg-red-50"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>

                    {editBaris === idx && (
                      <tr className="border-b border-slate-100 bg-amber-50/60">
                        <td colSpan={5} className="p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-slate-600">Qty</span>
                            <Button
                              variant="secondary"
                              aria-label="Kurangi qty"
                              className="px-4 text-lg"
                              onClick={() => ubahQty(idx, -1)}
                            >
                              −
                            </Button>
                            <span className="w-10 text-center text-base font-semibold">{it.qty}</span>
                            <Button
                              variant="secondary"
                              aria-label="Tambah qty"
                              className="px-4 text-lg"
                              onClick={() => ubahQty(idx, 1)}
                            >
                              +
                            </Button>
                            <Button variant="ghost" className="ml-auto text-red-700" onClick={() => hapusBaris(idx)}>
                              Hapus barang
                            </Button>
                          </div>

                          <EditorHarga
                            item={it}
                            onBatal={() => setEditBaris(null)}
                            onSimpan={(harga, alasan) => ubahHarga(idx, harga, alasan)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200">
                  <td colSpan={4} className="py-2 pr-2 text-right font-semibold">
                    TOTAL
                  </td>
                  <td className="py-2 text-right text-base font-bold">{rupiah(total)}</td>
                </tr>
              </tfoot>
            </table>

            {!keranjang.length && <Kosong>Keranjang kosong. Cari barang di kotak pencarian di atas.</Kosong>}
            {keranjang.length > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                Ketuk nama barang atau angka qty untuk mengubah qty dan harga.
              </p>
            )}
          </Card>
        </div>

        {/* ---------- Kolom kanan: total & pembayaran ---------- */}
        <div className="flex min-w-0 flex-col gap-3 md:min-h-0">
          <Card title="Pembayaran" className="shrink-0">
            <div className="space-y-3">
              <div className="rounded-lg bg-slate-900 px-3 py-3 text-right">
                <p className="text-xs text-slate-300">Total Pembayaran</p>
                <p className="break-all text-3xl font-bold text-white">{rupiah(total)}</p>
              </div>

              <div>
                <Label>Dibayar, ketuk untuk mengisi angka</Label>
                {/* Sengaja tombol, bukan input: menyentuhnya tidak memunculkan keyboard
                    HP/tablet, dan langsung membuka kalkulator angka besar. */}
                <button
                  type="button"
                  onClick={() => setBukaKalkulator(true)}
                  aria-haspopup="dialog"
                  className="min-h-[52px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-lg font-semibold text-slate-800 active:bg-slate-50"
                >
                  {dibayar ? rupiah(dibayarAngka) : <span className="text-slate-500">Ketuk angka…</span>}
                </button>
              </div>

              <div className="flex items-center justify-between text-base">
                <span>Kembalian</span>
                <span className={kembalian < 0 ? 'font-bold text-red-700' : 'font-bold'}>
                  {rupiah(keranjang.length ? kembalian : 0)}
                </span>
              </div>

              {!online && (
                <Alert tone="info">
                  Offline, transaksi disimpan lokal{pending > 0 ? ` (${pending} menunggu sinkron)` : ''}.
                </Alert>
              )}

              {error && <Alert>{error}</Alert>}

              {/* Di tablet/desktop tombol aksi ada di kartu ini; di HP dipindah ke baris
                  lengket di bawah supaya selalu terjangkau. */}
              <div className="hidden md:block">{tombolSimpan('grid-cols-1 lg:grid-cols-2')}</div>
            </div>
          </Card>
        </div>
      </div>

      <ActionBar className="md:hidden">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>
            Total <b className="text-base">{rupiah(total)}</b>
          </span>
          <span className={kembalian < 0 ? 'text-red-700' : 'text-slate-600'}>
            Kembalian <b className="text-base">{rupiah(keranjang.length ? kembalian : 0)}</b>
          </span>
        </div>
        <div className="mt-2">{tombolSimpan('grid-cols-2')}</div>
      </ActionBar>

      <Kalkulator
        open={bukaKalkulator}
        onClose={() => setBukaKalkulator(false)}
        nilai={dibayarAngka}
        total={total}
        onTerapkan={(v) => setDibayar(v > 0 ? String(v) : '')}
      />
    </div>
  );
}

function EditorHarga({
  item,
  onSimpan,
  onBatal,
}: {
  item: KeranjangItem;
  onSimpan: (harga: number, alasan: string) => void;
  onBatal: () => void;
}) {
  const [harga, setHarga] = useState(String(item.harga));
  const [alasan, setAlasan] = useState(item.alasan_ubah_harga);
  const nilai = parseUang(harga);
  const bolehSimpan = alasan.trim().length > 0 && Number.isInteger(nilai) && nilai >= 0;

  return (
    <div className="mt-2 space-y-2 rounded-md bg-amber-50 p-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <Label>Harga baru</Label>
          <Input
            inputMode="numeric"
            value={harga}
            onChange={(e) => setHarga(e.target.value.replace(/[^\d]/g, ''))}
          />
        </div>
        <div>
          <Label>Harga normal</Label>
          <Input value={rupiah(item.harga_asli)} disabled />
        </div>
      </div>
      <div>
        <Label>Alasan ubah harga (wajib)</Label>
        <Input
          value={alasan}
          onChange={(e) => setAlasan(e.target.value)}
          placeholder="mis. pembeli langganan, harga promo"
        />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" ukuran="lg" onClick={onBatal}>
          Batal
        </Button>
        <Button ukuran="lg" disabled={!bolehSimpan} onClick={() => onSimpan(nilai, alasan.trim())}>
          Simpan harga
        </Button>
      </div>
      {!alasan.trim() && <p className="text-xs text-red-700">Alasan wajib diisi sebelum harga bisa disimpan.</p>}
    </div>
  );
}
