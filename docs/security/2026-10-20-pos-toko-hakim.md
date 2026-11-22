# Security & correctness audit — POS Toko Hakim, migrasi 007 (bon/piutang + shift kas)

Tanggal: 2026-10-20
Auditor: topic Security Review (190)
Repo: `C:\POS Toko Hakim` (commit terakhir `50f44db`, semua perubahan masih di working tree)
Verdict: **TIDAK LULUS**

## Yang diperiksa

Berkas: `backend/migrations/007_pelanggan_bon_shift.sql`, `backend/src/routes/shifts.js`,
`backend/src/routes/sales.js`, `backend/src/routes/debts.js`, `backend/src/routes/returns.js`,
`backend/src/routes/reports.js` (per-kasir, per-jam), `backend/src/routes/auth.js`,
`backend/src/lib.js` (insertCashFlow), `backend/src/app.js`, `backend/src/auth.js`,
`backend/tests/bon-shift.test.js`, `backend/tests/helper.js`, `frontend/src/lib/shift.ts`,
`frontend/src/pages/Kasir.tsx`, `frontend/src/pages/Laporan.tsx`.

Cek 1-10 dijalankan. Bukti diambil dari kode aslinya + eksekusi nyata terhadap database uji
(`npm test`: 42/42 lulus) dan probe tambahan yang dijalankan auditor lalu dihapus.

## Hasil per cek

1. Auth & session — lolos. Semua rute baru di bawah `authenticate` (app.js:30).
2. Otorisasi per objek (IDOR) — lolos. Kasir 403 di `/debts/pelanggan`, `/debts/:id/bayar`,
   `/shifts`; `/shifts/aktif` hanya shift milik sendiri.
3. Input user — SQL injection bersih: seluruh nilai lewat parameter `$n`; satu-satunya
   interpolasi string adalah konstanta milik kode sendiri (`RUMUS_KAS`, `SHIFT_COLS`, `COLS`).
   XSS bersih: React meng-escape, tidak ada `dangerouslySetInnerHTML`. Lihat temuan 9 (panjang nama).
4. Secret — lolos. `.env` di `.gitignore`, hanya `backend/.env.example` yang ter-commit.
5. Dependency — lolos. `npm audit`: 0 kerentanan.
6. Konfigurasi — `x-powered-by` dimatikan, JSON limit 2 MB, satu origin (tanpa CORS terbuka).
7. Error & log — lolos. `pgError` memetakan kode Postgres, error tak dikenal jadi 500 generik.
8. Data sensitif — lolos. Tidak ada data pribadi baru yang terekspos; nama pelanggan hanya
   untuk superadmin (`/debts/pelanggan`) atau pemilik transaksi.
9. Rate limit & brute force — GAGAL, lihat temuan 8.
10. File & backup — lolos. Tidak ada direktori statis yang membuka `storage/`/`.git`.

Migrasi 007 additive dan sudah diterapkan ke DB asli: 9 transaksi lama utuh, 7 migrasi tercatat.

## Temuan

1. `backend/src/routes/debts.js:113-122` — pelunasan bon menulis baris kas tanpa `shift_id`.
   Bukti: shift modal 100.000 + jual 100.000 + bon 100.000 dilunasi tunai → `kas_seharusnya`
   200.000, uang fisik 300.000, selisih dilaporkan **+100.000** (`shift_id` kas pelunasan = null).
   Dampak: laporan selisih kas salah setiap ada pelunasan bon di jam kerja; kasir dituduh
   kelebihan uang padahal laci pas.
   Perbaikan: ambil shift terbuka user lalu kirim `shiftId` ke `insertCashFlow`, seperti sales.js:214.

2. `backend/src/routes/returns.js:86-95` — retur penjualan (uang keluar) juga tanpa `shift_id`.
   Bukti: modal 100.000 + jual 100.000 − retur 30.000, uang fisik 170.000 → selisih dilaporkan
   **−30.000** padahal laci pas.
   Dampak: sama dengan temuan 1, arah sebaliknya.
   Perbaikan: sama — tempelkan retur ke shift terbuka.

3. `backend/src/routes/sales.js:214-218` — `shift_id` dicari tanpa kunci, dan tidak ada penolakan
   bila kasir belum buka kas. Bukti: `POST /sales` sebagai kasir tanpa buka kas → **201**,
   `shift_id: null`.
   Dampak: aturan "kasir tidak bisa jual sebelum buka kas" hanya ada di frontend
   (Kasir.tsx:358). Lewat API langsung atau sync offline, penjualan lolos dan uangnya tidak
   masuk rekap shift mana pun — selisih kas tidak bisa dipertanggungjawabkan.
   Perbaikan: 422 bila role kasir tidak punya shift terbuka; baca baris shift dengan `FOR UPDATE`.

4. `backend/src/routes/debts.js:165-232` — `PUT /debts/:id` masih boleh mengubah `dibayar`
   langsung. Bukti: bon 100.000 di-PUT `{dibayar: 100000}` → status `lunas`,
   `debt_payments` **0 baris**, kas pelunasan **0 baris**.
   Dampak: jalur pintas yang melunasi piutang tanpa uang masuk dan tanpa riwayat. Riwayat
   pelunasan dan buku kas jadi tidak bisa dipercaya, dan angka piutang tidak cocok dengan kas.
   Perbaikan: hapus `dibayar` dari PUT (pelunasan hanya lewat `POST /debts/:id/bayar`), atau
   wajibkan `debt_payments` + baris kas bila `dibayar` diisi.

5. `backend/src/routes/debts.js:234-240` — `DELETE /debts/:id` tidak menyapu `cash_flows`
   (`ref_type='debt'`). Bukti: bon dilunasi 50.000 lalu dihapus → **1 baris kas pelunasan yatim**
   tertinggal; `sisa_piutang` transaksinya jadi 0.
   Dampak: uang masuk tetap tercatat untuk piutang yang sudah tidak ada; buku kas tidak bisa
   direkonsiliasi. `sales.js:364` sudah benar menyapunya — perilaku dua jalur hapus jadi berbeda.
   Perbaikan: di dalam transaksi, `DELETE FROM cash_flows WHERE ref_type='debt' AND ref_id=$1`
   sebelum menghapus bon.

6. `backend/src/routes/reports.js:700-718` — laporan per kasir dibangun `FROM sales`, jadi shift
   tanpa penjualan hilang. Bukti: buka modal 100.000, tutup uang fisik 90.000 → selisih
   **−10.000**, `/reports/per-kasir` **0 baris**, `/shifts` 1 baris.
   Dampak: selisih kas shift kosong (kasir buka lalu tutup tanpa jual) tidak pernah muncul di
   laporan — justru kasus yang paling perlu dilihat pemilik.
   Perbaikan: jadikan `shifts` tabel utama dengan `LEFT JOIN sales`, atau UNION baris shift
   tanpa penjualan.

7. `backend/src/routes/shifts.js:75-93` + `backend/src/routes/sales.js:214-218` — tutup kas tidak
   mengunci penjualan yang sedang berjalan. Bukti: jual + tutup + jual bersamaan → status
   `201,200,201`, hanya **1 dari 2** penjualan mendapat `shift_id`; penjualan yang lolos tidak
   masuk rekap shift mana pun.
   Dampak: uang bisa hilang dari rekap saat kasir menutup kas berbarengan dengan sync offline.
   Perbaikan: `SELECT ... FOR UPDATE` pada baris shift di kedua sisi sebelum menempel/menghitung.

8. `backend/src/routes/auth.js:10-23` — tidak ada rate limit atau lockout login. Bukti: 30
   percobaan password salah berturut-turut → **30× 401**, tanpa jeda maupun blokir.
   Dampak: brute force password kasir/superadmin tidak dibatasi.
   Perbaikan: hitung kegagalan per username+IP, balas 429 setelah N percobaan (mis. 10) dalam 15 menit.

9. `backend/src/routes/sales.js:96-99` — `nama_pelanggan` tanpa batas panjang. Bukti: nama
   5.000 karakter diterima **201** dan tersimpan sebagai baris `customers`.
   Dampak: data kotor masuk master pelanggan yang belum punya halaman edit, sulit dibersihkan.
   Perbaikan: tolak nama lebih dari 100 karakter.

## Langkah berikutnya

Perbaiki 1-9 di topic Development (109), lalu lapor ulang ke topic ini untuk audit kedua.
Temuan 1-3 adalah yang paling mendesak: ketiganya membuat angka selisih kas salah, yaitu
inti dari fitur yang baru dibangun.
