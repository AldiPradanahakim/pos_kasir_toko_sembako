/**
 * Regresi migrasi 007: bon/piutang per pelanggan dan buka-tutup kas per shift.
 *
 * Yang diperiksa adalah perilaku yang terlihat pemilik toko: sisa piutang yang benar,
 * uang yang benar-benar masuk buku kas, selisih kas saat tutup shift, dan angka laporan.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDb, seedMaster, createUser, startServer, login, productFixture, closePool, q,
} from './helper.js';

let api;
let token;
let kasir;
let fx;

before(async () => {
  api = await startServer();
});

after(async () => {
  await api.close();
  await closePool();
});

beforeEach(async () => {
  await resetDb();
  await seedMaster();
  await createUser({ name: 'Super Admin', username: 'superadmin', role: 'superadmin' });
  token = await login(api.req, 'superadmin');
  await createUser({ name: 'Kasir Satu', username: 'kasir1', role: 'kasir' });
  kasir = await login(api.req, 'kasir1');
  fx = await productFixture(api.req, token);
  await api.req('POST', '/api/stock/in', {
    token,
    body: { product_id: fx.productId, unit_id: fx.dusId, qty: 10 },
  });
});

const jual = (extra = {}, tok = null) => api.req('POST', '/api/sales', {
  token: tok ?? token,
  body: {
    uuid: crypto.randomUUID(),
    items: [{ product_id: fx.productId, unit_id: fx.dusId, qty: 1 }],
    metode_bayar: 'tunai',
    dibayar: 100_000,
    ...extra,
  },
});

const kasMasuk = async () => {
  const r = await api.req('GET', '/api/cash-flows', { token });
  return r.body.rows.filter((x) => x.tipe === 'masuk');
};

test('bon: sisa jadi piutang pelanggan, kas masuk hanya sebesar uang yang diterima', async () => {
  const r = await jual({ bon: true, nama_pelanggan: 'Bu Ani', dibayar: 40_000 });
  assert.equal(r.status, 201);
  assert.equal(r.body.sale.dibayar, 40_000);
  assert.equal(r.body.sale.kembalian, 0);
  assert.equal(r.body.sale.sisa_piutang, 60_000, 'sisa 100.000 - 40.000 harus jadi piutang');
  assert.ok(r.body.sale.customer_id, 'pelanggan harus tercatat di transaksi');

  const debts = (await api.req('GET', '/api/debts?tipe=piutang', { token })).body;
  assert.equal(debts.length, 1);
  assert.equal(debts[0].pihak, 'Bu Ani');
  assert.equal(debts[0].jumlah, 100_000);
  assert.equal(debts[0].dibayar, 40_000);
  assert.equal(debts[0].sale_id, r.body.sale.id);
  assert.equal(debts[0].no_struk, r.body.sale.no_struk);

  const masuk = await kasMasuk();
  assert.equal(masuk.length, 1);
  assert.equal(masuk[0].jumlah, 40_000, 'kas tidak boleh mencatat uang yang belum diterima');
});

test('bon tanpa nama pelanggan ditolak, dan tunai kurang bayar tetap ditolak', async () => {
  assert.equal((await jual({ bon: true })).status, 422);
  assert.equal((await jual({ bon: true, nama_pelanggan: 'Bu Ani', dibayar: 100_000 })).status, 422,
    'bon hanya untuk pembayaran yang kurang dari total');
  assert.equal((await jual({ dibayar: 50_000 })).status, 422, 'tanpa bon, kurang bayar tetap galat');
});

test('pelunasan cicilan: dibayar bertambah, riwayat tercatat, kas masuk, lunas otomatis', async () => {
  const sale = (await jual({ bon: true, nama_pelanggan: 'Bu Ani', dibayar: 0 })).body.sale;
  const debtId = (await api.req('GET', '/api/debts', { token })).body[0].id;

  const bayar1 = await api.req('POST', `/api/debts/${debtId}/bayar`, { token, body: { jumlah: 30_000 } });
  assert.equal(bayar1.status, 200);
  assert.equal(bayar1.body.dibayar, 30_000);
  assert.equal(bayar1.body.sisa, 70_000);
  assert.equal(bayar1.body.status, 'belum');

  const bayar2 = await api.req('POST', `/api/debts/${debtId}/bayar`, { token, body: { jumlah: 70_000 } });
  assert.equal(bayar2.body.status, 'lunas');
  assert.equal(bayar2.body.sisa, 0);

  // Lebih bayar dan bayar bon yang sudah lunas sama-sama ditolak.
  assert.equal((await api.req('POST', `/api/debts/${debtId}/bayar`, { token, body: { jumlah: 1 } })).status, 422);

  const riwayat = (await api.req('GET', `/api/debts/${debtId}/bayar`, { token })).body;
  assert.deepEqual(riwayat.map((r) => r.jumlah), [30_000, 70_000]);

  const masuk = await kasMasuk();
  assert.equal(masuk.length, 2, 'pelunasan adalah uang masuk');
  assert.equal(masuk.reduce((a, r) => a + r.jumlah, 0), 100_000);
  assert.equal((await api.req('GET', `/api/sales/${sale.id}`, { token })).body.sisa_piutang, 0);
});

test('saldo piutang per pelanggan menjumlahkan bon yang belum lunas', async () => {
  await jual({ bon: true, nama_pelanggan: 'Bu Ani', dibayar: 40_000 });
  await jual({ bon: true, nama_pelanggan: 'Bu Ani', dibayar: 0 });
  await jual({ bon: true, nama_pelanggan: 'Pak Budi', dibayar: 90_000 });

  const r = await api.req('GET', '/api/debts/pelanggan?tipe=piutang', { token });
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.rows.map((x) => [x.nama, x.jumlah_bon, x.sisa]),
    [['Bu Ani', 2, 160_000], ['Pak Budi', 1, 10_000]],
  );
});

test('nama pelanggan yang sama beda huruf besar/kecil tetap satu pelanggan', async () => {
  await jual({ bon: true, nama_pelanggan: 'Bu Ani', dibayar: 0 });
  await jual({ bon: true, nama_pelanggan: 'BU ANI', dibayar: 0 });
  const { rows } = await q('SELECT COUNT(*)::int AS n FROM customers');
  assert.equal(rows[0].n, 1);
  assert.equal((await api.req('GET', '/api/debts/pelanggan', { token })).body.rows[0].jumlah_bon, 2);
});

test('shift: buka kas, penjualan menempel ke shift, tutup kas menghitung selisih', async () => {
  assert.equal((await api.req('GET', '/api/shifts/aktif', { token })).body, null);

  const buka = await api.req('POST', '/api/shifts/buka', { token: kasir, body: { modal_awal: 50_000 } });
  assert.equal(buka.status, 201);
  assert.equal(buka.body.modal_awal, 50_000);
  assert.equal(buka.body.kas_seharusnya, 50_000);

  assert.equal((await api.req('POST', '/api/shifts/buka', { token: kasir, body: { modal_awal: 1 } })).status, 422,
    'dua shift terbuka sekaligus tidak boleh');

  const sale = await jual({}, kasir);
  assert.equal(sale.status, 201);
  assert.equal(sale.body.sale.shift_id, buka.body.id, 'penjualan harus terikat ke shift kasir');

  const aktif = (await api.req('GET', '/api/shifts/aktif', { token: kasir })).body;
  assert.equal(aktif.kas_seharusnya, 150_000, 'modal 50.000 + penjualan 100.000');
  assert.equal(aktif.transaksi, 1);
  assert.equal(aktif.omzet, 100_000);

  // Uang fisik 145.000 => kurang 5.000 dari yang seharusnya.
  const tutup = await api.req('POST', '/api/shifts/tutup', { token: kasir, body: { uang_fisik: 145_000 } });
  assert.equal(tutup.status, 200);
  assert.equal(tutup.body.uang_fisik, 145_000);
  assert.equal(tutup.body.selisih, -5_000);
  assert.equal(tutup.body.transaksi, 1);

  assert.equal((await api.req('GET', '/api/shifts/aktif', { token: kasir })).body, null);
  assert.equal((await api.req('POST', '/api/shifts/tutup', { token: kasir, body: { uang_fisik: 0 } })).status, 422,
    'tutup kas tanpa shift terbuka ditolak');

  const riwayat = (await api.req('GET', '/api/shifts', { token })).body;
  assert.equal(riwayat.length, 1);
  assert.equal(riwayat[0].selisih, -5_000);
  assert.equal(riwayat[0].kasir_name ?? riwayat[0].user_name, 'Kasir Satu');
});

test('tutup kas tidak boleh memakai uang negatif, dan riwayat kas khusus superadmin', async () => {
  const bukaKasir = await api.req('POST', '/api/shifts/buka', { token: kasir, body: { modal_awal: 0 } });
  assert.equal((await api.req('POST', '/api/shifts/tutup', { token: kasir, body: { uang_fisik: -1 } })).status, 422);

  // Riwayat kas adalah laporan pemeriksaan uang lintas kasir: kasir ditolak, bukan disaring.
  // Hasil tutup kasnya sendiri tetap dia terima sekali dari respons `POST /shifts/tutup`.
  assert.equal((await api.req('GET', '/api/shifts', { token: kasir })).status, 403,
    'kasir tidak boleh membuka riwayat kas');

  await api.req('POST', '/api/shifts/buka', { token, body: { modal_awal: 10_000 } });
  await api.req('POST', '/api/shifts/tutup', { token, body: { uang_fisik: 10_000 } });

  const semua = (await api.req('GET', '/api/shifts', { token })).body;
  assert.equal(semua.length, 2, 'superadmin melihat semua shift');
  assert.ok(semua.some((r) => Number(r.id) === Number(bukaKasir.body.id)), 'shift kasir ikut tampil');
});

test('shift tanpa penjualan tetap muncul di riwayat kas dan laporan per kasir', async () => {
  // Persis kasus pemilik: buka 80.000 lalu tutup 100.000 tanpa menjual apa pun.
  await api.req('POST', '/api/shifts/buka', { token: kasir, body: { modal_awal: 80_000 } });
  const tutup = await api.req('POST', '/api/shifts/tutup', { token: kasir, body: { uang_fisik: 100_000 } });
  assert.equal(tutup.status, 200);
  assert.equal(tutup.body.modal_awal, 80_000);
  assert.equal(tutup.body.kas_seharusnya, 80_000);
  assert.equal(tutup.body.selisih, 20_000, 'fisik 100.000 - seharusnya 80.000');
  assert.equal(tutup.body.transaksi, 0);
  assert.equal(tutup.body.items, 0);

  const riwayat = (await api.req('GET', '/api/shifts', { token })).body;
  const barisShift = riwayat.find((r) => Number(r.id) === Number(tutup.body.id));
  assert.ok(barisShift, 'shift tanpa penjualan tetap muncul di riwayat kas superadmin');
  assert.equal(barisShift.modal_awal, 80_000);
  assert.equal(barisShift.uang_fisik, 100_000);
  assert.equal(barisShift.selisih, 20_000);
  assert.equal(barisShift.kas_seharusnya, 80_000);

  // Laporan per kasir dulu dibangun dari `sales`, sehingga shift tanpa penjualan HILANG.
  const perKasir = (await api.req('GET', '/api/reports/per-kasir', { token })).body;
  assert.equal(perKasir.rows.length, 1);
  const baris = perKasir.rows[0];
  assert.equal(baris.kasir, 'Kasir Satu');
  assert.equal(baris.transaksi, 0);
  assert.equal(baris.modal_awal, 80_000);
  assert.equal(baris.kas_seharusnya, 80_000);
  assert.equal(baris.uang_fisik, 100_000);
  assert.equal(baris.selisih, 20_000);
});

test('kas keluar selama shift masuk rincian dan mengurangi uang seharusnya di laci', async () => {
  await api.req('POST', '/api/shifts/buka', { token: kasir, body: { modal_awal: 80_000 } });

  // Kasir memakai uang laci untuk beli barang dagangan di tengah shift.
  const keluar = await api.req('POST', '/api/shifts/pengeluaran', {
    token: kasir,
    body: { jumlah: 15_000, keterangan: 'beli gula 5 kg' },
  });
  assert.equal(keluar.status, 201);
  assert.equal(keluar.body.shift.kas_keluar, 15_000);
  assert.equal(keluar.body.shift.kas_seharusnya, 65_000, 'modal 80.000 - uang dipakai 15.000');
  assert.equal(keluar.body.shift.rincian.length, 1);
  assert.equal(keluar.body.shift.rincian[0].keterangan, 'beli gula 5 kg');

  // Uang fisik 65.000 = pas, jadi selisihnya nol (tanpa rincian ini akan terlihat -15.000).
  const tutup = await api.req('POST', '/api/shifts/tutup', { token: kasir, body: { uang_fisik: 65_000 } });
  assert.equal(tutup.status, 200);
  assert.equal(tutup.body.kas_seharusnya, 65_000);
  assert.equal(tutup.body.selisih, 0);
  assert.equal(tutup.body.rincian.length, 1, 'rincian ikut di laporan tutup kas');
  assert.equal(tutup.body.rincian[0].tipe, 'keluar');

  // Laporan superadmin menampilkan uang keluar itu juga.
  const riwayat = (await api.req('GET', '/api/shifts', { token })).body;
  assert.equal(riwayat[0].kas_keluar, 15_000);
  const detail = (await api.req('GET', `/api/shifts/${tutup.body.id}`, { token })).body;
  assert.equal(detail.rincian[0].keterangan, 'beli gula 5 kg');

  // Kasir lain tidak boleh membaca detail kas ini.
  await createUser({ name: 'Kasir Dua', username: 'kasir2', role: 'kasir' });
  const kasir2 = await login(api.req, 'kasir2');
  assert.equal((await api.req('GET', `/api/shifts/${tutup.body.id}`, { token: kasir2 })).status, 403);
});

test('kas keluar: wajib ada keterangan, tidak boleh melebihi uang laci, dan bisa dibatalkan', async () => {
  assert.equal(
    (await api.req('POST', '/api/shifts/pengeluaran', { token: kasir, body: { jumlah: 1_000 } })).status,
    422,
    'tanpa kas terbuka ditolak',
  );

  await api.req('POST', '/api/shifts/buka', { token: kasir, body: { modal_awal: 20_000 } });
  const tanpaKet = await api.req('POST', '/api/shifts/pengeluaran', {
    token: kasir, body: { jumlah: 5_000, keterangan: '   ' },
  });
  assert.equal(tanpaKet.status, 422, 'keterangan wajib: uangnya dipakai untuk apa');

  const lebih = await api.req('POST', '/api/shifts/pengeluaran', {
    token: kasir, body: { jumlah: 25_000, keterangan: 'beli rokok' },
  });
  assert.equal(lebih.status, 422, 'uang laci cuma 20.000');

  const satu = await api.req('POST', '/api/shifts/pengeluaran', {
    token: kasir, body: { jumlah: 5_000, keterangan: 'bayar ongkos' },
  });
  const dua = await api.req('POST', '/api/shifts/pengeluaran', {
    token: kasir, body: { jumlah: 5_000, keterangan: 'salah catat' },
  });
  assert.equal(dua.body.shift.kas_keluar, 10_000);

  // Yang salah catat dibatalkan: total kembali 5.000.
  const batal = await api.req('DELETE', `/api/shifts/pengeluaran/${dua.body.pengeluaran.id}`, { token: kasir });
  assert.equal(batal.status, 200);
  assert.equal(batal.body.shift.kas_keluar, 5_000);
  assert.equal(batal.body.shift.rincian.length, 1);

  // Kasir lain tidak boleh membatalkan pengeluaran shift ini.
  await createUser({ name: 'Kasir Dua', username: 'kasir2', role: 'kasir' });
  const kasir2 = await login(api.req, 'kasir2');
  assert.equal(
    (await api.req('DELETE', `/api/shifts/pengeluaran/${satu.body.pengeluaran.id}`, { token: kasir2 })).status,
    403,
  );

  // Setelah kas ditutup, rincian laporan tidak boleh diubah lagi.
  const tutup = await api.req('POST', '/api/shifts/tutup', { token: kasir, body: { uang_fisik: 15_000 } });
  assert.equal(tutup.body.selisih, 0);
  assert.equal(
    (await api.req('DELETE', `/api/shifts/pengeluaran/${satu.body.pengeluaran.id}`, { token: kasir })).status,
    422,
  );
});

test('retur dan pelunasan yang dilakukan kasir ikut mengurangi/menambah uang laci shift-nya', async () => {
  await api.req('POST', '/api/shifts/buka', { token: kasir, body: { modal_awal: 100_000 } });

  // Retur penjualan: uang keluar dari laci kasir yang melayani.
  const retur = await api.req('POST', '/api/returns', {
    token: kasir,
    body: {
      tipe: 'penjualan', product_id: fx.productId, unit_id: fx.pcsId, qty: 1, jumlah: 9_000, alasan: 'rusak',
    },
  });
  assert.equal(retur.status, 201);

  // Pelunasan piutang: uang masuk ke laci kasir yang menerimanya.
  const piutang = await api.req('POST', '/api/debts', {
    token: kasir, body: { tipe: 'piutang', pihak: 'Bu Ani', jumlah: 40_000 },
  });
  await api.req('POST', `/api/debts/${piutang.body.id}/bayar`, { token: kasir, body: { jumlah: 25_000 } });

  const aktif = (await api.req('GET', '/api/shifts/aktif', { token: kasir })).body;
  // 100.000 modal - 9.000 retur + 25.000 pelunasan.
  assert.equal(aktif.kas_masuk, 25_000);
  assert.equal(aktif.kas_keluar, 9_000);
  assert.equal(aktif.kas_seharusnya, 116_000);
  const rincian = aktif.rincian.map((r) => `${r.tipe}:${r.keterangan}`);
  assert.ok(rincian.some((t) => t.includes('Retur penjualan')), 'retur tampil di rincian kas shift');
  assert.ok(rincian.some((t) => t.includes('Pelunasan piutang')), 'pelunasan tampil di rincian kas shift');

  const tutup = await api.req('POST', '/api/shifts/tutup', { token: kasir, body: { uang_fisik: 116_000 } });
  assert.equal(tutup.body.selisih, 0, 'laci pas karena retur & pelunasan ikut dihitung');
});

test('hapus transaksi bon ikut menghapus piutang dan kas pelunasannya', async () => {
  const sale = (await jual({ bon: true, nama_pelanggan: 'Bu Ani', dibayar: 0 })).body.sale;
  const debtId = (await api.req('GET', '/api/debts', { token })).body[0].id;
  await api.req('POST', `/api/debts/${debtId}/bayar`, { token, body: { jumlah: 25_000 } });

  const hapus = await api.req('DELETE', `/api/sales/${sale.id}`, { token });
  assert.equal(hapus.status, 200);

  assert.equal((await api.req('GET', '/api/debts', { token })).body.length, 0);
  const sisaKas = await kasMasuk();
  assert.equal(sisaKas.length, 0, 'kas penjualan dan kas pelunasan sama-sama hilang');
});

test('laporan per kasir dan per jam membaca angka shift yang benar', async () => {
  const buka = await api.req('POST', '/api/shifts/buka', { token: kasir, body: { modal_awal: 0 } });
  await jual({}, kasir);
  await jual({}, token);
  await api.req('POST', '/api/shifts/tutup', { token: kasir, body: { uang_fisik: 100_000 } });

  const perKasir = (await api.req('GET', '/api/reports/per-kasir', { token })).body;
  assert.equal(perKasir.rows.length, 2, 'satu baris per kasir/shift');
  const barisKasir = perKasir.rows.find((r) => r.kasir === 'Kasir Satu');
  assert.equal(barisKasir.transaksi, 1);
  assert.equal(barisKasir.omzet, 100_000);
  assert.equal(barisKasir.items, 1);
  assert.equal(barisKasir.selisih, 0);
  assert.equal(barisKasir.modal_awal, 0);
  // Seharusnya = modal 0 + uang masuk 100.000 dari penjualan tunai.
  assert.equal(barisKasir.kas_seharusnya, 100_000);
  assert.equal(barisKasir.uang_fisik, 100_000);
  assert.ok(barisKasir.shift_mulai, 'baris bershift menyebut jam mulainya');
  const barisAdmin = perKasir.rows.find((r) => r.kasir === 'Super Admin');
  assert.equal(barisAdmin.shift_mulai, null, 'penjualan tanpa shift tetap terhitung');
  assert.equal(perKasir.total, 200_000);

  const perJam = (await api.req('GET', '/api/reports/per-jam', { token })).body;
  assert.equal(perJam.rows.length, 1);
  assert.equal(perJam.rows[0].transaksi, 2);
  assert.equal(perJam.rows[0].omzet, 200_000);
  assert.match(perJam.rows[0].jam, /^\d{2}:00$/);
  assert.equal(perJam.total, 200_000);
  assert.ok(buka.body.id);
});

test('master pelanggan: daftar, ubah, nonaktif, dan sisa piutangnya ikut tampil', async () => {
  const buat = await api.req('POST', '/api/customers', {
    token, body: { nama: 'Bu Ani', telepon: '0812' },
  });
  assert.equal(buat.status, 201);
  assert.equal(buat.body.sisa_piutang, 0);

  // Nama yang sudah ada (beda huruf besar/kecil) ditolak, bukan jadi pelanggan kedua.
  assert.equal((await api.req('POST', '/api/customers', { token, body: { nama: 'BU ANI' } })).status, 422);

  await jual({ bon: true, nama_pelanggan: 'Bu Ani', dibayar: 40_000 });
  const daftar = (await api.req('GET', '/api/customers', { token })).body;
  assert.equal(daftar.length, 1);
  assert.equal(daftar[0].jumlah_transaksi, 1);
  assert.equal(daftar[0].sisa_piutang, 60_000);

  const ubah = await api.req('PUT', `/api/customers/${buat.body.id}`, {
    token, body: { nama: 'Bu Ani Suryani', telepon: '0813' },
  });
  assert.equal(ubah.status, 200);
  assert.equal(ubah.body.nama, 'Bu Ani Suryani');

  assert.equal((await api.req('DELETE', `/api/customers/${buat.body.id}`, { token })).status, 200);
  const nonaktif = (await api.req('GET', '/api/customers?aktif=false', { token })).body;
  assert.equal(nonaktif.length, 1, 'nonaktif, bukan dihapus: riwayat bon tetap terbaca');
  assert.equal(nonaktif[0].is_active, false);

  // Kasir boleh membaca daftar (dipakai layar kasir), tapi tidak boleh mengubah.
  assert.equal((await api.req('GET', '/api/customers', { token: kasir })).status, 200);
  assert.equal((await api.req('POST', '/api/customers', { token: kasir, body: { nama: 'X' } })).status, 403);
});

test('CSV laporan per kasir dan per jam bisa diunduh', async () => {
  await api.req('POST', '/api/shifts/buka', { token: kasir, body: { modal_awal: 0 } });
  await jual({}, kasir);

  const perKasir = await api.req('GET', '/api/reports/per-kasir.csv', { token });
  assert.equal(perKasir.status, 200);
  assert.match(String(perKasir.body), /Kasir/);
  assert.match(String(perKasir.body), /Kasir Satu/);
  assert.match(String(perKasir.body), /TOTAL/);

  const perJam = await api.req('GET', '/api/reports/per-jam.csv', { token });
  assert.equal(perJam.status, 200);
  assert.match(String(perJam.body), /Jam/);
  assert.match(String(perJam.body), /TOTAL/);

  assert.equal((await api.req('GET', '/api/reports/per-kasir.csv', { token: kasir })).status, 403);
});
