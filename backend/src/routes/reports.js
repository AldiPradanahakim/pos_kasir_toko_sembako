import express from 'express';
import { q } from '../db.js';
import { requireSuperadmin } from '../auth.js';
import {
  ApiError, dateOrNull, monthStartJakarta, todayJakarta, toStr, limitOf, sendCsv,
} from '../lib.js';

const router = express.Router();

// Omzet hanya untuk superadmin, sama seperti seluruh laporan lain. Penjaganya dipasang
// per rute: penjaga menyeluruh (router.use) di router yang dipasang di /api akan ikut
// memblokir router lain yang dipasang setelahnya, bukan hanya rute di berkas ini.
router.get('/reports/omzet', requireSuperadmin, async (_req, res) => {
  const totalOf = (from, to) => q(
    `SELECT COALESCE(SUM(s.total), 0) AS total, COUNT(DISTINCT s.id) AS transaksi
       FROM sales s
      WHERE ${NOT_CANCELLED} AND ${DAY} BETWEEN $1 AND $2`,
    [from, to],
  );
  const hariIni = todayJakarta();
  const [hari, bulan, tahun, items] = await Promise.all([
    totalOf(hariIni, hariIni),
    totalOf(monthStartJakarta(), hariIni),
    totalOf(`${hariIni.slice(0, 4)}-01-01`, hariIni),
    q(
      `SELECT COALESCE(SUM(si.qty), 0) AS n
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE ${NOT_CANCELLED} AND ${DAY} = $1`,
      [hariIni],
    ),
  ]);

  const pick = (r) => ({ total: Number(r.rows[0].total), transaksi: Number(r.rows[0].transaksi) });
  res.json({
    hari_ini: pick(hari),
    bulan_ini: pick(bulan),
    tahun_ini: pick(tahun),
    hari_ini_items: Number(items.rows[0].n),
  });
});


// Semua laporan mengabaikan transaksi berstatus 'dibatalkan'.
const NOT_CANCELLED = "s.status = 'selesai'";

function range(req) {
  return {
    from: dateOrNull(req.query.from) ?? monthStartJakarta(),
    to: dateOrNull(req.query.to) ?? todayJakarta(),
  };
}

const DAY = "(s.created_at AT TIME ZONE 'Asia/Jakarta')::date";

router.get('/reports/daily', requireSuperadmin, async (req, res) => {
  const date = dateOrNull(req.query.date) ?? todayJakarta();

  const { rows } = await q(
    `SELECT COUNT(DISTINCT s.id) AS transactions,
            COALESCE(SUM(s.total), 0) AS total
       FROM sales s
      WHERE ${NOT_CANCELLED} AND ${DAY} = $1`,
    [date],
  );
  const { rows: itemRows } = await q(
    `SELECT COALESCE(SUM(si.qty), 0) AS items_count
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE ${NOT_CANCELLED} AND ${DAY} = $1`,
    [date],
  );

  res.json({
    date,
    transactions: Number(rows[0].transactions),
    total: Number(rows[0].total),
    items_count: Number(itemRows[0].items_count),
  });
});

router.get('/reports/sales', requireSuperadmin, async (req, res) => {
  const { from, to } = range(req);
  const { rows } = await q(
    `SELECT to_char(${DAY}, 'YYYY-MM-DD') AS date,
            COUNT(*) AS transactions, COALESCE(SUM(s.total), 0) AS total
       FROM sales s
      WHERE ${NOT_CANCELLED} AND ${DAY} BETWEEN $1 AND $2
      GROUP BY 1 ORDER BY 1`,
    [from, to],
  );
  res.json({
    from,
    to,
    total: rows.reduce((a, r) => a + Number(r.total), 0),
    rows: rows.map((r) => ({ date: r.date, transactions: Number(r.transactions), total: Number(r.total) })),
  });
});

// Laba kotor = SUM((harga_snapshot - harga_modal_snapshot) * qty)
router.get('/reports/profit', requireSuperadmin, async (req, res) => {
  const { from, to } = range(req);
  const { rows } = await q(
    `SELECT to_char(${DAY}, 'YYYY-MM-DD') AS date,
            COALESCE(SUM(si.harga_snapshot * si.qty), 0) AS omzet,
            COALESCE(SUM(si.harga_modal_snapshot * si.qty), 0) AS modal,
            COALESCE(SUM((si.harga_snapshot - si.harga_modal_snapshot) * si.qty), 0) AS laba
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE ${NOT_CANCELLED} AND ${DAY} BETWEEN $1 AND $2
      GROUP BY 1 ORDER BY 1`,
    [from, to],
  );
  const totalOmzet = rows.reduce((a, r) => a + Number(r.omzet), 0);
  const totalModal = rows.reduce((a, r) => a + Number(r.modal), 0);
  res.json({
    from,
    to,
    total_omzet: totalOmzet,
    total_modal: totalModal,
    laba_kotor: totalOmzet - totalModal,
    rows: rows.map((r) => ({
      date: r.date,
      omzet: Number(r.omzet),
      modal: Number(r.modal),
      laba: Number(r.laba),
    })),
  });
});

router.get('/reports/price-changes', requireSuperadmin, async (req, res) => {
  const { from, to } = range(req);
  const { rows } = await q(
    `SELECT si.sale_id, s.no_struk, s.created_at, p.name AS product_name, si.unit_name, si.qty,
            si.harga_snapshot, pu.harga_jual AS harga_normal, si.alasan_ubah_harga,
            u.name AS kasir
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN product_units pu ON pu.product_id = si.product_id AND pu.unit_id = si.unit_id
      WHERE si.harga_diubah AND ${NOT_CANCELLED} AND ${DAY} BETWEEN $1 AND $2
      ORDER BY s.created_at DESC, si.id`,
    [from, to],
  );
  res.json(rows);
});

// ---------------------------------------------------------------------------
// Laporan lengkap. Semua memakai rentang yang sama (default: bulan berjalan)
// dan mengabaikan transaksi berstatus 'dibatalkan'.
// ---------------------------------------------------------------------------

/** Ringkasan satu layar: uang masuk, laba, jumlah barang, dan yang paling laku. */
router.get('/reports/umum', requireSuperadmin, async (req, res) => {
  const { from, to } = range(req);

  const [sales, items, purchases, cash, top] = await Promise.all([
    q(
      `SELECT COUNT(DISTINCT s.id) AS transaksi, COALESCE(SUM(s.total), 0) AS omzet,
              COALESCE(SUM(si.harga_modal_snapshot * si.qty), 0) AS modal
         FROM sales s JOIN sale_items si ON si.sale_id = s.id
        WHERE ${NOT_CANCELLED} AND ${DAY} BETWEEN $1 AND $2`,
      [from, to],
    ),
    q(
      `SELECT COALESCE(SUM(si.qty), 0) AS n
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE ${NOT_CANCELLED} AND ${DAY} BETWEEN $1 AND $2`,
      [from, to],
    ),
    q(
      `SELECT COUNT(*) AS transaksi, COALESCE(SUM(total), 0) AS total
         FROM purchases WHERE tanggal BETWEEN $1 AND $2`,
      [from, to],
    ),
    q(
      `SELECT COALESCE(SUM(jumlah) FILTER (WHERE tipe = 'masuk'), 0) AS masuk,
              COALESCE(SUM(jumlah) FILTER (WHERE tipe = 'keluar'), 0) AS keluar
         FROM cash_flows WHERE tanggal BETWEEN $1 AND $2`,
      [from, to],
    ),
    q(
      `SELECT si.product_id, p.name AS product_name, COALESCE(c.name, 'Tanpa kategori') AS category_name,
              SUM(si.qty) AS qty,
              SUM(si.harga_snapshot * si.qty) AS omzet,
              SUM((si.harga_snapshot - si.harga_modal_snapshot) * si.qty) AS laba
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE ${NOT_CANCELLED} AND ${DAY} BETWEEN $1 AND $2
        GROUP BY si.product_id, p.name, c.name
        ORDER BY qty DESC, omzet DESC
        LIMIT 5`,
      [from, to],
    ),
  ]);

  const omzet = Number(sales.rows[0].omzet);
  const modal = Number(sales.rows[0].modal);

  const { rows: saldo } = await q(
    `SELECT COALESCE(SUM(CASE WHEN tipe = 'masuk' THEN jumlah ELSE -jumlah END), 0) AS n
       FROM cash_flows WHERE tanggal <= $1`,
    [to],
  );

  res.json({
    from,
    to,
    omzet,
    modal,
    laba_kotor: omzet - modal,
    jumlah_transaksi: Number(sales.rows[0].transaksi),
    jumlah_item: Number(items.rows[0].n),
    pembelian: Number(purchases.rows[0].total),
    pembelian_transaksi: Number(purchases.rows[0].transaksi),
    pemasukan: Number(cash.rows[0].masuk),
    pengeluaran: Number(cash.rows[0].keluar),
    saldo_kas: Number(saldo[0].n),
    produk_terlaris: top.rows.map((r) => ({
      product_id: r.product_id,
      product_name: r.product_name,
      category_name: r.category_name,
      qty: Number(r.qty),
      omzet: Number(r.omzet),
      laba: Number(r.laba),
    })),
  });
});

/** Semua transaksi baris per baris item — siap diekspor. */
router.get('/reports/transactions', requireSuperadmin, async (req, res) => {
  const { from, to } = range(req);
  const status = toStr(req.query.status);
  if (status && status !== 'selesai' && status !== 'dibatalkan') {
    throw new ApiError(422, "status harus 'selesai' atau 'dibatalkan'");
  }
  const search = toStr(req.query.q);

  const { rows } = await q(
    `SELECT s.id AS sale_id, s.no_struk, to_char(${DAY}, 'YYYY-MM-DD') AS tanggal,
            s.created_at, s.status, s.metode_bayar, s.total, s.dibayar, s.kembalian,
            s.nama_pelanggan, s.alasan_batal, u.name AS kasir,
            si.id AS item_id, si.product_id, p.name AS product_name, si.unit_name, si.qty,
            si.isi_snapshot, si.harga_snapshot, si.harga_modal_snapshot,
            si.harga_snapshot * si.qty AS subtotal,
            (si.harga_snapshot - si.harga_modal_snapshot) * si.qty AS laba,
            si.harga_diubah, si.alasan_ubah_harga
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       JOIN users u ON u.id = s.user_id
      WHERE ${DAY} BETWEEN $1 AND $2
        AND ($3::text IS NULL OR s.status = $3)
        AND ($4::text IS NULL OR s.no_struk ILIKE '%' || $4 || '%'
             OR s.nama_pelanggan ILIKE '%' || $4 || '%')
      ORDER BY s.created_at DESC, s.id DESC, si.id
      LIMIT $5`,
    [from, to, status, search, limitOf(req.query.limit, 1000, 5000)],
  );
  res.json(rows);
});

/** Arus kas harian + rincian per kategori, untuk periode yang diminta. */
async function cashFlowReport(from, to) {
  const { rows } = await q(
    `SELECT to_char(tanggal, 'YYYY-MM-DD') AS tanggal,
            COALESCE(SUM(jumlah) FILTER (WHERE tipe = 'masuk'), 0) AS masuk,
            COALESCE(SUM(jumlah) FILTER (WHERE tipe = 'keluar'), 0) AS keluar
       FROM cash_flows WHERE tanggal BETWEEN $1 AND $2
      GROUP BY 1 ORDER BY 1`,
    [from, to],
  );
  const { rows: opening } = await q(
    `SELECT COALESCE(SUM(CASE WHEN tipe = 'masuk' THEN jumlah ELSE -jumlah END), 0) AS n
       FROM cash_flows WHERE tanggal < $1`,
    [from],
  );
  const { rows: byKategori } = await q(
    `SELECT kategori, tipe, COALESCE(SUM(jumlah), 0) AS total, COUNT(*) AS baris
       FROM cash_flows WHERE tanggal BETWEEN $1 AND $2
      GROUP BY kategori, tipe ORDER BY total DESC, kategori`,
    [from, to],
  );

  let saldo = Number(opening[0].n);
  const saldoAwal = saldo;
  const daily = rows.map((r) => {
    saldo += Number(r.masuk) - Number(r.keluar);
    return { tanggal: r.tanggal, masuk: Number(r.masuk), keluar: Number(r.keluar), saldo };
  });

  return {
    from,
    to,
    saldo_awal: saldoAwal,
    saldo_akhir: saldo,
    total_masuk: daily.reduce((a, r) => a + r.masuk, 0),
    total_keluar: daily.reduce((a, r) => a + r.keluar, 0),
    rows: daily,
    by_kategori: byKategori.map((r) => ({
      kategori: r.kategori, tipe: r.tipe, total: Number(r.total), baris: Number(r.baris),
    })),
  };
}

router.get('/reports/cash-flow', requireSuperadmin, async (req, res) => {
  const { from, to } = range(req);
  res.json(await cashFlowReport(from, to));
});

// Satu tabel persegi supaya rapi dibuka di Excel: kolom `Bagian` memisahkan baris
// harian, baris TOTAL, dan rincian per kategori. Sebelumnya rincian kategori ditumpuk
// di bawah tajuk yang berbeda, sehingga Excel membacanya sebagai data nyasar.
router.get('/reports/cash-flow.csv', requireSuperadmin, async (req, res) => {
  const { from, to } = range(req);
  const r = await cashFlowReport(from, to);
  const rows = [['Saldo Awal', '', '', '', '', r.saldo_awal, '']];
  for (const d of r.rows) rows.push(['Harian', d.tanggal, '', d.masuk, d.keluar, d.saldo, '']);
  rows.push(['TOTAL', '', '', r.total_masuk, r.total_keluar, r.saldo_akhir, '']);
  for (const k of r.by_kategori) {
    rows.push([
      'Kategori', '', k.kategori,
      k.tipe === 'masuk' ? k.total : '', k.tipe === 'keluar' ? k.total : '', '', k.baris,
    ]);
  }
  sendCsv(
    res,
    `arus-kas-${from}-${to}.csv`,
    ['Bagian', 'Tanggal', 'Kategori', 'Masuk', 'Keluar', 'Saldo', 'Baris'],
    rows,
  );
});

/** Penjualan per kategori: qty, omzet, dan laba. */
router.get('/reports/sales-by-category', requireSuperadmin, async (req, res) => {
  const { from, to } = range(req);
  const { rows } = await q(
    `SELECT COALESCE(c.name, 'Tanpa kategori') AS category_name, c.id AS category_id,
            COALESCE(SUM(si.qty), 0) AS qty,
            COALESCE(SUM(si.harga_snapshot * si.qty), 0) AS omzet,
            COALESCE(SUM(si.harga_modal_snapshot * si.qty), 0) AS modal,
            COALESCE(SUM((si.harga_snapshot - si.harga_modal_snapshot) * si.qty), 0) AS laba
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${NOT_CANCELLED} AND ${DAY} BETWEEN $1 AND $2
      GROUP BY c.id, c.name
      ORDER BY omzet DESC, category_name`,
    [from, to],
  );

  const out = rows.map((r) => ({
    category_id: r.category_id,
    category_name: r.category_name,
    qty: Number(r.qty),
    omzet: Number(r.omzet),
    modal: Number(r.modal),
    laba: Number(r.laba),
  }));
  res.json({
    from,
    to,
    total_omzet: out.reduce((a, r) => a + r.omzet, 0),
    total_laba: out.reduce((a, r) => a + r.laba, 0),
    rows: out,
  });
});

/**
 * Pembelian per supplier dan per produk pada periode — **berbasis qty**, bukan uang.
 *
 * Sejak pembelian tidak lagi memakai harga, angka utamanya adalah `qty` (jumlah satuan
 * yang dibeli) dan `qty_base` (jumlah dalam base_unit). `total` dipertahankan supaya
 * klien lama tidak pecah; untuk pembelian baru nilainya selalu 0, dan hanya pembelian
 * warisan (sebelum migrasi 003) yang masih menyumbang.
 */
router.get('/reports/purchases', requireSuperadmin, async (req, res) => {
  const { from, to } = range(req);

  // Satu baris per pembelian, supaya `total` (per dokumen) tidak tergandakan oleh
  // banyaknya item saat dijumlahkan per supplier.
  const PER_PURCHASE = `
    SELECT pu.id, pu.supplier, pu.total,
           COALESCE(SUM(pi.qty), 0) AS qty,
           COALESCE(SUM(pi.isi_snapshot * pi.qty), 0) AS qty_base
      FROM purchases pu
      LEFT JOIN purchase_items pi ON pi.purchase_id = pu.id
     WHERE pu.tanggal BETWEEN $1 AND $2
     GROUP BY pu.id`;

  const [bySupplier, byProduct, totals] = await Promise.all([
    q(
      `WITH per_purchase AS (${PER_PURCHASE})
       SELECT COALESCE(NULLIF(supplier, ''), 'Tanpa supplier') AS supplier,
              COUNT(*) AS transaksi,
              COALESCE(SUM(qty), 0) AS qty,
              COALESCE(SUM(qty_base), 0) AS qty_base,
              COALESCE(SUM(total), 0) AS total
         FROM per_purchase
        GROUP BY 1 ORDER BY qty_base DESC, supplier`,
      [from, to],
    ),
    q(
      `SELECT pi.product_id, p.name AS product_name,
              COALESCE(SUM(pi.qty), 0) AS qty,
              COALESCE(SUM(pi.isi_snapshot * pi.qty), 0) AS qty_base,
              COALESCE(SUM(pi.subtotal), 0) AS total
         FROM purchase_items pi
         JOIN purchases pu ON pu.id = pi.purchase_id
         JOIN products p ON p.id = pi.product_id
        WHERE pu.tanggal BETWEEN $1 AND $2
        GROUP BY pi.product_id, p.name
        ORDER BY qty_base DESC, p.name`,
      [from, to],
    ),
    q(
      `WITH per_purchase AS (${PER_PURCHASE})
       SELECT COUNT(*) AS transaksi,
              COALESCE(SUM(qty), 0) AS qty,
              COALESCE(SUM(qty_base), 0) AS qty_base,
              COALESCE(SUM(total), 0) AS total
         FROM per_purchase`,
      [from, to],
    ),
  ]);

  res.json({
    from,
    to,
    qty: Number(totals.rows[0].qty),
    qty_base: Number(totals.rows[0].qty_base),
    jumlah_transaksi: Number(totals.rows[0].transaksi),
    total: Number(totals.rows[0].total),
    by_supplier: bySupplier.rows.map((r) => ({
      supplier: r.supplier,
      transaksi: Number(r.transaksi),
      qty: Number(r.qty),
      qty_base: Number(r.qty_base),
      total: Number(r.total),
    })),
    by_product: byProduct.rows.map((r) => ({
      product_id: r.product_id,
      product_name: r.product_name,
      qty: Number(r.qty),
      qty_base: Number(r.qty_base),
      total: Number(r.total),
    })),
  });
});

/**
 * Nilai modal. `modal_tersimpan` = nilai stok yang ada sekarang menurut harga modal
 * per base_unit; harga per base_unit diambil dari satuan dengan isi TERKECIL supaya
 * pembulatannya paling kecil (biasanya satuan pcs isi 1, yang harganya persis).
 */
router.get('/reports/modal', requireSuperadmin, async (req, res) => {
  const { from, to } = range(req);

  const [stored, sold] = await Promise.all([
    q(
      `WITH per_base AS (
         SELECT DISTINCT ON (product_id) product_id, harga_modal, isi
           FROM product_units ORDER BY product_id, isi ASC, id ASC
       ), stok AS (
         SELECT product_id, COALESCE(SUM(qty_base), 0) AS stok_base
           FROM stock_movements GROUP BY product_id
       )
       SELECT COALESCE(SUM(ROUND(stok.stok_base * pb.harga_modal::numeric / pb.isi)), 0) AS modal,
              COUNT(*) AS produk
         FROM stok JOIN per_base pb ON pb.product_id = stok.product_id
        WHERE stok.stok_base > 0`,
      [],
    ),
    q(
      `SELECT COALESCE(SUM(si.harga_modal_snapshot * si.qty), 0) AS modal,
              COALESCE(SUM(si.harga_snapshot * si.qty), 0) AS omzet
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE ${NOT_CANCELLED} AND ${DAY} BETWEEN $1 AND $2`,
      [from, to],
    ),
  ]);

  res.json({
    from,
    to,
    modal_tersimpan: Number(stored.rows[0].modal),
    produk_bersaldo: Number(stored.rows[0].produk),
    modal_terjual: Number(sold.rows[0].modal),
    omzet_periode: Number(sold.rows[0].omzet),
  });
});

/** Hutang & piutang + ringkasan yang belum lunas. */
router.get('/reports/debts', requireSuperadmin, async (req, res) => {
  const tipe = toStr(req.query.tipe);
  const status = toStr(req.query.status);
  if (tipe && tipe !== 'utang' && tipe !== 'piutang') throw new ApiError(422, "tipe harus 'utang' atau 'piutang'");
  if (status && status !== 'belum' && status !== 'lunas') {
    throw new ApiError(422, "status harus 'belum' atau 'lunas'");
  }

  const { rows } = await q(
    `SELECT d.id, d.tipe, d.pihak, d.jumlah, d.dibayar, d.jumlah - d.dibayar AS sisa,
            to_char(d.jatuh_tempo, 'YYYY-MM-DD') AS jatuh_tempo, d.keterangan, d.status,
            d.created_at, u.name AS user_name
       FROM debts d LEFT JOIN users u ON u.id = d.user_id
      WHERE ($1::text IS NULL OR d.tipe = $1)
        AND ($2::text IS NULL OR d.status = $2)
      ORDER BY d.status, d.created_at DESC, d.id DESC`,
    [tipe, status],
  );

  const { rows: sum } = await q(
    `SELECT COALESCE(SUM(jumlah) FILTER (WHERE tipe = 'utang' AND status = 'belum'), 0) AS utang_belum,
            COALESCE(SUM(jumlah - dibayar) FILTER (WHERE tipe = 'utang' AND status = 'belum'), 0) AS utang_sisa,
            COALESCE(SUM(jumlah) FILTER (WHERE tipe = 'piutang' AND status = 'belum'), 0) AS piutang_belum,
            COALESCE(SUM(jumlah - dibayar) FILTER (WHERE tipe = 'piutang' AND status = 'belum'), 0) AS piutang_sisa
       FROM debts`,
    [],
  );

  res.json({
    ringkasan: {
      utang_belum: Number(sum[0].utang_belum),
      utang_sisa: Number(sum[0].utang_sisa),
      piutang_belum: Number(sum[0].piutang_belum),
      piutang_sisa: Number(sum[0].piutang_sisa),
    },
    rows,
  });
});

/**
 * Laba rugi sederhana.
 *
 * `pengeluaran_operasional` = kas keluar selain pembelian dan pembatalan.
 * Pembatalan sengaja TIDAK dihitung: transaksi yang dibatalkan sudah dikeluarkan dari
 * omzet (status != 'selesai'), jadi mengurangi uangnya lagi akan menghitung dua kali.
 */
router.get('/reports/profit-loss', requireSuperadmin, async (req, res) => {
  const { from, to } = range(req);

  const [sales, cash] = await Promise.all([
    q(
      `SELECT COALESCE(SUM(si.harga_snapshot * si.qty), 0) AS omzet,
              COALESCE(SUM(si.harga_modal_snapshot * si.qty), 0) AS hpp
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE ${NOT_CANCELLED} AND ${DAY} BETWEEN $1 AND $2`,
      [from, to],
    ),
    q(
      `SELECT COALESCE(SUM(jumlah) FILTER (WHERE tipe = 'keluar'
                AND kategori NOT IN ('pembelian', 'pembatalan')), 0) AS operasional,
              COALESCE(SUM(jumlah) FILTER (WHERE tipe = 'keluar' AND kategori = 'pembatalan'), 0) AS pembatalan,
              COALESCE(SUM(jumlah) FILTER (WHERE tipe = 'keluar' AND kategori = 'pembelian'), 0) AS pembelian,
              COALESCE(SUM(jumlah) FILTER (WHERE tipe = 'masuk' AND kategori NOT IN ('penjualan')), 0) AS lain_masuk
         FROM cash_flows WHERE tanggal BETWEEN $1 AND $2`,
      [from, to],
    ),
  ]);

  const omzet = Number(sales.rows[0].omzet);
  const hpp = Number(sales.rows[0].hpp);
  const operasional = Number(cash.rows[0].operasional);

  res.json({
    from,
    to,
    omzet,
    hpp,
    laba_kotor: omzet - hpp,
    pengeluaran_operasional: operasional,
    pembelian: Number(cash.rows[0].pembelian),
    pembatalan: Number(cash.rows[0].pembatalan),
    pemasukan_lain: Number(cash.rows[0].lain_masuk),
    laba_bersih: omzet - hpp - operasional,
  });
});

/** Retur penjualan & pembelian pada periode. */
router.get('/reports/returns', requireSuperadmin, async (req, res) => {
  const { from, to } = range(req);

  const [list, sum] = await Promise.all([
    q(
      `SELECT r.id, r.tipe, r.ref_id, r.product_id, p.name AS product_name, r.unit_id, r.qty,
              r.jumlah, r.alasan, r.created_at, u.name AS user_name
         FROM returns r
         JOIN products p ON p.id = r.product_id
         LEFT JOIN users u ON u.id = r.user_id
        WHERE (r.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1 AND $2
        ORDER BY r.created_at DESC, r.id DESC`,
      [from, to],
    ),
    q(
      `SELECT r.tipe, COUNT(*) AS baris, COALESCE(SUM(r.qty), 0) AS qty, COALESCE(SUM(r.jumlah), 0) AS jumlah
         FROM returns r
        WHERE (r.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1 AND $2
        GROUP BY r.tipe`,
      [from, to],
    ),
  ]);

  const of = (tipe) => sum.rows.find((r) => r.tipe === tipe);
  const ringkas = (tipe) => ({
    baris: Number(of(tipe)?.baris ?? 0),
    qty: Number(of(tipe)?.qty ?? 0),
    jumlah: Number(of(tipe)?.jumlah ?? 0),
  });

  res.json({
    from,
    to,
    penjualan: ringkas('penjualan'),
    pembelian: ringkas('pembelian'),
    rows: list.rows,
  });
});

/**
 * Arus stok per produk. `masuk`/`keluar`/`penyesuaian`/`pembatalan` dihitung dari
 * movement DI DALAM periode, sedangkan `saldo_akhir` adalah stok sampai akhir periode.
 * `saldo_akhir` diambil dari seluruh riwayat, bukan hanya periode ini, karena stok
 * adalah akumulasi — saldo yang dihitung per periode akan selalu salah.
 */
async function stockFlowReport(from, to) {
  const { rows } = await q(
    `SELECT p.id AS product_id, p.name AS product_name, p.base_unit,
            COALESCE(c.name, 'Tanpa kategori') AS category_name,
            COALESCE(SUM(sm.qty_base) FILTER (WHERE sm.type = 'masuk'), 0) AS masuk,
            COALESCE(-SUM(sm.qty_base) FILTER (WHERE sm.type = 'keluar'), 0) AS keluar,
            COALESCE(SUM(sm.qty_base) FILTER (WHERE sm.type = 'penyesuaian'), 0) AS penyesuaian,
            COALESCE(SUM(sm.qty_base) FILTER (WHERE sm.type = 'pembatalan'), 0) AS pembatalan,
            (SELECT COALESCE(SUM(sm2.qty_base), 0) FROM stock_movements sm2
              WHERE sm2.product_id = p.id
                AND (sm2.created_at AT TIME ZONE 'Asia/Jakarta')::date <= $2) AS saldo_akhir
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN stock_movements sm ON sm.product_id = p.id
            AND (sm.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1 AND $2
      GROUP BY p.id, p.name, p.base_unit, c.name
      ORDER BY p.name`,
    [from, to],
  );

  return rows.map((r) => ({
    product_id: r.product_id,
    product_name: r.product_name,
    category_name: r.category_name,
    base_unit: r.base_unit,
    masuk: Number(r.masuk),
    keluar: Number(r.keluar),
    penyesuaian: Number(r.penyesuaian),
    pembatalan: Number(r.pembatalan),
    saldo_akhir: Number(r.saldo_akhir),
  }));
}

router.get('/reports/stock-flow', requireSuperadmin, async (req, res) => {
  const { from, to } = range(req);
  res.json({ from, to, rows: await stockFlowReport(from, to) });
});

router.get('/reports/stock-flow.csv', requireSuperadmin, async (req, res) => {
  const { from, to } = range(req);
  const data = await stockFlowReport(from, to);
  const jumlah = (k) => data.reduce((a, r) => a + r[k], 0);
  // `product_id` sengaja tidak ikut: kolom teknis bikin laporan sulit dibaca pemilik.
  const rows = data.map((r) => [
    r.product_name, r.category_name, r.base_unit,
    r.masuk, r.keluar, r.penyesuaian, r.pembatalan, r.saldo_akhir,
  ]);
  rows.push([
    'TOTAL', '', '',
    jumlah('masuk'), jumlah('keluar'), jumlah('penyesuaian'), jumlah('pembatalan'), jumlah('saldo_akhir'),
  ]);
  sendCsv(
    res,
    `arus-stok-${from}-${to}.csv`,
    ['Produk', 'Kategori', 'Satuan Dasar', 'Masuk', 'Keluar', 'Penyesuaian', 'Pembatalan', 'Saldo Akhir'],
    rows,
  );
});

export default router;
