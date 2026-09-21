import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ActionBar, Alert, Button, Card, Input, Kosong, Label, Select } from '../components/ui';
import { db } from '../db';
import { rupiah, parseUang } from '../lib/format';
import { bacaTeks, labelProgres, type Progres } from '../lib/ocr';
import { parseStruk, tebakProduk, type BarisStruk } from '../lib/ocrParse';
import { useOnline } from '../lib/useOnline';
import { pullSync } from '../sync';
import type { Product, ProductAlias, StockInBulkResult, StockRow } from '../types';

type BarisScan = {
  kunci: number;
  /** Teks barang apa adanya dari foto — dipakai untuk mengisi product_aliases. */
  nama: string;
  mentah: string;
  productId: string;
  unitId: string;
  qty: string;
  harga: string;
};

/** Normalisasi balasan daftar alias: bisa array langsung atau dibungkus {rows}. */
function bacaAlias(data: unknown): ProductAlias[] {
  if (Array.isArray(data)) return data as ProductAlias[];
  if (data && typeof data === 'object' && Array.isArray((data as { rows?: unknown }).rows)) {
    return (data as { rows: ProductAlias[] }).rows;
  }
  return [];
}

export default function StokScan() {
  const online = useOnline();
  const produk = useLiveQuery(() => db.products.toArray(), [], [] as Product[]);

  const [alias, setAlias] = useState<ProductAlias[]>([]);
  const [catatanAlias, setCatatanAlias] = useState('');

  const [berkas, setBerkas] = useState<File | null>(null);
  const [pratinjau, setPratinjau] = useState('');
  const [menyeret, setMenyeret] = useState(false);
  const [memproses, setMemproses] = useState(false);
  const [progres, setProgres] = useState<Progres | null>(null);
  const [teks, setTeks] = useState('');
  const [pernahBaca, setPernahBaca] = useState(false);

  const [baris, setBaris] = useState<BarisScan[]>([]);
  const [catatan, setCatatan] = useState('');
  const [error, setError] = useState('');
  const [mengirim, setMengirim] = useState(false);
  const [diterapkan, setDiterapkan] = useState<number | null>(null);
  const [stokBaru, setStokBaru] = useState<StockRow[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const kunciRef = useRef(0);

  const produkById = new Map(produk.map((p) => [p.id, p]));

  useEffect(() => {
    if (!berkas) {
      setPratinjau('');
      return;
    }
    const url = URL.createObjectURL(berkas);
    setPratinjau(url);
    return () => URL.revokeObjectURL(url);
  }, [berkas]);

  // Alias dipakai untuk menebak produk; endpoint-nya opsional (404 = belum ada).
  useEffect(() => {
    if (!online) return;
    let batal = false;
    void api
      .get<unknown>('/product-aliases')
      .then((data) => {
        if (!batal) setAlias(bacaAlias(data));
      })
      .catch((e: unknown) => {
        if (batal) return;
        setCatatanAlias(
          e instanceof Error && /404/.test(e.message)
            ? 'Daftar alias produk belum tersedia di server; tebakan produk memakai nama saja.'
            : '',
        );
      });
    return () => {
      batal = true;
    };
  }, [online]);

  function keBaris(hasil: BarisStruk[]): BarisScan[] {
    return hasil.map((b) => {
      const tebakan = tebakProduk(b.nama, produk, alias);
      const p = tebakan === null ? undefined : produkById.get(tebakan);
      return {
        kunci: ++kunciRef.current,
        nama: b.nama,
        mentah: b.mentah,
        productId: p ? String(p.id) : '',
        unitId: p?.units.length ? String(p.units[0].unit_id) : '',
        qty: String(b.qty),
        harga: b.harga ? String(b.harga) : '',
      };
    });
  }

  function pilihBerkas(f: File | null | undefined) {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setError('Berkas harus berupa gambar (foto struk).');
      return;
    }
    setError('');
    setBerkas(f);
    setTeks('');
    setPernahBaca(false);
    setBaris([]);
    setDiterapkan(null);
    setStokBaru([]);
  }

  async function baca() {
    if (!berkas) {
      setError('Pilih atau jatuhkan foto struk terlebih dahulu.');
      return;
    }
    setError('');
    setDiterapkan(null);
    setStokBaru([]);
    setMemproses(true);
    setProgres(null);
    try {
      const hasilTeks = await bacaTeks(berkas, setProgres);
      setTeks(hasilTeks);
      setPernahBaca(true);
      setBaris(keBaris(parseStruk(hasilTeks)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal membaca teks dari foto');
      setBaris([]);
    } finally {
      setMemproses(false);
      setProgres(null);
    }
  }

  function ubah(kunci: number, patch: Partial<BarisScan>) {
    setBaris((lama) => lama.map((b) => (b.kunci === kunci ? { ...b, ...patch } : b)));
  }

  function tambahBaris() {
    setBaris((lama) => [
      ...lama,
      { kunci: ++kunciRef.current, nama: '', mentah: '', productId: '', unitId: '', qty: '1', harga: '' },
    ]);
  }

  function gantiProduk(b: BarisScan, id: string) {
    const p = id ? produkById.get(Number(id)) : undefined;
    ubah(b.kunci, { productId: id, unitId: p?.units.length ? String(p.units[0].unit_id) : '' });
  }

  function geserQty(b: BarisScan, delta: number) {
    const baru = Math.max(1, parseUang(b.qty) + delta);
    ubah(b.kunci, { qty: String(baru) });
  }

  async function terapkan() {
    setError('');
    setDiterapkan(null);
    const kurang = baris.filter((b) => !b.productId || !b.unitId || parseUang(b.qty) <= 0);
    if (kurang.length) {
      setError(
        `Baris ${kurang.map((b) => baris.indexOf(b) + 1).join(', ')} belum lengkap. Pilih produk, satuan, dan qty lebih dari 0 (atau hapus barisnya).`,
      );
      return;
    }
    setMengirim(true);
    try {
      // Hanya nama yang berbeda dari nama produk yang disimpan sebagai alias baru.
      const peta = new Map<string, number>();
      for (const b of baris) {
        const namaProduk = produkById.get(Number(b.productId))?.name ?? '';
        if (!b.nama.trim() || b.nama.trim().toLowerCase() === namaProduk.trim().toLowerCase()) continue;
        peta.set(b.nama.trim(), Number(b.productId));
      }

      const res = await api.post<StockInBulkResult>('/stock/in/bulk', {
        items: baris.map((b) => ({
          product_id: Number(b.productId),
          unit_id: Number(b.unitId),
          qty: parseUang(b.qty),
        })),
        note: catatan.trim() || null,
        aliases: [...peta].map(([a, product_id]) => ({ alias: a, product_id })),
      });

      setDiterapkan(typeof res.applied === 'number' ? res.applied : baris.length);
      const ids = new Set(baris.map((b) => Number(b.productId)));
      await pullSync();
      setStokBaru((await db.cachedStock.toArray()).filter((s) => ids.has(s.product_id)));
      setBaris([]);
      setCatatan('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menerapkan stok');
    } finally {
      setMengirim(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Scan Struk</h1>
          <p className="text-sm text-slate-500">Foto nota supplier, lalu periksa hasilnya sebelum masuk stok.</p>
        </div>
        <Link
          to="/stok"
          className="inline-flex min-h-sentuh shrink-0 items-center text-sm font-medium text-teal-700 underline"
        >
          ← Kembali ke Stok
        </Link>
      </div>

      {!online && <Alert tone="info">Baca foto masih bisa, tetapi menerapkan ke stok butuh koneksi.</Alert>}
      {catatanAlias && <Alert tone="info">{catatanAlias}</Alert>}

      <Card title="1. Ambil Foto Struk">
        <div className="space-y-3">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setMenyeret(true);
            }}
            onDragLeave={() => setMenyeret(false)}
            onDrop={(e) => {
              e.preventDefault();
              setMenyeret(false);
              pilihBerkas(e.dataTransfer.files?.[0]);
            }}
            className={`rounded-lg border-2 border-dashed px-3 py-6 text-center ${
              menyeret ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-slate-50'
            }`}
          >
            <p className="text-sm text-slate-600">Jatuhkan foto struk di sini (komputer)</p>
            <p className="mt-1 text-xs text-slate-500">atau</p>
            <Button ukuran="lg" className="mt-3 w-full sm:w-auto" onClick={() => inputRef.current?.click()}>
              Buka Kamera / Pilih Foto
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                pilihBerkas(e.target.files?.[0]);
                // Supaya memilih berkas yang sama lagi tetap memicu perubahan.
                e.target.value = '';
              }}
            />
          </div>

          {pratinjau && (
            <div className="space-y-2">
              <img src={pratinjau} alt="Pratinjau struk" className="max-h-72 w-full rounded-md border border-slate-200 object-contain" />
              <p className="truncate text-xs text-slate-500">{berkas?.name}</p>
            </div>
          )}

          {memproses && (
            <div className="space-y-1">
              <p className="text-sm text-slate-600">{labelProgres(progres?.status ?? '')}…</p>
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-teal-600 transition-all"
                  style={{ width: `${Math.round((progres?.progress ?? 0) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-slate-500">{Math.round((progres?.progress ?? 0) * 100)}%</p>
            </div>
          )}

          <Button ukuran="lg" className="w-full" onClick={() => void baca()} disabled={!berkas || memproses}>
            {memproses ? 'Membaca…' : 'Baca Teks dari Foto'}
          </Button>
        </div>
      </Card>

      {teks && (
        <Card title="2. Teks Hasil Pembacaan">
          <details>
            <summary className="min-h-sentuh cursor-pointer py-2 text-sm font-medium text-teal-700">
              Lihat teks mentah (untuk memeriksa hasil baca)
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-50 p-3 text-xs text-slate-700">
              {teks}
            </pre>
          </details>
        </Card>
      )}

      {pernahBaca && (
        <Card
          title={`3. Periksa Baris (${baris.length})`}
          actions={
            <Button variant="secondary" onClick={tambahBaris}>
              + Tambah baris manual
            </Button>
          }
        >
          <div className="space-y-3">
            {!baris.length && !diterapkan && (
              <Alert tone="info">
                Tidak ada baris yang bisa dibaca dari foto ini. Tambahkan baris manual lewat tombol di atas.
              </Alert>
            )}

            {baris.map((b, i) => {
              const p = b.productId ? produkById.get(Number(b.productId)) : undefined;
              const qty = parseUang(b.qty);
              const harga = parseUang(b.harga);
              return (
                <div key={b.kunci} className="min-w-0 rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500">Baris {i + 1}</p>
                      <p className="break-words text-sm font-semibold text-slate-700">
                        {b.nama || b.mentah || 'Baris manual'}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Hapus baris ${i + 1}`}
                      onClick={() => setBaris((lama) => lama.filter((x) => x.kunci !== b.kunci))}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-lg text-red-600 hover:bg-red-50"
                    >
                      ✕
                    </button>
                  </div>

                  {!b.productId && (
                    <div className="mb-2">
                      <Alert tone="info">
                        Produk belum dikenali dari foto — pilih produk yang benar untuk baris ini.
                      </Alert>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div>
                      <Label>Produk</Label>
                      <Select value={b.productId} onChange={(e) => gantiProduk(b, e.target.value)}>
                        <option value="">Pilih produk…</option>
                        {produk.map((pr) => (
                          <option key={pr.id} value={pr.id}>
                            {pr.name}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div>
                      <Label>Satuan</Label>
                      <Select value={b.unitId} onChange={(e) => ubah(b.kunci, { unitId: e.target.value })} disabled={!p}>
                        <option value="">Pilih satuan…</option>
                        {(p?.units ?? []).map((u) => (
                          <option key={u.unit_id} value={u.unit_id}>
                            {u.unit_name} (isi {u.isi})
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <Label>Qty</Label>
                        <div className="flex items-stretch gap-2">
                          <Button
                            variant="secondary"
                            aria-label="Kurangi qty"
                            onClick={() => geserQty(b, -1)}
                            className="w-12 shrink-0 text-lg"
                          >
                            −
                          </Button>
                          <Input
                            inputMode="numeric"
                            className="text-center"
                            value={b.qty}
                            onChange={(e) => ubah(b.kunci, { qty: e.target.value })}
                          />
                          <Button
                            variant="secondary"
                            aria-label="Tambah qty"
                            onClick={() => geserQty(b, 1)}
                            className="w-12 shrink-0 text-lg"
                          >
                            +
                          </Button>
                        </div>
                      </div>
                      <div>
                        <Label>Harga satuan</Label>
                        <Input
                          inputMode="numeric"
                          placeholder="0"
                          value={b.harga}
                          onChange={(e) => ubah(b.kunci, { harga: e.target.value })}
                        />
                      </div>
                    </div>

                    <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      Subtotal: <b>{rupiah(qty * harga)}</b>
                    </p>
                  </div>
                </div>
              );
            })}

            <div>
              <Label>Catatan (opsional)</Label>
              <Input
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                placeholder="mis. kulakan nota Wingsfood"
              />
            </div>

            {error && <Alert>{error}</Alert>}

            {diterapkan !== null && (
              <Alert tone="sukses">
                Berhasil: {diterapkan} baris stok ditambahkan.
                {stokBaru.length > 0 && (
                  <ul className="mt-1 list-disc pl-5">
                    {stokBaru.map((s) => (
                      <li key={s.product_id}>
                        {s.name}: <b>{s.display}</b>
                      </li>
                    ))}
                  </ul>
                )}
              </Alert>
            )}
          </div>
        </Card>
      )}

      {!pernahBaca && <Kosong>Ambil foto struk untuk mulai.</Kosong>}

      {baris.length > 0 && (
        <ActionBar>
          <Button ukuran="lg" className="w-full" onClick={() => void terapkan()} disabled={!online || mengirim}>
            {mengirim ? 'Menerapkan…' : 'Terapkan ke Stok'}
          </Button>
        </ActionBar>
      )}
    </div>
  );
}
