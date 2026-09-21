# Laporan lanjutan audit antislop 001

- **Tanggal:** 2026-09-21
- **Cakupan perbaikan:** temuan 1 sampai 11 (6 HIGH + 5 MEDIUM) dari
  `anti-slop/audit-001-2026-09-21.md`
- **Tidak dikerjakan:** temuan 12 sampai 16 (LOW), sesuai pilihan Anda
- **Berkas bukti:** `anti-slop/bukti/`, 12 tangkapan layar sebelum dan sesudah

Cara memperoleh gambar "sebelum": perubahan disimpan sementara dengan `git stash`, kode lama
dibangun ulang, gambar diambil, lalu perubahan dikembalikan dan dibangun ulang lagi. Jadi kedua
gambar berasal dari aplikasi yang benar-benar berjalan, bukan rekaan.

---

## Angka sebelum dan sesudah

### Temuan 1: em dash (R-02)

| | Sebelum | Sesudah |
|---|---|---|
| Kemunculan di teks yang dirender | 8 tempat | **0** |
| Kemunculan di seluruh `src/` (termasuk komentar) | 36 | **0** |
| Diperiksa di 16 halaman, `document.body.innerText` | ada | **tidak ada di satu halaman pun** |

Contoh penggantian:

| Sebelum | Sesudah |
|---|---|
| "Dibayar — ketuk untuk mengisi angka" | "Dibayar, ketuk untuk mengisi angka" |
| "Belum lunas — hutang" | "Belum lunas (hutang)" |
| "Offline — transaksi disimpan lokal" | "Offline, transaksi disimpan lokal" |
| "Hutang — kita yang berhutang" | "Hutang (kita yang berhutang)" |
| "—" (penanda sel kosong) | "-" |

### Temuan 2 sampai 4: kontras WCAG AA (R-25)

Diukur di browser sungguhan dengan menghitung rasio kontras tiap elemen berteks terhadap latar
efektifnya (menelusuri lewat orang tua sampai menemukan latar yang tidak transparan).

| | Sebelum | Sesudah |
|---|---|---|
| Pelanggaran di 16 halaman | 27 tempat `slate-400` (2,56:1), 6 pil nonaktif (4,34:1), 31 `text-red-600` (4,41:1) | **0** |

Angka terukur dari browser, sebelum dan sesudah:

| Elemen | Sebelum | Sesudah |
|---|---|---|
| Pesan data kosong di `/laporan/harga` | `rgb(148,163,184)` = **2,56:1** | `rgb(100,116,139)` = **4,76:1** |
| Label grup sidebar | `rgb(148,163,184)` = **2,56:1** | `rgb(100,116,139)` = **4,76:1** |
| Label "Total Pembayaran" di kartu gelap | `rgb(100,116,139)` di atas `slate-900` = **3,75:1** | `rgb(203,213,225)` = **12,02:1** |
| Label kartu Stat di latar berwarna | 4,35:1 | **6,93:1** (paling rendah, di atas `red-50`) |

Tiga aturan penggantian yang dipakai:

| Pola lama | Pola baru | Alasan |
|---|---|---|
| `text-slate-400` (2,56:1) | `text-slate-500` (4,76:1) | lulus di atas latar putih |
| `bg-slate-100 text-slate-500` (4,34:1) | `bg-slate-100 text-slate-600` (7,58:1) | pil status |
| `text-red-600` (4,41:1 di atas `red-50`) | `text-red-700` (5,30:1) | keadaan hover dan aktif |

Plus dua kasus yang hanya ketahuan setelah pengukuran menyeluruh, bukan dari perkiraan awal:
label `Stat` di atas latar berwarna (`slate-500` hanya 4,35:1 di atas `red-50`), dan teks di
`/stok/scan` yang duduk di atas kotak `slate-100`. Keduanya dinaikkan ke `slate-600` (6,92:1 di
atas `slate-100`).

Kontrol nonaktif dikecualikan, sesuai WCAG 1.4.3 yang tidak mengatur komponen antarmuka nonaktif.
Tiga elemen yang tersisa di `/kasir` semuanya dalam keadaan nonaktif ("Simpan Struk", "Cetak Struk",
dan kolom dibayar saat keranjang kosong).

### Temuan 5: modal (R-32, R-26)

Diuji langsung di browser pada `/kategori`, sebelum dan sesudah:

| Yang diuji | Sebelum | Sesudah |
|---|---|---|
| Tekan Escape | modal **tetap terbuka** | modal **tertutup** |
| `role` pada panel | `null` | `"dialog"` |
| `aria-modal` | `null` | `"true"` |
| Label untuk pembaca layar | tidak ada | `aria-labelledby` menunjuk judul modal |
| Fokus saat modal dibuka | tidak diatur | pindah ke kolom pertama di dalam modal |
| Urutan Tab | `INPUT`, `BUTTON`, lalu `BODY <LUAR-MODAL>`, lalu tautan sidebar `<LUAR-MODAL>` | `INPUT`, `BUTTON`, `BUTTON`, `BUTTON[Tutup]`, `INPUT`, `BUTTON`, `BUTTON`, `BUTTON[Tutup]`, `INPUT` berputar di dalam modal, **tidak pernah keluar** |
| Fokus setelah modal ditutup | tidak dikembalikan | kembali ke tombol yang membukanya |

Satu perbaikan di `components/ui.tsx` berlaku untuk semua modal di aplikasi, karena semuanya
memakai komponen yang sama.

### Temuan 6: keadaan memuat (R-27)

`components/MasterSederhana.tsx` sekarang membedakan `undefined` (data lokal belum terbaca, tampil
"Memuat data") dari `[]` (benar-benar kosong, tampil "Belum ada data"). Sebelumnya nilai awal `[]`
membuat pesan "Belum ada data" berpotensi tampil sebelum data tiba.

Catatan kejujuran: saya **tidak berhasil mengamati** kedipan itu, baik sebelum maupun sesudah, bahkan
dengan pembatasan CPU 20x dan IndexedDB dikosongkan. Jadi perbaikan ini adalah perbaikan
kelengkapan kontrak, bukan perbaikan cacat yang terlihat. Yang bisa saya buktikan: kode sekarang
membedakan dua keadaan itu, dan keadaan memuat tidak pernah muncul di pengamatan saya karena
IndexedDB lokal memang selalu lebih cepat daripada React.

### Temuan 7 sampai 11: alasan tertulis (R-31, R-06, R-08, R-10, R-21)

| Temuan | Tindakan |
|---|---|
| 7. Huruf besar berjarak lebar di label sidebar | `uppercase tracking-wide` **dihapus** dari `components/Layout.tsx:90`. Terukur: `textTransform` berubah dari `uppercase` menjadi `none`, `letterSpacing` dari `0.35px` menjadi `normal` |
| 8. Tanda `›` di 15 kartu laporan | Dipertahankan, alasannya ditulis di `DESIGN.md` |
| 9. Mode gelap | Dipertahankan terang, alasannya ditulis di `DESIGN.md`, plus catatan bahwa keputusan ini milik saya dan Anda bisa meminta tombol tema |
| 10. `backdrop-blur` | Dipertahankan, alasannya ditulis di `DESIGN.md` |
| 11. Alasan keputusan | Tabel 10 baris alasan ditambahkan ke `DESIGN.md` |

Header tabel tetap memakai `uppercase` di 12 tempat, karena di situ huruf besar memisahkan baris
judul dari isi tabel, dan alasan itu sudah tercatat.

---

## Regresi: tidak ada yang rusak

Dijalankan setelah semua perubahan, pada build produksi di port 3100.

| Pemeriksaan | Hasil |
|---|---|
| `npm test` backend | **31 lulus, 0 gagal** |
| `npx tsc --noEmit` | lulus, tanpa galat |
| `npm run build` | lulus, 11 berkas di-precache |
| `scripts/verify-kasir.mjs` | lulus; transaksi tersimpan tetap `metode_bayar: "tunai"`, struk memuat "Metode Tunai" |
| `scripts/verify-tap.mjs` | 60 halaman/lebar diuji, 0 gagal render; satu-satunya target di bawah 44px tetap checkbox 20x20 di `/stok` yang terbungkus label 193x44 |
| `scripts/verify-ux-owner.mjs` | lulus; data toko utuh sebelum dan sesudah (101 produk, 160 Sedaap, 2 penjualan) |
| Cakupan kontras | 16 halaman, **0 pelanggaran** |
| Cakupan em dash | 16 halaman, **0 kemunculan** |

---

## Status Delivery Gate setelah perbaikan

| Blok | Sebelum | Sesudah |
|---|---|---|
| Blok 1 Hard Gate | GAGAL, 6 pertanyaan terjawab ya | **LULUS**, semua terjawab tidak |
| Blok 2 Purpose-Gate | GAGAL, 4 teknik tanpa alasan | **LULUS**, semua alasan tertulis di `DESIGN.md` |
| Blok 3 Liveliness | SEBAGIAN | **LULUS dengan catatan** |
| Blok 4 Craftsmanship | LULUS | LULUS |

Catatan Blok 3: dial dinyatakan (ENERGY 1 / RHYTHM 1 / MOTION 1), satu aksen jelas (teal), Design
Read dinyatakan, whitespace struktural, dan satu titik fokus per layar. Yang masih lemah adalah
**motif identitas**, karena logonya masih monogram "TH" sementara. Itu temuan LOW nomor 12 dan
belum dikerjakan.

---

## Sisa pekerjaan

Temuan LOW 12 sampai 16 belum disentuh, sesuai pilihan Anda:

| Nomor | Isi |
|---|---|
| 12 | Logo "TH" belum disahkan atau ditandai placeholder |
| 13 | Penanda fokus tombol masih bawaan peramban, tidak seragam dengan cincin teal di kolom isian |
| 14 | Em dash di komentar kode |
| 15 | Kedipan keadaan kosong (sudah ditangani bersama temuan 6) |
| 16 | Deklarasi palet di `DESIGN.md` |

Nomor 14 sudah ikut selesai karena penggantian em dash saya jalankan di seluruh berkas, termasuk
komentar. Nomor 16 sudah ikut selesai lewat tabel alasan di `DESIGN.md`.
