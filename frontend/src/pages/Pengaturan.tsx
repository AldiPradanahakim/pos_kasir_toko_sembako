import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Alert, Button, Card, Input, Label, Stat } from '../components/ui';
import { bacaSettings, db } from '../db';
import { useOnline } from '../lib/useOnline';
import { pullSync } from '../sync';

export default function Pengaturan() {
  const online = useOnline();
  const setting = useLiveQuery(() => bacaSettings(), []);
  const jmlKategori = useLiveQuery(() => db.categories.count(), [], 0);
  const jmlSatuan = useLiveQuery(() => db.units.count(), [], 0);
  const jmlProduk = useLiveQuery(() => db.products.count(), [], 0);
  const jmlStok = useLiveQuery(() => db.cachedStock.count(), [], 0);
  const jmlAntre = useLiveQuery(() => db.pendingSales.count(), [], 0);

  const [tokoNama, setTokoNama] = useState('');
  const [alamat, setAlamat] = useState('');
  const [telepon, setTelepon] = useState('');
  const [error, setError] = useState('');
  const [sukses, setSukses] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setTokoNama(setting?.toko_nama ?? '');
    setAlamat(setting?.alamat ?? '');
    setTelepon(setting?.telepon ?? '');
  }, [setting?.toko_nama, setting?.alamat, setting?.telepon]);

  async function simpan(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSukses('');
    setLoading(true);
    try {
      await api.put('/settings', { toko_nama: tokoNama.trim(), alamat: alamat.trim(), telepon: telepon.trim() });
      await pullSync();
      setSukses('Pengaturan tersimpan.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold">Pengaturan</h1>

      {!online && <Alert tone="info">Menyimpan pengaturan memerlukan koneksi internet.</Alert>}
      {error && <Alert>{error}</Alert>}
      {sukses && <Alert tone="info">{sukses}</Alert>}

      <Card title="Identitas Toko">
        <form onSubmit={simpan} className="space-y-3">
          <div>
            <Label>Nama toko</Label>
            <Input value={tokoNama} onChange={(e) => setTokoNama(e.target.value)} placeholder="Toko Hakim" />
          </div>
          <div>
            <Label>Alamat</Label>
            <Input value={alamat} onChange={(e) => setAlamat(e.target.value)} />
          </div>
          <div>
            <Label>Telepon</Label>
            <Input value={telepon} onChange={(e) => setTelepon(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={loading || !online}>
              {loading ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Status Sinkronisasi">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label="Kategori" nilai={jmlKategori} />
          <Stat label="Satuan" nilai={jmlSatuan} />
          <Stat label="Produk" nilai={jmlProduk} />
          <Stat label="Baris stok" nilai={jmlStok} />
          <Stat label="Antrean transaksi" nilai={jmlAntre} />
        </div>
        <div className="mt-3">
          <Button variant="secondary" onClick={() => void pullSync()} disabled={!online}>
            Sinkronkan sekarang
          </Button>
        </div>
      </Card>
    </div>
  );
}
