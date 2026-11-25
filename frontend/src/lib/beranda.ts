import type { AuthUser } from '../types';

/**
 * Halaman pertama setelah masuk.
 *
 * Kasir: layar kasir, karena seluruh tugasnya ada di sana.
 * Superadmin: dashboard. Dia masuk untuk memeriksa toko, bukan untuk melayani pembeli —
 * memaksanya mendarat di layar kasir berarti dia dicegat kartu "Buka Kas" lebih dulu.
 * Kalau memang mau memakai mesin kasir, dia membuka kasnya sendiri lewat menu Kasir.
 */
export function halamanAwal(user: AuthUser | null): string {
  return user?.role === 'superadmin' ? '/dashboard' : '/kasir';
}
