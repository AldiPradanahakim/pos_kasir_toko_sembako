/**
 * Backfill buku kas untuk penjualan yang dibuat SEBELUM fitur arus keuangan ada.
 *
 *   npm run backfill:kas
 *
 * Latar masalah: fitur buku kas mulai berlaku pada migrasi `002_fitur_lengkap.sql`.
 * Penjualan yang sudah ada sebelumnya tidak punya baris `cash_flows`, sehingga omzet
 * dan pemasukan kas tidak cocok untuk data lama.
 *
 * Yang dilakukan:
 * - Penjualan `selesai` yang belum punya baris kas `masuk`/`penjualan` dibuatkan satu baris,
 *   sebesar `total`, bertanggal hari Jakarta dari `created_at` (sama seperti alur penjualan baru).
 * - Penjualan `dibatalkan` yang punya baris `masuk` tetapi belum punya baris penyeimbang
 *   `keluar`/`pembatalan` dibuatkan baris penyeimbangnya.
 *
 * Idempotent: hanya MENAMBAH baris yang memang belum ada. Baris `cash_flows` yang sudah ada
 * tidak pernah diubah atau dihapus, jadi aman dijalankan berulang (penjalanan kedua membuat 0).
 *
 * Catatan penting soal penjualan yang dibatalkan: baris `masuk` hanya dibuat untuk penjualan
 * berstatus `selesai`. Penjualan yang dibatalkan sengaja TIDAK diberi baris `masuk`, supaya
 * pemasukan kas dari penjualan tetap sama dengan omzet (omzet juga mengabaikan transaksi
 * `dibatalkan`). Transaksi batal jadi menyumbang 0 — sama seperti netto sepasang baris
 * masuk/keluar pada transaksi baru — dan saldo kasnya tetap benar. Kalau penjualan batal
 * diberi baris `masuk` juga, pemasukan kas akan lebih besar dari omzet sebesar nilai transaksi
 * yang dibatalkan, dan pembaca laporan akan mengira ada penjualan yang tidak tercatat di omzet.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env'), quiet: true });

/** Tanggal YYYY-MM-DD menurut zona Asia/Jakarta. */
const jakartaDate = (d) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);

/**
 * Lengkapi buku kas untuk transaksi lama. Dipakai CLI `npm run backfill:kas` dan tes.
 * Mengembalikan { dibuat, dilewati, masuk, pembatalan }.
 */
export async function runBackfillKas(url, { log = console.log } = {}) {
  // Dipakai agar bentuk barisnya identik dengan alur penjualan/pembatalan yang hidup.
  const { insertCashFlow } = await import('../src/lib.js');

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // Penjualan selesai yang belum punya kas masuk.
    const { rows: perluMasuk } = await client.query(
      `SELECT s.id, s.no_struk, s.uuid, s.total, s.created_at
         FROM sales s
        WHERE s.status = 'selesai'
          AND NOT EXISTS (SELECT 1 FROM cash_flows cf
                           WHERE cf.ref_type = 'sale' AND cf.ref_id = s.id AND cf.tipe = 'masuk')
        ORDER BY s.id`,
    );

    // Penjualan batal yang baris masuknya ada tapi penyeimbangnya belum.
    const { rows: perluPembatalan } = await client.query(
      `SELECT s.id, s.no_struk, s.uuid, s.total, s.created_at
         FROM sales s
        WHERE s.status = 'dibatalkan'
          AND EXISTS (SELECT 1 FROM cash_flows cf
                       WHERE cf.ref_type = 'sale' AND cf.ref_id = s.id AND cf.tipe = 'masuk')
          AND NOT EXISTS (SELECT 1 FROM cash_flows cf
                           WHERE cf.ref_type = 'sale' AND cf.ref_id = s.id
                             AND cf.tipe = 'keluar' AND cf.kategori = 'pembatalan')
        ORDER BY s.id`,
    );

    const { rows: total } = await client.query('SELECT count(*)::int AS n FROM sales');
    const salesTotal = total[0].n;

    await client.query('BEGIN');
    let masuk = 0;
    let pembatalan = 0;
    try {
      for (const s of perluMasuk) {
        await insertCashFlow(client, {
          tanggal: jakartaDate(s.created_at),
          tipe: 'masuk',
          kategori: 'penjualan',
          jumlah: s.total,
          keterangan: `Penjualan ${s.no_struk ?? s.uuid} (backfill)`,
          refType: 'sale',
          refId: s.id,
          userId: null,
        });
        masuk++;
      }

      for (const s of perluPembatalan) {
        // Diberi tanggal penjualannya, bukan hari ini, supaya pasangan masuk/keluar-nya
        // jatuh di periode yang sama dan saling meniadakan di laporan periode itu.
        await insertCashFlow(client, {
          tanggal: jakartaDate(s.created_at),
          tipe: 'keluar',
          kategori: 'pembatalan',
          jumlah: s.total,
          keterangan: `Pembatalan ${s.no_struk ?? s.uuid} (backfill)`,
          refType: 'sale',
          refId: s.id,
          userId: null,
        });
        pembatalan++;
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }

    const dibuat = masuk + pembatalan;
    const dilewati = salesTotal - perluMasuk.length - perluPembatalan.length;

    log(`dibuat: ${dibuat}, dilewati: ${dilewati}`);
    log(`  kas masuk penjualan dibuat : ${masuk}`);
    log(`  kas keluar pembatalan dibuat: ${pembatalan}`);
    log(`  penjualan diperiksa          : ${salesTotal}`);
    log('Baris kas yang sudah ada tidak diubah dan tidak dihapus.');

    return { dibuat, dilewati, masuk, pembatalan };
  } finally {
    await client.end();
  }
}

// --- CLI: node scripts/backfill-kas.js ---
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'BACKFILL GAGAL: DATABASE_URL belum diset.\n' +
      'Berkas backend\\.env belum ada. Buat dulu dengan:  copy .env.example .env',
    );
    process.exit(1);
  }
  runBackfillKas(url).catch((err) => {
    console.error('BACKFILL GAGAL:', err.message);
    process.exitCode = 1;
  });
}
