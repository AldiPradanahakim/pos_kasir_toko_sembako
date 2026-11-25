/**
 * Pembatas percobaan login.
 *
 * Kenapa ada: `/api/login` adalah satu-satunya endpoint tanpa token. Tanpa batas, siapa pun
 * yang menemukan alamatnya bisa menebak password tanpa henti — bcrypt memperlambat tiap
 * tebakan, tetapi tidak pernah menghentikannya.
 *
 * Aturannya:
 *  - Dihitung per IP DAN per username, supaya penyerang yang berganti-ganti IP tetap
 *    tertahan saat mengincar satu akun.
 *  - Hanya percobaan GAGAL yang dihitung. Login yang berhasil membersihkan hitungan, jadi
 *    kasir yang sering buka-tutup aplikasi tidak pernah terkunci karena salah ketik orang lain.
 *  - Keadaan disimpan di memori proses (satu proses Node, satu toko). Restart server
 *    mengosongkannya, dan itu aman: tidak ada yang bisa dipulihkan penyerang dari situ.
 *
 * Batasnya bisa diubah lewat .env: LOGIN_MAKS_GAGAL (default 10) dan LOGIN_JENDELA_MENIT (default 15).
 */

const MAKS_GAGAL_DEFAULT = 10;
const JENDELA_MENIT_DEFAULT = 15;
/** Batas jumlah entri supaya serangan dari banyak IP tidak menghabiskan memori. */
const MAKS_ENTRI = 5000;

/** key -> { gagal, mulai } */
const catatan = new Map();

function batas() {
  const maks = Number(process.env.LOGIN_MAKS_GAGAL ?? MAKS_GAGAL_DEFAULT);
  const menit = Number(process.env.LOGIN_JENDELA_MENIT ?? JENDELA_MENIT_DEFAULT);
  return {
    maks: Number.isFinite(maks) && maks > 0 ? maks : MAKS_GAGAL_DEFAULT,
    jendelaMs: (Number.isFinite(menit) && menit > 0 ? menit : JENDELA_MENIT_DEFAULT) * 60_000,
  };
}

function buangKedaluwarsa(now, jendelaMs) {
  for (const [k, e] of catatan) {
    if (now - e.mulai >= jendelaMs) catatan.delete(k);
  }
  // Map menjaga urutan penyisipan: yang paling awal masuk dibuang lebih dulu.
  while (catatan.size > MAKS_ENTRI) catatan.delete(catatan.keys().next().value);
}

function terkunci(kunci, cfg, now) {
  const e = catatan.get(kunci);
  if (!e) return null;
  if (now - e.mulai >= cfg.jendelaMs) {
    catatan.delete(kunci);
    return null;
  }
  if (e.gagal < cfg.maks) return null;
  return { retryAfter: Math.max(1, Math.ceil((e.mulai + cfg.jendelaMs - now) / 1000)) };
}

function catatGagal(kunci, now) {
  const e = catatan.get(kunci);
  if (!e || now - e.mulai >= batas().jendelaMs) catatan.set(kunci, { gagal: 1, mulai: now });
  else e.gagal += 1;
}

/** Hanya untuk tes: lupakan semua hitungan supaya satu berkas tes tidak saling mengunci. */
export function bersihkanCatatanLogin() {
  catatan.clear();
}

/** Middleware khusus route login. */
export function rateLimitLogin() {
  return (req, res, next) => {
    const cfg = batas();
    const now = Date.now();
    buangKedaluwarsa(now, cfg.jendelaMs);

    // trust proxy di app.js membuat req.ip berisi IP asli klien di balik Caddy.
    const ip = req.ip || req.socket?.remoteAddress || 'tanpa-ip';
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const kunci = [`ip:${ip}`];
    if (username) kunci.push(`user:${username.toLowerCase()}`);

    let tertahan = null;
    for (const k of kunci) {
      const t = terkunci(k, cfg, now);
      if (t && (!tertahan || t.retryAfter > tertahan.retryAfter)) tertahan = t;
    }
    if (tertahan) {
      const menit = Math.max(1, Math.ceil(tertahan.retryAfter / 60));
      res.set('Retry-After', String(tertahan.retryAfter));
      return res.status(429).json({ error: `Terlalu banyak percobaan masuk. Coba lagi dalam ${menit} menit.` });
    }

    // Status akhir baru diketahui setelah handler selesai (termasuk lewat error handler).
    res.on('finish', () => {
      const t = Date.now();
      if (res.statusCode === 200) {
        for (const k of kunci) catatan.delete(k);
      } else if (res.statusCode >= 400) {
        for (const k of kunci) catatGagal(k, t);
      }
    });

    next();
  };
}
