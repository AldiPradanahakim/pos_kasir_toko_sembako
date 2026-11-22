import express from 'express';
import { q, tx, jakartaDate } from '../db.js';
import { requireSuperadmin } from '../auth.js';
import {
  ApiError, toBool, toInt, toStr, dateOrNull, limitOf, insertCashFlow,
} from '../lib.js';

const router = express.Router();

/** Detail transaksi lengkap (dipakai struk & riwayat). */
async function saleDetail(where, params) {
  const { rows } = await q(
    `SELECT s.id, s.uuid, s.no_struk, s.created_at, s.synced_at, s.total, s.metode_bayar,
            s.dibayar, s.kembalian, s.status, s.alasan_batal, s.nama_pelanggan,
            s.customer_id, c.nama AS customer_nama, s.shift_id,
            COALESCE(dp.sisa, 0) AS sisa_piutang,
            u.id AS user_id, u.name AS user_name,
            d.id AS dibatalkan_oleh_id, d.name AS dibatalkan_oleh_name
       FROM sales s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN users d ON d.id = s.dibatalkan_oleh
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN LATERAL (
         SELECT SUM(d2.jumlah - d2.dibayar) AS sisa
           FROM debts d2 WHERE d2.sale_id = s.id AND d2.status = 'belum'
       ) dp ON true
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
    customer_id: sale.customer_id,
    customer_nama: sale.customer_nama,
    shift_id: sale.shift_id,
    sisa_piutang: Number(sale.sisa_piutang),
    alasan_batal: sale.alasan_batal,
    dibatalkan_oleh: sale.dibatalkan_oleh_id
      ? { id: sale.dibatalkan_oleh_id, name: sale.dibatalkan_oleh_name }
      : null,
    items,
  };
}

/**
 * Nomor struk tidak bolong: baris counter tahun itu dikunci dan dinaikkan dalam transaksi
 * yang sama. Format `INV-<tahun>-<6 digit>` — tanggal TIDAK diulang di nomor karena sudah
 * tercetak di barisnya sendiri, dan 6 digit perlu karena setahun bisa ribuan transaksi
 * (4 digit per hari tidak cukup begitu satu hari tembus 999 struk).
 */
async function nextNoStruk(c, tahun) {
  const { rows } = await c.query(
    `INSERT INTO struk_counters_tahun (tahun, last) VALUES ($1, 1)
     ON CONFLICT (tahun) DO UPDATE SET last = struk_counters_tahun.last + 1
     RETURNING last`,
    [tahun],
  );
  return `INV-${tahun}-${String(rows[0].last).padStart(6, '0')}`;
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
  // Bon = pelanggan berutang sisa. Nama wajib supaya piutangnya bisa ditagih ke orang.
  const bon = toBool(req.body?.bon, false);
  if (bon && !namaPelanggan) throw new ApiError(422, 'Nama pelanggan wajib diisi untuk transaksi bon');

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

    // Tunai penuh: `dibayar` wajib dan tidak boleh kurang dari total.
    // Bon: boleh DP (termasuk 0), sisanya jadi piutang pelanggan.
    const dibayarInput = req.body?.dibayar === undefined || req.body?.dibayar === null
      ? null
      : toInt(req.body.dibayar);
    if (dibayarInput !== null && dibayarInput < 0) throw new ApiError(422, 'dibayar harus bilangan bulat >= 0');
    const dibayar = dibayarInput ?? (bon ? 0 : null);
    if (dibayar === null) throw new ApiError(422, 'dibayar wajib diisi untuk pembayaran tunai');
    if (bon && dibayar >= total) throw new ApiError(422, 'Bon hanya untuk pembayaran yang kurang dari total');
    if (!bon && dibayar < total) throw new ApiError(422, `dibayar (${dibayar}) kurang dari total (${total})`);
    const kembalian = bon ? 0 : dibayar - total;

    // Barang yang dijual harus ada, kecuali superadmin sudah memberi izin minus per produk.
    // Diperiksa di dalam transaksi yang sama, sebelum baris `sales` dibuat: kalau di luar,
    // dua sync bersamaan bisa sama-sama lolos dari stok yang sama. Baris produk dikunci
    // (FOR UPDATE, urut id supaya tidak deadlock) sehingga sync kedua menunggu sync pertama.
    const butuh = new Map();
    for (const l of lines) {
      butuh.set(l.product_id, (butuh.get(l.product_id) ?? 0) + l.isi_snapshot * l.qty);
    }
    // Dua langkah, dan urutannya penting: kunci baris produknya dulu, BARU baca stoknya.
    // Kalau SUM(stock_movements) dihitung di query yang sama dengan FOR UPDATE, subquery itu
    // masih memakai snapshot saat pernyataan dimulai — yaitu sebelum transaksi saingan commit.
    // Akibatnya dua sync bersamaan sama-sama melihat stok lama dan dua-duanya lolos, walau
    // baris produknya terkunci. Query kedua baru jalan setelah kunci didapat, jadi snapshotnya
    // (READ COMMITTED = per pernyataan) sudah memuat penjualan yang menang balapan.
    const ids = [...butuh.keys()].sort((a, b) => a - b);
    await c.query('SELECT id FROM products WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [ids]);
    const { rows: stokRows } = await c.query(
      `SELECT p.id, p.name, p.izin_minus,
              COALESCE((SELECT SUM(sm.qty_base) FROM stock_movements sm WHERE sm.product_id = p.id), 0) AS stok
         FROM products p
        WHERE p.id = ANY($1::bigint[])`,
      [ids],
    );
    for (const r of stokRows) {
      const sisa = Number(r.stok);
      const jumlah = butuh.get(r.id);
      if (sisa - jumlah < 0 && !r.izin_minus) {
        throw new ApiError(
          422,
          `Stok "${r.name}" tidak cukup (sisa ${sisa}, butuh ${jumlah}). Minta superadmin memberi izin jual stok kosong.`,
        );
      }
    }

    const when = createdAt ?? new Date();
    const noStruk = await nextNoStruk(c, Number(jakartaDate(when).slice(0, 4)));

    // Shift kasir yang sedang terbuka: penjualan (dan kasnya) menempel ke situ supaya
    // tutup kas bisa membandingkan uang fisik dengan yang seharusnya ada.
    const { rows: shiftRows } = await c.query(
      'SELECT id FROM shifts WHERE user_id = $1 AND ditutup_pada IS NULL',
      [req.user.id],
    );
    const shiftId = shiftRows[0]?.id ?? null;

    // Bon: pelanggan dicari dari nama (tanpa beda huruf besar/kecil), dibuat kalau belum ada.
    let customerId = null;
    if (namaPelanggan) {
      const { rows: cust } = await c.query(
        `INSERT INTO customers (nama) VALUES ($1)
         ON CONFLICT (lower(nama)) DO UPDATE SET nama = customers.nama
         RETURNING id`,
        [namaPelanggan],
      );
      customerId = cust[0].id;
    }

    const { rows: saleRows } = await c.query(
      `INSERT INTO sales (uuid, no_struk, user_id, total, metode_bayar, dibayar, kembalian,
                          status, created_at, synced_at, nama_pelanggan, customer_id, shift_id)
       VALUES ($1, $2, $3, $4, 'tunai', $5, $6, 'selesai', $7, now(), $8, $9, $10) RETURNING id`,
      [uuid, noStruk, req.user.id, total, dibayar, kembalian, when, namaPelanggan, customerId, shiftId],
    );
    const saleId = saleRows[0].id;

    if (bon) {
      const { rows: debt } = await c.query(
        `INSERT INTO debts (tipe, pihak, jumlah, dibayar, keterangan, status, user_id, customer_id, sale_id)
         VALUES ('piutang', $1, $2, $3, $4, 'belum', $5, $6, $7) RETURNING id`,
        [namaPelanggan, total, dibayar, `Bon ${noStruk}`, req.user.id, customerId, saleId],
      );
      if (dibayar > 0) {
        await c.query(
          'INSERT INTO debt_payments (debt_id, jumlah, catatan, user_id) VALUES ($1, $2, $3, $4)',
          [debt[0].id, dibayar, 'DP saat transaksi', req.user.id],
        );
      }
    }

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

    // Kas masuk sebesar uang yang tinggal di laci: total untuk tunai penuh (kembalian
    // keluar lagi, jadi bukan pemasukan), dan DP saja untuk bon — sisanya belum jadi uang.
    await insertCashFlow(c, {
      tanggal: jakartaDate(when),
      tipe: 'masuk',
      kategori: 'penjualan',
      jumlah: bon ? dibayar : total,
      keterangan: `Penjualan ${noStruk}`,
      refType: 'sale',
      refId: saleId,
      userId: req.user.id,
      shiftId,
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

  // Baris kas milik transaksi ini ikut hilang supaya buku kas tetap konsisten —
  // termasuk pelunasan bon yang piutangnya ikut terhapus lewat ON DELETE CASCADE.
  await c.query(
    `DELETE FROM cash_flows WHERE ref_type = 'sale' AND ref_id = ANY($1::bigint[])
        OR (ref_type = 'debt' AND ref_id IN (SELECT id FROM debts WHERE sale_id = ANY($1::bigint[])))`,
    [ids],
  );
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
