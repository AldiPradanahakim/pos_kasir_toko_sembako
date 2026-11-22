import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import Kalkulator from '../components/Kalkulator';
import LaporanTutupKas from '../components/LaporanTutupKas';
import ScanNotaKasir from '../components/ScanNotaKasir';
import { ActionBar, Alert, Button, Card, Input, InputUang, Kosong, Label, Modal } from '../components/ui';
import { db } from '../db';
import { rupiah, parseUang } from '../lib/format';
import { useOnline } from '../lib/useOnline';
import { useShift } from '../lib/shift';
import { useAuth } from '../store';
import { hitungStok, simpanPenjualan, type KeranjangItem } from '../sync';
import type { Product, ProductUnit, Shift, StockRow } from '../types';

/** Banyak hasil pencarian yang ditampilkan sekaligus di bawah kotak cari. */
const MAKS_HASIL = 8;

/**
 * Nama tuan/nyonya hanya boleh huruf (beserta spasi dan tanda baca nama: . ' -).
 * Kolom ini disaring di layar kasir saja, TIDAK di server: transaksi offline yang sudah
 * antre tidak boleh ditolak server gara-gara nama, karena itu berarti penjualannya hilang.
 */
const BUKAN_HURUF = /[^\p{L}\s.'-]/gu;

export default function Kasir() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const online = useOnline();

  const products = useLiveQuery(
    () => db.products.filter((p) => p.is_active !== false).toArray(),
    [],
    [] as Product[],
  );
  const pending = useLiveQuery(() => db.pendingSales.where('status').equals('pending').count(), [], 0);
  const stok = useLiveQuery(() => db.cachedStock.toArray(), [], [] as StockRow[]);
  const stokProduk = useMemo(() => new Map(stok.map((s) => [s.product_id, s])), [stok]);
  const produkById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const [cari, setCari] = useState('');
  const [keranjang, setKeranjang] = useState<KeranjangItem[]>([]);
  const [dibayar, setDibayar] = useState('');
  const [namaPelanggan, setNamaPelanggan] = useState('');
  const [bon, setBon] = useState(false);
  const [pesan, setPesan] = useState('');
  /** Laporan satu-satunya yang dilihat kasir: hasil tutup kas yang baru saja dia lakukan. */
  const [laporanTutup, setLaporanTutup] = useState<Shift | null>(null);
  const [error, setError] = useState('');
  const [sedangSimpan, setSedangSimpan] = useState(false);
  const [editBaris, setEditBaris] = useState<number | null>(null);
  const [bukaKalkulator, setBukaKalkulator] = useState(false);
  const [bukaScan, setBukaScan] = useState(false);
  const kotakKeranjang = useRef<HTMLDivElement>(null);

  // Kas harus dibuka dulu: tanpa shift, uang fisik saat tutup kas tidak bisa dibandingkan.
  const {
    shift,
    memuat: memuatKas,
    online: onlineKas,
    buka: bukaKas,
    tutup: tutupKas,
    catatPengeluaran,
    batalPengeluaran,
  } = useShift();
  const [modalAwal, setModalAwal] = useState('');
  const [sedangKas, setSedangKas] = useState(false);
  const [errorKas, setErrorKas] = useState('');
  const [dialogTutup, setDialogTutup] = useState(false);
  /** Nama pelanggan yang sudah pernah bon — dipakai <datalist>, bukan dropdown buatan sendiri. */
  const [daftarPelanggan, setDaftarPelanggan] = useState<string[]>([]);
  const [uangFisik, setUangFisik] = useState('');
  const [catatanKas, setCatatanKas] = useState('');
  /** Pop up "Kas Keluar": uang laci yang dipakai selama shift (beli barang, bayar ongkos). */
  const [dialogKeluar, setDialogKeluar] = useState(false);
  const [jumlahKeluar, setJumlahKeluar] = useState('');
  const [ketKeluar, setKetKeluar] = useState('');
  const [sedangKeluar, setSedangKeluar] = useState(false);

  // Saran nama pelanggan: sekali per kunjungan layar kasir, dan hanya saat online.
  // Offline tetap bisa mengetik nama bebas; saran nama bukan syarat berjualan.
  useEffect(() => {
    if (!online) return;
    api
      .getSilent<{ nama: string }[]>('/customers?aktif=true&limit=500')
      .then((rows) => setDaftarPelanggan(rows.map((r) => r.nama)))
      .catch(() => setDaftarPelanggan([]));
  }, [online]);

  /**
   * Barang yang baru ditambahkan selalu jadi baris paling bawah. Tanpa ini, keranjang yang
   * sudah panjang membuat kasir tidak melihat apa pun berubah saat mengetuk hasil pencarian.
   */
  useEffect(() => {
    const el = kotakKeranjang.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [keranjang.length]);

  /**
   * Kotak cari adalah SATU-SATUNYA jalan menambah barang (daftar produk dihapus atas
   * permintaan pemilik). Hasilnya muncul sebagai daftar di bawah kotak cari; sekali ketuk
   * pada satuan yang diinginkan, barang langsung masuk keranjang.
   */
  const hasil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || (p.category_name ?? '').toLowerCase().includes(q))
      .slice(0, MAKS_HASIL);
  }, [cari, products]);

  const total = keranjang.reduce((s, it) => s + it.harga * it.qty, 0);
  /** Total barang (jenis/baris) dan total qty seluruh keranjang, ditampilkan di kartu pembayaran. */
  const totalQty = keranjang.reduce((s, it) => s + it.qty, 0);
  const dibayarAngka = parseUang(dibayar);
  // Bon: sisa tagihan pelanggan, jadi tidak ada kembalian dan boleh kurang bayar.
  const sisaBon = Math.max(total - dibayarAngka, 0);
  const kembalian = bon ? 0 : dibayarAngka - total;

  /**
   * Penjagaan stok di sisi kasir. Server tetap penjaga terakhir (menolak 422), tapi kalau
   * tidak dicek di sini keranjang sudah berubah padahal transaksinya nanti ditolak.
   * `kecualiBaris` = indeks baris yang sedang dihitung ulang, supaya qty lamanya tidak
   * dihitung dua kali sebagai pemakaian.
   */
  function sisaBaseStok(productId: number, kecualiBaris: number | null): number | null {
    const row = stokProduk.get(productId);
    // Stok belum tersalin (perangkat baru/offline): jangan blokir, server yang memutuskan.
    if (!row) return null;
    const dipakai = keranjang.reduce(
      (s, it, i) => (i === kecualiBaris || it.product_id !== productId ? s : s + it.isi * it.qty),
      0,
    );
    return row.stok_base - dipakai;
  }

  /** Sisa stok untuk ditampilkan di hasil pencarian, dalam satuan hitung server. */
  function sisaStok(productId: number): { teks: string; habis: boolean } {
    const row = stokProduk.get(productId);
    const sisa = sisaBaseStok(productId, null);
    if (!row || sisa === null) return { teks: 'stok belum tersalin', habis: false };
    // Yang ditampilkan adalah SISA (stok dikurangi isi keranjang), bukan stok total:
    // menulis total membuat kasir mengira masih bisa menambah lalu ditolak pesan galat.
    return {
      teks: hitungStok(sisa, row, produkById.get(productId)?.units ?? []).display_hitung ?? row.display,
      habis: sisa <= 0 && row.izin_minus !== true,
    };
  }

  function pesanStokTidakCukup(
    productId: number,
    name: string,
    kebutuhanBase: number,
    kecualiBaris: number | null,
  ): string {
    const row = stokProduk.get(productId);
    const sisa = sisaBaseStok(productId, kecualiBaris);
    if (!row || sisa === null) return '';
    if (sisa - kebutuhanBase >= 0 || row.izin_minus === true) return '';
    return `Stok "${name}" tidak cukup (sisa ${sisa}, butuh ${kebutuhanBase}). Minta superadmin memberi izin jual stok kosong.`;
  }

  /**
   * Masukkan barang ke keranjang sekaligus. Dipakai kotak cari (satu barang) dan Scan Nota
   * (banyak baris), supaya aturan harga, penjagaan stok, dan penggabungan baris hanya ada
   * di satu tempat. Seluruh batch dihitung terhadap keranjang yang sama, jadi tiga baris
   * dari nota tidak bisa lolos penjagaan stok masing-masing.
   * `ditolak` = indeks `pilihan` yang tidak masuk, dipakai Scan Nota untuk menandai baris.
   */
  function masukkanKeKeranjang(pilihan: { productId: number; unitId: number; qty: number }[]): {
    ok: number;
    gagal: string[];
    ditolak: number[];
  } {
    const gagal: string[] = [];
    const ditolak: number[] = [];
    const next = [...keranjang];
    /** Pemakaian stok dasar yang sudah direncanakan batch ini, per produk. */
    const rencana = new Map<number, number>();
    let ok = 0;

    pilihan.forEach((s, i) => {
      const p = produkById.get(s.productId);
      const u = p?.units.find((x) => x.unit_id === s.unitId);
      if (!p || !u) {
        gagal.push(`Baris ${i + 1}: produk atau satuannya tidak ditemukan.`);
        ditolak.push(i);
        return;
      }
      if (!Number.isInteger(u.harga_jual) || u.harga_jual < 0) {
        gagal.push(`Harga jual "${p.name}" (${u.unit_name}) belum diisi.`);
        ditolak.push(i);
        return;
      }
      if (!Number.isInteger(s.qty) || s.qty <= 0) {
        gagal.push(`Qty "${p.name}" harus bilangan bulat lebih dari 0.`);
        ditolak.push(i);
        return;
      }

      const row = stokProduk.get(p.id);
      if (row && row.izin_minus !== true) {
        const dipakai = keranjang.reduce((t, it) => (it.product_id === p.id ? t + it.isi * it.qty : t), 0);
        const sisa = row.stok_base - dipakai - (rencana.get(p.id) ?? 0);
        const butuh = u.isi * s.qty;
        if (sisa - butuh < 0) {
          gagal.push(
            `Stok "${p.name}" tidak cukup (sisa ${hitungStok(sisa, row, p.units).display_hitung ?? row.display}, butuh ${hitungStok(butuh, row, p.units).display_hitung ?? butuh}). Minta superadmin memberi izin jual stok kosong.`,
          );
          ditolak.push(i);
          return;
        }
      }

      const idx = next.findIndex(
        (x) => x.product_id === p.id && x.unit_id === u.unit_id && x.harga === u.harga_jual,
      );
      if (idx >= 0) next[idx] = { ...next[idx], qty: next[idx].qty + s.qty };
      else
        next.push({
          product_id: p.id,
          name: p.name,
          unit_id: u.unit_id,
          unit_name: u.unit_name,
          isi: u.isi,
          qty: s.qty,
          harga: u.harga_jual,
          harga_asli: u.harga_jual,
          alasan_ubah_harga: '',
        });
      rencana.set(p.id, (rencana.get(p.id) ?? 0) + u.isi * s.qty);
      ok++;
    });

    if (ok) {
      setKeranjang(next);
      setError('');
    }
    return { ok, gagal, ditolak };
  }

  /** Tambah satu satuan produk; baris dengan produk + satuan + harga sama digabung qty-nya. */
  function tambahItem(p: Product, u: ProductUnit) {
    const hasil = masukkanKeKeranjang([{ productId: p.id, unitId: u.unit_id, qty: 1 }]);
    if (!hasil.ok) {
      setError(hasil.gagal[0] ?? `"${p.name}" tidak bisa ditambahkan.`);
      return;
    }
    setCari('');
    setPesan(`Ditambahkan: ${p.name} (${u.unit_name})`);
  }

  /** Enter di kotak cari = tambah hasil paling atas (satuannya yang terkecil, mis. pcs). */
  function tambahHasilTeratas() {
    const p = hasil[0];
    const u = p?.units[0];
    if (p && u) tambahItem(p, u);
  }

  function ubahQty(idx: number, delta: number) {
    const it = keranjang[idx];
    if (!it) return;
    const q = it.qty + delta;
    if (q < 1) return;
    const tolak = pesanStokTidakCukup(it.product_id, it.name, it.isi * q, idx);
    if (tolak) {
      setError(tolak);
      return;
    }
    setError('');
    setKeranjang((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], qty: q };
      return next;
    });
  }

  /** Simpan satu baris dari pop up: qty, harga, dan alasan sekaligus. */
  function simpanBaris(idx: number, qty: number, harga: number, alasan: string) {
    const it = keranjang[idx];
    if (!it) return;
    const tolak = pesanStokTidakCukup(it.product_id, it.name, it.isi * qty, idx);
    if (tolak) {
      setError(tolak);
      return;
    }
    setError('');
    setKeranjang((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], qty, harga, alasan_ubah_harga: alasan };
      return next;
    });
    setEditBaris(null);
  }

  function hapusBaris(idx: number) {
    setKeranjang((prev) => prev.filter((_, i) => i !== idx));
    setEditBaris(null);
  }

  /**
   * Simpan transaksi. `cetak` hanya menentukan apakah dialog cetak dibuka setelahnya ,
   * keduanya tetap menyimpan transaksi (lokal + antrean sinkron).
   */
  async function simpan(cetak: boolean) {
    setError('');
    if (!keranjang.length) {
      setError('Keranjang masih kosong.');
      return;
    }
    for (const it of keranjang) {
      if (!Number.isInteger(it.qty) || it.qty <= 0) {
        setError(`Qty "${it.name}" harus bilangan bulat lebih dari 0.`);
        return;
      }
      if (!Number.isInteger(it.harga) || it.harga < 0) {
        setError(`Harga "${it.name}" harus bilangan bulat dan tidak negatif.`);
        return;
      }
      if (it.harga !== it.harga_asli && !it.alasan_ubah_harga.trim()) {
        setError(`Perubahan harga "${it.name}" wajib disertai alasan.`);
        return;
      }
    }
    if (bon) {
      if (!namaPelanggan.trim()) {
        setError('Bon butuh nama pelanggan (untuk ditagih nanti).');
        return;
      }
      if (dibayarAngka >= total) {
        setError('Bon hanya untuk pembayaran yang kurang dari total. Matikan tombol Bon.');
        return;
      }
    } else if (dibayarAngka < total) {
      setError('Jumlah dibayar kurang dari total. Pakai tombol Bon kalau pelanggan berutang.');
      return;
    }

    setSedangSimpan(true);
    try {
      const { uuid } = await simpanPenjualan({
        items: keranjang,
        // Toko hanya menerima tunai; pilihan metode bayar sudah dihapus dari layar kasir.
        // Server mewajibkan `metode_bayar`, jadi nilainya tetap dikirim.
        metode_bayar: 'tunai',
        dibayar: dibayarAngka,
        kasir: user?.name ?? user?.username ?? '-',
        nama_pelanggan: namaPelanggan,
        bon,
      });
      setKeranjang([]);
      setDibayar('');
      setNamaPelanggan('');
      setBon(false);
      setPesan('');
      navigate(`/kasir/struk/${uuid}${cetak ? '?cetak=1' : ''}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan transaksi');
    } finally {
      setSedangSimpan(false);
    }
  }

  const bisaSimpan = !sedangSimpan && keranjang.length > 0;

  async function simpanBukaKas() {
    const modal = parseUang(modalAwal);
    if (!Number.isInteger(modal) || modal < 0) {
      setErrorKas('Modal awal harus angka, boleh 0.');
      return;
    }
    setSedangKas(true);
    setErrorKas('');
    try {
      await bukaKas(modal);
      setModalAwal('');
      setLaporanTutup(null);
    } catch (e) {
      setErrorKas(e instanceof Error ? e.message : 'Gagal membuka kas');
    } finally {
      setSedangKas(false);
    }
  }

  async function simpanTutupKas() {
    const fisik = parseUang(uangFisik);
    if (!Number.isInteger(fisik) || fisik < 0) {
      setErrorKas('Uang fisik harus angka, boleh 0.');
      return;
    }
    setSedangKas(true);
    setErrorKas('');
    try {
      const hasil = await tutupKas(fisik, catatanKas);
      setDialogTutup(false);
      setUangFisik('');
      setCatatanKas('');
      // Laporan tutup kas tampil di layar ini SEKALI, di tempat kartu "Buka Kas": inilah
      // saat uang 80.000 jadi 100.000 dicocokkan (modal, seharusnya, fisik, selisih).
      // Riwayat kas seluruh kasir khusus superadmin, jadi kasir tidak diarahkan ke sana.
      setLaporanTutup(hasil);
      setPesan(`Kas ditutup. Selisih ${rupiah(hasil.selisih ?? 0)}.`);
    } catch (e) {
      setErrorKas(e instanceof Error ? e.message : 'Gagal menutup kas');
    } finally {
      setSedangKas(false);
    }
  }

  /**
   * Catat uang laci yang dipakai selama shift. Baris ini menempel ke shift di server,
   * jadi "seharusnya di laci" langsung turun dan ikut terbaca saat tutup kas.
   */
  async function simpanKeluar() {
    const jumlah = parseUang(jumlahKeluar);
    if (!Number.isInteger(jumlah) || jumlah <= 0) {
      setErrorKas('Jumlah harus angka lebih dari 0.');
      return;
    }
    if (!ketKeluar.trim()) {
      setErrorKas('Tulis uangnya dipakai untuk apa, mis. beli gula atau bayar ongkos.');
      return;
    }
    setSedangKeluar(true);
    setErrorKas('');
    try {
      const baru = await catatPengeluaran(jumlah, ketKeluar.trim());
      setDialogKeluar(false);
      setJumlahKeluar('');
      setKetKeluar('');
      setPesan(
        `Kas keluar ${rupiah(jumlah)} dicatat. Seharusnya di laci sekarang ${rupiah(baru.kas_seharusnya ?? 0)}.`,
      );
    } catch (e) {
      setErrorKas(e instanceof Error ? e.message : 'Gagal mencatat kas keluar');
    } finally {
      setSedangKeluar(false);
    }
  }

  /** Batalkan pengeluaran yang salah catat (hanya selama kas masih terbuka). */
  async function batalKeluar(id: number) {
    setSedangKeluar(true);
    setErrorKas('');
    try {
      await batalPengeluaran(id);
    } catch (e) {
      setErrorKas(e instanceof Error ? e.message : 'Gagal membatalkan pengeluaran');
    } finally {
      setSedangKeluar(false);
    }
  }

  /** Baris kas keluar shift ini: rincian yang dibaca kasir sebelum menghitung uang fisik. */
  const keluarShift = (shift?.rincian ?? []).filter((r) => r.tipe === 'keluar');

  /** Baris yang sedang dibuka pop up-nya; null kalau tidak ada (atau barisnya sudah hilang). */
  const idxEdit = editBaris !== null && keranjang[editBaris] ? editBaris : null;

  /**
   * Dua tombol simpan/cetak. Jumlah kolomnya berbeda menurut tempat: di baris lengket HP
   * selalu dua kolom (mendatar, hemat tinggi), sedangkan di kartu pembayaran baru dua kolom
   * sejak `lg`, di kolom sempit 768px teks "Simpan Struk" tidak muat satu baris.
   */
  const tombolSimpan = (kolom: string) => (
    <div className={`grid gap-2 ${kolom}`}>
      <Button ukuran="lg" variant="secondary" disabled={!bisaSimpan} onClick={() => void simpan(false)}>
        {sedangSimpan ? 'Menyimpan…' : 'Simpan Struk'}
      </Button>
      <Button ukuran="lg" disabled={!bisaSimpan} onClick={() => void simpan(true)}>
        {sedangSimpan ? 'Menyimpan…' : 'Cetak Struk'}
      </Button>
    </div>
  );

  return (
    // Tata letak kasir gaya minimarket: kiri = pelanggan, kotak cari, lalu tabel keranjang
    // yang besar; kanan = total & pembayaran. Halaman ini tidak menggulir sejak tablet ,
    // yang bergulir hanya daftar hasil cari dan tabel keranjang.
    <div className="flex flex-col gap-3 md:min-h-0 md:flex-1">
      {/* Kas belum dibuka: jangan biarkan jual dulu, uang fisik nanti tidak bisa dicocokkan. */}
      {memuatKas ? (
        <Card>
          <Kosong>Memuat status kas…</Kosong>
        </Card>
      ) : !shift ? (
        <>
        {laporanTutup && (
          <LaporanTutupKas shift={laporanTutup} onTutup={() => setLaporanTutup(null)} />
        )}
        <Card title="Buka Kas">
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Isi modal awal (uang di laci sebelum jualan). Kas harus dibuka sebelum transaksi pertama.
            </p>
            <div>
              <Label>Modal awal</Label>
              <InputUang
                nilai={modalAwal}
                onNilai={setModalAwal}
                placeholder="0"
                className="text-right text-lg font-semibold"
              />
            </div>
            {errorKas && <Alert>{errorKas}</Alert>}
            {/* Setelah tutup kas, shift jadi null sehingga kartu kasir (tempat pesan sr-only)
                hilang. Pesan selisih harus tetap terlihat di sini, bukan cuma di pembaca layar. */}
            {pesan && <Alert tone="sukses">{pesan}</Alert>}
            {!onlineKas && <Alert tone="info">Offline: kas dibuka lokal, dicatat ke server saat online.</Alert>}
            <Button ukuran="lg" className="w-full" disabled={sedangKas} onClick={() => void simpanBukaKas()}>
              {sedangKas ? 'Membuka…' : 'Buka Kas'}
            </Button>
          </div>
        </Card>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <span className="text-slate-600">
            Kas dibuka {new Date(shift.dibuka_pada).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} ·
            modal <b className="text-slate-800">{rupiah(shift.modal_awal)}</b>
            {!!shift.kas_keluar && (
              <> · uang keluar <b className="text-amber-800">{rupiah(shift.kas_keluar)}</b></>
            )}
            {shift.kas_seharusnya !== undefined && (
              <> · seharusnya di laci <b className="text-slate-800">{rupiah(shift.kas_seharusnya)}</b></>
            )}
          </span>
          <span className="flex shrink-0 gap-2">
            <Button variant="secondary" ukuran="sm" onClick={() => setDialogKeluar(true)}>
              Kas Keluar
            </Button>
            <Button variant="secondary" ukuran="sm" onClick={() => setDialogTutup(true)}>
              Tutup Kas
            </Button>
          </span>
        </div>
      )}

      {shift && (
      <>
      <div className="grid min-w-0 grid-cols-1 gap-3 md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,1fr)_minmax(0,300px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)] xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        {/* ---------- Kolom kiri: tuan/nyonya, cari barang, keranjang ---------- */}
        <div className="flex min-w-0 flex-col gap-3 md:min-h-0">
          {/* Cari barang, nama tuan/nyonya, jumlah keranjang, dan Kosongkan jadi SATU baris.
              Dulu empat blok terpisah (dua kartu + judul kartu keranjang); tingginya
              menghabiskan ruang yang seharusnya dipakai tabel keranjang. */}
          <Card className="shrink-0" padat>
            <div className="flex flex-wrap items-center gap-2 p-2">
              {/* Daftar hasil sengaja menumpuk di atas keranjang (absolute), bukan mendorongnya:
                  tinggi tabel keranjang tidak berubah-ubah setiap kali kasir mengetik. */}
              <div className="relative min-w-0 w-full xl:w-auto xl:min-w-[13rem] xl:flex-1">
                <Input
                  type="search"
                  value={cari}
                  aria-label="Cari barang"
                  placeholder="Ketik nama barang, lalu ketuk untuk menambah…"
                  onChange={(e) => setCari(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      tambahHasilTeratas();
                    }
                  }}
                />

                {cari.trim() !== '' && (
                  <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-[50vh] overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                    {hasil.map((p) => {
                      const sisaProduk = sisaStok(p.id);
                      return (
                        <div key={p.id} className="border-b border-slate-100 px-2 py-2 last:border-0">
                          <p className="truncate font-medium">{p.name}</p>
                          <p className="text-xs text-slate-500">{p.category_name ?? 'Tanpa kategori'}</p>
                          {/* Sisa stok dalam satuan hitung supaya kasir tahu sebelum mengetuk.
                              Tombolnya tetap bisa diketuk: menolak lewat pesan galat lebih jelas
                              daripada tombol mati tanpa alasan. */}
                          <p className="text-xs">
                            <span className={sisaProduk.habis ? 'font-semibold text-red-700' : 'text-slate-600'}>
                              Sisa {sisaProduk.teks}
                              {sisaProduk.habis ? ` · stok kosong (sisa ${sisaProduk.teks}), minta izin superadmin` : ''}
                            </span>
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {p.units.map((u) => (
                              <button
                                key={u.unit_id}
                                type="button"
                                // Label lengkap: teks yang terlihat ("pcs · Rp 2.700") tidak
                                // menyebut nama barangnya, jadi pembaca layar butuh ini.
                                aria-label={`Tambah ${p.name} ${u.unit_name}`}
                                onClick={() => tambahItem(p, u)}
                                className="min-h-sentuh rounded-md border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-900 active:bg-teal-100"
                              >
                                {u.unit_name} · {rupiah(u.harga_jual)}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {!hasil.length && <Kosong>Tidak ada produk yang cocok.</Kosong>}
                  </div>
                )}
              </div>

              <Input
                value={namaPelanggan}
                onChange={(e) => setNamaPelanggan(e.target.value.replace(BUKAN_HURUF, ''))}
                aria-label="Nama tuan/nyonya (opsional)"
                placeholder="Tuan/Nyonya"
                maxLength={100}
                list="daftar-pelanggan"
                className="sm:w-36 sm:shrink-0 lg:w-36 xl:w-44"
              />
              <datalist id="daftar-pelanggan">
                {daftarPelanggan.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>

              {/* Jalan kedua mengisi keranjang: nota belanja pelanggan dipindai sekali, bukan
                  dicari satu per satu. Di layar sempit ia turun satu baris bersama nama
                  pelanggan, supaya kotak cari tetap selebar kolom (di 768px kolom kirinya
                  hanya ~400px; memaksa sebaris membuat kotak cari tinggal 130px). */}
              <Button
                variant="secondary"
                className="shrink-0"
                onClick={() => setBukaScan(true)}
                aria-haspopup="dialog"
              >
                Scan Nota
              </Button>

              <div className="ml-auto flex shrink-0 items-center gap-2">
                {/* Dihitung hanya kalau barisnya masih muat: di 768px penghitung ini
                    memaksa nama tuan/nyonya turun ke baris kedua dan memakan tinggi tabel. */}
                <span className="hidden whitespace-nowrap text-sm font-semibold text-slate-700 lg:inline">
                  Keranjang ({keranjang.length})
                </span>
                {keranjang.length > 0 && (
                  <Button variant="ghost" ukuran="sm" className="text-red-700" onClick={() => setKeranjang([])}>
                    Kosongkan
                  </Button>
                )}
              </div>

              {/* Umpan balik untuk pembaca layar saja: barangnya sudah terlihat muncul di
                  keranjang, jadi teks konfirmasi ini tidak perlu memakan tinggi layar. */}
              <p className="sr-only" role="status">
                {pesan}
              </p>
            </div>
          </Card>

          <Card
            className="flex min-h-0 flex-col md:flex-1"
            padat
            isiClassName="flex min-h-0 flex-col md:flex-1"
          >
            {/* Tanpa padding atas: `sticky top-0` menempel di tepi kotak gulir, jadi baris yang
                lewat tidak terlihat menyembul di celah antara judul kolom dan tepi kartu. */}
            <div
              ref={kotakKeranjang}
              className="max-h-[45vh] min-h-0 flex-1 overflow-y-auto px-2 pb-2 md:max-h-none"
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                    {/* Judul kolom menempel di atas kotak gulirnya: kasir tetap tahu kolom mana
                        yang sedang dilihat walau isi keranjangnya panjang. */}
                    <th className="sticky top-0 z-10 bg-white pb-1.5 pt-2 pr-2">Barang</th>
                    <th className="sticky top-0 z-10 w-40 bg-white pb-1.5 pt-2 text-center">Qty</th>
                    <th className="sticky top-0 z-10 hidden bg-white pb-1.5 pt-2 pr-3 text-right lg:table-cell">Harga</th>
                    <th className="sticky top-0 z-10 hidden bg-white pb-1.5 pt-2 pr-3 text-right sm:table-cell">Subtotal</th>
                    <th className="sticky top-0 z-10 bg-white pb-1.5 pt-2 pr-3 text-right">Hapus</th>
                  </tr>
                </thead>
                <tbody>
                  {keranjang.map((it, idx) => (
                    <tr key={`${it.product_id}-${it.unit_id}`} className="h-11 border-b border-slate-50">
                      <td className="max-w-0 w-full py-0 pr-2">
                        <div className="flex items-center gap-2">
                          {/* Nomor baris: memudahkan kasir menyebut barang ke-N saat antre panjang. */}
                          <span className="w-5 shrink-0 text-right text-xs text-slate-500">{idx + 1}</span>
                          <button
                            type="button"
                            onClick={() => setEditBaris(idx)}
                            title={it.alasan_ubah_harga ? `Alasan ubah harga: ${it.alasan_ubah_harga}` : undefined}
                            className="flex h-11 min-w-0 flex-1 items-center gap-1.5 text-left"
                          >
                            <span className="min-w-0 truncate font-medium">{it.name}</span>
                            <span className="shrink-0 text-xs text-slate-500">{it.unit_name}</span>
                            {it.harga !== it.harga_asli && (
                              <span className="shrink-0 text-xs text-amber-700">· harga diubah</span>
                            )}
                          </button>
                        </div>
                        {/* Di HP kolom Subtotal tidak muat, jadi subtotalnya turun ke baris kedua
                            di bawah nama barang alih-alih memotong lebar nama. */}
                        <span className="block pl-7 text-xs font-semibold text-slate-600 sm:hidden">
                          {rupiah(it.harga * it.qty)}
                        </span>
                      </td>
                      {/* Qty diubah langsung dari barisnya, tanpa perlu membuka apa pun.
                          Kotak − dan + sengaja kecil (28px) supaya tidak mepet barisnya, tetapi
                          tombolnya tetap 44×44px — target sentuh minimum yang dipegang proyek. */}
                      <td className="py-0 pr-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            aria-label={`Kurangi qty ${it.name}`}
                            disabled={it.qty <= 1}
                            onClick={() => ubahQty(idx, -1)}
                            className="flex h-11 w-11 items-center justify-center"
                          >
                            <span
                              className={`flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-lg font-semibold ${
                                it.qty <= 1 ? 'text-slate-300' : 'text-slate-700'
                              }`}
                            >
                              −
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-label={`Ubah qty ${it.name}`}
                            onClick={() => setEditBaris(idx)}
                            className="h-11 w-8 font-semibold text-slate-800"
                          >
                            {it.qty}
                          </button>
                          <button
                            type="button"
                            aria-label={`Tambah qty ${it.name}`}
                            onClick={() => ubahQty(idx, 1)}
                            className="flex h-11 w-11 items-center justify-center"
                          >
                            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-lg font-semibold text-slate-700">
                              +
                            </span>
                          </button>
                        </div>
                      </td>
                      <td className="hidden whitespace-nowrap py-0 pr-3 text-right lg:table-cell">
                        {rupiah(it.harga)}
                      </td>
                      <td className="hidden whitespace-nowrap py-0 pr-3 text-right font-semibold sm:table-cell">
                        {rupiah(it.harga * it.qty)}
                      </td>
                      <td className="py-0 pr-3 text-right">
                        <button
                          type="button"
                          aria-label={`Hapus ${it.name}`}
                          onClick={() => hapusBaris(idx)}
                          className="h-11 w-11 rounded-md text-lg text-red-700 active:bg-red-50"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {!keranjang.length && <Kosong>Keranjang kosong. Cari barang di kotak pencarian di atas.</Kosong>}
              {keranjang.length > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  Tombol − dan + mengubah qty. Ketuk nama barang untuk ubah harga atau menghapusnya.
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* ---------- Kolom kanan: total & pembayaran ---------- */}
        <div className="flex min-w-0 flex-col gap-3 md:min-h-0">
          <Card title="Pembayaran" className="shrink-0">
            <div className="space-y-3">
              <div className="rounded-lg bg-slate-900 px-3 py-3 text-right">
                <p className="text-xs text-slate-300">Total Pembayaran</p>
                <p className="break-all text-3xl font-bold text-white">{rupiah(total)}</p>
              </div>

              {/* Total barang & qty dipisah dari kotak total: ini angka yang dicocokkan
                  kasir dengan belanjaan pembeli sebelum menagih, jadi harus terbaca
                  sebagai dua angka sendiri, bukan teks kecil di atas nominal. */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-600">Jumlah barang</p>
                  <p className="text-lg font-bold text-slate-800">{keranjang.length}</p>
                </div>
                <div className="rounded-md bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-600">Total qty</p>
                  <p className="text-lg font-bold text-slate-800">{totalQty}</p>
                </div>
              </div>

              <div>
                <Label>Dibayar</Label>
                {/* Selalu kolom yang bisa diketik (laptop: klik lalu ketik angkanya), dan selalu
                    ada jalur kalkulator besar untuk jari. Bedanya ditentukan PER KEJADIAN lewat
                    `pointerType`, bukan media query `pointer: fine`: di laptop layar sentuh media
                    query itu salah tebak, sehingga kolomnya tidak bisa diketik sama sekali. */}
                <InputUang
                  aria-label="Jumlah dibayar"
                  placeholder="0"
                  nilai={dibayar}
                  onNilai={setDibayar}
                  onPointerDown={(e) => {
                    // Jari: buka kalkulator besar dan cegah fokus, supaya keyboard lembut HP
                    // tidak muncul menutupi layar. Mouse/trackpad: biarkan fokus seperti biasa.
                    if (e.pointerType === 'touch') {
                      e.preventDefault();
                      setBukaKalkulator(true);
                    }
                  }}
                  className="text-right text-lg font-semibold"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Ketik angkanya langsung. Di layar sentuh, ketuk kolom ini untuk kalkulator besar.
                </p>
                {/* Bon = pelanggan bayar sebagian (atau belum bayar); sisanya jadi piutang
                    atas namanya, bukan transaksi yang gagal. */}
                <button
                  type="button"
                  aria-pressed={bon}
                  onClick={() => setBon(!bon)}
                  className={`mt-2 min-h-sentuh w-full rounded-md border px-3 py-2 text-sm font-semibold ${
                    bon ? 'border-amber-500 bg-amber-50 text-amber-900' : 'border-slate-300 bg-white text-slate-600'
                  }`}
                >
                  {bon ? 'Bon aktif — sisa jadi piutang' : 'Bon (pelanggan berutang)'}
                </button>
              </div>

              <div className="flex items-center justify-between text-base">
                <span>{bon ? 'Sisa (piutang)' : 'Kembalian'}</span>
                <span
                  className={
                    bon ? 'font-bold text-amber-800' : kembalian < 0 ? 'font-bold text-red-700' : 'font-bold'
                  }
                >
                  {rupiah(keranjang.length ? (bon ? sisaBon : kembalian) : 0)}
                </span>
              </div>
              {bon && !namaPelanggan.trim() && (
                <p className="text-xs text-red-700">Isi nama tuan/nyonya dulu supaya piutangnya bisa ditagih.</p>
              )}

              {!online && (
                <Alert tone="info">
                  Offline, transaksi disimpan lokal{pending > 0 ? ` (${pending} menunggu sinkron)` : ''}.
                </Alert>
              )}

              {error && <Alert>{error}</Alert>}

              {/* Di tablet/desktop tombol aksi ada di kartu ini; di HP dipindah ke baris
                  lengket di bawah supaya selalu terjangkau. */}
              <div className="hidden md:block">{tombolSimpan('grid-cols-1 lg:grid-cols-2')}</div>
            </div>
          </Card>
        </div>
      </div>

      <ActionBar className="md:hidden">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>
            Total <b className="text-base">{rupiah(total)}</b>
            <span className="ml-1 text-xs text-slate-600">
              ({keranjang.length} barang · {totalQty} qty)
            </span>
          </span>
          <span className={bon ? 'text-amber-800' : kembalian < 0 ? 'text-red-700' : 'text-slate-600'}>
            {bon ? 'Sisa' : 'Kembalian'}{' '}
            <b className="text-base">{rupiah(keranjang.length ? (bon ? sisaBon : kembalian) : 0)}</b>
          </span>
        </div>
        <div className="mt-2">{tombolSimpan('grid-cols-2')}</div>
      </ActionBar>
      </>
      )}

      <ScanNotaKasir
        open={bukaScan}
        onTutup={() => setBukaScan(false)}
        produk={products}
        onMasukkan={(pilihan) => {
          const hasil = masukkanKeKeranjang(pilihan);
          if (hasil.ok) {
            setPesan(`${hasil.ok} barang dari nota dimasukkan ke keranjang.`);
            setCari('');
          }
          return hasil;
        }}
      />

      <Kalkulator
        open={bukaKalkulator}
        onClose={() => setBukaKalkulator(false)}
        nilai={dibayarAngka}
        total={total}
        onTerapkan={(v) => setDibayar(v > 0 ? String(v) : '')}
      />

      {dialogKeluar && (
        <Modal open title="Kas Keluar" onClose={() => setDialogKeluar(false)} width="max-w-md">
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Catat uang laci yang dipakai selama shift (beli barang dagangan, bayar ongkos, dsb).
              Jumlahnya otomatis mengurangi “seharusnya di laci” saat tutup kas.
            </p>
            <div>
              <Label>Jumlah</Label>
              <InputUang
                nilai={jumlahKeluar}
                onNilai={setJumlahKeluar}
                placeholder="0"
                className="text-right text-lg font-semibold"
              />
            </div>
            <div>
              <Label>Dipakai untuk apa</Label>
              <Input
                value={ketKeluar}
                onChange={(e) => setKetKeluar(e.target.value)}
                placeholder="mis. beli gula 5 kg di warung sebelah"
              />
            </div>
            {keluarShift.length > 0 && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <p className="text-xs font-semibold uppercase text-slate-500">Sudah dicatat shift ini</p>
                <ul className="mt-1 space-y-1">
                  {keluarShift.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 break-words">
                        <span className="text-slate-500">{r.jam}</span> {r.keterangan ?? r.kategori}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-medium">{rupiah(r.jumlah)}</span>
                        {!r.ref_type && (
                          <button
                            type="button"
                            onClick={() => void batalKeluar(r.id)}
                            disabled={sedangKeluar}
                            aria-label={`Batalkan pengeluaran ${r.keterangan ?? r.kategori}`}
                            className="min-h-sentuh rounded px-1 text-xs font-medium text-red-700 underline disabled:opacity-50"
                          >
                            Batalkan
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {errorKas && <Alert>{errorKas}</Alert>}
            {!onlineKas && <Alert tone="info">Mencatat kas keluar butuh koneksi ke server.</Alert>}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" ukuran="lg" onClick={() => setDialogKeluar(false)}>
                Batal
              </Button>
              <Button ukuran="lg" disabled={sedangKeluar || !onlineKas} onClick={() => void simpanKeluar()}>
                {sedangKeluar ? 'Menyimpan…' : 'Catat Kas Keluar'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {dialogTutup && (
        <Modal open title="Tutup Kas" onClose={() => setDialogTutup(false)} width="max-w-md">
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <p className="flex justify-between">
                <span>Modal awal</span>
                <span>{rupiah(shift?.modal_awal ?? 0)}</span>
              </p>
              <p className="mt-1 flex justify-between">
                <span>Uang masuk (penjualan &amp; setoran)</span>
                <span className="text-teal-800">+ {rupiah(shift?.kas_masuk ?? 0)}</span>
              </p>
              <p className="mt-1 flex justify-between">
                <span>Uang keluar (dipakai)</span>
                <span className="text-amber-800">− {rupiah(shift?.kas_keluar ?? 0)}</span>
              </p>
              <p className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-semibold">
                <span>Seharusnya di laci</span>
                <span>{rupiah(shift?.kas_seharusnya ?? 0)}</span>
              </p>
            </div>
            {keluarShift.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                <p className="text-xs font-semibold uppercase text-amber-800">Uang dipakai selama shift</p>
                <ul className="mt-1 space-y-1">
                  {keluarShift.map((r) => (
                    <li key={r.id} className="flex justify-between gap-2">
                      <span className="min-w-0 break-words">
                        <span className="text-slate-500">{r.jam}</span> {r.keterangan ?? r.kategori}
                      </span>
                      <span className="shrink-0 font-medium text-amber-900">{rupiah(r.jumlah)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 flex justify-between border-t border-amber-200 pt-1 font-semibold text-amber-900">
                  <span>Total dipakai</span>
                  <span>{rupiah(shift?.kas_keluar ?? 0)}</span>
                </p>
              </div>
            )}
            <div>
              <Label>Uang fisik dihitung</Label>
              <InputUang
                nilai={uangFisik}
                onNilai={setUangFisik}
                placeholder="0"
                className="text-right text-lg font-semibold"
              />
              {uangFisik !== '' && (
                <p className={`mt-1 text-sm font-semibold ${parseUang(uangFisik) - (shift?.kas_seharusnya ?? 0) < 0 ? 'text-red-700' : 'text-teal-800'}`}>
                  Selisih {rupiah(parseUang(uangFisik) - (shift?.kas_seharusnya ?? 0))}
                </p>
              )}
            </div>
            <div>
              <Label>Catatan (opsional)</Label>
              <Input value={catatanKas} onChange={(e) => setCatatanKas(e.target.value)} placeholder="mis. uang kembalian kurang" />
            </div>
            {errorKas && <Alert>{errorKas}</Alert>}
            {!onlineKas && <Alert tone="info">Tutup kas butuh koneksi ke server.</Alert>}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" ukuran="lg" onClick={() => setDialogTutup(false)}>
                Batal
              </Button>
              <Button ukuran="lg" disabled={sedangKas || !onlineKas} onClick={() => void simpanTutupKas()}>
                {sedangKas ? 'Menutup…' : 'Tutup Kas'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {idxEdit !== null && (
        <DialogBaris
          item={keranjang[idxEdit]}
          onBatal={() => setEditBaris(null)}
          onHapus={() => hapusBaris(idxEdit)}
          onSimpan={(qty, harga, alasan) => simpanBaris(idxEdit, qty, harga, alasan)}
        />
      )}
    </div>
  );
}

/**
 * Pop up satu baris keranjang. Dulu editor ini dirender sebagai baris tambahan DI DALAM
 * tabel, sehingga tabel melompat dan tinggi yang tersisa untuk daftar barang berkurang
 * banyak tiap kali kasir menyentuh qty atau nama barang.
 */
function DialogBaris({
  item,
  onSimpan,
  onHapus,
  onBatal,
}: {
  item: KeranjangItem;
  onSimpan: (qty: number, harga: number, alasan: string) => void;
  onHapus: () => void;
  onBatal: () => void;
}) {
  const [qty, setQty] = useState(item.qty);
  const [harga, setHarga] = useState(String(item.harga));
  const [alasan, setAlasan] = useState(item.alasan_ubah_harga);
  const nilai = parseUang(harga);
  const hargaBerubah = nilai !== item.harga_asli;
  const bolehSimpan = Number.isInteger(nilai) && nilai >= 0 && qty >= 1 && (!hargaBerubah || alasan.trim().length > 0);

  return (
    <Modal open title={item.name} onClose={onBatal} width="max-w-md">
      <div className="space-y-3">
        <div>
          <Label>Qty ({item.unit_name})</Label>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              ukuran="lg"
              aria-label="Kurangi qty"
              disabled={qty <= 1}
              className="w-14 text-lg"
              onClick={() => setQty(qty - 1)}
            >
              −
            </Button>
            <span className="w-12 text-center text-lg font-semibold">{qty}</span>
            <Button
              variant="secondary"
              ukuran="lg"
              aria-label="Tambah qty"
              className="w-14 text-lg"
              onClick={() => setQty(qty + 1)}
            >
              +
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <Label>Harga baru</Label>
            <InputUang nilai={harga} onNilai={setHarga} />
          </div>
          <div>
            <Label>Harga normal</Label>
            <Input value={rupiah(item.harga_asli)} disabled />
          </div>
        </div>

        {/* Kolom alasan hanya muncul kalau harganya memang diubah: alasan wajib untuk
            perubahan harga, dan tidak ada gunanya kalau harga tetap. */}
        {hargaBerubah && (
          <div>
            <Label>Alasan ubah harga (wajib)</Label>
            <Input
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder="mis. pembeli langganan, harga promo"
            />
            {!alasan.trim() && (
              <p className="mt-1 text-xs text-red-700">Alasan wajib diisi sebelum harga bisa disimpan.</p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" ukuran="lg" className="text-red-700 sm:mr-auto" onClick={onHapus}>
            Hapus barang
          </Button>
          <Button variant="secondary" ukuran="lg" onClick={onBatal}>
            Batal
          </Button>
          <Button
            ukuran="lg"
            disabled={!bolehSimpan}
            onClick={() => onSimpan(qty, nilai, hargaBerubah ? alasan.trim() : '')}
          >
            Simpan
          </Button>
        </div>
      </div>
    </Modal>
  );
}
