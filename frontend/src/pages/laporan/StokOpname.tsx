import { useLiveQuery } from 'dexie-react-hooks';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { ActionBar, Alert, Button, Card, Input, Kosong, Label } from '../../components/ui';
import { db } from '../../db';
import { parseUang } from '../../lib/format';
import { useOnline } from '../../lib/useOnline';
import { pullSync } from '../../sync';
import type { Product, StockRow } from '../../types';
import { normalisasi, TabelLaporan } from './tabel';

type BarisHitung = {
  id: number;
  nama: string;
  sistem: number;
  display: string;
};

/** Baris di-memo supaya mengetik di satu baris tidak me-render ulang ratusan produk. */
const BarisOpname = memo(function BarisOpname({
  baris,
  nilai,
  onUbah,
}: {
  baris: BarisHitung;
  nilai: string;
  onUbah: (id: number, nilai: string) => void;
}) {
  const selisih = nilai === '' ? null : parseUang(nilai) - baris.sistem;
  const geser = (delta: number) => {
    const dasar = nilai === '' ? baris.sistem : parseUang(nilai);
    onUbah(baris.id, String(Math.max(0, dasar + delta)));
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-2 last:border-0">
      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate text-sm font-medium">{baris.nama}</p>
        <p className="text-xs text-slate-500">Sistem: {baris.display}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          ukuran="sm"
          className="w-12 shrink-0 text-lg"
          aria-label={`Kurangi ${baris.nama}`}
          onClick={() => geser(-1)}
        >
          −
        </Button>
        <Input
          type="text"
          inputMode="numeric"
          className="w-20 shrink-0 text-center"
          placeholder={String(baris.sistem)}
          aria-label={`Stok fisik ${baris.nama}`}
          value={nilai}
          onChange={(e) => onUbah(baris.id, e.target.value)}
        />
        <Button
          variant="secondary"
          ukuran="sm"
          className="w-12 shrink-0 text-lg"
          aria-label={`Tambah ${baris.nama}`}
          onClick={() => geser(1)}
        >
          +
        </Button>
      </div>
      <div className="w-24 shrink-0 text-right">
        {selisih === null ? (
          <span className="text-xs text-slate-500">belum diisi</span>
        ) : (
          <span
            className={`inline-block rounded-md px-2 py-1 text-xs font-semibold ${
              selisih === 0
                ? 'bg-slate-100 text-slate-600'
                : selisih > 0
                  ? 'bg-teal-50 text-teal-700'
                  : 'bg-red-50 text-red-700'
            }`}
          >
            {selisih > 0 ? `+${selisih}` : selisih} {selisih === 0 ? 'sesuai' : selisih > 0 ? 'lebih' : 'kurang'}
          </span>
        )}
      </div>
    </div>
  );
});

export default function StokOpname() {
  const online = useOnline();
  const produk = useLiveQuery(() => db.products.toArray(), [], [] as Product[]);
  const stok = useLiveQuery(() => db.cachedStock.toArray(), [], [] as StockRow[]);

  const [cari, setCari] = useState('');
  const [fisik, setFisik] = useState<Record<number, string>>({});
  const [memuat, setMemuat] = useState(false);
  const [error, setError] = useState('');
  const [pesan, setPesan] = useState('');
  const [riwayat, setRiwayat] = useState<Record<string, unknown>[]>([]);
  const [errorRiwayat, setErrorRiwayat] = useState('');

  const semua = useMemo<BarisHitung[]>(() => {
    const peta = new Map(stok.map((s) => [s.product_id, s]));
    return produk
      .map((p) => {
        const s = peta.get(p.id);
        return {
          id: p.id,
          nama: p.name,
          sistem: s?.stok_base ?? 0,
          display: s?.display ?? '0',
        };
      })
      .sort((a, b) => Number(b.sistem !== 0) - Number(a.sistem !== 0) || a.nama.localeCompare(b.nama, 'id'));
  }, [produk, stok]);

  const terlihat = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return q ? semua.filter((b) => b.nama.toLowerCase().includes(q)) : semua;
  }, [semua, cari]);

  const onUbah = useCallback((id: number, nilai: string) => {
    setFisik((lama) => {
      const baru = { ...lama };
      if (nilai.trim() === '') delete baru[id];
      else baru[id] = nilai;
      return baru;
    });
  }, []);

  const terisi = semua.filter((b) => fisik[b.id] !== undefined);
  const jumlahSelisih = terisi.filter((b) => parseUang(fisik[b.id]) !== b.sistem).length;

  const muatRiwayat = useCallback(async () => {
    setErrorRiwayat('');
    try {
      const { rows } = normalisasi(await api.get<unknown>('/stock-opnames'));
      // Server mengirim opname terakhir sebagai objek bersarang; ratakan dan simpan
      // hanya produk yang memang sudah pernah diopname, sisanya cuma daftar stok.
      setRiwayat(
        rows.flatMap(({ last_opname, ...r }) =>
          last_opname && typeof last_opname === 'object'
            ? [{ ...r, ...(last_opname as Record<string, unknown>) }]
            : [],
        ),
      );
    } catch (e) {
      setErrorRiwayat(e instanceof Error ? e.message : 'Gagal memuat riwayat stok opname');
      setRiwayat([]);
    }
  }, []);

  useEffect(() => {
    if (online) void muatRiwayat();
  }, [online, muatRiwayat]);

  async function simpan() {
    setError('');
    setPesan('');
    if (!terisi.length) {
      setError('Isi dulu stok fisik minimal satu produk.');
      return;
    }
    setMemuat(true);
    try {
      const hasil = await api.post<Record<string, unknown>>('/stock-opnames', {
        items: terisi.map((b) => ({ product_id: b.id, stok_fisik: parseUang(fisik[b.id]) })),
      });
      const jumlah = typeof hasil?.applied === 'number' ? hasil.applied : terisi.length;
      setPesan(`${jumlah} baris stok opname tersimpan.`);
      setFisik({});
      try {
        // Stok sistem berubah setelah penyesuaian; tarik ulang supaya angka di layar ikut benar.
        await pullSync();
      } catch {
        /* gagal sync bukan kegagalan simpan, salinan lokal menyusul */
      }
      await muatRiwayat();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan stok opname');
    } finally {
      setMemuat(false);
    }
  }

  return (
    <div className="space-y-4">
      {!online && <Alert tone="info">Hitung stok fisik tetap bisa diisi, tapi menyimpan butuh koneksi.</Alert>}
      {error && <Alert>{error}</Alert>}
      {pesan && <Alert tone="sukses">{pesan}</Alert>}

      <Card title={`Hitung Stok (${semua.length} produk)`} className="no-print">
        <div className="space-y-3">
          <div>
            <Label>Cari produk</Label>
            <Input
              type="search"
              placeholder="Nama produk…"
              value={cari}
              onChange={(e) => setCari(e.target.value)}
            />
          </div>
          {semua.length === 0 ? (
            <Kosong>Data produk lokal masih kosong. Buka halaman lain saat online agar data tersinkron.</Kosong>
          ) : terlihat.length === 0 ? (
            <Kosong>Tidak ada produk yang cocok.</Kosong>
          ) : (
            <div>
              {terlihat.map((b) => (
                <BarisOpname key={b.id} baris={b} nilai={fisik[b.id] ?? ''} onUbah={onUbah} />
              ))}
            </div>
          )}
        </div>
      </Card>

      <ActionBar>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="w-full sm:w-auto"
            ukuran="lg"
            onClick={() => void simpan()}
            disabled={!online || memuat || terisi.length === 0}
          >
            {memuat ? 'Menyimpan…' : `Simpan Stok Opname (${terisi.length})`}
          </Button>
          <p className="text-xs text-slate-500">
            {terisi.length === 0
              ? 'Hanya baris yang diisi yang dikirim.'
              : `${terisi.length} baris terisi, ${jumlahSelisih} di antaranya berselisih.`}
          </p>
        </div>
      </ActionBar>

      <Card
        title="Riwayat Stok Opname"
        actions={
          <Button variant="secondary" ukuran="sm" onClick={() => void muatRiwayat()} disabled={!online}>
            Muat riwayat
          </Button>
        }
      >
        {errorRiwayat ? (
          <Alert>{errorRiwayat}</Alert>
        ) : (
          <TabelLaporan rows={riwayat} kosong="Belum ada opname tersimpan. Tekan Muat riwayat." />
        )}
      </Card>
    </div>
  );
}
