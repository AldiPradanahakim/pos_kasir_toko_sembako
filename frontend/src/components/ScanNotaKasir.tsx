import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { db } from '../db';
import { rupiah } from '../lib/format';
import {
  bacaDaftarAlias,
  daftarSatuan,
  pilihSatuan,
  susunBarisNota,
  type BarisNotaKasir,
} from '../lib/notaKasir';
import { bacaTeks, labelProgres, type Progres } from '../lib/ocr';
import { parseStruk } from '../lib/ocrParse';
import { useOnline } from '../lib/useOnline';
import type { Product, ProductAlias, Unit } from '../types';
import CariSelect from './CariSelect';
import { Alert, Button, Input, Kosong, Label, Modal, Select } from './ui';

export type PilihanNota = { productId: number; unitId: number; qty: number };

/**
 * Scan nota daftar belanja pelanggan di layar kasir.
 *
 * Nota dibaca di perangkat (tesseract.js), lalu hasilnya ditampilkan sebagai daftar
 * yang WAJIB diperiksa kasir sebelum masuk keranjang. Harga tidak diambil dari nota:
 * nota pelanggan sering tanpa harga, dan nota supplier berisi harga modal — harga jual
 * tetap dari master produk.
 */
export default function ScanNotaKasir({
  open,
  onTutup,
  produk,
  onMasukkan,
}: {
  open: boolean;
  onTutup: () => void;
  produk: Product[];
  /** Sisipkan ke keranjang; `ditolak` = indeks `pilihan` yang tidak masuk + alasannya. */
  onMasukkan: (pilihan: PilihanNota[]) => { ok: number; gagal: string[]; ditolak: number[] };
}) {
  const online = useOnline();
  const satuanMaster = useLiveQuery(() => db.units.toArray(), [], [] as Unit[]);

  const [berkas, setBerkas] = useState<File | null>(null);
  const [pratinjau, setPratinjau] = useState('');
  const [menyeret, setMenyeret] = useState(false);
  const [memproses, setMemproses] = useState(false);
  const [progres, setProgres] = useState<Progres | null>(null);
  const [teks, setTeks] = useState('');
  const [pernahBaca, setPernahBaca] = useState(false);
  const [baris, setBaris] = useState<BarisNotaKasir[]>([]);
  const [alias, setAlias] = useState<ProductAlias[]>([]);
  const [error, setError] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const kunciRef = useRef(0);

  const produkById = useMemo(() => new Map(produk.map((p) => [p.id, p])), [produk]);
  const opsiProduk = useMemo(
    () => produk.map((p) => ({ value: p.id, label: p.name, hint: p.barcode ?? p.category_name ?? undefined })),
    [produk],
  );

  /** Alias dari koreksi kasir sebelumnya: dipakai lebih dulu saat menebak produk. */
  useEffect(() => {
    if (!open || !online) return;
    let batal = false;
    api
      .getSilent<unknown>('/product-aliases')
      .then((data) => {
        if (!batal) setAlias(bacaDaftarAlias(data));
      })
      // Alias hanya memperbaiki tebakan; tanpa itu tebakan memakai nama produk saja.
      .catch(() => setAlias([]));
    return () => {
      batal = true;
    };
  }, [open, online]);

  useEffect(() => {
    if (!berkas) {
      setPratinjau('');
      return;
    }
    const url = URL.createObjectURL(berkas);
    setPratinjau(url);
    return () => URL.revokeObjectURL(url);
  }, [berkas]);

  // Modal ditutup: buang foto dan hasil baca supaya nota berikutnya tidak tercampur.
  useEffect(() => {
    if (open) return;
    setBerkas(null);
    setTeks('');
    setPernahBaca(false);
    setBaris([]);
    setError('');
    setProgres(null);
  }, [open]);

  function pilihBerkas(f: File | null | undefined) {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setError('Berkas harus berupa gambar (foto atau tangkapan layar nota).');
      return;
    }
    setError('');
    setBerkas(f);
    setTeks('');
    setPernahBaca(false);
    setBaris([]);
  }

  async function baca() {
    if (!berkas) {
      setError('Pilih atau jatuhkan foto nota terlebih dahulu.');
      return;
    }
    setError('');
    setMemproses(true);
    setProgres(null);
    try {
      const hasilTeks = await bacaTeks(berkas, setProgres);
      setTeks(hasilTeks);
      setPernahBaca(true);
      const { baris: hasil, kunciBerikut } = susunBarisNota(
        parseStruk(hasilTeks, { tanpaHarga: true, satuan: daftarSatuan(produk, satuanMaster) }),
        produk,
        alias,
        kunciRef.current,
      );
      kunciRef.current = kunciBerikut;
      setBaris(hasil);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal membaca teks dari foto');
      setBaris([]);
    } finally {
      setMemproses(false);
      setProgres(null);
    }
  }

  function ubah(kunci: number, patch: Partial<BarisNotaKasir>) {
    setBaris((lama) => lama.map((b) => (b.kunci === kunci ? { ...b, ...patch } : b)));
  }

  function gantiProduk(b: BarisNotaKasir, id: string) {
    const p = id ? produkById.get(Number(id)) : undefined;
    if (!p) {
      ubah(b.kunci, { productId: null, unitId: null, pilih: false });
      return;
    }
    const { unit } = pilihSatuan(p.units, b.satuanNota);
    ubah(b.kunci, { productId: p.id, unitId: unit?.unit_id ?? null, pilih: true, catatan: null });
  }

  const dipilih = baris.filter((b) => b.pilih && b.productId && b.unitId);
  const belumLengkap = baris.filter((b) => b.pilih && (!b.productId || !b.unitId));
  /** Total yang dilihat kasir: berapa jenis barang dan berapa qty seluruhnya. */
  const totalQty = dipilih.reduce((s, b) => s + b.qty, 0);
  const totalPerkiraan = dipilih.reduce((s, b) => {
    const p = produkById.get(b.productId!);
    const u = p?.units.find((x) => x.unit_id === b.unitId);
    return s + (u?.harga_jual ?? 0) * b.qty;
  }, 0);

  function masukkan() {
    setError('');
    if (!dipilih.length) {
      setError('Belum ada baris yang dicentang. Centang barang yang mau dimasukkan, atau pilih produknya dulu.');
      return;
    }
    const pilihan = dipilih.map((b) => ({ productId: b.productId!, unitId: b.unitId!, qty: b.qty }));
    const hasil = onMasukkan(pilihan);
    if (hasil.ok === 0) {
      setError(hasil.gagal.join(' ') || 'Tidak ada barang yang bisa dimasukkan.');
      return;
    }
    // Baris yang ditolak (stok kurang / harga jual kosong) tetap tampil supaya bisa diperbaiki.
    const kunciDitolak = new Set(hasil.ditolak.map((i) => dipilih[i]?.kunci).filter((k) => k !== undefined));
    if (kunciDitolak.size) {
      setBaris((lama) => lama.map((b) => (kunciDitolak.has(b.kunci) ? b : { ...b, pilih: false })));
      setError(hasil.gagal.join(' '));
      return;
    }
    onTutup();
  }

  return (
    <Modal open={open} title="Scan Nota Belanja" onClose={onTutup} width="max-w-2xl" tinggiPenuh>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Foto nota daftar belanja pelanggan, lalu periksa daftar barangnya. Harga diambil dari harga jual master produk.
        </p>
        {!online && (
          <Alert tone="info">
            Offline: membaca foto masih bisa kalau data bahasa OCR sudah pernah terunduh. Kalau belum, sambungkan internet dulu.
          </Alert>
        )}

        <div className="space-y-3 rounded-lg border border-slate-200 p-3">
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
            className={`rounded-lg border-2 border-dashed px-3 py-5 text-center ${
              menyeret ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-slate-50'
            }`}
          >
            <p className="text-sm text-slate-600">Jatuhkan foto nota di sini (komputer)</p>
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
              <img
                src={pratinjau}
                alt="Pratinjau nota"
                className="max-h-56 w-full rounded-md border border-slate-200 object-contain"
              />
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
            </div>
          )}

          <Button ukuran="lg" className="w-full" onClick={() => void baca()} disabled={!berkas || memproses}>
            {memproses ? 'Membaca…' : 'Baca Nota'}
          </Button>
        </div>

        {teks && (
          <details>
            <summary className="min-h-sentuh cursor-pointer py-2 text-sm font-medium text-teal-700">
              Lihat teks hasil pembacaan
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-50 p-3 text-xs text-slate-700">
              {teks}
            </pre>
          </details>
        )}

        {pernahBaca && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-700">
                Periksa barang ({dipilih.length} dari {baris.length} dicentang)
              </p>
              <p className="text-sm text-slate-700" aria-live="polite">
                Total <b>{dipilih.length}</b> barang · <b>{totalQty}</b> qty
              </p>
              {baris.length > 0 && (
                <button
                  type="button"
                  className="min-h-sentuh text-sm font-medium text-teal-700 underline"
                  onClick={() =>
                    setBaris((lama) => lama.map((b) => ({ ...b, pilih: Boolean(b.productId && b.unitId) })))
                  }
                >
                  Centang semua yang dikenali
                </button>
              )}
            </div>

            {!baris.length && (
              <Alert tone="info">
                Tidak ada barang yang terbaca dari gambar ini. Coba foto lebih terang dan lurus, atau tambahkan barang lewat
                kotak cari.
              </Alert>
            )}

            {baris.map((b, i) => {
              const p = b.productId ? produkById.get(b.productId) : undefined;
              const u = p?.units.find((x) => x.unit_id === b.unitId);
              return (
                <div
                  key={b.kunci}
                  className={`rounded-lg border p-3 ${b.pilih ? 'border-teal-300 bg-teal-50/40' : 'border-slate-200'}`}
                >
                  <div className="mb-2 flex items-start gap-2">
                    <input
                      type="checkbox"
                      id={`nota-${b.kunci}`}
                      checked={b.pilih}
                      onChange={(e) => ubah(b.kunci, { pilih: e.target.checked })}
                      className="mt-1 h-5 w-5 shrink-0 accent-teal-700"
                    />
                    <label htmlFor={`nota-${b.kunci}`} className="min-w-0 flex-1 cursor-pointer">
                      <span className="block text-xs text-slate-500">Baris {i + 1} dari nota</span>
                      <span className="block break-words text-sm font-semibold text-slate-700">{b.nama}</span>
                      {b.satuanNota && (
                        <span className="block text-xs text-slate-500">Tertulis: {b.satuanNota}</span>
                      )}
                    </label>
                    <button
                      type="button"
                      aria-label={`Hapus baris ${i + 1}`}
                      onClick={() => setBaris((lama) => lama.filter((x) => x.kunci !== b.kunci))}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-lg text-red-700 hover:bg-red-50"
                    >
                      ✕
                    </button>
                  </div>

                  {b.catatan && <p className="mb-2 rounded-md bg-sky-50 px-2 py-1.5 text-sm text-sky-800">{b.catatan}</p>}

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Label>Produk</Label>
                      <CariSelect
                        value={b.productId ? String(b.productId) : ''}
                        onChange={(v) => gantiProduk(b, v)}
                        options={opsiProduk}
                        ariaLabel={`Produk baris ${i + 1}`}
                        placeholder="Ketik nama atau barcode produk…"
                        kosong="Tidak ada produk yang cocok."
                      />
                    </div>
                    <div>
                      <Label>Jenis / satuan</Label>
                      <Select
                        value={b.unitId ? String(b.unitId) : ''}
                        onChange={(e) => ubah(b.kunci, { unitId: e.target.value ? Number(e.target.value) : null })}
                        disabled={!p}
                        aria-label={`Satuan baris ${i + 1}`}
                      >
                        <option value="">Pilih satuan…</option>
                        {(p?.units ?? []).map((x) => (
                          <option key={x.unit_id} value={x.unit_id}>
                            {x.unit_name} ({rupiah(x.harga_jual)})
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label>Qty</Label>
                      <div className="flex items-stretch gap-2">
                        <Button
                          variant="secondary"
                          aria-label="Kurangi qty"
                          disabled={b.qty <= 1}
                          onClick={() => ubah(b.kunci, { qty: Math.max(1, b.qty - 1) })}
                          className="w-12 shrink-0 text-lg"
                        >
                          −
                        </Button>
                        <Input
                          inputMode="numeric"
                          className="text-center"
                          aria-label={`Qty baris ${i + 1}`}
                          value={String(b.qty)}
                          onChange={(e) => {
                            const n = Number(e.target.value.replace(/[^\d]/g, ''));
                            ubah(b.kunci, { qty: n > 0 ? n : 1 });
                          }}
                        />
                        <Button
                          variant="secondary"
                          aria-label="Tambah qty"
                          onClick={() => ubah(b.kunci, { qty: b.qty + 1 })}
                          className="w-12 shrink-0 text-lg"
                        >
                          +
                        </Button>
                      </div>
                    </div>
                  </div>

                  <p className="mt-2 text-sm text-slate-700">
                    {u ? (
                      <>
                        {rupiah(u.harga_jual)} × {b.qty} = <b>{rupiah(u.harga_jual * b.qty)}</b>
                      </>
                    ) : (
                      <span className="text-slate-500">Pilih produk dan satuan untuk melihat harganya.</span>
                    )}
                  </p>
                </div>
              );
            })}

            {belumLengkap.length > 0 && (
              <Alert tone="info">
                {belumLengkap.length} baris dicentang tetapi belum punya produk/satuan, jadi tidak akan dimasukkan.
              </Alert>
            )}
          </div>
        )}

        {error && <Alert>{error}</Alert>}
        {!pernahBaca && !berkas && <Kosong>Ambil foto nota untuk mulai memindai.</Kosong>}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {dipilih.length > 0 && (
            <p className="text-sm text-slate-700 sm:mr-auto">
              <b>{dipilih.length}</b> barang · <b>{totalQty}</b> qty · perkiraan <b>{rupiah(totalPerkiraan)}</b>
            </p>
          )}
          <Button variant="secondary" ukuran="lg" onClick={onTutup}>
            Batal
          </Button>
          <Button ukuran="lg" onClick={masukkan} disabled={!dipilih.length}>
            Masukkan ke Keranjang
          </Button>
        </div>
      </div>
    </Modal>
  );
}
