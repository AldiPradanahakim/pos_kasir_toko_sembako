import express from 'express';
import { q, tx } from '../db.js';
import { requireSuperadmin } from '../auth.js';
import { ApiError, toInt, toStr, dateOrNull, limitOf, todayJakarta } from '../lib.js';

const router = express.Router();

/**
 * Uang yang seharusnya ada di laci untuk satu shift: modal awal + kas masuk shift itu
 * - kas keluar shift itu. Kas penjualan sudah menempel ke shift lewat `cash_flows.shift_id`,
 * jadi angka ini tidak perlu menghitung ulang penjualan.
 *
 * Kas keluar shift adalah uang laci yang DIPAKAI selama shift (beli barang dagangan,
 * bayar ongkos, dsb). Tanpa dikurangkan, tutup kas akan selalu terlihat kurang sebesar
 * uang yang sudah dibelanjakan.
 */
const RUMUS_MASUK = `COALESCE(SUM(CASE WHEN cf.tipe = 'masuk' THEN cf.jumlah ELSE 0 END), 0)`;
const RUMUS_KELUAR = `COALESCE(SUM(CASE WHEN cf.tipe = 'keluar' THEN cf.jumlah ELSE 0 END), 0)`;

/** Satu baris kas milik shift, untuk rincian "uang dipakai" di laporan tutup kas. */
const RINCIAN_COLS = `cf.id, cf.tipe, cf.kategori, cf.jumlah, cf.keterangan, cf.ref_type, cf.ref_id,
                      to_char(cf.created_at AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS jam,
                      u.name AS user_name`;

const SHIFT_COLS = `sh.id, sh.user_id, u.name AS user_name, sh.dibuka_pada, sh.modal_awal,
                    sh.ditutup_pada, sh.uang_fisik, sh.selisih, sh.catatan`;

/** Ringkasan satu shift: kas seharusnya, jumlah transaksi, dan omset shift itu. */
async function rekapShift(shiftId, modalAwal) {
  const { rows: kas } = await q(
    `SELECT ${RUMUS_MASUK} AS kas_masuk, ${RUMUS_KELUAR} AS kas_keluar
       FROM cash_flows cf WHERE cf.shift_id = $1`,
    [shiftId],
  );
  const { rows: jual } = await q(
    `SELECT COUNT(*) AS transaksi, COALESCE(SUM(s.total), 0) AS omzet,
            COALESCE((SELECT SUM(si.qty) FROM sale_items si
                        JOIN sales s2 ON s2.id = si.sale_id
                       WHERE s2.shift_id = $1 AND s2.status = 'selesai'), 0) AS items
       FROM sales s WHERE s.shift_id = $1 AND s.status = 'selesai'`,
    [shiftId],
  );
  const kasMasuk = Number(kas[0].kas_masuk);
  const kasKeluar = Number(kas[0].kas_keluar);
  return {
    kas_masuk: kasMasuk,
    kas_keluar: kasKeluar,
    kas_seharusnya: modalAwal + kasMasuk - kasKeluar,
    transaksi: Number(jual[0].transaksi),
    omzet: Number(jual[0].omzet),
    items: Number(jual[0].items),
  };
}

/**
 * Rincian baris kas satu shift, urut waktu. Yang dibaca kasir saat menutup kas adalah
 * terutama `tipe = 'keluar'` (uang yang dipakai), tapi retur penjualan juga keluar uang
 * dari laci, jadi seluruh baris shift dikirim dengan `tipe`-nya dan layar yang memilih.
 */
async function rincianShift(shiftId) {
  const { rows } = await q(
    `SELECT ${RINCIAN_COLS}
       FROM cash_flows cf LEFT JOIN users u ON u.id = cf.user_id
      WHERE cf.shift_id = $1
      ORDER BY cf.created_at, cf.id`,
    [shiftId],
  );
  return rows.map((r) => ({ ...r, jumlah: Number(r.jumlah) }));
}

/** Shift lengkap dengan rekap dan rincian kasnya. */
async function shiftLengkap(shiftId) {
  const { rows } = await q(
    `SELECT ${SHIFT_COLS} FROM shifts sh JOIN users u ON u.id = sh.user_id WHERE sh.id = $1`,
    [shiftId],
  );
  if (!rows.length) return null;
  return {
    ...rows[0],
    ...(await rekapShift(rows[0].id, rows[0].modal_awal)),
    rincian: await rincianShift(rows[0].id),
  };
}

/** Shift yang sedang terbuka milik user login (null kalau belum buka kas). */
async function shiftAktif(userId) {
  const { rows } = await q(
    `SELECT ${SHIFT_COLS} FROM shifts sh JOIN users u ON u.id = sh.user_id
      WHERE sh.user_id = $1 AND sh.ditutup_pada IS NULL`,
    [userId],
  );
  if (!rows.length) return null;
  return {
    ...rows[0],
    ...(await rekapShift(rows[0].id, rows[0].modal_awal)),
    rincian: await rincianShift(rows[0].id),
  };
}

// Dipakai kasir setiap kali membuka layar kasir, jadi TIDAK superadmin.
router.get('/shifts/aktif', async (req, res) => {
  res.json(await shiftAktif(req.user.id));
});

router.post('/shifts/buka', async (req, res) => {
  const modalAwal = toInt(req.body?.modal_awal);
  if (modalAwal === null || modalAwal < 0) throw new ApiError(422, 'modal_awal harus bilangan bulat >= 0');

  const id = await tx(async (c) => {
    // Dikunci per user: dua ketukan "Buka Kas" bersamaan tidak boleh jadi dua shift.
    await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    const { rows: ada } = await c.query(
      'SELECT id FROM shifts WHERE user_id = $1 AND ditutup_pada IS NULL',
      [req.user.id],
    );
    if (ada.length) throw new ApiError(422, 'Kas sudah dibuka. Tutup kas dulu sebelum membuka lagi.');
    const { rows } = await c.query(
      'INSERT INTO shifts (user_id, modal_awal, catatan) VALUES ($1, $2, $3) RETURNING id',
      [req.user.id, modalAwal, toStr(req.body?.catatan)],
    );
    return rows[0].id;
  });

  res.status(201).json(await shiftAktif(req.user.id));
});

router.post('/shifts/tutup', async (req, res) => {
  const uangFisik = toInt(req.body?.uang_fisik);
  if (uangFisik === null || uangFisik < 0) throw new ApiError(422, 'uang_fisik harus bilangan bulat >= 0');

  const aktif = await shiftAktif(req.user.id);
  if (!aktif) throw new ApiError(422, 'Kas belum dibuka');

  const selisih = uangFisik - aktif.kas_seharusnya;
  await q(
    `UPDATE shifts SET ditutup_pada = now(), uang_fisik = $1, selisih = $2, catatan = COALESCE($3, catatan)
      WHERE id = $4`,
    [uangFisik, selisih, toStr(req.body?.catatan), aktif.id],
  );

  res.json(await shiftLengkap(aktif.id));
});

/**
 * Catat uang laci yang DIPAKAI selama shift: beli barang dagangan, bayar ongkos angkut,
 * bayar tukang, dsb. Baris ini menempel ke shift yang sedang terbuka (`cash_flows.shift_id`),
 * jadi otomatis mengurangi "seharusnya di laci" pada laporan tutup kas — bukan sekadar
 * catatan: tanpa ini, selisih kas selalu terlihat kurang sebesar uang yang sudah dibelanjakan.
 *
 * Kasir boleh menulis di sini (berbeda dari buku kas manual yang superadmin saja), karena
 * dialah yang memegang laci dan tahu uangnya dipakai untuk apa.
 */
router.post('/shifts/pengeluaran', async (req, res) => {
  const jumlah = toInt(req.body?.jumlah);
  if (jumlah === null || jumlah <= 0) throw new ApiError(422, 'jumlah harus bilangan bulat lebih dari 0');
  const keterangan = toStr(req.body?.keterangan);
  if (!keterangan) throw new ApiError(422, 'keterangan wajib diisi: uangnya dipakai untuk apa');

  const aktif = await shiftAktif(req.user.id);
  if (!aktif) throw new ApiError(422, 'Kas belum dibuka');
  if (jumlah > aktif.kas_seharusnya) {
    throw new ApiError(
      422,
      `Uang di laci hanya Rp ${aktif.kas_seharusnya.toLocaleString('id-ID')}, tidak cukup untuk Rp ${jumlah.toLocaleString('id-ID')}.`,
    );
  }

  const kategori = toStr(req.body?.kategori) ?? 'kas keluar';
  const { rows } = await q(
    `INSERT INTO cash_flows (tanggal, tipe, kategori, jumlah, keterangan, user_id, shift_id)
     VALUES ($1, 'keluar', $2, $3, $4, $5, $6)
     RETURNING id`,
    [todayJakarta(), kategori, jumlah, keterangan, req.user.id, aktif.id],
  );
  const { rows: baris } = await q(
    `SELECT ${RINCIAN_COLS}
       FROM cash_flows cf LEFT JOIN users u ON u.id = cf.user_id
      WHERE cf.id = $1`,
    [rows[0].id],
  );
  const shift = await shiftLengkap(aktif.id);
  res.status(201).json({ pengeluaran: { ...baris[0], jumlah: Number(baris[0].jumlah) }, shift });
});

/**
 * Batalkan satu pengeluaran shift yang salah catat, selama kasnya masih terbuka.
 * Hanya baris manual milik shift sendiri: baris otomatis (penjualan, retur) berasal dari
 * transaksinya dan tidak boleh hilang dari laci tanpa transaksinya dibatalkan.
 */
router.delete('/shifts/pengeluaran/:id', async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'Pengeluaran tidak ditemukan');

  const hapus = await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT cf.id, cf.shift_id, cf.ref_type, sh.user_id, sh.ditutup_pada
         FROM cash_flows cf JOIN shifts sh ON sh.id = cf.shift_id
        WHERE cf.id = $1 FOR UPDATE`,
      [id],
    );
    if (!rows.length) throw new ApiError(404, 'Pengeluaran tidak ditemukan');
    const baris = rows[0];
    if (baris.ditutup_pada) throw new ApiError(422, 'Kas sudah ditutup: rincian laporan tidak bisa diubah lagi');
    if (baris.ref_type) throw new ApiError(422, 'Baris ini berasal dari transaksi, bukan pengeluaran manual');
    if (baris.user_id !== req.user.id) throw new ApiError(403, 'Hanya kasir yang mencatatnya yang bisa membatalkan');
    await c.query('DELETE FROM cash_flows WHERE id = $1', [id]);
    return baris;
  });

  res.json({ ok: true, shift: await shiftLengkap(hapus.shift_id) });
});

/**
 * Satu shift lengkap dengan rekap dan rincian kasnya. Superadmin boleh membuka shift
 * siapa pun (untuk memeriksa laporan tutup kas); kasir hanya shift miliknya sendiri.
 */
router.get('/shifts/:id', async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'Shift tidak ditemukan');

  const shift = await shiftLengkap(id);
  if (!shift) throw new ApiError(404, 'Shift tidak ditemukan');
  if (req.user.role !== 'superadmin' && shift.user_id !== req.user.id) {
    throw new ApiError(403, 'Akses ditolak: ini kas kasir lain');
  }
  res.json(shift);
});

/**
 * Riwayat kas (shift): modal awal, uang yang seharusnya di laci, uang fisik yang dihitung,
 * dan selisihnya — per kasir per penutupan kas.
 *
 * Hanya superadmin: ini laporan pemeriksaan uang lintas kasir, bukan layar kerja kasir.
 * Kasir tetap menerima laporan tutup kasnya sendiri SEKALI, saat menekan "Tutup Kas"
 * (respons `POST /shifts/tutup`), lalu tidak lagi punya akses ke daftar ini.
 * Daftar dibangun dari tabel `shifts`, bukan dari `sales`, supaya shift yang ditutup
 * tanpa satu pun penjualan tetap muncul dengan selisihnya.
 */
router.get('/shifts', requireSuperadmin, async (req, res) => {
  const from = dateOrNull(req.query.from);
  const to = dateOrNull(req.query.to);
  const { rows } = await q(
    `SELECT ${SHIFT_COLS},
            COALESCE(kas.masuk, 0) AS kas_masuk,
            COALESCE(kas.keluar, 0) AS kas_keluar,
            sh.modal_awal + COALESCE(kas.masuk, 0) - COALESCE(kas.keluar, 0) AS kas_seharusnya,
            COALESCE(jual.transaksi, 0) AS transaksi,
            COALESCE(jual.omzet, 0) AS omzet,
            COALESCE(jual.items, 0) AS items
       FROM shifts sh
       JOIN users u ON u.id = sh.user_id
       LEFT JOIN LATERAL (
         SELECT ${RUMUS_MASUK} AS masuk, ${RUMUS_KELUAR} AS keluar
           FROM cash_flows cf WHERE cf.shift_id = sh.id
       ) kas ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS transaksi, COALESCE(SUM(s.total), 0) AS omzet,
                COALESCE(SUM((SELECT SUM(si.qty) FROM sale_items si WHERE si.sale_id = s.id)), 0) AS items
           FROM sales s WHERE s.shift_id = sh.id AND s.status = 'selesai'
       ) jual ON true
      WHERE ($1::date IS NULL OR (sh.dibuka_pada AT TIME ZONE 'Asia/Jakarta')::date >= $1)
        AND ($2::date IS NULL OR (sh.dibuka_pada AT TIME ZONE 'Asia/Jakarta')::date <= $2)
      ORDER BY sh.dibuka_pada DESC
      LIMIT $3`,
    [from, to, limitOf(req.query.limit, 100)],
  );
  res.json(
    rows.map((r) => ({
      ...r,
      kas_masuk: Number(r.kas_masuk),
      kas_keluar: Number(r.kas_keluar),
      kas_seharusnya: Number(r.kas_seharusnya),
      transaksi: Number(r.transaksi),
      omzet: Number(r.omzet),
      items: Number(r.items),
    })),
  );
});

export default router;
export { shiftAktif };
