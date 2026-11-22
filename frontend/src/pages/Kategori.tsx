import MasterSederhana from '../components/MasterSederhana';
import { db } from '../db';

export default function Kategori() {
  return (
    <MasterSederhana judul="Kategori" path="/categories" tabel={db.categories} cari="Cari nama kategori…" />
  );
}
