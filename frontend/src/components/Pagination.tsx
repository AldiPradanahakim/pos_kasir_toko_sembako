import { Button, Select } from './ui';

/** Potongan satu halaman. Dipakai bersama `Pagination` supaya daftar dan penghitungnya tidak pernah beda. */
export function potongHalaman<T>(items: T[], halaman: number, perHalaman: number): T[] {
  const mulai = (Math.max(1, halaman) - 1) * perHalaman;
  return items.slice(mulai, mulai + perHalaman);
}

/**
 * Pengendali halaman daftar panjang. Kembalikan `null` kalau isinya masih muat dalam satu
 * halaman terkecil — kontrol halaman yang tidak berguna hanya menambah tinggi layar.
 */
export default function Pagination({
  total,
  halaman,
  perHalaman,
  onHalaman,
  onPerHalaman,
  pilihanPerHalaman = [10, 20, 50],
}: {
  total: number;
  /** 1-based. Nilai di luar rentang dijepit, bukan ditolak. */
  halaman: number;
  perHalaman: number;
  onHalaman: (h: number) => void;
  onPerHalaman?: (n: number) => void;
  pilihanPerHalaman?: number[];
}): JSX.Element | null {
  if (total <= pilihanPerHalaman[0]) return null;

  const jumlahHalaman = Math.max(1, Math.ceil(total / perHalaman));
  const hal = Math.min(Math.max(1, halaman), jumlahHalaman);
  const mulai = (hal - 1) * perHalaman;
  const akhir = Math.min(mulai + perHalaman, total);

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
      <p className="text-xs text-slate-600">
        Menampilkan {mulai + 1}–{akhir} dari {total}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {onPerHalaman && (
          <label className="flex items-center gap-2 text-xs text-slate-600">
            Per halaman
            <Select
              className="min-w-sentuh w-auto"
              aria-label="Jumlah baris per halaman"
              value={String(perHalaman)}
              onChange={(e) => onPerHalaman(Number(e.target.value))}
            >
              {pilihanPerHalaman.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
        )}
        <Button
          variant="secondary"
          ukuran="sm"
          className="min-w-sentuh"
          aria-label="Halaman sebelumnya"
          onClick={() => onHalaman(hal - 1)}
          disabled={hal <= 1}
        >
          Sebelumnya
        </Button>
        <span className="text-xs text-slate-600">
          Halaman {hal} / {jumlahHalaman}
        </span>
        <Button
          variant="secondary"
          ukuran="sm"
          className="min-w-sentuh"
          aria-label="Halaman berikutnya"
          onClick={() => onHalaman(hal + 1)}
          disabled={hal >= jumlahHalaman}
        >
          Berikutnya
        </Button>
      </div>
    </div>
  );
}
