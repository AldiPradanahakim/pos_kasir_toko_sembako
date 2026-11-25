import { Button, Card } from './ui';
import { formatTanggalJam, rupiah } from '../lib/format';
import type { Shift } from '../types';

/**
 * Laporan satu tutup kas: modal awal, uang masuk, uang yang DIPAKAI selama shift (beserta
 * rinciannya), uang seharusnya di laci, uang fisik yang dihitung, selisihnya, dan ringkasan
 * penjualan shift itu.
 *
 * Dipakai di dua tempat dengan maksud berbeda:
 * - kasir, SEKALI saat menekan "Tutup Kas" (hasil aksinya sendiri, bukan riwayat);
 * - superadmin, dari menu "Riwayat Kas" untuk memeriksa kas kasir mana pun.
 *
 * Dibungkus `area-laporan` supaya saat dicetak memakai kertas laporan dan hanya bagian
 * ini yang tampil (menu, tombol, dan daftar di sekitarnya bertanda `no-print`).
 */
export default function LaporanTutupKas({ shift, onTutup }: { shift: Shift; onTutup?: () => void }) {
  const selisih = shift.selisih ?? 0;
  const buka = !shift.ditutup_pada;
  const keluar = (shift.rincian ?? []).filter((r) => r.tipe === 'keluar');
  return (
    <div className="area-laporan space-y-3">
      <Card
        title={`Laporan Tutup Kas — ${shift.user_name ?? `#${shift.user_id}`}`}
        actions={
          <div className="no-print flex flex-wrap justify-end gap-2">
            {onTutup && (
              <Button variant="ghost" onClick={onTutup}>
                Tutup
              </Button>
            )}
            <Button variant="secondary" onClick={() => window.print()}>
              Cetak
            </Button>
          </div>
        }
      >
        <div className="space-y-2 text-sm">
          <Baris label="Kasir" nilai={shift.user_name ?? `#${shift.user_id}`} />
          <Baris label="Kas dibuka" nilai={formatTanggalJam(shift.dibuka_pada)} />
          <Baris label="Kas ditutup" nilai={buka ? 'Masih buka' : formatTanggalJam(shift.ditutup_pada)} />
          <div className="my-2 border-t border-slate-100" />
          <Baris label="Modal awal" nilai={rupiah(shift.modal_awal)} />
          <Baris label="Uang masuk (penjualan & setoran)" nilai={`+ ${rupiah(shift.kas_masuk ?? 0)}`} />
          <Baris label="Uang keluar (dipakai)" nilai={`− ${rupiah(shift.kas_keluar ?? 0)}`} />
          <Baris label="Uang seharusnya di laci" nilai={rupiah(shift.kas_seharusnya ?? 0)} />
          <Baris
            label="Uang fisik dihitung"
            nilai={shift.uang_fisik === null || shift.uang_fisik === undefined ? '—' : rupiah(shift.uang_fisik)}
          />
          <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
            <span className="font-semibold">Selisih</span>
            <span
              className={`text-lg font-bold ${
                selisih === 0 ? 'text-teal-800' : selisih < 0 ? 'text-red-700' : 'text-amber-800'
              }`}
            >
              {rupiah(selisih)}
            </span>
          </div>
          <p className="text-xs text-slate-600">
            {selisih === 0
              ? 'Uang fisik sama dengan hitungan sistem.'
              : selisih < 0
                ? 'Uang fisik kurang dari hitungan sistem: periksa kembalian, kas keluar, atau uang yang belum dicatat.'
                : 'Uang fisik lebih dari hitungan sistem: periksa kas masuk yang belum dicatat atau kelebihan kembalian.'}
          </p>
          {keluar.length > 0 && (
            <>
              <div className="my-2 border-t border-slate-100" />
              <p className="text-xs font-semibold uppercase text-slate-500">
                Rincian uang dipakai ({keluar.length})
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                    <th className="py-1 pr-2">Jam</th>
                    <th className="py-1 pr-2">Untuk</th>
                    <th className="py-1 text-right">Jumlah</th>
                  </tr>
                </thead>
                <tbody>
                  {keluar.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50">
                      <td className="whitespace-nowrap py-1 pr-2 text-slate-600">{r.jam}</td>
                      <td className="py-1 pr-2">{r.keterangan ?? r.kategori}</td>
                      <td className="whitespace-nowrap py-1 text-right font-medium">{rupiah(r.jumlah)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td />
                    <td className="py-1 pr-2 text-right font-semibold">Total dipakai</td>
                    <td className="whitespace-nowrap py-1 text-right font-semibold">
                      {rupiah(shift.kas_keluar ?? 0)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
          <div className="my-2 border-t border-slate-100" />
          <Baris label="Transaksi" nilai={String(shift.transaksi ?? 0)} />
          <Baris label="Barang terjual (qty)" nilai={String(shift.items ?? 0)} />
          <Baris label="Omzet" nilai={rupiah(shift.omzet ?? 0)} />
          {shift.catatan && <Baris label="Catatan" nilai={shift.catatan} />}
        </div>
      </Card>
    </div>
  );
}

function Baris({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-slate-600">{label}</span>
      <span className="min-w-0 break-words text-right font-medium">{nilai}</span>
    </div>
  );
}
