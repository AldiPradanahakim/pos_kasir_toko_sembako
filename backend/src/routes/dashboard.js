import express from 'express';
import { q } from '../db.js';
import { requireSuperadmin } from '../auth.js';
import {
  dateOrNull, monthStartJakarta, todayJakarta, toInt, displayStock, satuanHitungOf, sendCsv,
} from '../lib.js';

const router = express.Router();

// Basis angka disamakan dengan routes/reports.js: omzet dari `sales.total`, laba kotor
// dari `sale_items`, dan transaksi berstatus 'dibatalkan' selalu diabaikan.
const NOT_CANCELLED = "s.status = 'selesai'";
const DAY = "(s.created_at AT TIME ZONE 'Asia/Jakarta')::date";

/**
 * Rentang laporan, default bulan berjalan — sama persis dengan `range()` di reports.js.
 * Disalin, bukan diekspor dari reports.js: NOT_CANCELLED & DAY tetap harus disalin
 * (keduanya tidak diekspor), jadi impor lintas-router hanya menambah kopling tanpa
 * menghapus duplikasi. Rumah yang benar untuk helper ini adalah lib.js.
 */
function range(req) {
  return {
    from: dateOrNull(req.query.from) ?? monthStartJakarta(),
    to: dateOrNull(req.query.to) ?? todayJakarta(),
  };
}

// ---------------------------------------------------------------------------
// Utilitas kecil
// ---------------------------------------------------------------------------

/** Tanggal YYYY-MM-DD, `n` hari sebelum `date`. */
const dayBefore = (date, n) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

/** Semua tanggal YYYY-MM-DD dari `from` sampai `to`, inklusif (dipakai mengisi celah). */
function datesBetween(from, to) {
  const out = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round2 = (n) => Math.round(n * 100) / 100;

/** Angka gaya Indonesia: koma untuk desimal, titik untuk ribuan. */
const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// Kueri dashboard
// ---------------------------------------------------------------------------

/**
 * Ringkasan penjualan satu rentang. Omzet & jumlah transaksi diambil dari `sales`
 * (bukan dari sale_items, supaya `s.total` tidak tergandakan jumlah item), sedangkan
 * laba kotor & qty item dari sale_items. Basisnya sama dengan /reports/omzet.
 */
async function salesSummary(from, to) {
  const [sales, items] = await Promise.all([
    q(
      `SELECT COUNT(*) AS transaksi, COALESCE(SUM(s.total), 0) AS omzet
         FROM sales s
        WHERE ${NOT_CANCELLED} AND ${DAY} BETWEEN $1 AND $2`,
      [from, to],
    ),
    q(
      `SELECT COALESCE(SUM(si.qty), 0) AS jumlah_item,
              COALESCE(SUM((si.harga_snapshot - si.harga_modal_snapshot) * si.qty), 0) AS laba_kotor
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE ${NOT_CANCELLED} AND ${DAY} BETWEEN $1 AND $2`,
      [from, to],
    ),
  ]);
  return {
    omzet: Number(sales.rows[0].omzet),
    transaksi: Number(sales.rows[0].transaksi),
    laba_kotor: Number(items.rows[0].laba_kotor),
    jumlah_item: Number(items.rows[0].jumlah_item),
  };
}

/** Omzet/transaksi/laba per tanggal; tanggal tanpa transaksi tetap muncul bernilai 0. */
async function dailyRows(from, to) {
  const [sales, laba] = await Promise.all([
    q(
      `SELECT to_char(${DAY}, 'YYYY-MM-DD') AS tanggal,
              COUNT(*) AS transaksi, COALESCE(SUM(s.total), 0) AS omzet
         FROM sales s
        WHERE ${NOT_CANCELLED} AND ${DAY} BETWEEN $1 AND $2
        GROUP BY 1`,
      [from, to],
    ),
    q(
      `SELECT to_char(${DAY}, 'YYYY-MM-DD') AS tanggal,
              COALESCE(SUM((si.harga_snapshot - si.harga_modal_snapshot) * si.qty), 0) AS laba
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE ${NOT_CANCELLED} AND ${DAY} BETWEEN $1 AND $2
        GROUP BY 1`,
      [from, to],
    ),
  ]);

  const omzet = new Map(sales.rows.map((r) => [r.tanggal, r]));
  const labaPer = new Map(laba.rows.map((r) => [r.tanggal, r.laba]));
  // Celah diisi di JS: laporan hanya beberapa bulan, jadi menyusun tanggalnya sendiri
  // lebih sederhana daripada generate_series + LEFT JOIN.
  return datesBetween(from, to).map((tanggal) => {
    const s = omzet.get(tanggal);
    return {
      tanggal,
      omzet: Number(s?.omzet ?? 0),
      transaksi: Number(s?.transaksi ?? 0),
      laba: Number(labaPer.get(tanggal) ?? 0),
    };
  });
}

/** 10 produk terlaris per qty dalam rentang. */
async function topProducts(from, to) {
  const { rows } = await q(
    `SELECT si.product_id, p.name AS nama, SUM(si.qty) AS qty,
            SUM(si.harga_snapshot * si.qty) AS omzet
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
      WHERE ${NOT_CANCELLED} AND ${DAY} BETWEEN $1 AND $2
      GROUP BY si.product_id, p.name
      ORDER BY qty DESC, omzet DESC
      LIMIT 10`,
    [from, to],
  );
  return rows.map((r) => ({
    product_id: r.product_id, nama: r.nama, qty: Number(r.qty), omzet: Number(r.omzet),
  }));
}

/**
 * Produk berstok <= 0 (paling minus dulu). Satuan ikut dikirim supaya `display` bisa
 * memakai displayStock() — formatnya jadi sama dengan halaman stok.
 */
async function lowStock() {
  const { rows } = await q(
    `WITH stok AS (
       SELECT product_id, COALESCE(SUM(qty_base), 0) AS stok_base
         FROM stock_movements GROUP BY product_id
     )
     SELECT p.id AS product_id, p.name AS nama, p.base_unit, p.izin_minus,
            COALESCE(st.stok_base, 0) AS stok_base,
            COALESCE((SELECT json_agg(json_build_object('isi', pu.isi, 'unit_name', u.name)
                                      ORDER BY pu.isi DESC, u.name)
                        FROM product_units pu JOIN units u ON u.id = pu.unit_id
                       WHERE pu.product_id = p.id), '[]') AS units
       FROM products p
       LEFT JOIN stok st ON st.product_id = p.id
      WHERE COALESCE(st.stok_base, 0) <= 0
      ORDER BY COALESCE(st.stok_base, 0) ASC, p.name
      LIMIT 20`,
    [],
  );
  return rows.map((r) => {
    const stok = Number(r.stok_base);
    return {
      product_id: r.product_id,
      nama: r.nama,
      stok_base: stok,
      display: displayStock(stok, r.base_unit, r.units),
      izin_minus: r.izin_minus,
    };
  });
}

/**
 * Nilai stok yang ada sekarang, menurut harga modal & harga jual. Harga per base_unit
 * diambil dari satuan berisi TERKECIL (pembulatannya paling kecil) — sama seperti
 * /reports/modal, hanya ditambah sisi harga jual.
 */
async function stockValue() {
  const { rows } = await q(
    `WITH per_base AS (
       SELECT DISTINCT ON (product_id) product_id, harga_modal, harga_jual, isi
         FROM product_units ORDER BY product_id, isi ASC, id ASC
     ), stok AS (
       SELECT product_id, COALESCE(SUM(qty_base), 0) AS stok_base
         FROM stock_movements GROUP BY product_id
     )
     SELECT COALESCE(SUM(ROUND(stok.stok_base * pb.harga_modal::numeric / pb.isi)), 0) AS modal,
            COALESCE(SUM(ROUND(stok.stok_base * pb.harga_jual::numeric / pb.isi)), 0) AS jual
       FROM stok JOIN per_base pb ON pb.product_id = stok.product_id
      WHERE stok.stok_base > 0`,
    [],
  );
  return { modal: Number(rows[0].modal), jual: Number(rows[0].jual) };
}

/**
 * Kas pada rentang. `masuk`/`keluar` hanya pergerakan DI DALAM rentang, sedangkan
 * `saldo` adalah saldo berjalan sampai akhir rentang — definisi yang sama dengan
 * /reports/cash-flow supaya angkanya nyambung. `pengeluaran_operasional` memakai
 * pemisahan persis /reports/profit-loss: kas keluar selain pembelian & pembatalan.
 */
async function cashSummary(from, to) {
  const [flows, saldo] = await Promise.all([
    q(
      `SELECT COALESCE(SUM(jumlah) FILTER (WHERE tipe = 'masuk'), 0) AS masuk,
              COALESCE(SUM(jumlah) FILTER (WHERE tipe = 'keluar'), 0) AS keluar,
              COALESCE(SUM(jumlah) FILTER (WHERE tipe = 'keluar'
                        AND kategori NOT IN ('pembelian', 'pembatalan')), 0) AS operasional
         FROM cash_flows WHERE tanggal BETWEEN $1 AND $2`,
      [from, to],
    ),
    q(
      `SELECT COALESCE(SUM(CASE WHEN tipe = 'masuk' THEN jumlah ELSE -jumlah END), 0) AS saldo
         FROM cash_flows WHERE tanggal <= $1`,
      [to],
    ),
  ]);
  return {
    masuk: Number(flows.rows[0].masuk),
    keluar: Number(flows.rows[0].keluar),
    saldo: Number(saldo.rows[0].saldo),
    operasional: Number(flows.rows[0].operasional),
  };
}

/**
 * Hutang & piutang. Yang dilaporkan adalah SISA yang masih harus dibayar
 * (`jumlah - dibayar`), bukan nilai awal hutangnya — sama seperti `*_sisa` di
 * ringkasan /reports/debts. Tanpa rentang tanggal: yang belum lunas tetap belum lunas.
 */
async function debtSummary() {
  const { rows } = await q(
    `SELECT COALESCE(SUM(jumlah - dibayar) FILTER (WHERE tipe = 'piutang' AND status = 'belum'), 0)
              AS piutang_belum_lunas,
            COALESCE(SUM(jumlah - dibayar) FILTER (WHERE tipe = 'utang' AND status = 'belum'), 0)
              AS utang_belum_lunas
       FROM debts`,
    [],
  );
  return {
    piutang_belum_lunas: Number(rows[0].piutang_belum_lunas),
    utang_belum_lunas: Number(rows[0].utang_belum_lunas),
  };
}

/** Omzet & laba per kategori produk dalam rentang. */
async function byCategory(from, to) {
  const { rows } = await q(
    `SELECT COALESCE(c.name, 'Tanpa kategori') AS kategori,
            COALESCE(SUM(si.harga_snapshot * si.qty), 0) AS omzet,
            COALESCE(SUM((si.harga_snapshot - si.harga_modal_snapshot) * si.qty), 0) AS laba
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${NOT_CANCELLED} AND ${DAY} BETWEEN $1 AND $2
      GROUP BY c.id, c.name
      ORDER BY omzet DESC, kategori`,
    [from, to],
  );
  return rows.map((r) => ({ kategori: r.kategori, omzet: Number(r.omzet), laba: Number(r.laba) }));
}

/** Jumlah transaksi & omzet per kasir dalam rentang. */
async function byCashier(from, to) {
  const { rows } = await q(
    `SELECT u.name AS kasir, COUNT(*) AS transaksi, COALESCE(SUM(s.total), 0) AS omzet
       FROM sales s JOIN users u ON u.id = s.user_id
      WHERE ${NOT_CANCELLED} AND ${DAY} BETWEEN $1 AND $2
      GROUP BY u.id, u.name
      ORDER BY omzet DESC, kasir`,
    [from, to],
  );
  return rows.map((r) => ({ kasir: r.kasir, transaksi: Number(r.transaksi), omzet: Number(r.omzet) }));
}

/** Satu layar dashboard: hari ini, ringkasan rentang, dan rinciannya. */
router.get('/reports/dashboard', requireSuperadmin, async (req, res) => {
  const { from, to } = range(req);
  const hariIni = todayJakarta();

  const [hari, ringkas, harian, terlaris, menipis, nilai, kas, hutang, kategori, kasir] =
    await Promise.all([
      salesSummary(hariIni, hariIni),
      salesSummary(from, to),
      dailyRows(from, to),
      topProducts(from, to),
      lowStock(),
      stockValue(),
      cashSummary(from, to),
      debtSummary(),
      byCategory(from, to),
      byCashier(from, to),
    ]);

  res.json({
    from,
    to,
    hari_ini: {
      omzet: hari.omzet,
      transaksi: hari.transaksi,
      laba_kotor: hari.laba_kotor,
    },
    ringkasan: {
      omzet: ringkas.omzet,
      transaksi: ringkas.transaksi,
      laba_kotor: ringkas.laba_kotor,
      pengeluaran: kas.operasional,
      laba_bersih: ringkas.laba_kotor - kas.operasional,
      jumlah_item: ringkas.jumlah_item,
    },
    harian,
    terlaris,
    stok_menipis: menipis,
    nilai_stok: nilai,
    kas: { masuk: kas.masuk, keluar: kas.keluar, saldo: kas.saldo },
    hutang_piutang: hutang,
    per_kategori: kategori,
    per_kasir: kasir,
  });
});

// ---------------------------------------------------------------------------
// Saran pembelian
// ---------------------------------------------------------------------------

/**
 * Saran pembelian: produk yang stoknya tipis dibanding kecepatan jualnya.
 *
 * `terjual` hanya menghitung movement 'keluar' yang ber-referensi penjualan
 * (`reference_type = 'sale'`) dan penjualannya masih 'selesai' — penyesuaian, retur,
 * serta penjualan yang dibatalkan/dihapus tidak ikut. Movement 'keluar' disimpan
 * negatif (lihat routes/sales.js), jadi nilainya dibalik.
 */
async function purchaseSuggestions(hari, ambang, batas = 50) {
  const to = todayJakarta();
  const from = dayBefore(to, hari - 1);

  const { rows } = await q(
    `WITH jual AS (
       SELECT sm.product_id, -SUM(sm.qty_base) AS terjual
         FROM stock_movements sm
         JOIN sales s ON s.id = sm.reference_id
        WHERE sm.type = 'keluar' AND sm.reference_type = 'sale'
          AND ${NOT_CANCELLED}
          AND (sm.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1 AND $2
        GROUP BY sm.product_id
     ), stok AS (
       SELECT product_id, COALESCE(SUM(qty_base), 0) AS stok_base
         FROM stock_movements GROUP BY product_id
     ), kandidat AS (
       SELECT p.id AS product_id, p.name AS nama, p.base_unit, p.base_unit_id,
              COALESCE(st.stok_base, 0) AS stok_base,
              COALESCE(j.terjual, 0) AS terjual,
              COALESCE((SELECT json_agg(json_build_object('unit_id', pu.unit_id, 'isi', pu.isi, 'unit_name', u.name)
                                        ORDER BY pu.isi DESC, u.name)
                          FROM product_units pu JOIN units u ON u.id = pu.unit_id
                         WHERE pu.product_id = p.id), '[]') AS units,
              CASE WHEN COALESCE(j.terjual, 0) > 0
                   THEN ROUND(COALESCE(st.stok_base, 0)::numeric * $3 / j.terjual, 2)
              END AS hari_tersisa
         FROM products p
         LEFT JOIN stok st ON st.product_id = p.id
         LEFT JOIN jual j ON j.product_id = p.id
     )
     SELECT * FROM kandidat
      WHERE (terjual > 0 AND hari_tersisa <= $4) OR stok_base <= 0
      ORDER BY hari_tersisa ASC, stok_base ASC
      LIMIT $5`,
    [from, to, hari, ambang, batas],
  );

  const items = rows.map((r) => {
    const stokBase = Number(r.stok_base);
    const terjual = Number(r.terjual);
    const rata = round2(terjual / hari);
    // Satuan hitung memakai aturan yang SAMA dengan GET /stock (satuanHitungOf): pilihan
    // superadmin dulu, baru satuan isi > 1 terbesar. Kalau dihitung sendiri di sini,
    // saran pembelian dan halaman stok bisa menyebut satuan yang berbeda untuk produk
    // yang sama (mis. "3 dus" di saran, "36 slop" di halaman stok).
    const { hitung, isi } = satuanHitungOf(r.units, r.base_unit_id);
    const satuanHitung = hitung ? hitung.unit_name : r.base_unit;
    // `hari_tersisa` null = belum pernah terjual dalam jendela ini; produk begitu hanya
    // disarankan kalau stoknya sudah minus/0 (kalau tidak, tidak ada yang perlu dibeli).
    const hariTersisa = r.hari_tersisa === null ? null : Number(r.hari_tersisa);
    const saran = Math.max(1, Math.ceil(Math.max(0, rata * ambang - stokBase) / isi));
    const stokDisplay = displayStock(stokBase, r.base_unit, r.units);

    return {
      product_id: r.product_id,
      nama: r.nama,
      stok_base: stokBase,
      stok_display: stokDisplay,
      satuan_hitung: satuanHitung,
      satuan_hitung_isi: isi,
      stok_hitung: round2(stokBase / isi),
      terjual,
      rata_per_hari: rata,
      hari_tersisa: hariTersisa,
      saran_qty: saran,
      alasan: hariTersisa === null
        ? `Belum ada penjualan dalam ${hari} hari terakhir dan stok ${stokBase < 0 ? 'sudah minus' : 'kosong'} (${stokDisplay}).`
        : `Terjual ${nf.format(terjual)} ${r.base_unit} dalam ${hari} hari, sisa ${nf.format(stokBase)} ${r.base_unit} (${nf.format(hariTersisa)} hari lagi).`,
    };
  });

  return items;
}

/** Parameter saran pembelian: hari (1..365) & ambang (1..90), nilai aneh jatuh ke default. */
const suggestionParams = (req) => ({
  hari: clamp(toInt(req.query.hari) ?? 30, 1, 365),
  ambang: clamp(toInt(req.query.ambang) ?? 7, 1, 90),
});

/** Dipakai halaman Pembelian (kasir ikut memakainya), jadi tidak superadmin. */
router.get('/reports/purchase-suggestions', async (req, res) => {
  const { hari, ambang } = suggestionParams(req);
  const items = await purchaseSuggestions(hari, ambang);
  res.json({ hari, ambang, items });
});

// CSV siap dibawa ke supplier. Tanggal di nama berkas = tanggal hari ini (hari Jakarta);
// jendela penjualan yang dianalisis tertulis di tajuk kolom terakhir.
// Batas 50 baris hanya untuk daftar di layar; berkas yang dibawa ke supplier harus UTUH,
// kalau tidak barang yang perlu dibeli diam-diam hilang dari daftar belanja.
router.get('/reports/purchase-suggestions.csv', requireSuperadmin, async (req, res) => {
  const { hari, ambang } = suggestionParams(req);
  const items = await purchaseSuggestions(hari, ambang, 5000);
  sendCsv(
    res,
    `saran-pembelian-${todayJakarta()}.csv`,
    ['Nama Barang', 'Saran', 'Satuan', 'Stok Sekarang', `Terjual (${hari} hari)`],
    items.map((it) => [it.nama, it.saran_qty, it.satuan_hitung, it.stok_display, it.terjual]),
  );
});

export default router;
