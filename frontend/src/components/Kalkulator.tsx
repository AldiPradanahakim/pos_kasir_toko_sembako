import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from './ui';
import { rupiah } from '../lib/format';

/** Tombol keypad: angka, `000`, hapus satu digit, dan bersihkan. */
const TOMBOL: { label: string; aksi: 'angka' | 'hapus' | 'c'; nilai?: string; gaya?: string }[] = [
  { label: '7', aksi: 'angka', nilai: '7' },
  { label: '8', aksi: 'angka', nilai: '8' },
  { label: '9', aksi: 'angka', nilai: '9' },
  { label: '4', aksi: 'angka', nilai: '4' },
  { label: '5', aksi: 'angka', nilai: '5' },
  { label: '6', aksi: 'angka', nilai: '6' },
  { label: '1', aksi: 'angka', nilai: '1' },
  { label: '2', aksi: 'angka', nilai: '2' },
  { label: '3', aksi: 'angka', nilai: '3' },
  { label: '000', aksi: 'angka', nilai: '000' },
  { label: '0', aksi: 'angka', nilai: '0' },
  { label: '⌫', aksi: 'hapus', gaya: 'bg-slate-200 text-slate-700' },
];

/**
 * Satu-satunya kalkulator di aplikasi: keypad angka besar gaya minimarket.
 * Hasilnya langsung mengisi kolom yang sedang diisi kasir (kolom "Dibayar"),
 * bukan untuk menghitung kembalian — kembalian sudah otomatis dari kolom itu.
 */
export default function Kalkulator({
  open,
  onClose,
  nilai,
  total,
  onTerapkan,
}: {
  open: boolean;
  onClose: () => void;
  /** Nilai awal (angka rupiah) yang sudah ada di kolom. */
  nilai: number;
  /** Total belanja saat ini, untuk tombol "Uang Pas". */
  total: number;
  onTerapkan: (nilai: number) => void;
}) {
  const [teks, setTeks] = useState('');

  // Setiap kali dibuka, keypad mulai dari nilai yang sudah ada di kolom.
  useEffect(() => {
    if (open) setTeks(nilai > 0 ? String(nilai) : '');
  }, [open, nilai]);

  const angka = teks ? parseInt(teks, 10) : 0;

  function tekan(t: (typeof TOMBOL)[number]) {
    if (t.aksi === 'c') {
      setTeks('');
      return;
    }
    if (t.aksi === 'hapus') {
      setTeks((lama) => lama.slice(0, -1));
      return;
    }
    setTeks((lama) => {
      const baru = (lama + t.nilai).replace(/^0+(?=\d)/, '');
      // Batasi panjang supaya angka tidak meluber keluar layar HP.
      return baru.length <= 12 ? baru : lama;
    });
  }

  // Aksi terbaru untuk papan ketik fisik. Disimpan di ref supaya pendengar `keydown`
  // cukup dipasang sekali per pembukaan, bukan dipasang-ulang setiap kali angka berubah.
  const aksi = useRef({ tekan, onClose, onTerapkan, teks });
  aksi.current = { tekan, onClose, onTerapkan, teks };

  /**
   * Papan ketik fisik (keyboard laptop): angka 0-9, Backspace menghapus, Escape menutup,
   * Enter mengisi kolom Dibayar. Pendengarnya di `window`, jadi langsung bekerja tanpa
   * kasir mengklik apa pun lebih dulu — dan modal menutupi seluruh layar, sehingga tidak
   * ada kolom isian lain yang bisa ikut menerima ketikan ini.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
      const { tekan: pijit, onClose: tutup, onTerapkan: terapkan, teks: isi } = aksi.current;
      if (e.key.length === 1 && e.key >= '0' && e.key <= '9') {
        pijit({ label: e.key, aksi: 'angka', nilai: e.key });
      } else if (e.key === 'Backspace') {
        pijit({ label: '⌫', aksi: 'hapus' });
      } else if (e.key === 'Escape') {
        tutup();
      } else if (e.key === 'Enter') {
        terapkan(isi ? parseInt(isi, 10) : 0);
        tutup();
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <Modal open={open} title="Masukkan Jumlah Dibayar" onClose={onClose} width="max-w-sm">
      <div className="mb-3 rounded-lg bg-slate-900 px-3 py-3 text-right">
        <p className="text-xs text-slate-400">{total > 0 ? `Total belanja ${rupiah(total)}` : 'Belum ada barang'}</p>
        <p className="break-all text-3xl font-bold text-white">{rupiah(angka)}</p>
      </div>

      {total > 0 && (
        <Button
          variant="secondary"
          ukuran="lg"
          className="mb-2 w-full"
          onClick={() => setTeks(String(total))}
        >
          Uang Pas ({rupiah(total)})
        </Button>
      )}

      <div className="grid grid-cols-3 gap-2">
        {TOMBOL.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => tekan(t)}
            className={`min-h-[56px] select-none rounded-lg text-xl font-semibold text-slate-700 active:scale-95 ${
              t.gaya ?? 'bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button variant="secondary" ukuran="lg" className="min-h-[56px]" onClick={() => setTeks('')}>
          C
        </Button>
        <Button
          ukuran="lg"
          className="min-h-[56px]"
          onClick={() => {
            onTerapkan(angka);
            onClose();
          }}
        >
          Isi Dibayar
        </Button>
      </div>
    </Modal>
  );
}
