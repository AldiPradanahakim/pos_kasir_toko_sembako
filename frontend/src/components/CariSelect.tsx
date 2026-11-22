import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Input, Kosong } from './ui';

export interface OpsiCari {
  value: number | string;
  label: string;
  hint?: string;
}

/** Daftar 1000 produk tidak perlu dirender seluruhnya sekaligus hanya untuk memilih satu. */
const MAKS_HASIL = 50;

/**
 * Pengganti `<Select>` untuk daftar panjang (produk, dokumen): mengetik menyaring di memori,
 * hasilnya menumpuk di bawah kolom (absolute) supaya tata letak di sekitarnya tidak melompat.
 */
export default function CariSelect({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder = 'Ketik untuk mencari…',
  kosong = 'Tidak ada yang cocok.',
  disabled = false,
  required = false,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: OpsiCari[];
  ariaLabel: string;
  placeholder?: string;
  kosong?: string;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
}): JSX.Element {
  const [buka, setBuka] = useState(false);
  const [cari, setCari] = useState('');
  const kotak = useRef<HTMLDivElement>(null);
  const idDaftar = useId();

  const terpilih = options.find((o) => String(o.value) === value);

  const hasil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    const dasar = q
      ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q))
      : options;
    return dasar.slice(0, MAKS_HASIL);
  }, [options, cari]);

  /**
   * Klik di luar menutup daftar. Didengar di `document` (bukan `onBlur`) supaya mengetuk
   * baris hasil tidak menutup daftarnya lebih dulu — di HP tidak ada `blur` yang bisa diandalkan.
   */
  useEffect(() => {
    if (!buka) return;
    const diLuar = (e: PointerEvent) => {
      if (!kotak.current?.contains(e.target as Node)) setBuka(false);
    };
    document.addEventListener('pointerdown', diLuar);
    return () => document.removeEventListener('pointerdown', diLuar);
  }, [buka]);

  function pilih(o: OpsiCari) {
    onChange(String(o.value));
    setCari('');
    setBuka(false);
  }

  return (
    <div ref={kotak} className="relative min-w-0">
      <Input
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={buka}
        aria-controls={idDaftar}
        aria-autocomplete="list"
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        // Saat daftar terbuka kolomnya berisi teks pencarian (bisa kosong) walau pilihan sudah
        // ada, jadi `required` hanya dipasang kalau memang BELUM ada nilai — tanpa ini browser
        // menolak formulir "please fill out this field" padahal barangnya sudah dipilih.
        required={required && !value}
        placeholder={terpilih ? undefined : placeholder}
        // Saat difokuskan kolomnya jadi kotak pencarian kosong; saat tidak, menampilkan
        // label pilihan supaya jelas apa yang sedang terpilih.
        value={buka ? cari : (terpilih?.label ?? '')}
        onChange={(e) => setCari(e.target.value)}
        onFocus={() => {
          setCari('');
          setBuka(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // Tanpa ini Enter mengirim formulir modal padahal maksudnya memilih hasil.
            if (buka && hasil.length) {
              e.preventDefault();
              pilih(hasil[0]);
            }
            return;
          }
          if (e.key === 'Escape' && buka) {
            // Escape di sini hanya menutup daftar; modal pemanggilnya tidak ikut tertutup.
            e.stopPropagation();
            setBuka(false);
          }
        }}
      />

      {buka && !disabled && (
        <div
          id={idDaftar}
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-[50vh] overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg"
        >
          {hasil.length > 0 ? (
            hasil.map((o) => (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={String(o.value) === value}
                onClick={() => pilih(o)}
                className="flex min-h-sentuh w-full flex-col items-start justify-center border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50 active:bg-slate-100"
              >
                <span className="w-full truncate text-sm">{o.label}</span>
                {o.hint && <span className="w-full truncate text-xs text-slate-500">{o.hint}</span>}
              </button>
            ))
          ) : (
            <Kosong>{kosong}</Kosong>
          )}
        </div>
      )}
    </div>
  );
}
