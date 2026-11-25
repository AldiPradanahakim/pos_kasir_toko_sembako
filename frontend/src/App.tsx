import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { halamanAwal } from './lib/beranda';
import { useAuth } from './store';
import Audit from './pages/Audit';
import Dashboard from './pages/Dashboard';
import GantiPasswordWajib from './pages/GantiPasswordWajib';
import HutangPiutang from './pages/HutangPiutang';
import Kas from './pages/Kas';
import Kasir from './pages/Kasir';
import Kategori from './pages/Kategori';
import Keuangan from './pages/Keuangan';
import Laporan from './pages/Laporan';
import Login from './pages/Login';
import Pelanggan from './pages/Pelanggan';
import Pembelian from './pages/Pembelian';
import Pengaturan from './pages/Pengaturan';
import Produk from './pages/Produk';
import Retur from './pages/Retur';
import Riwayat from './pages/Riwayat';
import Satuan from './pages/Satuan';
import Stok from './pages/Stok';
import StokScan from './pages/StokScan';
import Struk from './pages/Struk';
import Users from './pages/Users';

function Terlindungi({ children, superadminSaja = false }: { children: JSX.Element; superadminSaja?: boolean }) {
  const { token, user, siap } = useAuth();
  if (!siap) return <p className="p-8 text-center text-sm text-slate-500">Memuat…</p>;
  if (!token) return <Navigate to="/login" replace />;
  if (superadminSaja && user?.role !== 'superadmin') return <Navigate to="/kasir" replace />;
  return children;
}

export default function App() {
  const token = useAuth((s) => s.token);
  const siap = useAuth((s) => s.siap);
  const user = useAuth((s) => s.user);

  // Password baru direset (atau masih default): server menolak semua endpoint lain, jadi
  // tampilkan layar ganti password saja — bukan halaman yang isinya akan gagal dimuat.
  if (siap && token && user?.must_change_password) return <GantiPasswordWajib />;

  return (
    <Routes>
      {/* Selama sesi belum selesai diperiksa, jangan melompat ke /kasir: token yang ternyata
          ditolak server akan membuat halaman bolak-balik antara /login dan /kasir. */}
      <Route
        path="/login"
        element={
          !siap ? (
            <p className="p-8 text-center text-sm text-slate-500">Memuat…</p>
          ) : token ? (
            <Navigate to={halamanAwal(user)} replace />
          ) : (
            <Login />
          )
        }
      />
      <Route
        element={
          <Terlindungi>
            <Layout />
          </Terlindungi>
        }
      >
        <Route path="/kasir" element={<Kasir />} />
        <Route path="/kasir/struk/:uuid" element={<Struk />} />
        <Route
          path="/kas"
          element={
            <Terlindungi superadminSaja>
              <Kas />
            </Terlindungi>
          }
        />
        <Route path="/riwayat" element={<Riwayat />} />
        <Route path="/stok" element={<Stok />} />
        <Route path="/stok/scan" element={<StokScan />} />
        <Route
          path="/produk"
          element={
            <Terlindungi superadminSaja>
              <Produk />
            </Terlindungi>
          }
        />
        <Route
          path="/kategori"
          element={
            <Terlindungi superadminSaja>
              <Kategori />
            </Terlindungi>
          }
        />
        <Route
          path="/satuan"
          element={
            <Terlindungi superadminSaja>
              <Satuan />
            </Terlindungi>
          }
        />
        <Route
          path="/pembelian"
          element={<Pembelian />}
        />
        <Route
          path="/keuangan"
          element={
            <Terlindungi superadminSaja>
              <Keuangan />
            </Terlindungi>
          }
        />
        <Route
          path="/hutang-piutang"
          element={<HutangPiutang />}
        />
        <Route
          path="/pelanggan"
          element={
            <Terlindungi superadminSaja>
              <Pelanggan />
            </Terlindungi>
          }
        />
        <Route
          path="/retur"
          element={<Retur />}
        />
        <Route
          path="/dashboard"
          element={
            <Terlindungi superadminSaja>
              <Dashboard />
            </Terlindungi>
          }
        />
        <Route
          path="/laporan"
          element={
            <Terlindungi superadminSaja>
              <Laporan />
            </Terlindungi>
          }
        />
        <Route
          path="/laporan/:slug"
          element={
            <Terlindungi superadminSaja>
              <Laporan />
            </Terlindungi>
          }
        />
        <Route
          path="/pengaturan"
          element={
            <Terlindungi superadminSaja>
              <Pengaturan />
            </Terlindungi>
          }
        />
        <Route
          path="/audit"
          element={
            <Terlindungi superadminSaja>
              <Audit />
            </Terlindungi>
          }
        />
        <Route
          path="/users"
          element={
            <Terlindungi superadminSaja>
              <Users />
            </Terlindungi>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to={halamanAwal(user)} replace />} />
    </Routes>
  );
}
