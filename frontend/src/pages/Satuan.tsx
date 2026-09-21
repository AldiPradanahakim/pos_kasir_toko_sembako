import MasterSederhana from '../components/MasterSederhana';
import { db } from '../db';

export default function Satuan() {
  return <MasterSederhana judul="Satuan" path="/units" tabel={db.units} />;
}
