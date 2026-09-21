import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Alert, Button, Card, Input, Kosong, Label, Modal, Select } from '../components/ui';
import { db } from '../db';
import { formatTanggalJam, labelMetode, rupiah, tanggalLokal } from '../lib/format';
import { useOnline } from '../lib/useOnline';
import { useAuth } from '../store';
import type { Sale } from '../types';

/**
 * Batalkan = amber (transaksi tetap tercatat, stok kembali) dan Hapus = merah
 * (record hilang permanen). Warna dan kata sengaja dibedakan jauh supaya staf
 * tidak tertukar saat melayani pelanggan.
 */
const GAYA_BATAL =
  'border border-amber-300 !bg-amber-50 !text-amber-800 hover:!bg-amber-100 active:!bg-amber-200';

const LABEL_STATUS: Record<string, string> = {
  '': 'Semua status',
  selesai: 'Selesai',
  dibatalkan: 'Dibatalkan',
};

export default function Riwayat() {
  const online = useOnline();
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const superadmin = user?.role === 'superadmin';

  const [dari, setDari] = useState(tanggalLokal());
  const [sampai, setSampai] = useState(tanggalLokal());
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Sale[]>([]);
  const [memuat, setMemuat] = useState(false);
  const [error, setError] = useState('');
  const [sukses, setSukses] = useState('');
  const [detail, setDetail] = useState<Sale | null>(null);
  const [batal, setBatal] = useState<Sale | null>(null);
  const [hapus, setHapus] = useState<Sale | null>(null);
  const [purge, setPurge] = useState(false);

  const pending = useLiveQuery(() => db.pendingSales.orderBy('created_at').toArray(), [], []);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (dari) p.set('from', dari);
    if (sampai) p.set('to', sampai);
    if (status) p.set('status', status);
    if (q.trim()) p.set('q', q.trim());
    p.set('limit', '200');
    return p.toString();
  }, [dari, sampai, status, q]);

  async function muat() {
    setError('');
    setMemuat(true);
    try {
      const data = await api.get<Sale[] | { data: Sale[] }>(`/sales?${query}`);
      setRows(Array.isArray(data) ? data : (data.data ?? []));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat riwayat');
    } finally {
      setMemuat(false);
    }
  }

  async function bukaDetail(id: number) {
    setError('');
    try {
      setDetail(await api.get<Sale>(`/sales/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat detail');
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Riwayat Transaksi</h1>

      {!online && <Alert tone="info">Riwayat transaksi hanya bisa dibuka saat online.</Alert>}
      {sukses && <Alert tone="sukses">{sukses}</Alert>}
      {error && <Alert>{error}</Alert>}

      {pending.length > 0 && (
        <Card title={`Menunggu sinkron (${pending.length})`}>
          <div className="tabel-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <th className="py-2">Nomor sementara</th>
                  <th className="py-2">Waktu</th>
                  <th className="py-2">Status</th>
                  <th className="py-2 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.uuid} className="border-b border-slate-50">
                    <td className="py-2 font-mono text-xs">OFF-{p.uuid.slice(0, 8)}</td>
                    <td className="py-2">{formatTanggalJam(p.created_at)}</td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          p.status === 'gagal' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {p.status === 'gagal' ? `ditolak: ${p.error ?? 'tidak diketahui'}` : 'menunggu sinkron'}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <Link to={`/kasir/struk/${p.uuid}`}>
                        <Button variant="ghost">Struk</Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Filter">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <Label>Dari tanggal</Label>
            <Input type="date" value={dari} onChange={(e) => setDari(e.target.value)} />
          </div>
          <div>
            <Label>Sampai tanggal</Label>
            <Input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Semua</option>
              <option value="selesai">Selesai</option>
              <option value="dibatalkan">Dibatalkan</option>
            </Select>
          </div>
          <div>
            <Label>Cari (no struk / produk)</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="INV-…" />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={muat} disabled={!online || memuat}>
              {memuat ? 'Memuat…' : 'Tampilkan'}
            </Button>
          </div>
        </div>
      </Card>

      <Card
        title={`Transaksi (${rows.length})`}
        actions={
          superadmin ? (
            <Button variant="danger" ukuran="sm" disabled={!online} onClick={() => setPurge(true)}>
              Hapus Riwayat per Tanggal
            </Button>
          ) : undefined
        }
      >
        {/* HP: kartu satu kolom. Tabel lebar hanya muncul dari md ke atas. */}
        <ul className="space-y-2 md:hidden">
          {rows.map((s) => (
            <li key={s.id} className="min-w-0 rounded-md border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-all font-mono text-xs">{s.no_struk ?? s.uuid.slice(0, 8)}</span>
                <PilStatus status={s.status} />
              </div>
              <p className="mt-1 text-xs text-slate-500">{formatTanggalJam(s.created_at)}</p>
              <p className="text-xs text-slate-500">Kasir: {s.user_name ?? '-'}</p>
              <p className="mt-1 text-base font-bold">{rupiah(s.total)}</p>
              <AksiTransaksi
                sale={s}
                superadmin={superadmin}
                online={online}
                tumpuk
                onDetail={bukaDetail}
                onCetak={(uuid) => navigate(`/kasir/struk/${uuid}`)}
                onBatal={setBatal}
                onHapus={setHapus}
              />
            </li>
          ))}
        </ul>

        <div className="tabel-scroll hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <th className="py-2">No struk</th>
                <th className="py-2">Waktu</th>
                <th className="py-2">Kasir</th>
                <th className="py-2">Metode</th>
                <th className="py-2 text-right">Total</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-slate-50">
                  <td className="py-2 font-mono text-xs">{s.no_struk ?? s.uuid.slice(0, 8)}</td>
                  <td className="whitespace-nowrap py-2">{formatTanggalJam(s.created_at)}</td>
                  <td className="py-2">{s.user_name ?? '-'}</td>
                  <td className="py-2">{labelMetode(s.metode_bayar)}</td>
                  <td className="py-2 text-right">{rupiah(s.total)}</td>
                  <td className="py-2">
                    <PilStatus status={s.status} />
                  </td>
                  <td className="py-2">
                    <AksiTransaksi
                      sale={s}
                      superadmin={superadmin}
                      online={online}
                      tumpuk={false}
                      onDetail={bukaDetail}
                      onCetak={(uuid) => navigate(`/kasir/struk/${uuid}`)}
                      onBatal={setBatal}
                      onHapus={setHapus}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <Kosong>Belum ada transaksi pada rentang ini. Klik "Tampilkan" untuk memuat.</Kosong>}
      </Card>

      <Modal
        open={!!detail}
        title={`Detail ${detail?.no_struk ?? ''}`}
        onClose={() => setDetail(null)}
        width="max-w-2xl"
        tinggiPenuh
      >
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-1 gap-2 text-xs text-slate-600 sm:grid-cols-2">
              <p>Waktu: {formatTanggalJam(detail.created_at)}</p>
              <p>Kasir: {detail.user_name ?? detail.user?.name ?? '-'}</p>
              <p>Metode: {labelMetode(detail.metode_bayar)}</p>
              <p>Status: {detail.status}</p>
              {detail.nama_pelanggan && <p>Pelanggan: {detail.nama_pelanggan}</p>}
              {detail.status === 'dibatalkan' && <p className="sm:col-span-2">Alasan batal: {detail.alasan_batal}</p>}
            </div>
            <div className="tabel-scroll">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                    <th className="py-2">Item</th>
                    <th className="py-2">Satuan</th>
                    <th className="py-2 text-right">Qty</th>
                    <th className="py-2 text-right">Harga</th>
                    <th className="py-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.items ?? []).map((it, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="py-2">
                        {it.product_name ?? `#${it.product_id}`}
                        {it.alasan_ubah_harga && (
                          <span className="block text-xs text-amber-700">Alasan ubah harga: {it.alasan_ubah_harga}</span>
                        )}
                      </td>
                      <td className="py-2">{it.unit_name}</td>
                      <td className="py-2 text-right">{it.qty}</td>
                      <td className="py-2 text-right">{rupiah(it.harga_snapshot)}</td>
                      <td className="py-2 text-right">{rupiah(it.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-slate-100 pt-2">
              <span>Total {rupiah(detail.total)}</span>
              <span>Dibayar {rupiah(detail.dibayar)}</span>
              <span>Kembalian {rupiah(detail.kembalian)}</span>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!batal} title="Batalkan Transaksi" onClose={() => setBatal(null)}>
        {batal && (
          <FormBatal
            sale={batal}
            perluKredensial={!superadmin}
            onSelesai={() => {
              setBatal(null);
              void muat();
            }}
          />
        )}
      </Modal>

      <Modal open={!!hapus} title="Hapus Transaksi Permanen" onClose={() => setHapus(null)}>
        {hapus && (
          <FormHapus
            sale={hapus}
            onSelesai={(pesan) => {
              setHapus(null);
              if (!pesan) return; // sekadar menutup modal, tidak perlu memuat ulang
              setSukses(pesan);
              void muat();
            }}
          />
        )}
      </Modal>

      <Modal open={purge} title="Hapus Riwayat per Rentang Tanggal" onClose={() => setPurge(false)} tinggiPenuh>
        <FormPurge
          awalDari={dari}
          awalSampai={sampai}
          onSelesai={() => {
            setSukses('');
            void muat();
          }}
        />
      </Modal>
    </div>
  );
}

function PilStatus({ status }: { status: string }) {
  const batal = status === 'dibatalkan';
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${
        batal ? 'bg-red-100 text-red-700' : 'bg-teal-50 text-teal-700'
      }`}
    >
      {batal ? 'Dibatalkan' : 'Selesai'}
    </span>
  );
}

function AksiTransaksi({
  sale,
  superadmin,
  online,
  tumpuk,
  onDetail,
  onCetak,
  onBatal,
  onHapus,
}: {
  sale: Sale;
  superadmin: boolean;
  online: boolean;
  /** true = tombol ditumpuk penuh selebar kartu (tampilan HP). */
  tumpuk: boolean;
  onDetail: (id: number) => void;
  onCetak: (uuid: string) => void;
  onBatal: (sale: Sale) => void;
  onHapus: (sale: Sale) => void;
}) {
  const ukuran = tumpuk ? 'md' : 'sm';
  const lebar = tumpuk ? 'w-full' : '';
  return (
    <div className={tumpuk ? 'mt-2 grid gap-2' : 'flex justify-end gap-1'}>
      <Button variant="ghost" ukuran={ukuran} className={lebar} onClick={() => onDetail(sale.id)}>
        Detail
      </Button>
      <Button variant="ghost" ukuran={ukuran} className={lebar} onClick={() => onCetak(sale.uuid)}>
        Cetak ulang
      </Button>
      {sale.status !== 'dibatalkan' && (
        <Button
          variant="secondary"
          ukuran={ukuran}
          className={`${GAYA_BATAL} ${lebar}`}
          disabled={!online}
          onClick={() => onBatal(sale)}
        >
          Batalkan Transaksi
        </Button>
      )}
      {superadmin && (
        <Button variant="danger" ukuran={ukuran} className={lebar} disabled={!online} onClick={() => onHapus(sale)}>
          Hapus Permanen
        </Button>
      )}
    </div>
  );
}

function FormHapus({ sale, onSelesai }: { sale: Sale; onSelesai: (pesan: string) => void }) {
  const [setuju, setSetuju] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const nomor = sale.no_struk ?? sale.uuid;

  async function hapus() {
    setError('');
    setLoading(true);
    try {
      // Backend mengembalikan stok transaksi 'selesai', nyatakan itu apa adanya di teks konfirmasi.
      await api.del(`/sales/${sale.id}?restore_stock=true`);
      onSelesai(`Transaksi ${nomor} sebesar ${rupiah(sale.total)} dihapus permanen dari riwayat.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus transaksi');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <Alert>
        <span className="block font-semibold">Transaksi ini dihapus permanen dari riwayat.</span>
        No struk <b>{nomor}</b> sebesar <b>{rupiah(sale.total)}</b> hilang dan tidak bisa dikembalikan.
        <span className="mt-1 block">
          Stok transaksi ini DIKEMBALIKAN ke produk. Beda dengan "Batalkan Transaksi": batalkan tetap mencatat
          transaksinya sebagai "Dibatalkan", sedangkan "Hapus" membuang barisnya dari riwayat.
        </span>
      </Alert>

      <label className="flex min-h-sentuh cursor-pointer items-center gap-3 rounded-md border border-slate-200 p-3">
        <input
          type="checkbox"
          className="h-6 w-6 shrink-0"
          checked={setuju}
          onChange={(e) => setSetuju(e.target.checked)}
        />
        <span className="text-sm">
          Saya mengerti transaksi <b>{nomor}</b> dihapus permanen dari riwayat.
        </span>
      </label>

      {error && <Alert>{error}</Alert>}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => onSelesai('')} disabled={loading}>
          Jangan hapus
        </Button>
        <Button variant="danger" onClick={hapus} disabled={!setuju || loading}>
          {loading ? 'Menghapus…' : 'Hapus Permanen'}
        </Button>
      </div>
    </div>
  );
}

function FormPurge({
  awalDari,
  awalSampai,
  onSelesai,
}: {
  awalDari: string;
  awalSampai: string;
  onSelesai: () => void;
}) {
  const [dari, setDari] = useState(awalDari);
  const [sampai, setSampai] = useState(awalSampai);
  const [status, setStatus] = useState('');
  const [restore, setRestore] = useState(false);
  const [setuju, setSetuju] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dihapus, setDihapus] = useState<number | null>(null);

  const rentangValid = !!dari && !!sampai && dari <= sampai;
  const labelStatus = LABEL_STATUS[status] ?? status;

  // Ubah pilihan apa pun = batal centang, supaya yang dicentang benar-benar rentang terakhir.
  function ubah(fn: () => void) {
    setSetuju(false);
    setDihapus(null);
    fn();
  }

  async function jalankan() {
    setError('');
    setLoading(true);
    try {
      const res = await api.post<{ deleted?: number }>('/sales/purge', {
        from: dari,
        to: sampai,
        ...(status ? { status } : {}),
        restore_stock: restore,
      });
      setDihapus(res?.deleted ?? 0);
      setSetuju(false);
      onSelesai();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus riwayat');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <Alert>
        <span className="block font-semibold">Riwayat yang dihapus tidak bisa dikembalikan.</span>
        Transaksi dengan tanggal <b>{dari || '(belum diisi)'}</b> sampai <b>{sampai || '(belum diisi)'}</b>, status{' '}
        <b>{labelStatus}</b>, akan dihapus permanen. Stok{' '}
        <b>{restore ? 'transaksi selesai dikembalikan ke produk' : 'TIDAK dikembalikan'}</b>.
      </Alert>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>Dari tanggal</Label>
          <Input type="date" value={dari} onChange={(e) => ubah(() => setDari(e.target.value))} />
        </div>
        <div>
          <Label>Sampai tanggal</Label>
          <Input type="date" value={sampai} onChange={(e) => ubah(() => setSampai(e.target.value))} />
        </div>
        <div>
          <Label>Status yang dihapus</Label>
          <Select value={status} onChange={(e) => ubah(() => setStatus(e.target.value))}>
            <option value="">Semua status</option>
            <option value="selesai">Selesai</option>
            <option value="dibatalkan">Dibatalkan</option>
          </Select>
        </div>
      </div>

      <label className="flex min-h-sentuh cursor-pointer items-center gap-3 rounded-md border border-slate-200 p-3">
        <input
          type="checkbox"
          className="h-6 w-6 shrink-0"
          checked={restore}
          onChange={(e) => ubah(() => setRestore(e.target.checked))}
        />
        <span className="text-sm">
          Kembalikan stok transaksi berstatus selesai yang dihapus. Transaksi yang sudah dibatalkan tidak dikembalikan
          lagi karena stoknya sudah masuk saat dibatalkan.
        </span>
      </label>

      <label className="flex min-h-sentuh cursor-pointer items-center gap-3 rounded-md border border-red-200 bg-red-50 p-3">
        <input
          type="checkbox"
          className="h-6 w-6 shrink-0"
          checked={setuju}
          onChange={(e) => setSetuju(e.target.checked)}
        />
        <span className="text-sm text-red-800">
          Saya mengerti seluruh riwayat transaksi <b>{dari || '…'}</b> s/d <b>{sampai || '…'}</b> ({labelStatus}) dihapus
          permanen.
        </span>
      </label>

      {dihapus !== null && (
        <Alert tone="sukses">
          {dihapus > 0
            ? `${dihapus} transaksi pada rentang ${dari} s/d ${sampai} berhasil dihapus permanen.`
            : 'Tidak ada transaksi yang cocok pada rentang dan status tersebut.'}
        </Alert>
      )}

      {error && <Alert>{error}</Alert>}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onSelesai} disabled={loading}>
          Tutup
        </Button>
        <Button variant="danger" onClick={jalankan} disabled={!setuju || !rentangValid || loading}>
          {loading ? 'Menghapus…' : 'Hapus Riwayat Permanen'}
        </Button>
      </div>
    </div>
  );
}

function FormBatal({
  sale,
  perluKredensial,
  onSelesai,
}: {
  sale: Sale;
  perluKredensial: boolean;
  onSelesai: () => void;
}) {
  const [alasan, setAlasan] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const boleh = alasan.trim().length > 0 && (!perluKredensial || (username.trim() && password));

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post(`/sales/${sale.id}/cancel`, {
        alasan_batal: alasan.trim(),
        ...(perluKredensial ? { superadmin_username: username.trim(), superadmin_password: password } : {}),
      });
      onSelesai();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membatalkan transaksi');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={kirim} className="space-y-3">
      <Alert tone="info">
        Transaksi <b>{sale.no_struk ?? sale.uuid}</b> sebesar <b>{rupiah(sale.total)}</b> akan dibatalkan dan stok
        dikembalikan. Transaksinya tetap tercatat di riwayat sebagai "Dibatalkan".
      </Alert>

      <div>
        <Label>Alasan pembatalan (wajib)</Label>
        <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} required />
      </div>

      {perluKredensial && (
        <div className="grid grid-cols-1 gap-3 rounded-md bg-amber-50 p-3 md:grid-cols-2">
          <div className="text-xs text-amber-800 md:col-span-2">
            Hanya superadmin yang dapat membatalkan. Masukkan kredensial superadmin.
          </div>
          <div>
            <Label>Username superadmin</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div>
            <Label>Password superadmin</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
        </div>
      )}

      {error && <Alert>{error}</Alert>}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onSelesai}>
          Batal
        </Button>
        <Button type="submit" variant="secondary" className={GAYA_BATAL} disabled={!boleh || loading}>
          {loading ? 'Memproses…' : 'Batalkan Transaksi'}
        </Button>
      </div>
    </form>
  );
}
