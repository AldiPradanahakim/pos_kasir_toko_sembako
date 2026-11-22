import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import Pagination, { potongHalaman } from '../components/Pagination';
import { Alert, Button, Card, Input, Kosong, Label, Stat } from '../components/ui';
import { formatTanggal, rupiah, tanggalLokal } from '../lib/format';
import { useOnline } from '../lib/useOnline';

/* Bentuk respons GET /reports/dashboard. Tipe lokal: hanya halaman ini yang memakainya. */
interface BarisHarian {
  tanggal: string;
  omzet: number;
  transaksi: number;
  laba: number;
}

interface BarisTerlaris {
  product_id: number;
  nama: string;
  qty: number;
  omzet: number;
}

interface BarisStokMenipis {
  product_id: number;
  nama: string;
  stok_base: number;
  display: string;
  izin_minus: boolean;
}

interface BarisKategori {
  kategori: string;
  omzet: number;
  laba: number;
}

interface BarisKasir {
  kasir: string;
  transaksi: number;
  omzet: number;
}

interface DataDashboard {
  hari_ini: { omzet: number; transaksi: number; laba_kotor: number };
  ringkasan: {
    omzet: number;
    transaksi: number;
    laba_kotor: number;
    pengeluaran: number;
    laba_bersih: number;
    jumlah_item: number;
  };
  harian: BarisHarian[];
  terlaris: BarisTerlaris[];
  stok_menipis: BarisStokMenipis[];
  nilai_stok: { modal: number; jual: number };
  kas: { masuk: number; keluar: number; saldo: number };
  hutang_piutang: { piutang_belum_lunas: number; utang_belum_lunas: number };
  per_kategori: BarisKategori[];
  per_kasir: BarisKasir[];
}

const angka = (n: number | null | undefined): string => Number(n || 0).toLocaleString('id-ID');

/** Hari pertama bulan berjalan — rentang awal yang paling sering dibuka pemilik. */
const awalBulan = (): string => `${tanggalLokal().slice(0, 7)}-01`;

interface Kolom<T> {
  judul: string;
  nilai: (r: T) => ReactNode;
  /** Kolom angka: rata kanan di tabel, supaya digit sejajar. */
  kanan?: boolean;
}

/**
 * Tabel + pencarian di memori + halaman. Empat tabel di halaman ini bisa panjang,
 * jadi semuanya diperlakukan sama: kartu di HP, tabel di layar lebar.
 */
function KartuTabel<T>({
  judul,
  kolom,
  rows,
  kunci,
  teks,
  kosong,
  kelasBaris,
}: {
  judul: string;
  kolom: Kolom<T>[];
  rows: T[];
  kunci: (r: T) => string | number;
  /** Bahan pencarian; dicari dari nilai yang benar-benar tampil, jadi hasilnya pasti ketemu. */
  teks: (r: T) => string;
  kosong: string;
  kelasBaris?: (r: T) => string;
}) {
  const [kata, setKata] = useState('');
  const [halaman, setHalaman] = useState(1);
  const [perHalaman, setPerHalaman] = useState(20);

  const q = kata.trim().toLowerCase();
  const tersaring = q ? rows.filter((r) => teks(r).toLowerCase().includes(q)) : rows;
  const tampil = potongHalaman(tersaring, halaman, perHalaman);

  return (
    <Card title={`${judul} (${tersaring.length})`}>
      {rows.length > 0 && (
        <div className="no-print mb-3">
          <Input
            type="search"
            value={kata}
            onChange={(e) => {
              setKata(e.target.value);
              setHalaman(1);
            }}
            placeholder={`Cari di ${judul.toLowerCase()}…`}
            aria-label={`Cari di ${judul.toLowerCase()}`}
          />
        </div>
      )}

      {!rows.length ? (
        <Kosong>{kosong}</Kosong>
      ) : !tampil.length ? (
        <Kosong>Tidak ada baris yang cocok dengan pencarian "{kata.trim()}".</Kosong>
      ) : (
        <>
          {/* HP: satu kartu per baris; tabel selebar ini hanya bisa dibaca sambil digeser. */}
          <div className="space-y-2 md:hidden">
            {tampil.map((r) => (
              <div key={kunci(r)} className={`rounded-md border border-slate-200 p-3 ${kelasBaris?.(r) ?? ''}`}>
                <p className="text-sm font-medium">{kolom[0].nilai(r)}</p>
                <dl className="mt-1 space-y-0.5">
                  {kolom.slice(1).map((k) => (
                    <div key={k.judul} className="flex items-start justify-between gap-2">
                      <dt className="text-xs text-slate-600">{k.judul}</dt>
                      <dd className="min-w-0 text-right text-sm">{k.nilai(r)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>

          <div className="tabel-scroll hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  {kolom.map((k) => (
                    <th key={k.judul} className={`py-2 pr-3 ${k.kanan ? 'text-right' : ''}`}>
                      {k.judul}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tampil.map((r) => (
                  <tr key={kunci(r)} className={`border-b border-slate-50 ${kelasBaris?.(r) ?? ''}`}>
                    {kolom.map((k) => (
                      <td key={k.judul} className={`py-2 pr-3 ${k.kanan ? 'text-right' : ''}`}>
                        {k.nilai(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            total={tersaring.length}
            halaman={halaman}
            perHalaman={perHalaman}
            onHalaman={setHalaman}
            onPerHalaman={(n) => {
              setPerHalaman(n);
              setHalaman(1);
            }}
          />
        </>
      )}
    </Card>
  );
}

/**
 * Batang CSS murni (tanpa dependency chart). Tiap batang dibaca pembaca layar sebagai
 * gambar berlabel tanggal + omzet, dan batang tertinggi selalu membawa label nilainya.
 */
function GrafikHarian({ harian }: { harian: BarisHarian[] }) {
  const maks = harian.reduce((m, h) => Math.max(m, h.omzet), 0);
  if (!maks) return <Kosong>Belum ada penjualan pada rentang ini.</Kosong>;

  return (
    <div>
      <div className="flex h-40 items-end gap-1">
        {harian.map((h) => {
          const persen = (h.omzet / maks) * 100;
          return (
            <div
              key={h.tanggal}
              role="img"
              aria-label={`${formatTanggal(h.tanggal)}: omzet ${rupiah(h.omzet)} dari ${h.transaksi} transaksi`}
              className="relative h-full min-w-0 flex-1"
            >
              {h.omzet === maks && (
                <span
                  className="absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap text-xs font-semibold text-slate-700"
                  style={{ bottom: `calc(${persen}% + 4px)` }}
                >
                  {rupiah(h.omzet)}
                </span>
              )}
              <div
                className={`absolute bottom-0 w-full rounded-t ${h.omzet ? 'bg-teal-600' : 'bg-slate-100'}`}
                style={{ height: `${h.omzet ? Math.max(persen, 2) : 2}%` }}
              />
            </div>
          );
        })}
      </div>
      {/* Tanggal di bawah batang: di layar sempit hanya batang bernilai yang tulisannya
          dimunculkan, tetapi kolomnya tetap ada supaya tanggal tidak meleset dari batangnya. */}
      <div className="mt-1 flex gap-1">
        {harian.map((h) => (
          <span
            key={h.tanggal}
            title={formatTanggal(h.tanggal)}
            className={`min-w-0 flex-1 truncate text-center text-xs text-slate-600 ${
              h.omzet ? '' : 'invisible md:visible'
            }`}
          >
            {h.tanggal.slice(8, 10)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const online = useOnline();
  const [dari, setDari] = useState(awalBulan);
  const [sampai, setSampai] = useState(tanggalLokal);
  const [data, setData] = useState<DataDashboard | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [error, setError] = useState('');

  const muat = useCallback(async () => {
    const q = new URLSearchParams({ from: dari, to: sampai });
    setError('');
    setMemuat(true);
    try {
      setData(await api.get<DataDashboard>(`/reports/dashboard?${q}`));
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : 'Gagal memuat dashboard');
    } finally {
      setMemuat(false);
    }
  }, [dari, sampai]);

  // Rentang berubah = angka langsung disegarkan; tombol "Tampilkan" tetap ada untuk memaksa ulang.
  useEffect(() => {
    if (online) void muat();
  }, [muat, online]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Dashboard Analitik</h1>

      {!online && <Alert tone="info">Dashboard hanya bisa dimuat saat online.</Alert>}
      {error && <Alert>{error}</Alert>}

      <Card title="Rentang">
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
          <div>
            <Label>Dari tanggal</Label>
            <Input type="date" value={dari} onChange={(e) => setDari(e.target.value)} />
          </div>
          <div>
            <Label>Sampai tanggal</Label>
            <Input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} />
          </div>
          <div>
            <Button className="w-full" onClick={() => void muat()} disabled={!online || memuat}>
              {memuat ? 'Memuat…' : 'Tampilkan'}
            </Button>
          </div>
        </div>
      </Card>

      {memuat && !data && (
        <Card>
          <Kosong>Memuat…</Kosong>
        </Card>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
            <Stat label="Omzet" nilai={rupiah(data.ringkasan.omzet)} tone="hijau" />
            <Stat label="Transaksi" nilai={angka(data.ringkasan.transaksi)} />
            <Stat label="Laba kotor" nilai={rupiah(data.ringkasan.laba_kotor)} />
            <Stat
              label="Laba bersih"
              nilai={rupiah(data.ringkasan.laba_bersih)}
              tone={data.ringkasan.laba_bersih < 0 ? 'merah' : 'hijau'}
            />
            <Stat label="Jumlah item" nilai={angka(data.ringkasan.jumlah_item)} />
            <Stat label="Pengeluaran" nilai={rupiah(data.ringkasan.pengeluaran)} tone="kuning" />
          </div>

          <Card title="Hari Ini">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Omzet" nilai={rupiah(data.hari_ini.omzet)} tone="hijau" />
              <Stat label="Transaksi" nilai={angka(data.hari_ini.transaksi)} />
              <Stat label="Laba kotor" nilai={rupiah(data.hari_ini.laba_kotor)} />
            </div>
          </Card>

          <Card title="Grafik Penjualan Harian">
            <GrafikHarian harian={data.harian} />
          </Card>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Card title="Nilai Stok">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Modal" nilai={rupiah(data.nilai_stok.modal)} />
                <Stat label="Harga jual" nilai={rupiah(data.nilai_stok.jual)} tone="hijau" />
              </div>
            </Card>
            <Card title="Kas">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Masuk" nilai={rupiah(data.kas.masuk)} tone="hijau" />
                <Stat label="Keluar" nilai={rupiah(data.kas.keluar)} tone="merah" />
                <Stat label="Saldo" nilai={rupiah(data.kas.saldo)} className="col-span-2" />
              </div>
            </Card>
            <Card title="Hutang & Piutang">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Piutang belum lunas" nilai={rupiah(data.hutang_piutang.piutang_belum_lunas)} tone="kuning" />
                <Stat label="Utang belum lunas" nilai={rupiah(data.hutang_piutang.utang_belum_lunas)} tone="merah" />
              </div>
            </Card>
          </div>

          <KartuTabel
            judul="Terlaris"
            rows={data.terlaris}
            kunci={(r) => r.product_id}
            teks={(r) => `${r.nama} ${r.qty} ${r.omzet}`}
            kosong="Belum ada barang terjual pada rentang ini."
            kolom={[
              { judul: 'Nama Barang', nilai: (r) => r.nama },
              { judul: 'Qty', nilai: (r) => angka(r.qty), kanan: true },
              { judul: 'Omzet', nilai: (r) => rupiah(r.omzet), kanan: true },
            ]}
          />

          <KartuTabel
            judul="Stok Menipis"
            rows={data.stok_menipis}
            kunci={(r) => r.product_id}
            teks={(r) => `${r.nama} ${r.display} ${r.stok_base} ${r.izin_minus ? 'boleh minus' : 'tidak boleh minus'}`}
            kosong="Tidak ada stok menipis."
            kelasBaris={(r) => (r.izin_minus ? 'bg-amber-50' : '')}
            kolom={[
              { judul: 'Nama Barang', nilai: (r) => r.nama },
              { judul: 'Stok', nilai: (r) => r.display, kanan: true },
              {
                judul: 'Izin minus',
                nilai: (r) => (r.izin_minus ? <span className="font-medium text-amber-700">Ya</span> : 'Tidak'),
              },
            ]}
          />

          <KartuTabel
            judul="Per Kategori"
            rows={data.per_kategori}
            kunci={(r) => r.kategori}
            teks={(r) => `${r.kategori} ${r.omzet} ${r.laba}`}
            kosong="Belum ada penjualan pada rentang ini."
            kolom={[
              { judul: 'Kategori', nilai: (r) => r.kategori },
              { judul: 'Omzet', nilai: (r) => rupiah(r.omzet), kanan: true },
              { judul: 'Laba', nilai: (r) => rupiah(r.laba), kanan: true },
            ]}
          />

          <KartuTabel
            judul="Per Kasir"
            rows={data.per_kasir}
            kunci={(r) => r.kasir}
            teks={(r) => `${r.kasir} ${r.transaksi} ${r.omzet}`}
            kosong="Belum ada transaksi pada rentang ini."
            kolom={[
              { judul: 'Kasir', nilai: (r) => r.kasir },
              { judul: 'Transaksi', nilai: (r) => angka(r.transaksi), kanan: true },
              { judul: 'Omzet', nilai: (r) => rupiah(r.omzet), kanan: true },
            ]}
          />
        </>
      )}
    </div>
  );
}
