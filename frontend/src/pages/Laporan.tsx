import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { Alert, Button, Card, Input, Kosong, Label, Stat, Tabs } from '../components/ui';
import { bacaSettings } from '../db';
import { formatTanggal, formatTanggalJam, rupiah, tanggalLokal } from '../lib/format';
import { useOnline } from '../lib/useOnline';
import { useOmzet } from '../lib/useOmzet';
import { useAuth } from '../store';
import { entriDari, ENTRI, type EntriLaporan } from './laporan/daftar';
import StokOpname from './laporan/StokOpname';
import { normalisasi, Ringkasan, TabelLaporan, type HasilLaporan } from './laporan/tabel';

const ITEM_TAB = ENTRI.map((e) => ({ id: e.slug, label: e.judul }));

/**
 * Omset hari/bulan/tahun: hanya untuk superadmin (`/reports/omzet` menolak kasir).
 * Halaman ini sendiri sudah superadmin-saja, pengecekan peran di sini hanya jaring
 * pengaman supaya kasir tidak pernah memicu permintaan yang ditolak server.
 */
function KartuOmset() {
  const online = useOnline();
  const omzet = useOmzet();
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat
          label="Omset Hari Ini"
          nilai={rupiah(omzet.data?.hari_ini?.total ?? 0)}
          hint={`${omzet.data?.hari_ini?.transaksi ?? 0} transaksi`}
          tone="hijau"
        />
        <Stat
          label="Omset Bulan Ini"
          nilai={rupiah(omzet.data?.bulan_ini?.total ?? 0)}
          hint={`${omzet.data?.bulan_ini?.transaksi ?? 0} transaksi`}
        />
        <Stat
          label="Omset Tahun Ini"
          nilai={rupiah(omzet.data?.tahun_ini?.total ?? 0)}
          hint={`${omzet.data?.tahun_ini?.transaksi ?? 0} transaksi`}
        />
      </div>
      {omzet.error && !omzet.data && <Alert tone="info">Omset belum tersedia: {omzet.error}</Alert>}
      {omzet.dariCache && omzet.data && (
        <p className="text-xs font-medium text-amber-700">
          {online
            ? 'Omset belum bisa diperbarui, menampilkan angka tersimpan terakhir.'
            : 'Offline, menampilkan angka omset terakhir yang tersimpan.'}
        </p>
      )}
    </div>
  );
}

/** Daftar seluruh laporan: satu kartu besar per laporan supaya enak ditekan di HP. */
function DaftarLaporan() {
  const online = useOnline();
  const superadmin = useAuth((s) => s.user?.role) === 'superadmin';
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Laporan</h1>
      {!online && <Alert tone="info">Sebagian laporan butuh koneksi internet untuk memuat data terbaru.</Alert>}

      {superadmin && <KartuOmset />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ENTRI.map((e) => (
          <Link
            key={e.slug}
            to={`/laporan/${e.slug}`}
            className="flex min-h-sentuh items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm transition hover:border-teal-500 active:bg-teal-50"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-800">{e.judul}</span>
              <span className="block text-xs text-slate-500">{e.ket}</span>
            </span>
            <span aria-hidden className="shrink-0 text-lg text-slate-300">
              ›
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Kop laporan saat dicetak: hanya tampil di media cetak (bukan di layar). */
function KepalaCetak({
  entri,
  periode,
  toko,
  alamat,
}: {
  entri: EntriLaporan;
  periode: string;
  toko: string;
  alamat: string;
}) {
  return (
    <div className="mb-3 hidden print:block">
      <p className="text-base font-bold">{toko}</p>
      {alamat && <p className="text-xs">{alamat}</p>}
      <p className="mt-1 text-sm font-semibold">{entri.judul}</p>
      <p className="text-xs">Periode: {periode}</p>
      <p className="text-xs">Dicetak: {formatTanggalJam(new Date().toISOString())}</p>
    </div>
  );
}

function DetailLaporan({ entri }: { entri: EntriLaporan }) {
  const online = useOnline();
  const navigate = useNavigate();
  const superadmin = useAuth((s) => s.user?.role) === 'superadmin';
  const setting = useLiveQuery(() => bacaSettings(), []);
  const [dari, setDari] = useState(tanggalLokal());
  const [sampai, setSampai] = useState(tanggalLokal());
  const [tanggal, setTanggal] = useState(tanggalLokal());
  const [hasil, setHasil] = useState<HasilLaporan | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [error, setError] = useState('');
  const [pesan, setPesan] = useState('');

  const { slug, jenis } = entri;
  const sembunyi = entri.kolomSembunyi ?? [];
  // Rentang tanggal yang dicetak di kop laporan (harian cuma satu tanggal).
  const periode = jenis === 'harian' ? formatTanggal(tanggal) : `${formatTanggal(dari)} s/d ${formatTanggal(sampai)}`;
  // Entri unduhan CSV bukan laporan bertabel: tidak ada isi untuk dicetak.
  const bisaCetak = superadmin && jenis !== 'unduh';
  // Objek ringkasan yang punya field daftar (walau kosong) berarti laporannya berbasis daftar,
  // jadi baris kosong tetap perlu pesan "tidak ada data", beda dengan laporan angka murni.
  const ringkasPunyaDaftar = !!hasil?.ringkas && Object.values(hasil.ringkas).some(Array.isArray);
  const tampilTabel = !error && (!hasil || hasil.ringkas === null || hasil.rows.length > 0 || ringkasPunyaDaftar);

  const muat = useCallback(async () => {
    if (!entri.path) return;
    setError('');
    setPesan('');
    setMemuat(true);
    try {
      setHasil(normalisasi(await api.get<unknown>(entri.path({ dari, sampai, tanggal }))));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat laporan');
      setHasil(null);
    } finally {
      setMemuat(false);
    }
  }, [entri, dari, sampai, tanggal]);

  // Ganti laporan = buang hasil lama, lalu tarik otomatis. Ubah tanggal tetap lewat tombol Tampilkan.
  useEffect(() => {
    setHasil(null);
    setError('');
    setPesan('');
    if (online && entri.path && entri.jenis !== 'unduh') void muat();
  }, [slug, online]);

  async function unduh() {
    if (!entri.path || !entri.berkas) return;
    setError('');
    setPesan('');
    setMemuat(true);
    try {
      await api.unduh(entri.path({ dari, sampai, tanggal }), entri.berkas);
      setPesan(`Berkas ${entri.berkas} berhasil diunduh.`);
    } catch (e) {
      // api.unduh melempar isi respons mentah, ambil pesan error JSON-nya kalau ada.
      const teks = e instanceof Error ? e.message : '';
      let teksPesan = teks || 'Gagal mengunduh berkas';
      try {
        const json = JSON.parse(teks) as { error?: unknown };
        if (json?.error) teksPesan = String(json.error);
      } catch {
        /* bukan JSON: pakai teks apa adanya */
      }
      setError(teksPesan);
    } finally {
      setMemuat(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="no-print">
        <Link to="/laporan" className="inline-flex min-h-sentuh items-center gap-1 text-sm font-medium text-teal-700">
          <span aria-hidden>←</span> Kembali ke daftar laporan
        </Link>
      </div>

      <div className="no-print">
        <Tabs items={ITEM_TAB} nilai={slug} onChange={(id) => navigate(`/laporan/${id}`)} />
      </div>

      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{entri.judul}</h1>
        {bisaCetak && (
          <Button variant="secondary" ukuran="lg" onClick={() => window.print()}>
            Cetak / PDF
          </Button>
        )}
      </div>

      {!online && <Alert tone="info">Laporan hanya bisa dimuat saat online.</Alert>}
      {error && <Alert>{error}</Alert>}
      {pesan && <Alert tone="sukses">{pesan}</Alert>}

      {jenis !== 'khusus' && (
        <div className="no-print">
          <Card title="Rentang">
            <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {jenis === 'harian' ? (
                <div className="sm:col-span-1">
                  <Label>Tanggal</Label>
                  <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
                </div>
              ) : (
                <>
                  <div>
                    <Label>Dari tanggal</Label>
                    <Input type="date" value={dari} onChange={(e) => setDari(e.target.value)} />
                  </div>
                  <div>
                    <Label>Sampai tanggal</Label>
                    <Input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} />
                  </div>
                </>
              )}
              {jenis !== 'unduh' && (
                <div>
                  <Button className="w-full" onClick={() => void muat()} disabled={!online || memuat}>
                    {memuat ? 'Memuat…' : 'Tampilkan'}
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Semua isi laporan dibungkus `area-laporan`: hanya bagian inilah yang ikut
          tercetak/di-PDF-kan, lengkap dengan kop dan baris totalnya. */}
      {jenis === 'khusus' ? (
        <div className="area-laporan">
          <KepalaCetak
            entri={entri}
            periode={periode}
            toko={setting?.toko_nama || 'Toko Hakim'}
            alamat={setting?.alamat ?? ''}
          />
          <StokOpname />
        </div>
      ) : jenis === 'unduh' ? (
        <Card title="Unduh Berkas">
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Berkas CSV berisi data pada rentang tanggal di atas, diunduh lewat koneksi terautentikasi.
            </p>
            <Button ukuran="lg" className="w-full sm:w-auto" onClick={() => void unduh()} disabled={!online || memuat}>
              {memuat ? 'Menyiapkan…' : `Unduh ${entri.berkas}`}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="area-laporan space-y-4">
          <KepalaCetak
            entri={entri}
            periode={periode}
            toko={setting?.toko_nama || 'Toko Hakim'}
            alamat={setting?.alamat ?? ''}
          />
          {hasil?.ringkas && <Ringkasan ringkas={hasil.ringkas} sembunyi={sembunyi} />}
          {/* Laporan yang isinya cuma angka ringkasan tidak perlu tabel kosong di bawahnya. */}
          {tampilTabel && (
            <Card title={entri.judul}>
              {memuat ? (
                <Kosong>Memuat…</Kosong>
              ) : hasil ? (
                <TabelLaporan rows={hasil.rows} sembunyi={sembunyi} />
              ) : (
                <Kosong>Tekan Tampilkan untuk memuat laporan.</Kosong>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

export default function Laporan() {
  const { slug } = useParams();
  const entri = entriDari(slug);
  // Tanpa remount: rentang tanggal yang sudah dipilih tetap terpakai saat pindah laporan.
  return entri ? <DetailLaporan entri={entri} /> : <DaftarLaporan />;
}
