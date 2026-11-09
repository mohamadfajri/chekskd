# SSCASN 2024

Snapshot Aesen melengkapi katalog formasi dan administrasi. Nilai SKD tetap berasal
dari PDF instansi. `passed_admin` adalah pelamar lulus administrasi, bukan peserta
hadir SKD. API daftar tidak membawa jenis formasi umum/khusus.

## Pilot katalog publik

`/formasi` menampilkan pilot 203 baris dari tiga instansi. Payload ini disertakan
di server sebagai snapshot kecil dan tidak membaca SQLite saat web berjalan.
Tidak ada impor Supabase baru untuk katalog ini. Regenerasi dari SQLite yang sama:

```powershell
node tools/sscasn/export_public_pilot.mjs "C:\path\aesen.sqlite"
node --experimental-strip-types --test tools/sscasn/catalog.test.mjs
```

Dengan `AESEN_DATABASE_URL`, Daftar Formasi membaca katalog lengkap dari SumoPod.
Tanpa konfigurasi tersebut, aplikasi menampilkan pilot 203 baris. Pasangan
`approved` satu-lawan-satu hanya menambahkan data SKD ke baris Aesen. Kuota,
gaji, dan pelamar pada katalog tidak diganti oleh data PDF.

## Menyiapkan dan mengimpor

Node.js 22.14 atau lebih baru diperlukan oleh importer (SQLite bawaan Node).
Jalankan dari root repo, menggunakan data unduhan yang sudah tersedia:

```powershell
node --env-file=.env --experimental-strip-types tools/sscasn/import_snapshot.mjs --source "C:\path\casn-aesen\data"
```

Perintah ini memeriksa checksum JSONL, integritas dan angka SQLite, mengambil formasi Kejaksaan
yang published dari Supabase, dan membuat preview lokal. Tidak mengubah tabel SKD.
Preview dan keputusan review lokal berada di `data/staging/sscasn`, diabaikan Git.

Sebelum impor live, jalankan `tools/sscasn/preflight.sql` melalui SQL Editor pada
proyek yang benar. Bandingkan ukuran database dengan batas paket yang aktif;
importer tidak dapat mengetahui ruang paket melalui Data API. Jangan mulai impor
jika kapasitas belum cukup. Skrip ini hanya membaca ukuran, schema, dan hak akses.

Terapkan migration `20261012090000_add_sscasn_catalog.sql`, kemudian jalankan:

```powershell
node --env-file=.env --experimental-strip-types tools/sscasn/import_snapshot.mjs --source "C:\path\casn-aesen\data" --institution "Kejaksaan Agung" --apply
```

Import bertahap memakai upsert dan ID snapshot dari checksum. Snapshot baru
berstatus `importing` sampai jumlah baris sesuai. Import terputus dapat dijalankan
ulang. Snapshot `ready` tidak ditulis ulang. Pasangan tetap belum disetujui.

Pada database Free berukuran 405 MB, gunakan pilot Kejaksaan dahulu. Uji PostgreSQL
lokal terhadap schema ini mengukur tabel dan indeks katalog penuh sekitar 104 MB,
sedangkan 75 baris Kejaksaan sekitar 152 kB. Ini pengukuran lokal, bukan jaminan
ukuran akhir Supabase; tabel pendukung dan pertumbuhan database masih perlu ruang.

`--institution "Kejaksaan Agung"` membuat snapshot khusus dengan total 75 baris,
kuota 9.694 dan pelamar administrasi 50.562. ID snapshot berbeda dari katalog
gabungan. Pilihan ini tidak menimpa preview lokal lengkap atau keputusan review.
Report pilot tersimpan sebagai `report-<scope-hash>.json`. Mode instansi saat ini
dibatasi pada Kejaksaan, sesuai batas workspace pencocokan yang tersedia.

Impor seluruh katalog memerlukan flag `--allow-full-import` sebagai pengaman
tambahan setelah kapasitas diperiksa. Jangan gunakan flag itu pada database
405 MB/Free. Setelah ruang cukup, impor penuh memakai perintah awal ditambah
`--apply --allow-full-import`; snapshot gabungan menjadi pilihan utama pada
waktu pengambilan sumber yang sama.

## Review admin

Buka `/admin`, menu SSCASN. Tab daftar membaca snapshot yang tersedia dengan
pagination 25 baris: 111.921 pada preview penuh atau 75 pada pilot database.
Tab pencocokan dimulai dari Kejaksaan. Periksa pendidikan,
lokasi, kuota, serta kelompok umum/khusus pada PDF sebelum menyetujui pasangan.
Satu sumber SSCASN hanya boleh disetujui untuk satu formasi PDF.
Pasangan berbeda pendidikan/lokasi/kuota wajib disertai catatan alasan.

Kejaksaan memiliki 65 pasangan exact yang disetujui setelah audit rekap PDF.
Sepuluh lainnya tetap perlu review karena awalan kode jabatan.

Jika tabel live belum tersedia, server development memakai SQLite lokal read-only.
Review disimpan lokal dan tidak dipromosikan otomatis ke Supabase. Server
production hanya memakai snapshot Supabase yang siap; tidak membaca path laptop.
`SSCASN_LOCAL_DIR` dapat menunjuk folder staging proyek utama jika server
development dijalankan dari salinan kode di drive lokal. Opsi ini tidak mengaktifkan
fallback lokal di production.

Detail formasi dan snapshot rasionalisasi menerima konteks administrasi hanya
untuk pasangan approved pada batch PDF published dan verified. Konteks tambahan
tidak mengubah peserta, ranking SKD, nilai batas, atau skor rekomendasi v6.

## Audit dan persetujuan bulk

Untuk audit tanpa terminal, buka **Admin > SSCASN > Audit instansi**, pilih
instansi, lalu klik **Audit dan setujui**. Web memeriksa ulang data, menyimpan
pasangan exact yang unik, dan menampilkan hanya antrean yang masih perlu
review. Pasangan yang sudah disetujui tidak dipakai lagi sebagai kandidat
formasi lain. Nol peserta hanya dapat disetujui otomatis jika rekap PDF asli
dan API detail sama-sama mengonfirmasi nol, kategori cocok, dan pasangan unik.
CLI masih menyediakan mode audit saja.

Di antrean **Perlu review**, gunakan **Setujui** per baris atau centang beberapa
baris dan klik **Setujui pilihan** (maksimal 25 per pengiriman). Pilih kandidat
jika ada lebih dari satu dan isi catatan bukti PDF asli. Review manual menerima
awalan kode jabatan yang berbeda jika seluruh bukti inti lainnya cocok. Server
menolak satu kelompok utuh jika salah satu pilihan sudah dipakai, memiliki
review tersimpan, atau buktinya berbeda.

Pastikan `.env.local` berisi `AESEN_DATABASE_URL` (URL SumoPod) dan konfigurasi
server Supabase tersedia di `.env` atau `.env.local`. Jangan commit kredensial.
Audit seluruh instansi 2024 yang punya SKD terbit dan terverifikasi:

```powershell
node --env-file=.env --env-file=.env.local --experimental-strip-types tools/sscasn/reconcile_catalog.mjs
```

Laporan `data/staging/sscasn/reconcile-plan.json` memuat status, halaman PDF,
dan ID kandidat. Audit tidak mengubah database. Untuk memeriksa satu instansi,
tambahkan `--institution "Badan Kepegawaian Negara"`. Setelah memeriksa hasil,
ulang perintah untuk instansi yang sama dengan `--apply --confirm <kode-audit>`.
Skrip memeriksa ulang bukti, menyalin hanya kandidat yang perlu referensi
Supabase, dan menyimpan persetujuan baru tanpa menimpa review lama.

Gunakan `--audit <laporan-rekap.json> --pdf <pdf-asli>` untuk bukti dari PDF asli
seperti pilot Kejaksaan. Bukti rekap sendiri belum cukup untuk menyetujui baris
nol tanpa konfirmasi kategori dan angka nol dari API detail.
Nama instansi berbeda, awalan kode jabatan, dan kandidat ganda tetap perlu review.
Tidak ada mode persetujuan semua instansi sekaligus.

## Kategori Aesen dan rekap nol

API daftar tidak mengirim kategori. `backfill_aesen_categories.mjs` menambah
kode dan nama kategori di `aesen.formation_categories`, tanpa mengganti katalog
utama. Opsi `--archive <casn2024.sqlite>` hanya menerima baris yang cocok
menurut ID, instansi, jabatan, lokasi, pendidikan dan kuota. Sisanya ditarik per
ID dari API detail. Gunakan `--detail-all` untuk memverifikasi juga kategori
arsip lewat API, atau `--verify-zero "Badan Kepegawaian Negara"` untuk fokus
pada baris nol satu instansi. Script menyimpan per batch dan melewati ID yang
sudah lengkap saat dilanjutkan. Jangan jalankan dua unduhan detail sekaligus.

`verify_skd_zero_recaps.mjs` memeriksa semua instansi SKD 2024 terbit. Folder
default `FILE SKD 2024`; gunakan `--pdf-root` bila lokasinya berbeda atau
`--institution` untuk memeriksa satu instansi. Parser hanya menerima tata
letak rekap yang dikenali; dokumen SKB, integrasi, halaman ganda, atau rekap
yang tidak bisa diverifikasi tetap perlu review.

```powershell
node --env-file=.env --env-file=.env.local --experimental-strip-types tools/sscasn/verify_skd_zero_recaps.mjs --apply
node --env-file=.env --env-file=.env.local --experimental-strip-types tools/sscasn/backfill_aesen_categories.mjs --priority data/staging/sscasn/zero-recap-all-2024.json
```

Tanpa `--apply`, verifier hanya membuat laporan lokal. Dengan `--apply`,
bukti rekap yang lolos tersimpan di SumoPod, tetapi tidak mengubah persetujuan.
`--priority` mendahulukan kandidat nol yang sudah punya bukti PDF, termasuk
yang kategori awalnya berasal dari arsip. Admin dan CLI memakai bukti tersimpan
tanpa mengunduh PDF atau memanggil API detail saat audit. Di Admin, jalankan
**Audit dan setujui** untuk instansi yang dipilih. Hanya pasangan unik dengan
rekap nol, angka nol dari API detail, dan kategori yang sama bisa disetujui
otomatis; pasangan yang sudah dipakai tidak ditimpa.

```powershell
node --experimental-strip-types --test tools/sscasn/matching.test.mjs
```

Untuk smoke test API setelah server dev aktif di port 8091:

```powershell
node --env-file=.env tools/sscasn/smoke_test.mjs
```

Opsi `--local-review` menguji perubahan keputusan dan keunikan pasangan,
lalu mengembalikan file review lokal semula. Gunakan hanya pada salinan pengujian,
bukan ketika admin sedang menyimpan review. Jangan memakai opsi ini terhadap
server dari folder lain. `SSCASN_TEST_URL` dapat mengatur alamat server pengujian.

## Pengujian migration terisolasi

Tes SQL memakai PostgreSQL lokal berbasis PGlite, tanpa koneksi Supabase live.
Pasang dependency pengujian pada folder sementara tersendiri, bukan di root app:

```powershell
$testDependencies = Join-Path $env:TEMP "chekskd-sscasn-sql-tests"
npm install --prefix "$testDependencies" --no-save --package-lock=false @electric-sql/pglite@0.5.9
$env:SSCASN_PGLITE_MODULE = Join-Path $testDependencies "node_modules\@electric-sql\pglite\dist\index.js"
node --test tools/sscasn/schema.test.mjs
Remove-Item Env:SSCASN_PGLITE_MODULE
```

Tes memeriksa migration, RLS dan privilege backend, penolakan akses publik,
keunikan pasangan, timestamp review, status snapshot/batch, perubahan instansi/
jabatan/tahun, dan validasi angka. Fungsi konteks memakai `security invoker`;
hanya role backend dengan akses SELECT yang dapat membacanya.
