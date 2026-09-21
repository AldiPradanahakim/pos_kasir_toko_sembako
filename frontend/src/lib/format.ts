export const rupiah = (n: number | null | undefined): string =>
  'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/** 'YYYY-MM-DD' di zona waktu perangkat (Asia/Jakarta). */
export const tanggalLokal = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Nomor struk sementara sebelum tersinkron: OFF-<yyyymmddhhmmss> */
export const nomorOffline = (d: Date = new Date()): string =>
  `OFF-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(
    d.getSeconds(),
  )}`;

export const formatTanggalJam = (iso: string | null | undefined): string => {
  if (!iso) return '-';
  const d = new Date(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const formatTanggal = (iso: string | null | undefined): string => {
  if (!iso) return '-';
  const d = new Date(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/** Tampilan stok enak dibaca, mis. "3 dus 12 pcs". Samai gaya server: pakai satuan terbesar yang muat. */
export const displayStok = (stokBase: number, units: { unit_name: string; isi: number }[]): string => {
  const neg = stokBase < 0 ? '-' : '';
  const abs = Math.abs(Math.round(stokBase));
  const valid = units.filter((u) => u.isi > 0);
  if (!valid.length) return `${neg}${abs}`;
  const baseName = valid.find((u) => u.isi === 1)?.unit_name ?? 'base';
  const big = [...valid].filter((u) => u.isi > 1 && u.isi <= abs).sort((a, b) => b.isi - a.isi)[0];
  if (!big) return `${neg}${abs} ${baseName}`;
  const whole = Math.floor(abs / big.isi);
  const rest = abs % big.isi;
  return rest ? `${neg}${whole} ${big.unit_name} ${rest} ${baseName}` : `${neg}${whole} ${big.unit_name}`;
};

export const labelMetode = (m: string): string => ({ tunai: 'Tunai' })[m] ?? m;

/** Ubah "1.500" / "1500" jadi integer rupiah; kosong = 0. */
export const parseUang = (v: string): number => {
  const digits = v.replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : 0;
};
