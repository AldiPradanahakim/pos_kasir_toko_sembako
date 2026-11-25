import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { db } from '../db';
import { formatTanggalJam } from '../lib/format';
import { useKasTerbuka } from '../lib/shift';
import { useOnline } from '../lib/useOnline';
import { useAuth, useSync, useUi } from '../store';

interface Menu {
  to: string;
  label: string;
  superadminSaja: boolean;
}

const GRUP: { judul: string; menu: Menu[] }[] = [
  {
    judul: 'Transaksi',
    menu: [
      { to: '/kasir', label: 'Kasir', superadminSaja: false },
      { to: '/riwayat', label: 'Riwayat', superadminSaja: false },
      { to: '/kas', label: 'Riwayat Kas', superadminSaja: true },
      { to: '/retur', label: 'Retur', superadminSaja: false },
      { to: '/hutang-piutang', label: 'Hutang & Piutang', superadminSaja: false },
      { to: '/pelanggan', label: 'Pelanggan', superadminSaja: true },
    ],
  },
  {
    judul: 'Barang',
    menu: [
      { to: '/stok', label: 'Stok', superadminSaja: false },
      { to: '/stok/scan', label: 'Stok Scan', superadminSaja: false },
      { to: '/pembelian', label: 'Pembelian', superadminSaja: false },
      { to: '/produk', label: 'Produk', superadminSaja: true },
      { to: '/kategori', label: 'Kategori', superadminSaja: true },
      { to: '/satuan', label: 'Satuan', superadminSaja: true },
    ],
  },
  {
    judul: 'Uang & Laporan',
    menu: [
      { to: '/dashboard', label: 'Dashboard', superadminSaja: true },
      { to: '/keuangan', label: 'Arus Keuangan', superadminSaja: true },
      { to: '/laporan', label: 'Laporan', superadminSaja: true },
    ],
  },
  {
    judul: 'Sistem',
    menu: [
      { to: '/pengaturan', label: 'Pengaturan', superadminSaja: true },
      { to: '/users', label: 'Pengguna', superadminSaja: true },
      { to: '/audit', label: 'Jejak Audit', superadminSaja: true },
    ],
  },
];

export default function Layout() {
  const user = useAuth((s) => s.user);
  const keluar = useAuth((s) => s.keluar);
  const online = useOnline();
  const lastSyncAt = useSync((s) => s.lastSyncAt);
  const menuTersembunyi = useUi((s) => s.menuTersembunyi);
  // Dibaca dari localStorage shift, bukan state halaman kasir: kuncinya harus berlaku di
  // SEMUA halaman, bukan hanya saat layar kasir sedang terbuka.
  const kasTerbuka = useKasTerbuka();
  const navigate = useNavigate();
  const lokasi = useLocation();
  const [drawer, setDrawer] = useState(false);

  const pending = useLiveQuery(() => db.pendingSales.where('status').equals('pending').count(), [], 0);
  const gagal = useLiveQuery(() => db.pendingSales.where('status').equals('gagal').count(), [], 0);

  const superadmin = user?.role === 'superadmin';
  /**
   * Sidebar hanya untuk superadmin, dan hanya muncul di layar `desktop`
   * (>=1280px DAN penunjuk presisi, lihat catatan di tailwind.config.js).
   * Kasir tidak pernah dapat sidebar: layar mereka murni untuk melayani pembeli.
   */
  /** Di kasir, halaman harus muat satu layar penuh (tanpa scroll halaman) sejak tablet. */
  const kasirPenuh = lokasi.pathname === '/kasir';

  // Pindah halaman = tutup drawer supaya kontennya langsung terlihat.
  useEffect(() => setDrawer(false), [lokasi.pathname]);

  /**
   * Kasir tidak boleh keluar selama kasnya masih terbuka. Tombolnya sudah dinonaktifkan,
   * penjagaan di sini menutup jalur lain (mis. papan ketik yang memicu klik programatik).
   */
  const keluarTerkunci = !superadmin && kasTerbuka;

  async function doKeluar() {
    if (keluarTerkunci) return;
    await keluar();
    navigate('/login', { replace: true });
  }

  const isiMenu = (
    <nav className="tanpa-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
      {GRUP.map((g) => {
        const daftar = g.menu.filter((m) => superadmin || !m.superadminSaja);
        if (!daftar.length) return null;
        return (
          <div key={g.judul}>
            {/* Judul grup dibedakan oleh bobot huruf dan jarak, bukan oleh HURUF BESAR
                berjarak lebar (R-06: label uppercase berjarak lebar dilarang sebagai default). */}
            <p className="mb-1 px-2 text-xs font-semibold text-slate-500">{g.judul}</p>
            <div className="space-y-1">
              {daftar.map((m) => (
                <NavLink
                  key={m.to}
                  to={m.to}
                  end={m.to === '/stok'}
                  // Menutup drawer saat menunya disentuh. Perpindahan halaman juga menutupnya,
                  // tetapi mengetuk menu halaman yang sedang dibuka tidak mengubah rute ,
                  // drawer-nya akan tertinggal terbuka menutupi layar.
                  onClick={() => setDrawer(false)}
                  className={({ isActive }) =>
                    `flex min-h-sentuh items-center gap-3 rounded-md px-3 py-2 text-base ${
                      isActive ? 'bg-teal-50 font-semibold text-teal-800' : 'text-slate-600 hover:bg-slate-100'
                    }`
                  }
                >
                  <span className="truncate">{m.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );

  const identitas = (
    <div className="border-t border-slate-100 p-3 text-xs text-slate-500">
      <p className="text-sm font-semibold text-slate-700">{user?.name ?? '-'}</p>
      <p className="mb-2">{superadmin ? 'Superadmin' : 'Kasir'}</p>
      {/* Hanya superadmin: tombol Keluar-nya tinggal di sini (sidebar desktop / drawer HP).
          Kasir memakai tombol di header, dan tombol kedua di drawer hanya membingungkan. */}
      {superadmin ? (
        <button
          type="button"
          onClick={() => void doKeluar()}
          className="min-h-sentuh w-full rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
        >
          Keluar
        </button>
      ) : (
        // Kasir: tombolnya cuma satu, di header. Di sini hanya alasannya — tombol abu-abu di
        // header tidak bisa menjelaskan apa pun di layar sentuh (tooltip butuh kursor).
        keluarTerkunci && <p className="text-xs text-amber-700">Tutup kas dulu sebelum keluar.</p>
      )}
    </div>
  );

  return (
    <div className={`flex ${kasirPenuh ? 'md:h-[100dvh] md:overflow-hidden' : 'min-h-screen'}`}>
      {/* Sidebar: menempel (fixed) di layar desktop, dengan scroll sendiri di bagian menu
          supaya daftar menu yang panjang tidak ikut menggeser halaman. */}
      {superadmin && (
        <aside className="no-print fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-slate-200 bg-white desktop:flex">
          <div className="shrink-0 border-b border-slate-100 px-4 py-4">
            <p className="text-base font-bold text-teal-800">Toko Hakim</p>
            <p className="text-xs text-slate-500">POS Grosir Sembako</p>
          </div>
          {isiMenu}
          <div className="shrink-0">{identitas}</div>
        </aside>
      )}

      {/* Drawer HP/tablet (dipakai selama sidebar belum tampil). */}
      {drawer && (
        <div className={`no-print fixed inset-0 z-40 ${superadmin ? 'desktop:hidden' : ''}`}>
          <button
            type="button"
            aria-label="Tutup menu"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 h-full w-full bg-black/40"
          />
          <div className="aman-atas absolute inset-y-0 left-0 flex w-[85%] max-w-xs flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <p className="text-base font-bold text-teal-800">Toko Hakim</p>
                <p className="text-xs text-slate-500">POS Grosir Sembako</p>
              </div>
              <button
                type="button"
                onClick={() => setDrawer(false)}
                aria-label="Tutup menu"
                className="flex h-11 w-11 items-center justify-center rounded-md text-xl text-slate-500 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>
            {isiMenu}
            {identitas}
          </div>
        </div>
      )}

      <div
        className={`flex min-w-0 flex-1 flex-col ${superadmin ? 'desktop:pl-60' : ''} ${
          kasirPenuh ? 'md:min-h-0' : ''
        }`}
      >
        <header className="no-print sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-4">
          {menuTersembunyi ? (
            // Shift sudah ditutup (lihat Kasir): yang dibutuhkan tinggal keluar, bukan menu.
            <button
              type="button"
              onClick={() => void doKeluar()}
              className="flex min-h-sentuh items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
            >
              Keluar
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setDrawer(true)}
              aria-label="Buka menu"
              aria-expanded={drawer}
              className={`flex min-h-sentuh items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 ${
                superadmin ? 'desktop:hidden' : ''
              }`}
            >
              <span aria-hidden className="text-lg leading-none">
                ☰
              </span>
              Menu
            </button>
          )}

          {/* Kasir tidak punya sidebar, jadi "Keluar" hanya bisa dijangkau lewat drawer yang
              harus digulir. Tombolnya ditaruh langsung di header; selama kas masih terbuka
              tombolnya mati (abu-abu), bukan hilang — supaya jelas kenapa tidak bisa dipakai. */}
          {!superadmin && !menuTersembunyi && (
            <button
              type="button"
              onClick={() => void doKeluar()}
              disabled={keluarTerkunci}
              title={keluarTerkunci ? 'Tutup kas dulu sebelum keluar' : undefined}
              className={`flex min-h-sentuh items-center rounded-md border px-3 py-2 text-sm font-medium ${
                keluarTerkunci
                  ? 'cursor-not-allowed border-slate-200 text-slate-400'
                  : 'border-slate-300 text-slate-700'
              }`}
            >
              Keluar
            </button>
          )}

          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium ${
                online ? 'bg-teal-50 text-teal-800' : 'bg-amber-100 text-amber-800'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${online ? 'bg-teal-600' : 'bg-amber-500'}`} />
              {online ? 'Online' : 'Offline'}
            </span>
            {pending > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-800">
                {pending} menunggu sinkron
              </span>
            )}
            {gagal > 0 && (
              <Link
                to="/riwayat"
                className="rounded-full bg-red-100 px-2 py-1 font-medium text-red-700 underline decoration-red-400 underline-offset-2"
                title="Buka Riwayat untuk mengirim ulang"
              >
                {gagal} ditolak server
              </Link>
            )}
          </div>
          <p className="hidden text-xs text-slate-500 sm:block">
            Sinkron terakhir: {lastSyncAt ? formatTanggalJam(new Date(lastSyncAt).toISOString()) : 'belum'}
          </p>
        </header>

        {!online && (
          <div className="no-print bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900 sm:px-4">
            Offline, transaksi disimpan lokal
          </div>
        )}

        {/* `pb-4` di HP/tablet: baris aksi lengket tidak lagi dinaikkan setinggi navigasi
            bawah (navigasi itu sudah dihapus), jadi cukup jarak aman biasa. */}
        <main
          className={`min-w-0 flex-1 p-3 pb-4 sm:p-4 ${kasirPenuh ? 'md:flex md:min-h-0 md:flex-col md:overflow-hidden' : ''
            }`}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
