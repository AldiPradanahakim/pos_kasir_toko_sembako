import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Alert, Button, Card } from '../components/ui';
import { bacaSettings, db, type DbReceipt } from '../db';
import { formatTanggalJam, labelMetode, rupiah } from '../lib/format';
import { useOnline } from '../lib/useOnline';
import type { Sale } from '../types';

export default function Struk() {
  const { uuid = '' } = useParams();
  const [params] = useSearchParams();
  const online = useOnline();
  const [dariServer, setDariServer] = useState<Sale | null>(null);
  const [error, setError] = useState('');
  const lokal = useLiveQuery(() => db.receipts.get(uuid), [uuid]);
  const setting = useLiveQuery(() => bacaSettings(), []);

  useEffect(() => {
    if (lokal) return;
    if (!online) return;
    let batal = false;
    api
      .get<Sale>(`/sales/by-uuid/${uuid}`)
      .then((s) => {
        if (!batal) setDariServer(s);
      })
      .catch((e) => {
        if (!batal) setError(e instanceof Error ? e.message : 'Struk tidak ditemukan');
      });
    return () => {
      batal = true;
    };
  }, [uuid, lokal, online]);

  useEffect(() => {
    if ((lokal || dariServer) && params.get('cetak') === '1') {
      const t = window.setTimeout(() => window.print(), 400);
      return () => window.clearTimeout(t);
    }
  }, [lokal, dariServer, params]);

  const data: DbReceipt | null = lokal
    ? lokal
    : dariServer
      ? {
          uuid: dariServer.uuid,
          no_struk: dariServer.no_struk ?? dariServer.uuid,
          sale_id: dariServer.id,
          created_at: dariServer.created_at,
          kasir_name: dariServer.user_name ?? dariServer.user?.name ?? '-',
          metode_bayar: dariServer.metode_bayar,
          dibayar: dariServer.dibayar,
          kembalian: dariServer.kembalian,
          total: dariServer.total,
          pending: false,
          nama_pelanggan: dariServer.nama_pelanggan ?? null,
          items: (dariServer.items ?? []).map((it) => ({
            product_id: it.product_id,
            name: it.product_name ?? `#${it.product_id}`,
            unit_name: it.unit_name,
            qty: it.qty,
            harga: it.harga_snapshot,
            subtotal: it.subtotal,
            alasan_ubah_harga: it.alasan_ubah_harga ?? null,
          })),
        }
      : null;

  if (!data) {
    return (
      <div className="mx-auto max-w-md space-y-3">
        {error ? <Alert>{error}</Alert> : <p className="text-sm text-slate-500">Memuat struk…</p>}
        {!online && <Alert tone="info">Struk ini belum ada di perangkat dan Anda sedang offline.</Alert>}
        <Link to="/kasir" className="text-sm text-teal-700 underline">
          Kembali ke kasir
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="no-print space-y-2">
        <h1 className="text-lg font-semibold">Struk</h1>
        <div className="grid grid-cols-3 gap-2">
          <Link to="/kasir" className="contents">
            <Button variant="secondary" ukuran="lg">
              Kasir
            </Button>
          </Link>
          <Link to="/riwayat" className="contents">
            <Button variant="secondary" ukuran="lg">
              Riwayat
            </Button>
          </Link>
          <Button ukuran="lg" onClick={() => window.print()}>
            Cetak
          </Button>
        </div>
      </div>

      {data.pending && (
        <div className="no-print">
          <Alert tone="info">
            Belum tersinkron — nomor sementara {data.no_struk}. Nomor struk final akan diberikan server setelah
            terkirim.
          </Alert>
        </div>
      )}

      <Card className="no-print">
        <p className="text-xs text-slate-500">
          Kertas 58mm. Pada dialog cetak pilih printer thermal dan margin "None" agar hasil pas.
        </p>
      </Card>

      <div className="area-cetak flex justify-center">
        <div className="struk rounded-md border border-slate-300 bg-white p-3">
          <div className="text-center">
            <p className="text-[13px] font-bold uppercase">{setting?.toko_nama || 'Toko Hakim'}</p>
            {setting?.alamat && <p>{setting?.alamat}</p>}
            {setting?.telepon && <p>Telp {setting?.telepon}</p>}
          </div>

          <div className="garis" />
          <div className="flex justify-between">
            <span>No</span>
            <span>{data.no_struk}</span>
          </div>
          <div className="flex justify-between">
            <span>Tanggal</span>
            <span>{formatTanggalJam(data.created_at)}</span>
          </div>
          <div className="flex justify-between">
            <span>Kasir</span>
            <span>{data.kasir_name}</span>
          </div>
          {data.nama_pelanggan && (
            <div className="flex justify-between">
              <span>Pelanggan</span>
              <span>{data.nama_pelanggan}</span>
            </div>
          )}
          <div className="garis" />

          {data.items.map((it, i) => (
            <div key={`${it.product_id}-${i}`} className="mb-1">
              <p>{it.name}</p>
              <div className="flex justify-between">
                <span>
                  {it.qty} {it.unit_name} x {rupiah(it.harga)}
                </span>
                <span>{rupiah(it.subtotal)}</span>
              </div>
              {it.alasan_ubah_harga && <p className="pl-2">* harga diubah: {it.alasan_ubah_harga}</p>}
            </div>
          ))}

          <div className="garis" />
          <div className="flex justify-between font-bold">
            <span>TOTAL</span>
            <span>{rupiah(data.total)}</span>
          </div>
          <div className="flex justify-between">
            <span>Metode</span>
            <span>{labelMetode(data.metode_bayar)}</span>
          </div>
          <div className="flex justify-between">
            <span>Dibayar</span>
            <span>{rupiah(data.dibayar)}</span>
          </div>
          <div className="flex justify-between">
            <span>Kembalian</span>
            <span>{rupiah(data.kembalian)}</span>
          </div>
          <div className="garis" />
          <p className="text-center">Terima kasih telah berbelanja</p>
          <p className="text-center">Barang yang sudah dibeli tidak dapat ditukar</p>
        </div>
      </div>
    </div>
  );
}
