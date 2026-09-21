import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

export function Card({
  title,
  actions,
  children,
  className = '',
  isiClassName = '',
  padat = false,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Kelas tambahan untuk badan kartu (mis. `min-h-0 flex-1 overflow-y-auto` di kasir). */
  isiClassName?: string;
  /** true = isi kartu tanpa padding (mis. daftar kartu yang mengatur paddingnya sendiri). */
  padat?: boolean;
}) {
  return (
    <section className={`min-w-0 rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 sm:px-4 sm:py-3">
          <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
          {actions}
        </header>
      )}
      <div className={`min-w-0 ${padat ? '' : 'p-3 sm:p-4'} ${isiClassName}`}>{children}</div>
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** 'lg' untuk tombol aksi utama di kasir (lebih tinggi, teks lebih besar). */
  ukuran?: 'sm' | 'md' | 'lg';
};

const VARIAN = {
  primary: 'bg-teal-700 text-white hover:bg-teal-800 active:bg-teal-900 disabled:bg-slate-300',
  secondary: 'bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:bg-slate-300',
  ghost: 'text-slate-600 hover:bg-slate-100 active:bg-slate-200 disabled:text-slate-300',
};

const UKURAN = {
  sm: 'min-h-sentuh px-3 py-2 text-sm',
  md: 'min-h-sentuh px-4 py-2.5 text-sm',
  lg: 'min-h-[52px] px-4 py-3 text-base',
};

/** Semua tombol minimal 44×44px supaya nyaman disentuh jari. */
export function Button({ variant = 'primary', ukuran = 'md', className = '', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition disabled:cursor-not-allowed ${VARIAN[variant]} ${UKURAN[ukuran]} ${className}`}
    />
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = '', ...props },
  ref,
) {
  return (
    <input
      {...props}
      ref={ref}
      className={`min-h-sentuh w-full rounded-md border border-slate-300 px-3 py-2 text-base outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600 disabled:bg-slate-100 ${className}`}
    />
  );
});

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`min-h-sentuh w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600 disabled:bg-slate-100 ${className}`}
    />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="mb-1 block text-xs font-medium text-slate-600">{children}</span>;
}

export function Alert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' | 'sukses' }) {
  if (!children) return null;
  const gaya =
    tone === 'error' ? 'bg-red-50 text-red-700' : tone === 'sukses' ? 'bg-teal-50 text-teal-800' : 'bg-sky-50 text-sky-800';
  return <div className={`rounded-md px-3 py-2 text-sm ${gaya}`}>{children}</div>;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  width = 'max-w-lg',
  tinggiPenuh = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
  /** true = modal selalu memakai seluruh layar (untuk form panjang seperti OCR). */
  tinggiPenuh?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 sm:items-start sm:overflow-y-auto sm:p-4">
      <div
        className={`flex h-full w-full flex-col bg-white shadow-xl sm:mt-8 sm:rounded-lg ${
          tinggiPenuh ? 'sm:h-[calc(100vh-4rem)]' : 'sm:h-auto'
        } ${width}`}
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 sm:px-4 sm:py-3">
          <h3 className="min-w-0 truncate text-sm font-semibold text-slate-700">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Tutup"
          >
            ✕
          </button>
        </header>
        {/* Selalu bisa digeser: di HP isi modal sering lebih tinggi dari layar, dan tombol
            di bagian bawah tidak boleh terpotong tanpa cara menjangkaunya. */}
        <div className={`min-w-0 flex-1 overflow-y-auto p-3 sm:p-4 ${tinggiPenuh ? 'sm:overflow-y-auto' : ''}`}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Kosong({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-400">{children}</p>;
}

/** Tab yang bisa digeser ke samping di HP, bukan menumpuk jadi dua baris. */
export function Tabs<T extends string>({
  items,
  nilai,
  onChange,
  className = '',
}: {
  items: { id: T; label: string }[];
  nilai: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={`tab-strip ${className}`} role="tablist">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={nilai === t.id}
          onClick={() => onChange(t.id)}
          className={`min-h-sentuh whitespace-nowrap rounded-md border px-3 py-2 text-sm ${
            nilai === t.id
              ? 'border-teal-600 bg-teal-50 font-semibold text-teal-800'
              : 'border-slate-200 bg-white text-slate-600'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Kartu angka ringkas (omset, saldo, total). */
export function Stat({
  label,
  nilai,
  hint,
  tone = 'netral',
  className = '',
}: {
  label: string;
  nilai: ReactNode;
  hint?: ReactNode;
  tone?: 'netral' | 'hijau' | 'merah' | 'kuning';
  className?: string;
}) {
  const warna = {
    netral: 'border-slate-200 bg-white',
    hijau: 'border-teal-200 bg-teal-50',
    merah: 'border-red-200 bg-red-50',
    kuning: 'border-amber-200 bg-amber-50',
  }[tone];
  return (
    <div className={`min-w-0 rounded-lg border px-3 py-2 ${warna} ${className}`}>
      <p className="truncate text-xs text-slate-500">{label}</p>
      <p className="truncate text-base font-bold text-slate-800 sm:text-lg">{nilai}</p>
      {hint && <p className="truncate text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/**
 * Baris aksi yang selalu terjangkau: menempel di dasar layar pada HP/tablet,
 * dan mengalir biasa di dalam kartu pada layar besar.
 */
export function ActionBar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`no-print bar-aksi-lengket -mx-3 border-t border-slate-200 bg-white/95 px-3 py-2.5 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur sm:-mx-4 sm:px-4 desktop:mx-0 ${className}`}
    >
      {children}
    </div>
  );
}
