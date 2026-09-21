import express from 'express';
import { q, tx, jakartaDate } from '../db.js';
import { findSuperadmin, requireSuperadmin } from '../auth.js';
import {
  ApiError, toBool, toInt, toStr, dateOrNull, limitOf, insertCashFlow,
} from '../lib.js';

const router = express.Router();

/** Detail transaksi lengkap (dipakai struk & riwayat). */
async function saleDetail(where, params) {
  const { rows } = await q(
    `SELECT s.id, s.uuid, s.no_struk, s.created_at, s.synced_at, s.total, s.metode_bayar,
            s.dibayar, s.kembalian, s.status, s.alasan_batal, s.nama_pelanggan,
            u.id AS user_id, u.name AS user_name,
            d.id AS dibatalkan_oleh_id, d.name AS dibatalkan_oleh_name
       FROM sales s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN users d ON d.id = s.dibatalkan_oleh
      WHERE ${where}`,
    params,
  );
  const sale = rows[0];
  if (!sale) return null;

  const { rows: items } = await q(
    `SELECT si.product_id, p.name AS product_name, si.unit_id, si.unit_name, si.qty,
            si.isi_snapshot, si.harga_snapshot, si.harga_modal_snapshot,
            si.harga_diubah, si.alasan_ubah_harga,
            si.harga_snapshot * si.qty AS subtotal
       FROM sale_items si
       JOIN products p ON p.id = si.product_id
      WHERE si.sale_id = $1
      ORDER BY si.id`,
    [sale.id],
  );

  return {
    id: sale.id,
    uuid: sale.uuid,
    no_struk: sale.no_struk,
    created_at: sale.created_at,
    synced_at: sale.synced_at,
    user: { id: sale.user_id, name: sale.user_name },
    total: sale.total,
    metode_bayar: sale.metode_bayar,
    dibayar: sale.dibayar,
    kembalian: sale.kembalian,
    status: sale.status,
    nama_pelanggan: sale.nama_pelanggan,
    alasan_batal: sale.alasan_batal,
    dibatalkan_oleh: sale.dibatalkan_oleh_id
      ? { id: sale.dibatalkan_oleh_id, name: sale.dibatalkan_oleh_name }
      : null,
    items,
  };
}

// Nomor struk tidak bolong: baris counter hari itu dikunci dan dinaikkan dalam transaksi yang sama.
async function nextNoStruk(c, day) {
  const { rows } = await c.query(
    `INSERT INTO struk_counters (day, last) VALUES ($1, 1)
     ON CONFLICT (day) DO UPDATE SET last = struk_counters.last + 1
     RETURNING last`,
    [day],
  );
  return `INV-${day.replaceAll('-', '')}-${String(rows[0].last).padStart(4, '0')}`;
}

// POST /sales — idempotent terhadap uuid dari perangkat.
router.post('/sales', async (req, res) => {
  const uuid = toStr(req.body?.uuid);
  if (!uuid) throw new ApiError(422, 'uuid wajib diisi');
  if (!Array.isArray(req.body?.items) || req.body.items.length === 0) {
    throw new ApiError(422, 'items tidak boleh kosong');
  }
  // Toko hanya menerima tunai; QRIS dan transfer dihapus atas permintaan pemilik.
  if (toStr(req.body?.metode_bayar) !== 'tunai') throw new ApiError(422, "metode_bayar harus 'tunai'");

  const namaPelanggan = toStr(req.body?.nama_pelanggan);

  let createdAt = null;
  if (req.body?.created_at !== undefined && req.body?.created_at !== null && req.body?.created_at !== '') {
    const d = new Date(req.body.created_at);
    if (Number.isNaN(d.getTime())) throw new ApiError(422, 'created_at tidak valid');
    createdAt = d;
  }

  const existing = await saleDetail('s.uuid = $1', [uuid]);
  if (existing) return res.json({ sale: existing, duplicate: true });

  const result = await tx(async (c) => {
    // Idempotensi juga di level DB: dua sync bersamaan tidak boleh membuat dua baris.
    const { rows: dupe } = await c.query('SELECT id FROM sales WHERE uuid = $1', [uuid]);
    if (dupe.length) return { id: dupe[0].id, created: false };

    const lines = [];
    let total = 0;
    for (const raw of req.body.items) {
      const productId = toInt(raw?.product_id);
      const unitId = toInt(raw?.unit_id);
      const qty = toInt(raw?.qty);
      if (productId === null) throw new ApiError(422, 'product_id item tidak valid');
      if (unitId === null) throw new ApiError(422, 'unit_id item tidak valid');
      if (qty === null || qty <= 0) throw new ApiError(422, 'qty item harus bilangan bulat lebih dari 0');

      const { rows: pu } = await c.query(
        `SELECT pu.isi, pu.harga_jual, pu.harga_modal, u.name AS unit_name
           FROM product_units pu JOIN units u ON u.id = pu.unit_id
          WHERE pu.product_id = $1 AND pu.unit_id = $2`,
        [productId, unitId],
      );
      if (!pu.length) throw new ApiError(422, 'Satuan itu tidak terdaftar untuk produk pada item');
      const meta = pu[0];

      const hargaInput = raw?.harga === undefined || raw?.harga === null ? null : toInt(raw.harga);
      if (raw?.harga !== undefined && raw?.harga !== null && hargaInput === null) {
        throw new ApiError(422, 'harga item harus bilangan bulat >= 0');
      }
      if (hargaInput !== null && hargaInput < 0) throw new ApiError(422, 'harga item harus bilangan bulat >= 0');

      const alasan = toStr(raw?.alasan_ubah_harga);
      const berbeda = hargaInput !== null && hargaInput !== meta.harga_jual;
      if (berbeda && !alasan) {
        throw new ApiError(422, 'Harga diubah tapi alasan_ubah_harga belum diisi');
      }

      const hargaSnapshot = berbeda ? hargaInput : meta.harga_jual;
      const line = {
        product_id: productId,
        unit_id: unitId,
        unit_name: meta.unit_name,
        qty,
        isi_snapshot: meta.isi,
        harga_snapshot: hargaSnapshot,
        harga_modal_snapshot: meta.harga_modal,
        harga_diubah: berbeda,
        alasan_ubah_harga: berbeda ? alasan : null,
      };
      total += hargaSnapshot * qty;
      lines.push(line);
    }

    // Hanya tunai: `dibayar` wajib dan tidak boleh kurang dari total.
    const dibayar = toInt(req.body?.dibayar);
    if (dibayar === null) throw new ApiError(422, 'dibayar wajib diisi untuk pembayaran tunai');
    if (dibayar < total) throw new ApiError(422, `dibayar (${dibayar}) kurang dari total (${total})`);
    const kembalian = dibayar - total;

    const when = createdAt ?? new Date();
    const noStruk = await nextNoStruk(c, jakartaDate(when));

    const { rows: saleRows } = await c.query(
      `INSERT INTO sales (uuid, no_struk, user_id, total, metode_bayar, dibayar, kembalian,
                          status, created_at, synced_at, nama_pelanggan)
       VALUES ($1, $2, $3, $4, 'tunai', $5, $6, 'selesai', $7, now(), $8) RETURNING id`,
      [uuid, noStruk, req.user.id, total, dibayar, kembalian, when, namaPelanggan],
    );
    const saleId = saleRows[0].id;

    for (const l of lines) {
      await c.query(
        `INSERT INTO sale_items (sale_id, product_id, unit_id, unit_name, qty, isi_snapshot,
                                 harga_snapshot, harga_modal_snapshot, harga_diubah, alasan_ubah_harga)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [saleId, l.product_id, l.unit_id, l.unit_name, l.qty, l.isi_snapshot,
          l.harga_snapshot, l.harga_modal_snapshot, l.harga_diubah, l.alasan_ubah_harga],
      );
      // Jual 2 dus (isi 40) => keluar -80 base_unit.
      await c.query(
        `INSERT INTO stock_movements (product_id, type, qty_base, reference_type, reference_id, note, user_id, created_at)
         VALUES ($1, 'keluar', $2, 'sale', $3, NULL, $4, $5)`,
        [l.product_id, -(l.isi_snapshot * l.qty), saleId, req.user.id, when],
      );
    }

    // Kas masuk sebesar total transaksi, di transaksi yang sama — buku kas tidak
    // pernah beda dengan penjualannya. tanggal memakai hari Jakarta dari created_at.
    await insertCashFlow(c, {
      tanggal: jakartaDate(when),
      tipe: 'masuk',
      kategori: 'penjualan',
      jumlah: total,
      keterangan: `Penjualan ${noStruk}`,
      refType: 'sale',
      refId: saleId,
      userId: req.user.id,
    });

    return { id: saleId, created: true };
  });

  const sale = await saleDetail('s.id = $1', [result.id]);
  res.status(result.created ? 201 : 200).json({ sale, duplicate: !result.created });
});

router.get('/sales', async (req, res) => {
  const from = dateOrNull(req.query.from);
  const to = dateOrNull(req.query.to);
  const status = toStr(req.query.status);
  const search = toStr(req.query.q);
  if (status && status !== 'selesai' && status !== 'dibatalkan') {
    throw new ApiError(422, "status harus 'selesai' atau 'dibatalkan'");
  }

  const { rows } = await q(
    `SELECT s.id, s.uuid, s.no_struk, s.created_at, u.name AS user_name, s.total,
            s.metode_bayar, s.status, s.nama_pelanggan,
            (SELECT COALESCE(SUM(si.qty), 0) FROM sale_items si WHERE si.sale_id = s.id) AS items_count
       FROM sales s
       JOIN users u ON u.id = s.user_id
      WHERE ($1::date IS NULL OR (s.created_at AT TIME ZONE 'Asia/Jakarta')::date >= $1)
        AND ($2::date IS NULL OR (s.created_at AT TIME ZONE 'Asia/Jakarta')::date <= $2)
        AND ($3::text IS NULL OR s.status = $3)
        AND ($4::text IS NULL OR s.no_struk ILIKE '%' || $4 || '%' OR s.uuid ILIKE '%' || $4 || '%'
             OR s.nama_pelanggan ILIKE '%' || $4 || '%')
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT $5`,
    [from, to, status, search, limitOf(req.query.limit, 100)],
  );
  res.json(rows);
});

router.get('/sales/by-uuid/:uuid', async (req, res) => {
  const sale = await saleDetail('s.uuid = $1', [req.params.uuid]);
  if (!sale) throw new ApiError(404, 'Transaksi tidak ditemukan');
  res.json(sale);
});

router.get('/sales/:id', async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'Transaksi tidak ditemukan');
  const sale = await saleDetail('s.id = $1', [id]);
  if (!sale) throw new ApiError(404, 'Transaksi tidak ditemukan');
  res.json(sale);
});

// Batal transaksi penuh. Kasir boleh, asal membawa kredensial superadmin yang sah.
router.post('/sales/:id/cancel', async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'Transaksi tidak ditemukan');

  const alasan = toStr(req.body?.alasan_batal);
  if (!alasan) throw new ApiError(422, 'alasan_batal wajib diisi');

  let actor = req.user;
  if (req.user.role !== 'superadmin') {
    const sa = await findSuperadmin(req.body?.superadmin_username, req.body?.superadmin_password);
    if (!sa) throw new ApiError(403, 'Butuh kredensial superadmin yang sah untuk membatalkan transaksi');
    actor = sa;
  }

  await tx(async (c) => {
    const { rows } = await c.query('SELECT id, status, total, no_struk FROM sales WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) throw new ApiError(404, 'Transaksi tidak ditemukan');
    if (rows[0].status === 'dibatalkan') throw new ApiError(422, 'Transaksi ini sudah dibatalkan');

    // no_struk tetap tersimpan; transaksi tidak pernah dihapus.
    await c.query(
      `UPDATE sales SET status = 'dibatalkan', alasan_batal = $1, dibatalkan_oleh = $2 WHERE id = $3`,
      [alasan, actor.id, id],
    );

    const { rows: items } = await c.query(
      'SELECT product_id, qty, isi_snapshot FROM sale_items WHERE sale_id = $1',
      [id],
    );
    for (const it of items) {
      await c.query(
        `INSERT INTO stock_movements (product_id, type, qty_base, reference_type, reference_id, note, user_id)
         VALUES ($1, 'pembatalan', $2, 'sale', $3, $4, $5)`,
        [it.product_id, it.isi_snapshot * it.qty, id, `Batal: ${alasan}`, actor.id],
      );
    }

    // Baris kas penjualan TIDAK dihapus; dibuat baris lawan hari ini supaya buku kas
    // tetap seimbang dan jejak pembatalannya kelihatan.
    await insertCashFlow(c, {
      tanggal: jakartaDate(new Date()),
      tipe: 'keluar',
      kategori: 'pembatalan',
      jumlah: rows[0].total,
      keterangan: `Pembatalan ${rows[0].no_struk ?? id}`,
      refType: 'sale',
      refId: id,
      userId: actor.id,
    });
  });

  res.json(await saleDetail('s.id = $1', [id]));
});

/**
 * Hapus permanen penjualan (superadmin) beserta item dan baris kasnya.
 *
 * Stok dikembalikan lewat movement `penyesuaian` sebesar total base_unit transaksi —
 * TAPI hanya untuk transaksi berstatus 'selesai'. Transaksi 'dibatalkan' stoknya sudah
 * kembali lewat movement `pembatalan`, jadi mengembalikannya lagi akan menggandakan stok.
 *
 * `struk_counters` sengaja TIDAK disentuh: nomor struk yang sudah keluar tidak pernah
 * dipakai ulang, jadi riwayat nomor tetap utuh walau barisnya dihapus.
 */
async function deleteSales(c, sales, { restore, userId }) {
  const ids = sales.map((s) => s.id);
  let restored = 0;

  if (restore) {
    const restorable = sales.filter((s) => s.status === 'selesai').map((s) => s.id);
    if (restorable.length) {
      const { rowCount } = await c.query(
        `INSERT INTO stock_movements (product_id, type, qty_base, reference_type, reference_id, note, user_id)
         SELECT si.product_id, 'penyesuaian', SUM(si.isi_snapshot * si.qty), 'sale', s.id,
                'Hapus transaksi ' || COALESCE(s.no_struk, s.uuid), $2
           FROM sales s JOIN sale_items si ON si.sale_id = s.id
          WHERE s.id = ANY($1::bigint[])
          GROUP BY si.product_id, s.id, s.no_struk, s.uuid`,
        [restorable, userId],
      );
      restored = rowCount;
    }
  }

  // Baris kas milik transaksi ini ikut hilang supaya buku kas tetap konsisten.
  await c.query(`DELETE FROM cash_flows WHERE ref_type = 'sale' AND ref_id = ANY($1::bigint[])`, [ids]);
  const { rowCount } = await c.query('DELETE FROM sales WHERE id = ANY($1::bigint[])', [ids]);

  return { ok: true, deleted: rowCount, restored_movements: restored, restore_stock: restore };
}

// Hapus riwayat pesanan (superadmin). ?restore_stock=false untuk membersihkan tanpa menyentuh stok.
router.delete('/sales/:id', requireSuperadmin, async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) throw new ApiError(404, 'Transaksi tidak ditemukan');
  const restore = toBool(req.query.restore_stock, true);

  const out = await tx(async (c) => {
    const { rows } = await c.query(
      'SELECT id, no_struk, uuid, status FROM sales WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!rows.length) throw new ApiError(404, 'Transaksi tidak ditemukan');
    return deleteSales(c, rows, { restore, userId: req.user.id });
  });

  res.json(out);
});

// Hapus riwayat massal per rentang tanggal (superadmin) — dipakai tombol "hapus riwayat".
router.post('/sales/purge', requireSuperadmin, async (req, res) => {
  const from = dateOrNull(req.body?.from);
  const to = dateOrNull(req.body?.to);
  if (!from || !to) throw new ApiError(422, 'from dan to wajib diisi dengan format YYYY-MM-DD');
  if (from > to) throw new ApiError(422, 'from tidak boleh lebih besar dari to');

  const status = toStr(req.body?.status);
  if (status && status !== 'selesai' && status !== 'dibatalkan') {
    throw new ApiError(422, "status harus 'selesai' atau 'dibatalkan'");
  }
  const restore = toBool(req.body?.restore_stock, true);

  const out = await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT id, no_struk, uuid, status FROM sales
        WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1 AND $2
          AND ($3::text IS NULL OR status = $3)
        ORDER BY id
          FOR UPDATE`,
      [from, to, status],
    );
    if (!rows.length) return { ok: true, deleted: 0, restored_movements: 0, restore_stock: restore };
    return deleteSales(c, rows, { restore, userId: req.user.id });
  });

  res.json({ ...out, from, to });
});

export default router;
