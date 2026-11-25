/**
 * Kebijakan password.
 *
 * Aturan dipilih supaya bisa diikuti kasir toko tanpa alat bantu: panjang minimal 10,
 * mengandung huruf dan angka, tidak sama dengan username, dan tidak ada di daftar password
 * yang paling sering ditebak. Tidak ada aturan "harus simbol" — aturan seperti itu membuat
 * orang menulis "Password1!" yang justru ada di setiap kamus serangan.
 */

export const PANJANG_MINIMAL = 10;

/** Password yang muncul di daftar tebakan pertama setiap alat brute force. */
const TERLALU_UMUM = new Set([
  'password', 'password1', 'password123', 'passw0rd', '12345678', '123456789', '1234567890',
  'qwertyuiop', 'qwerty123', 'iloveyou', 'admin123', 'administrator', 'letmein123',
  'tokohakim', 'poshakim', 'superadmin', 'kasir12345',
]);

/**
 * Kembalikan pesan kesalahan, atau null kalau password memenuhi kebijakan.
 * `username` ikut diperiksa supaya "superadmin123" tidak lolos.
 */
export function cekPassword(password, { username } = {}) {
  const s = typeof password === 'string' ? password : '';
  if (s.length < PANJANG_MINIMAL) {
    return `Password minimal ${PANJANG_MINIMAL} karakter`;
  }
  if (s.length > 200) return 'Password terlalu panjang (maksimal 200 karakter)';
  if (!/[A-Za-z]/.test(s) || !/[0-9]/.test(s)) {
    return 'Password harus mengandung huruf dan angka';
  }
  if (new Set(s).size === 1) return 'Password tidak boleh satu karakter berulang';
  const kecil = s.toLowerCase();
  if (TERLALU_UMUM.has(kecil)) return 'Password terlalu mudah ditebak, pilih yang lain';
  if (username && kecil.includes(String(username).toLowerCase())) {
    return 'Password tidak boleh memuat username';
  }
  return null;
}
