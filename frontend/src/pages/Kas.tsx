import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import LaporanTutupKas from '../components/LaporanTutupKas';
import { Alert, Button, Card, Kosong, Stat } from '../components/ui';
import { formatTanggalJam, rupiah } from '../lib/format';
import { useOnline } from '../lib/useOnline';
import type { Shift } from '../types';

/**
 * Riwayat kas: satu baris = satu buka-tutup kas satu kasir.
 *
 * Halaman ini khusus superadmin (menu dan rutenya pun dikunci begitu), karena isinya
 * pemeriksaan uang semua kasir. Kasir tidak memakainya: dia melihat hasil tutup kasnya
 * sendiri sekali di layar kasir, tepat setelah menekan "Tutup Kas".
 */
export default function Kas() {
  const online = useOnline();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<Shift[] | null>(null);
  const [error, setError] = useState('');

  const dipilihId = Number(params.get('shift')) || null;

  useEffect(() => {
    if (!online) {
      setRows([]);
      return;
    }
    let batal = false;
    api
      .get<Shift[]>('/shifts?limit=100')
      .then((data) => {
        if (!batal) setRows(data);
      })
      .catch((e) => {
        if (batal) return;
        setRows([]);
        setError(e instanceof Error ? e.message : 'Gagal memuat riwayat kas');
      });
    return () => {
      batal = true;
    };
  }, [online]);

  /**
   * Baris yang sedang dibuka diambil ulang satu per satu (`GET /shifts/:id`) karena
   * rincian uang yang dipakai hanya dikirim di detail, bukan di daftar. Daftar sengaja
   * tetap ringan: satu baris per shift, tanpa puluhan baris kas di dalamnya.
   */
  const dipilih = useMemo(
    () => (rows ?? []).find((r) => r.id === dipilihId) ?? null,
    [rows, dipilihId],
  );
  const [detail, setDetail] = useState<Shift | null>(null);

  useEffect(() => {
    if (!dipilihId || !online) {
      setDetail(null);
      return;
    }
    let batal = false;
    api
      .get<Shift>(`/shifts/${dipilihId}`)
      .then((d) => {
        if (!batal) setDetail(d);
      })
      .catch((e) => {
        if (batal) return;
        setDetail(null);
        setError(e instanceof Error ? e.message : 'Gagal memuat rincian kas');
      });
    return () => {
      batal = true;
    };
  }, [dipilihId, online]);

  /**
   * Ringkasan hanya menghitung shift yang SUDAH ditutup. Shift yang masih berjalan
   * sengaja dilewati: selisihnya belum ada (uang fisik belum dihitung), jadi
   * memasukkannya membuat angka selisih terlihat bertentangan dengan tabel.
   */
  const tertutup = (rows ?? []).filter((r) => r.ditutup_pada);
  const total = tertutup.reduce(
    (a, r) => ({
      omzet: a.omzet + (r.omzet ?? 0),
      transaksi: a.transaksi + (r.transaksi ?? 0),
      items: a.items + (r.items ?? 0),
      selisih: a.selisih + (r.selisih ?? 0),
    }),
    { omzet: 0, transaksi: 0, items: 0, selisih: 0 },
  );

  function pilih(id: number) {
    setParams({ shift: String(id) }, { replace: true });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Riwayat Kas</h1>
          <p className="text-sm text-slate-600">
            Modal awal, uang seharusnya, uang fisik, dan selisih tiap tutup kas semua kasir.
          </p>
        </div>
        <Link to="/kasir" className="inline-flex min-h-sentuh shrink-0 items-center text-sm font-medium text-teal-700 underline">
          ← Ke Kasir
        </Link>
      </div>

      {!online && <Alert tone="info">Riwayat kas dibaca dari server, jadi butuh koneksi internet.</Alert>}
      {error && <Alert>{error}</Alert>}

      {rows === null ? (
        <Card>
          <Kosong>Memuat riwayat kas…</Kosong>
        </Card>
      ) : !rows.length ? (
        <Card>
          <Kosong>Belum ada kas yang ditutup. Riwayat muncul setelah Anda menekan “Tutup Kas”.</Kosong>
        </Card>
      ) : (
        <>
          <div className="no-print grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat
              label={`Omzet ${tertutup.length} kas tertutup`}
              nilai={rupiah(total.omzet)}
              hint={rows.length > tertutup.length ? `${rows.length - tertutup.length} kas masih buka` : undefined}
              tone="hijau"
            />
            <Stat label="Transaksi" nilai={total.transaksi} />
            <Stat label="Barang terjual" nilai={total.items} />
            <Stat
              label="Total selisih (kas tertutup)"
              nilai={rupiah(total.selisih)}
              tone={total.selisih === 0 ? 'netral' : total.selisih < 0 ? 'merah' : 'kuning'}
            />
          </div>

          <Card className={dipilih ? 'no-print' : ''} padat>
            <div className="tabel-scroll">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                    <th className="px-3 py-2">Kasir</th>
                    <th className="px-3 py-2">Buka</th>
                    <th className="px-3 py-2">Tutup</th>
                    <th className="px-3 py-2 text-right">Modal</th>
                    <th className="px-3 py-2 text-right">Masuk</th>
                    <th className="px-3 py-2 text-right">Keluar</th>
                    <th className="px-3 py-2 text-right">Seharusnya</th>
                    <th className="px-3 py-2 text-right">Fisik</th>
                    <th className="px-3 py-2 text-right">Selisih</th>
                    <th className="px-3 py-2 text-right">Omzet</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const buka = !r.ditutup_pada;
                    return (
                      <tr
                        key={r.id}
                        className={`border-b border-slate-50 ${r.id === dipilihId ? 'bg-teal-50' : ''}`}
                      >
                        <td className="px-3 py-2">{r.user_name ?? `#${r.user_id}`}</td>
                        <td className="whitespace-nowrap px-3 py-2">{formatTanggalJam(r.dibuka_pada)}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {buka ? <span className="font-semibold text-amber-700">masih buka</span> : formatTanggalJam(r.ditutup_pada)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{rupiah(r.modal_awal)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{rupiah(r.kas_masuk ?? 0)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-amber-800">
                          {rupiah(r.kas_keluar ?? 0)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{rupiah(r.kas_seharusnya ?? 0)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {r.uang_fisik === null || r.uang_fisik === undefined ? '—' : rupiah(r.uang_fisik)}
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-2 text-right font-semibold ${
                            r.selisih === null || r.selisih === undefined
                              ? 'text-slate-500'
                              : r.selisih === 0
                                ? 'text-teal-800'
                                : 'text-red-700'
                          }`}
                        >
                          {r.selisih === null || r.selisih === undefined ? '—' : rupiah(r.selisih)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{rupiah(r.omzet ?? 0)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <Button variant="ghost" onClick={() => pilih(r.id)}>
                            Lihat
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {dipilih && (
            <LaporanTutupKas
              shift={detail ?? dipilih}
              onTutup={() => setParams({}, { replace: true })}
            />
          )}
        </>
      )}
    </div>
  );
}
