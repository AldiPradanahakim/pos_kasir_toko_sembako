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
- **Keranjang memakai tinggi yang tersisa.** Kotak cari, **Scan Nota**, nama pelanggan, jumlah
  keranjang, dan tombol Kosongkan duduk di atas tabel; dari 1280px semuanya **satu baris**, di
  bawah itu kotak cari mengambil satu baris penuh dan sisanya turun ke baris kedua. Alasannya
  terukur: kolom kiri di 768px hanya ~406px, jadi memaksa semuanya sebaris membuat kotak cari
  tinggal 132px — lebih merugikan daripada 52px tinggi yang dihemat. Judul kartu keranjang dan
  baris TOTAL di dalam tabel sengaja dihapus supaya tabelnya dapat baris terbanyak (total sudah
  besar di kartu Pembayaran). Judul kolomnya `sticky`, jadi tetap terlihat saat isinya digulir.
  Tiap baris keranjang setinggi 45px dan bernomor di samping nama barangnya.
- **Tabel lebar tidak pernah melebarkan halaman.** Semua tabel dibungkus `.tabel-scroll`
  (`index.css`), menggeser ke samping di dalam kotak.
- **Sidebar hanya di desktop sungguhan:** lebar >=1280px DAN penunjuk presisi
  (`tailwind.config.js` -> `screens.desktop`). Alasan tertulis di kode: iPad Pro 12,9 inci
  landscape juga 1366px, dan pemilik minta sidebar hilang di tablet.
- **Kalkulator hanya di penunjuk kasar** (`screens.presisi`, `(pointer: fine)`): di laptop kolom
  Dibayar bisa diketik langsung, di tablet/HP tombolnya membuka kalkulator angka besar.
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
| Qty diubah langsung dari baris keranjang | Kasir mengubah jumlah belasan kali per transaksi; membuka panel dulu untuk menekan − / + menambah satu langkah dan menggeser tabel di tengah antrean. |
| Nota pelanggan dipindai, bukan diketik satu per satu | Pelanggan grosir datang dengan daftar belanja tulisan tangan; memindai sekali dan memeriksa hasilnya lebih cepat daripada mencari barang satu per satu di kotak cari, dan hasil pindai tetap wajib dicentang kasir sebelum masuk keranjang. |
| Kas retur & pelunasan menempel ke shift (`cash_flows.shift_id`) | Begitu kasir boleh menerima retur dan pelunasan, uangnya keluar/masuk laci pada shift yang sedang berjalan. Baris kas tanpa `shift_id` membuat laci selalu terlihat selisih sebesar transaksi itu di laporan tutup kas — jadi shift dicari saat menulis, bukan dicocokkan manual belakangan. |
| Retur, Hutang & Piutang, Pembelian dibuka untuk kasir; koreksinya tetap superadmin | Ketiganya pekerjaan meja kasir (pembeli membawa barang kembali, pelanggan melunasi bon, barang datang dari supplier) — menahannya di superadmin berarti kasir mencatat di kertas lalu disalin nanti. Yang tetap dikunci adalah membalik catatan yang sudah jadi (ubah nominal, hapus pembelian/retur), karena itu mengubah stok dan kas yang sudah lewat. |
| Laporan tutup kas tampil sekali di layar kasir; "Riwayat Kas" khusus superadmin | Pertanyaan yang harus dijawab setelah menutup kas selalu sama ("uang fisik cocok atau tidak"), jadi jawabannya ditampilkan saat itu juga ke kasir yang menutupnya — bukan lewat menu yang harus dia cari. Daftar seluruh kas tetap milik superadmin karena isinya pemeriksaan uang kasir lain. |
| Rekap kas dibangun dari tabel `shifts`, bukan `sales` | Kas yang dibuka lalu ditutup tanpa satu pun penjualan tetap harus punya laporan — justru di situlah selisih modal muncul; rekap dari tabel penjualan akan menghilangkannya. |
| Satuan punya inisial 1–4 huruf | Kasir dan pelanggan menulis nota dengan singkatan ("2 (r) Beng Beng"); inisial yang unik membuat singkatan itu bisa dibaca sistem tanpa menebak, sedangkan nama satuan tetap dipakai di layar supaya tidak ada singkatan yang harus dihafal. |
| Total barang & total qty ditampilkan | Antrean grosir memeriksa jumlah item dan jumlah keping sebelum membayar; angka itu juga yang dicocokkan dengan nota, jadi tidak perlu menghitung baris keranjang satu per satu. |
| Harga jual tidak diambil dari nota | Nota pelanggan sering tanpa harga dan nota supplier berisi harga modal; memakai angka nota akan menjual di bawah modal tanpa ketahuan. Harga selalu dari master, perubahan harga tetap lewat pop up beralasan. |
| Nama barang dan angka qty membuka pop up | Perubahan harga (jarang, butuh alasan tertulis) dan hapus barang dipindah ke pop up supaya tabel keranjang tetap satu baris per barang dan tidak melompat saat disentuh. |
| Tombol − dan + kecil di dalam kotak 44px | Kotak abu 44px terlihat mepet dan berat di baris setinggi 45px; yang dikecilkan tampilannya (28px), bukan area sentuhnya. |
| Transaksi tercetak bersifat final | Kasir tidak boleh menghapus riwayat penjualan; koreksi hanya lewat "Hapus Permanen" milik superadmin, supaya angka penjualan tidak bisa hilang diam-diam. |
| Nomor baris di samping nama barang | Antrean panjang membuat kasir perlu menyebut "barang nomor tiga" saat memeriksa keranjang bersama pembeli. |
| Kalkulator hanya di penunjuk kasar | Laptop punya papan ketik, jadi kolom Dibayar diketik langsung; di tablet/HP keyboard lembut menutupi layar, jadi tombolnya membuka kalkulator angka besar. |

### Catatan untuk mode gelap (R-21)

Keputusan di atas adalah pilihan saya berdasarkan jenis produk dan penggunanya, bukan arahan Anda.
R-21 hanya mengizinkan tema tetap kalau alasannya bisa disebut, dan alasan itu sekarang tertulis.
Kalau Anda ingin tombol tema, R-21 mewajibkannya benar-benar bekerja di dua mode sekaligus, dan itu
pekerjaan tersendiri di 19 halaman. Sebutkan saja kalau mau dikerjakan.

## Yang belum diputuskan

1. **Logo final.** Sekarang monogram "TH". Perlu keputusan Anda: dipertahankan, diganti, atau
   ditandai resmi sebagai placeholder.
