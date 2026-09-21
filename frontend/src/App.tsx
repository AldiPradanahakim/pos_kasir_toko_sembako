import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { useAuth } from './store';
import HutangPiutang from './pages/HutangPiutang';
import Kasir from './pages/Kasir';
import Kategori from './pages/Kategori';
import Keuangan from './pages/Keuangan';
import Laporan from './pages/Laporan';
import Login from './pages/Login';
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
  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/kasir" replace /> : <Login />} />
      <Route
        element={
          <Terlindungi>
            <Layout />
          </Terlindungi>
        }
      >
        <Route path="/kasir" element={<Kasir />} />
        <Route path="/kasir/struk/:uuid" element={<Struk />} />
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
          element={
            <Terlindungi superadminSaja>
              <Pembelian />
            </Terlindungi>
          }
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
          element={
            <Terlindungi superadminSaja>
              <HutangPiutang />
            </Terlindungi>
          }
        />
        <Route
          path="/retur"
          element={
            <Terlindungi superadminSaja>
              <Retur />
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
          path="/users"
          element={
            <Terlindungi superadminSaja>
              <Users />
            </Terlindungi>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/kasir" replace />} />
    </Routes>
  );
}
