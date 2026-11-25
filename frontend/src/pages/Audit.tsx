import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Alert, Card, Input, Label } from '../components/ui';
import { formatTanggalJam, tanggalLokal } from '../lib/format';

interface AuditRow {
  id: number;
  created_at: string;
  user_id: number | null;
  user_name: string | null;
  aksi: string;
  entitas: string;
  entitas_id: number | null;
  detail: unknown;
  ip: string | null;
}

/**
 * Jejak audit: siapa mengubah apa dan kapan. Read-only — tidak ada tombol hapus, karena
 * log yang bisa dirapikan oleh pelakunya tidak membuktikan apa pun.
 */
export default function Audit() {
  const [dari, setDari] = useState(tanggalLokal());
  const [sampai, setSampai] = useState(tanggalLokal());
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [memuat, setMemuat] = useState(false);
  const [error, setError] = useState('');
  const [terbuka, setTerbuka] = useState<number | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (dari) p.set('from', dari);
    if (sampai) p.set('to', sampai);
    if (q.trim()) p.set('q', q.trim());
    p.set('limit', '300');
    return p.toString();
  }, [dari, sampai, q]);

  async function muat() {
    setError('');
    setMemuat(true);
    try {
      setRows(await api.get<AuditRow[]>(`/audit-logs?${query}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat jejak audit');
    } finally {
      setMemuat(false);
    }
  }

  useEffect(() => {
    void muat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Jejak Audit</h1>
      <p className="text-sm text-slate-600">
        Catatan perubahan yang menyangkut uang dan data induk: harga produk, pengguna, hapus
        transaksi, koreksi kas, dan tutup kas. Baris di sini tidak bisa diubah atau dihapus dari
        aplikasi.
      </p>

      {error && <Alert>{error}</Alert>}

      <Card title="Filter">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label>Dari tanggal</Label>
            <Input type="date" value={dari} onChange={(e) => setDari(e.target.value)} />
          </div>
          <div>
            <Label>Sampai tanggal</Label>
            <Input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} />
          </div>
          <div>
            <Label>Cari (aksi / pengguna / isi)</Label>
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="products.update" />
          </div>
        </div>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void muat()}
            disabled={memuat}
            className="min-h-sentuh rounded-md bg-teal-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-800 disabled:bg-slate-300"
          >
            {memuat ? 'Memuat…' : 'Tampilkan'}
          </button>
        </div>
      </Card>

      <Card title={`Catatan (${rows.length})`}>
        <div className="tabel-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <th className="py-2">Waktu</th>
                <th className="py-2">Pengguna</th>
                <th className="py-2">Aksi</th>
                <th className="py-2">Objek</th>
                <th className="py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 align-top">
                  <td className="py-2 whitespace-nowrap">{formatTanggalJam(r.created_at)}</td>
                  <td className="py-2">{r.user_name ?? '-'}</td>
                  <td className="py-2 font-mono text-xs">{r.aksi}</td>
                  <td className="py-2 text-xs">
                    {r.entitas}
                    {r.entitas_id !== null ? ` #${r.entitas_id}` : ''}
                  </td>
                  <td className="py-2 text-xs">
                    {r.detail ? (
                      <>
                        <button
                          type="button"
                          className="text-teal-700 underline"
                          onClick={() => setTerbuka(terbuka === r.id ? null : r.id)}
                        >
                          {terbuka === r.id ? 'Sembunyikan' : 'Lihat'}
                        </button>
                        {terbuka === r.id && (
                          <pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-slate-600">
                            {JSON.stringify(r.detail, null, 2)}
                          </pre>
                        )}
                      </>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-sm text-slate-500">
                    Tidak ada catatan pada rentang ini.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
