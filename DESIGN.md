# DESIGN.md, arah desain Toko Hakim POS

Isi berkas ini **ditranskrip dari pilihan yang sudah dipakai di kode**, bukan dikarang. Setiap butir
bisa ditelusuri ke berkasnya. Pemilik toko yang mengesahkan isinya.

Status: **draft untuk disahkan pemilik.** Bagian yang ditandai *[usulan]* adalah alasan yang belum
tertulis di kode mana pun. Alasan itu perlu Anda setujui, ubah, atau buang, karena hanya Anda yang
tahu kenapa pilihan itu diambil.

```
Dial: ENERGY 1 / RHYTHM 1 / MOTION 1
```

## Siapa yang memakai

Kasir toko grosir sembako, banyak yang berusia 35 tahun ke atas, memakai HP atau tablet sambil
melayani pembeli. Pemilik toko (superadmin) membuka laporan di laptop.

Konsekuensinya mengikat, bukan preferensi: target sentuh minimum 44px
(`tailwind.config.js` -> `minHeight.sentuh`), ukuran teks dasar dinaikkan supaya `text-sm` = 16px
(`tailwind.config.js` -> `fontSize`), dan `input/select/textarea` dipaksa 16px supaya iOS tidak
memperbesar layar saat kolom diisi (`src/index.css`).

## Dial, dan kenapa segitu

| Dial | Nilai | Alasan |
|---|---|---|
| ENERGY | 1 | Layar dipakai sambil melayani antrean. Tidak ada yang boleh menarik mata dari keranjang dan tombol simpan. |
| RHYTHM | 1 | Bentuk halaman sengaja seragam: kartu, tabel, tombol yang sama di semua layar, supaya kasir tidak perlu belajar ulang tiap halaman. |
| MOTION | 1 | Hanya `transition` untuk keadaan hover/aktif. Tidak ada animasi masuk, tidak ada `animate-*` di seluruh `src/`. |

Nilai ini bukan default karena malas. Untuk alat kerja yang dipakai berulang ratusan kali sehari,
gerak dan variasi justru menjadi biaya. Kalau nanti ada layar yang memang butuh perhatian
(peringatan stok minus, transaksi gagal), naikkan dialnya **di layar itu saja**, jangan global.

## Identitas

- **Nama:** "Toko Hakim", dengan subjudul "POS Grosir Sembako" (`components/Layout.tsx`).
- **Monogram:** huruf "TH" putih di atas teal, dipakai di favicon dan ikon PWA
  (`public/favicon.svg`, `scripts/gen-icons.mjs`). Statusnya masih placeholder kelas huruf awal,
  bukan logo final. Lihat temuan LOW di `anti-slop/audit-001-2026-09-21.md`.
- **Motif identitas:** teal dipakai konsisten hanya untuk satu hal, yaitu tindakan utama dan
  keadaan aktif. Tidak ada hiasan teal di tempat lain. *[usulan]*

## Palet

Tiga lapis, dan pembagiannya sengaja:

| Warna | Peran | Contoh di kode |
|---|---|---|
| teal-700 / teal-800 | identitas dan tindakan utama | `Button` primary, tautan, `NavLink` aktif, judul toko |
| slate (50 sampai 900) | netral: latar, garis, teks | latar `bg-slate-100`, kartu putih, teks `text-slate-600`/`700` |
| red-600/700 | bahaya dan kesalahan | `Button` danger, hapus, "Stok minus", "ditolak server" |
| amber-700/800 | peringatan dan menunggu | banner offline, "menunggu sinkron", hutang |
| sky-700/800 | keterangan | `Alert` tone info, "Perubahan data master memerlukan koneksi internet" |

Merah, amber, dan sky **bukan** warna identitas. Ketiganya membawa arti status, jadi kalau salah
satu dipakai sebagai hiasan, artinya rusak. Ini yang membuat palet ini lolos R-29 meski ada lima
warna: dua warna inti (teal + netral) ditambah satu aksen (teal) dan tiga warna semantik. *[usulan]*

## Tipografi

- Satu keluarga huruf sistem (tanpa webfont). Alasan: aplikasi harus jalan offline dan PWA tidak
  boleh menunggu unduhan font. *[usulan, sesuai perilaku kode]*
- Skala dinaikkan dari bawaan Tailwind: `text-xs` 14px, `text-sm` 16px, `text-base` 17px
  (`tailwind.config.js`). Alasan tertulis di kode: pembaca 35+ di layar HP.
- Angka uang selalu lewat `rupiah()` (`lib/format.ts`), jadi selalu `Rp 1.234.567`.

## Bentuk, elevasi, gerak

- **Radius:** `rounded-md` untuk kontrol (tombol, input, tab), `rounded-lg` untuk kartu.
  `rounded-full` hanya untuk pil status dan titik indikator. Tidak ada yang dibuat pil tanpa alasan.
- **Elevasi:** `shadow-sm` untuk kartu (3 tempat), `shadow-xl` untuk dua permukaan di atas halaman
  (drawer dan modal), `shadow-lg` untuk daftar turun hasil cari, plus bayangan tipis khusus di
  baris aksi lengket. Bayangan menandai "ini melayang di atas halaman", bukan hiasan. *[usulan]*
- **Gerak:** `transition` saja, untuk hover dan aktif. Tidak ada animasi masuk.

## Aturan tata letak yang mengikat

- **Kasir satu layar penuh.** Halaman `/kasir` tidak menggulir sejak tablet; yang bergulir hanya
  daftar hasil cari dan tabel keranjang (`Layout.tsx` -> `kasirPenuh`, `Kasir.tsx`).
- **Tabel lebar tidak pernah melebarkan halaman.** Semua tabel dibungkus `.tabel-scroll`
  (`index.css`), menggeser ke samping di dalam kotak.
- **Sidebar hanya di desktop sungguhan:** lebar >=1280px DAN penunjuk presisi
  (`tailwind.config.js` -> `screens.desktop`). Alasan tertulis di kode: iPad Pro 12,9 inci
  landscape juga 1366px, dan pemilik minta sidebar hilang di tablet.
- **Baris aksi selalu terjangkau** lewat `.bar-aksi-lengket` (`index.css`).
- **Cetak:** dua ukuran kertas bernama, `@page struk` 58mm dan `@page laporan` A4.

## Alasan keputusan (R-31)

Satu baris per keputusan, supaya tiap teknik punya tujuan yang bisa disebut.

| Keputusan | Alasan satu baris |
|---|---|
| Warna teal untuk tindakan utama | Teal menandai satu hal saja, yaitu aksi yang mengubah data dan halaman yang sedang aktif, sehingga kasir tahu ke mana harus menekan. |
| Merah, amber, sky sebagai warna status | Ketiganya membawa arti (bahaya, peringatan, keterangan), jadi tidak boleh dipakai sebagai hiasan karena artinya akan rusak. |
| Kartu putih di atas latar `slate-100` | Latar abu memisahkan kartu dari halaman tanpa perlu garis tebal, sehingga tabel tetap jadi fokus. |
| Bayangan hanya di 3 tingkat | `shadow-sm` untuk kartu, `shadow-xl` untuk drawer dan modal, `shadow-lg` untuk daftar turun, karena bayangan dipakai menandai "melayang di atas halaman", bukan hiasan. |
| Radius `rounded-md` untuk kontrol, `rounded-lg` untuk kartu | Radius lebih besar pada wadah dan lebih kecil pada kontrol membuat hierarki terlihat tanpa perlu warna tambahan. |
| Satu keluarga huruf sistem | Aplikasi harus jalan offline sebagai PWA, jadi tidak boleh menunggu unduhan webfont. |
| Tanda `›` di 15 kartu daftar laporan | Menandai bahwa kartu itu membuka halaman lain, karena seluruh kartu bisa ditekan dan tanpa penanda itu batasnya tidak terlihat. (R-08) |
| `backdrop-blur` di baris aksi lengket | Isi halaman yang lewat di bawah baris aksi tetap samar terlihat, sehingga kasir tahu masih ada konten di bawah dan tidak mengira halaman sudah habis. (R-10, satu elemen, di dalam batas dosis) |
| Mode terang saja, tanpa tombol tema | Layar dipakai di dalam toko yang terang dan sering dilihat sambil berdiri, jadi latar terang justru lebih terbaca; ini alasan yang sama jenisnya dengan alat pengembang yang beralasan memilih gelap. (R-21) |
| Judul grup sidebar tanpa huruf besar | Pembeda antar kelompok cukup dari bobot huruf dan jarak; HURUF BESAR berjarak lebar adalah gaya bawaan yang tidak menambah keterbacaan. (R-06) |

### Catatan untuk mode gelap (R-21)

Keputusan di atas adalah pilihan saya berdasarkan jenis produk dan penggunanya, bukan arahan Anda.
R-21 hanya mengizinkan tema tetap kalau alasannya bisa disebut, dan alasan itu sekarang tertulis.
Kalau Anda ingin tombol tema, R-21 mewajibkannya benar-benar bekerja di dua mode sekaligus, dan itu
pekerjaan tersendiri di 19 halaman. Sebutkan saja kalau mau dikerjakan.

## Yang belum diputuskan

1. **Logo final.** Sekarang monogram "TH". Perlu keputusan Anda: dipertahankan, diganti, atau
   ditandai resmi sebagai placeholder.
