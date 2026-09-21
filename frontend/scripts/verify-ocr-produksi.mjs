/**
 * Bukti OCR pada BUILD PRODUKSI, terukur konsisten dan membersihkan dirinya sendiri.
 *
 * Pelajaran dari percobaan sebelumnya: kunci pengukuran stok harus diambil dari
 * permintaan yang BENAR-BENAR dikirim (bukan daftar id yang ditulis tangan), kalau
 * tidak bisa muncul id yang salah dan perubahan stok tidak terukur.
 *
 * Alur: foto -> OCR -> review -> Terapkan -> ukur stok per produk yang dikirim ->
 * kembalikan ke nilai awal -> hapus artefak uji -> ukur lagi.
 *
 * Jalankan: node scripts/verify-ocr-produksi.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import pg from '../../backend/node_modules/pg/lib/index.js';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const GAMBAR = path.resolve('verifikasi/struk-uji.png');
const KELUARAN = path.resolve('verifikasi');

const bukti = { base: BASE, catatan: [] };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const permintaanBulk = [];
const responsBulk = [];
page.on('request', (r) => {
  if (new URL(r.url()).pathname === '/api/stock/in/bulk') permintaanBulk.push(r.postData());
});
page.on('response', async (r) => {
  if (new URL(r.url()).pathname === '/api/stock/in/bulk') {
    responsBulk.push({ status: r.status(), body: await r.text().catch(() => '') });
  }
});

// ---- Masuk lewat UI build produksi ----
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[autocomplete="username"]', 'superadmin');
await page.fill('input[type="password"]', 'password');
await page.click('button[type="submit"]');
await page.waitForURL('**/kasir', { timeout: 30000 });
await page.waitForTimeout(2500);

bukti.buildProduksi = await page.evaluate(() => ({
  adaBundleProduksi: [...document.querySelectorAll('script[src]')].some((s) => /\/assets\/index-.*\.js/.test(s.src)),
  skrip: [...document.querySelectorAll('script[src]')].map((s) => s.src.split('/').pop()),
}));

const tok = await page.evaluate(() => localStorage.getItem('th_token'));
const stok = async () => (await fetch(`${API}/api/stock`, { headers: { Authorization: `Bearer ${tok}` } })).json();
const ambil = (semua, ids) =>
  Object.fromEntries(ids.map((id) => [id, semua.find((s) => s.product_id === Number(id))?.stok_base ?? null]));

// ---- OCR ----
await page.goto(`${BASE}/stok/scan`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.locator('input[type="file"]').first().setInputFiles(GAMBAR);
await page.waitForTimeout(1500);
await page.getByRole('button', { name: /Baca Teks dari Foto/i }).click();
for (let i = 0; i < 120; i++) {
  if (await page.evaluate(() => /Periksa Baris/.test(document.body.innerText))) break;
  await page.waitForTimeout(3000);
}
await page.waitForTimeout(4000);

await page.locator('summary').first().click().catch(() => {});
await page.waitForTimeout(500);
bukti.teksOcr = await page.evaluate(() => document.querySelector('pre')?.innerText ?? null);

const bacaBaris = () =>
  page.evaluate(() => {
    const tombol = [...document.querySelectorAll('button[aria-label^="Hapus baris"]')];
    return tombol.map((t) => {
      let k = t.parentElement;
      while (k && !k.querySelector('select')) k = k.parentElement;
      const selects = k ? [...k.querySelectorAll('select')] : [];
      const inputs = k ? [...k.querySelectorAll('input')] : [];
      const barisTeks = (k?.innerText ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
      return {
        label: t.getAttribute('aria-label'),
        namaOcr: barisTeks[1] ?? barisTeks[0] ?? '',
        produkTerpilih: selects[0]?.value ?? '',
        namaProdukTerpilih: selects[0]?.selectedOptions?.[0]?.textContent?.trim() ?? '',
        satuanTerpilih: selects[1]?.value ?? '',
        qty: inputs[0]?.value ?? '',
        harga: inputs[1]?.value ?? '',
      };
    });
  });

bukti.barisSetelahOcr = await bacaBaris();
bukti.terpetakanOtomatis = bukti.barisSetelahOcr
  .filter((b) => b.produkTerpilih)
  .map((b) => `${b.namaOcr} -> ${b.namaProdukTerpilih} (id ${b.produkTerpilih})`);

// Baris "SARDEN ABC" tidak punya produk padanan -> hapus (contoh review manual).
for (const b of await bacaBaris()) {
  if (!/sarden/i.test(b.namaOcr)) continue;
  await page.locator(`button[aria-label="${b.label}"]`).click();
  await page.waitForTimeout(400);
}
bukti.barisSiapTerapkan = await bacaBaris();
await page.screenshot({ path: path.join(KELUARAN, 'produksi-ocr-siap-390.png'), fullPage: true });

// ---- Stok SEBELUM, untuk produk yang benar-benar akan dikirim ----
const akanKirim = (await bacaBaris()).map((b) => Number(b.produkTerpilih)).filter(Boolean);
bukti.produkYangDikirim = akanKirim;
bukti.stokSebelum = ambil(await stok(), akanKirim);

// ---- Terapkan ----
await page.getByRole('button', { name: /Terapkan ke Stok/i }).click();
await page.waitForTimeout(10000);
bukti.permintaanBulk = permintaanBulk;
bukti.responsBulk = responsBulk;
bukti.teksSetelahTerapkan = (await page.locator('main').innerText()).slice(0, 700);

// ---- Ukur stok SESUDAH, kunci = id yang dikirim ----
const dikirim = permintaanBulk.length ? JSON.parse(permintaanBulk[0]).items : [];
bukti.qtyDikirim = Object.fromEntries(dikirim.map((i) => [i.product_id, i.qty]));
bukti.stokSesudah = ambil(await stok(), akanKirim);
bukti.delta = Object.fromEntries(
  akanKirim.map((id) => [id, (bukti.stokSesudah[id] ?? 0) - (bukti.stokSebelum[id] ?? 0)]),
);
bukti.deltaCocokDenganQty = akanKirim.every((id) => bukti.delta[id] === bukti.qtyDikirim[id]);

// ---- Kembalikan ke nilai awal ----
const balik = akanKirim.map((id) => ({ product_id: id, stok_fisik: bukti.stokSebelum[id], catatan: 'Koreksi uji verifikasi frontend' }));
const resBalik = await fetch(`${API}/api/stock-opnames`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ items: balik }),
});
const isiBalik = await resBalik.json();
bukti.undo = { body: balik, status: resBalik.status, opnameIds: (isiBalik.rows ?? []).map((r) => r.id) };
bukti.stokSetelahUndo = ambil(await stok(), akanKirim);
bukti.semuaKembaliKeAwal = akanKirim.every((id) => bukti.stokSetelahUndo[id] === bukti.stokSebelum[id]);

await browser.close();

// ---- Bersihkan artefak uji (movement masuk + penyesuaian + opname + alias) ----
const client = new pg.Client({ connectionString: 'postgres://pos_hakim:pos_hakim_dev@127.0.0.1:5433/pos_hakim' });
await client.connect();
const idMovement = responsBulk.flatMap((r) => {
  try {
    return (JSON.parse(r.body).movements ?? []).map((m) => m.id);
  } catch {
    return [];
  }
});
const idOpname = bukti.undo.opnameIds ?? [];
const ALIAS_UJI = ['TEH GELAS ML', 'KOPI KAPAL API', 'MINYAK GORENG L'];

bukti.pembersihan = {
  movementMasuk: (await client.query('DELETE FROM stock_movements WHERE id = ANY($1) RETURNING id', [idMovement])).rows.map((r) => r.id),
  movementPenyesuaian: (
    await client.query(
      `DELETE FROM stock_movements WHERE reference_type = 'opname' AND reference_id = ANY($1) RETURNING id`,
      [idOpname],
    )
  ).rows.map((r) => r.id),
  opname: (await client.query('DELETE FROM stock_opnames WHERE id = ANY($1) RETURNING id', [idOpname])).rows.map((r) => r.id),
  alias: (await client.query('DELETE FROM product_aliases WHERE alias = ANY($1) RETURNING alias', [ALIAS_UJI])).rows.map((r) => r.alias),
};
await client.end();

bukti.stokAkhirBersih = ambil(await stok(), akanKirim);
const sisaMovement = await (async () => {
  const c = new pg.Client({ connectionString: 'postgres://pos_hakim:pos_hakim_dev@127.0.0.1:5433/pos_hakim' });
  await c.connect();
  const r = await c.query('SELECT id, product_id, type, qty_base FROM stock_movements WHERE product_id = ANY($1)', [akanKirim]);
  const a = await c.query('SELECT alias FROM product_aliases');
  await c.end();
  return { movements: r.rows, aliases: a.rows };
})();
bukti.sisaJejak = sisaMovement;

fs.writeFileSync(path.join(KELUARAN, 'bukti-ocr-produksi.json'), JSON.stringify(bukti, null, 2));
console.log(JSON.stringify(bukti, null, 2));
