import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { api } from '../api';
import { Alert, Button, Card, Input, Kosong, Label, Modal, Select } from '../components/ui';
import { db } from '../db';
import { parseUang, rupiah } from '../lib/format';
import { useOnline } from '../lib/useOnline';
import { pullSync } from '../sync';
import type { Product } from '../types';

interface BarisUnit {
  unit_id: number;
  isi: string;
  harga_jual: string;
  harga_modal: string;
  barcode: string;
}

const barisKosong = (unit_id: number): BarisUnit => ({
  unit_id,
  isi: '1',
  harga_jual: '',
  harga_modal: '',
  barcode: '',
});

export default function Produk() {
  const online = useOnline();
  const products = useLiveQuery(() => db.products.toArray(), [], [] as Product[]);
  const categories = useLiveQuery(() => db.categories.toArray(), [], []);
  const units = useLiveQuery(() => db.units.toArray(), [], []);

  const [cari, setCari] = useState('');
  const [buka, setBuka] = useState(false);
  const [edit, setEdit] = useState<Product | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [baseUnit, setBaseUnit] = useState('pcs');
  const [barcode, setBarcode] = useState('');
  const [aktif, setAktif] = useState(true);
  const [baris, setBaris] = useState<BarisUnit[]>([]);

  const daftar = products.filter((p) => {
    const q = cari.trim().toLowerCase();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      (p.category_name ?? '').toLowerCase().includes(q) ||
      (p.barcode ?? '').toLowerCase().includes(q)
    );
  });

  function bukaTambah() {
    setEdit(null);
    setName('');
    setCategoryId(categories[0] ? String(categories[0].id) : '');
    setBaseUnit('pcs');
    setBarcode('');
    setAktif(true);
    setBaris([barisKosong(units[0]?.id ?? 0)]);
    setError('');
    setBuka(true);
  }

  function bukaEdit(p: Product) {
    setEdit(p);
    setName(p.name);
    setCategoryId(p.category_id ? String(p.category_id) : '');
    setBaseUnit(p.base_unit);
    setBarcode(p.barcode ?? '');
    setAktif(p.is_active);
    setBaris(
      p.units.map((u) => ({
        unit_id: u.unit_id,
        isi: String(u.isi),
        harga_jual: String(u.harga_jual),
        harga_modal: String(u.harga_modal),
        barcode: u.barcode ?? '',
      })),
    );
    setError('');
    setBuka(true);
  }

  function ubahBaris(idx: number, patch: Partial<BarisUnit>) {
    setBaris((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  }

  async function simpan(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Nama produk wajib diisi.');
      return;
    }
    if (!baris.length) {
      setError('Minimal satu satuan harus diisi.');
      return;
    }
    const dipakai = new Set<number>();
    for (const [i, b] of baris.entries()) {
      const isi = parseInt(b.isi, 10);
      if (!b.unit_id) {
        setError(`Baris ${i + 1}: satuan belum dipilih.`);
        return;
      }
      if (dipakai.has(b.unit_id)) {
        setError(`Baris ${i + 1}: satuan yang sama dipakai dua kali.`);
        return;
      }
      dipakai.add(b.unit_id);
      if (!Number.isInteger(isi) || isi <= 0) {
        setError(`Baris ${i + 1}: isi harus bilangan bulat lebih dari 0.`);
        return;
      }
      const jual = parseUang(b.harga_jual);
      const modal = parseUang(b.harga_modal);
      if (!Number.isInteger(jual) || jual < 0 || !Number.isInteger(modal) || modal < 0) {
        setError(`Baris ${i + 1}: harga jual/modal harus bilangan bulat tidak negatif.`);
        return;
      }
    }

    const payload = {
      name: name.trim(),
      category_id: categoryId ? Number(categoryId) : null,
      base_unit: baseUnit,
      barcode: barcode.trim() || null,
      is_active: aktif,
      units: baris.map((b) => ({
        unit_id: b.unit_id,
        isi: parseInt(b.isi, 10),
        harga_jual: parseUang(b.harga_jual),
        harga_modal: parseUang(b.harga_modal),
        barcode: b.barcode.trim() || null,
      })),
    };

    setLoading(true);
    try {
      if (edit) await api.put(`/products/${edit.id}`, payload);
      else await api.post('/products', payload);
      await pullSync();
      setBuka(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan produk');
    } finally {
      setLoading(false);
    }
  }

  async function hapus(p: Product) {
    if (!window.confirm(`Nonaktifkan produk "${p.name}"?`)) return;
    setError('');
    try {
      await api.del(`/products/${p.id}`);
      await pullSync();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus produk');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="min-w-0 text-lg font-semibold">Produk</h1>
        <Button onClick={bukaTambah} disabled={!online}>
          + Tambah Produk
        </Button>
      </div>

      {!online && <Alert tone="info">Ubah data produk memerlukan koneksi internet.</Alert>}
      {error && <Alert>{error}</Alert>}

      <Card title={`Daftar Produk (${daftar.length})`}>
        <div className="mb-3 max-w-sm">
          <Input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari nama / barcode…" />
        </div>
        {/* Di HP daftar dibaca sebagai kartu supaya 7 kolom tabel tidak melebarkan halaman. */}
        <ul className="space-y-2 md:hidden">
          {daftar.map((p) => (
            <li key={p.id} className="min-w-0 rounded-md border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-words font-medium">{p.name}</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                    p.is_active ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {p.is_active ? 'Aktif' : 'Nonaktif'}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {p.category_name ?? 'Tanpa kategori'} · satuan dasar {p.base_unit}
                {p.barcode ? ` · ${p.barcode}` : ''}
              </p>
              <ul className="mt-2 space-y-0.5">
                {p.units.map((u) => (
                  <li key={u.unit_id} className="text-xs">
                    {u.unit_name} · isi {u.isi} · jual {rupiah(u.harga_jual)} · modal {rupiah(u.harga_modal)}
                    {u.barcode ? ` · ${u.barcode}` : ''}
                  </li>
                ))}
                {!p.units.length && <li className="text-xs text-red-700">Belum ada satuan</li>}
              </ul>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <Button variant="ghost" onClick={() => bukaEdit(p)} disabled={!online}>
                  Ubah
                </Button>
                <Button variant="ghost" className="text-red-700" onClick={() => hapus(p)} disabled={!online}>
                  Nonaktifkan
                </Button>
              </div>
            </li>
          ))}
        </ul>

        <div className="tabel-scroll hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <th className="py-2">Nama</th>
                <th className="py-2">Kategori</th>
                <th className="py-2">Base</th>
                <th className="py-2">Barcode</th>
                <th className="py-2">Satuan</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {daftar.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 align-top">
                  <td className="min-w-0 break-words py-2 font-medium">{p.name}</td>
                  <td className="py-2">{p.category_name ?? '-'}</td>
                  <td className="py-2">{p.base_unit}</td>
                  <td className="py-2 font-mono text-xs">{p.barcode ?? '-'}</td>
                  <td className="py-2">
                    <ul className="space-y-0.5">
                      {p.units.map((u) => (
                        <li key={u.unit_id} className="text-xs">
                          {u.unit_name} · isi {u.isi} · jual {rupiah(u.harga_jual)} · modal {rupiah(u.harga_modal)}
                          {u.barcode ? ` · ${u.barcode}` : ''}
                        </li>
                      ))}
                      {!p.units.length && <li className="text-xs text-red-700">Belum ada satuan</li>}
                    </ul>
                  </td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        p.is_active ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {p.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-2 text-right">
                    <Button variant="ghost" onClick={() => bukaEdit(p)} disabled={!online}>
                      Ubah
                    </Button>
                    <Button variant="ghost" className="text-red-700" onClick={() => hapus(p)} disabled={!online}>
                      Nonaktifkan
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!daftar.length && <Kosong>Belum ada produk.</Kosong>}
      </Card>

      <Modal
        open={buka}
        title={edit ? `Ubah Produk: ${edit.name}` : 'Tambah Produk'}
        onClose={() => setBuka(false)}
        width="max-w-3xl"
      >
        <form onSubmit={simpan} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label>Nama produk</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            <div>
              <Label>Kategori</Label>
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Tanpa kategori</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Satuan dasar (base_unit)</Label>
              <Select value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)}>
                <option value="pcs">pcs</option>
                <option value="gram">gram</option>
              </Select>
            </div>
            <div>
              <Label>Barcode produk (opsional)</Label>
              <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            </div>
          </div>

          {/* Baris checkbox setinggi 44px supaya nyaman dipencet di HP. */}
          <label className="flex min-h-sentuh cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0"
              checked={aktif}
              onChange={(e) => setAktif(e.target.checked)}
            />
            Aktif
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">Satuan & harga</span>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setBaris((prev) => [...prev, barisKosong(units[0]?.id ?? 0)])}
              >
                + Baris
              </Button>
            </div>

            <div className="space-y-2">
              {baris.map((b, i) => (
                <div
                  key={i}
                  className="grid min-w-0 grid-cols-1 gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-2 lg:grid-cols-6"
                >
                  <div className="min-w-0">
                    <Label>Satuan</Label>
                    <Select value={b.unit_id || ''} onChange={(e) => ubahBaris(i, { unit_id: Number(e.target.value) })}>
                      <option value="">Pilih…</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="min-w-0">
                    <Label>Isi (per {baseUnit})</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={b.isi}
                      onChange={(e) => ubahBaris(i, { isi: e.target.value.replace(/[^\d]/g, '') })}
                    />
                  </div>
                  <div className="min-w-0">
                    <Label>Harga jual</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={b.harga_jual}
                      onChange={(e) => ubahBaris(i, { harga_jual: e.target.value.replace(/[^\d]/g, '') })}
                    />
                  </div>
                  <div className="min-w-0">
                    <Label>Harga modal</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={b.harga_modal}
                      onChange={(e) => ubahBaris(i, { harga_modal: e.target.value.replace(/[^\d]/g, '') })}
                    />
                  </div>
                  <div className="min-w-0">
                    <Label>Barcode satuan</Label>
                    <Input value={b.barcode} onChange={(e) => ubahBaris(i, { barcode: e.target.value })} />
                  </div>
                  <div className="flex min-w-0 items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-red-700"
                      onClick={() => setBaris((prev) => prev.filter((_, x) => x !== i))}
                      disabled={baris.length <= 1}
                    >
                      Hapus baris
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Isi = jumlah satuan dasar dalam satu satuan ini. Contoh: dus isi 40 pcs → isi 40. Harga tiap satuan
              diinput manual (tidak diturunkan otomatis).
            </p>
          </div>

          {error && <Alert>{error}</Alert>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setBuka(false)}>
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
