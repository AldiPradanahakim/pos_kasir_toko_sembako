import { q } from './db.js';

/**
 * Audit log untuk perubahan yang bisa merugikan toko: harga, produk, pengguna, hapus transaksi,
 * koreksi kas, dan pembatalan.
 *
 * Prinsipnya: pencatatan audit TIDAK BOLEH menggagalkan pekerjaan kasir. Kalau penulisan log
 * gagal (mis. database sedang penuh), kesalahan dicatat ke konsol dan permintaan tetap lanjut.
 * Yang tidak boleh terjadi adalah sebaliknya — kasir gagal menjual karena log gagal ditulis.
 *
 * `detail` sengaja berupa objek bebas; jangan pernah menaruh password atau token di sini.
 */
export async function audit(req, aksi, entitas, entitasId = null, detail = null) {
  try {
    await q(
      `INSERT INTO audit_logs (user_id, user_name, aksi, entitas, entitas_id, detail, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.user?.id ?? null,
        req.user?.name ?? null,
        aksi,
        entitas,
        entitasId,
        detail === null ? null : JSON.stringify(detail),
        req.ip ?? null,
      ],
    );
  } catch (err) {
    console.error('[audit] gagal mencatat', aksi, entitas, entitasId, err.message);
  }
}

/**
 * Selisih dua objek: hanya field yang berubah, bentuknya { field: [lama, baru] }.
 * Dipakai supaya log perubahan produk tidak menyalin seluruh baris.
 */
export function selisih(sebelum, sesudah, kolom) {
  const out = {};
  for (const k of kolom) {
    const a = sebelum?.[k] ?? null;
    const b = sesudah?.[k] ?? null;
    if (String(a) !== String(b)) out[k] = [a, b];
  }
  return Object.keys(out).length ? out : null;
}
