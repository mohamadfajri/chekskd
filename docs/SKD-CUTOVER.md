# Peralihan SKD ke SumoPod

Salinan SumoPod dan preview lokal bukan pengganti produksi. Jangan kosongkan
tabel SKD Supabase selama aplikasi produksi atau admin masih memakainya.
Jangan hapus proyek Supabase, akun, lead, riwayat kode, atau Storage PDF.

## Tahap baca yang dapat dibalik

Setelah fungsi baca dipasang di database tujuan, set `SKD_DATABASE_URL` di
environment server Vercel dan `SKD_READ_BACKEND=sumopod` pada Preview dahulu.
Jangan beri awalan `VITE_` pada URL. Endpoint `/api/skd-data?type=stats`
menyertakan header `x-skd-backend` untuk memastikan server membaca sumber
yang benar. Nilai `supabase` mengembalikan jalur baca lama setelah redeploy.

Flag ini mencakup pencarian dan detail peserta, jumlah publik, pencarian
target, validasi skor dan target saat membuat kode, daftar/detail/filter
formasi SKD, statistik pembanding untuk katalog, simulasi manual, dan
perhitungan v6 pada worker Hermes. Penyimpanan kode, akun, dan antrean tetap
di Supabase.

Selama pembacaan publik menggunakan SumoPod dan admin masih menyimpan batch
di Supabase, endpoint publikasi menolak batch baru. Ini mencegah batch terlihat
terbit di admin tetapi tidak muncul di pencarian dan mesin rasionalisasi.

## Pindahkan penulisan admin

1. Jeda impor dan review, cek ulang bahwa isi dan status batch masih sama, dan
   uji jalur admin SumoPod dengan batch sintetis. Script
   `tools/skd/smoke_sumopod_admin.mjs` menjalankan endpoint lokal; uji publikasi
   memakai transaksi yang dibatalkan dan hanya menghapus batch uji yang dibuatnya.
2. Jalankan SQL pelepasan relasi di Supabase. Hasil
   `ready_for_sumopod_admin = true` menandakan ID baru bisa disimpan sebagai
   referensi eksternal tanpa mengubah ID yang sudah ada.
3. Aktifkan `SKD_ADMIN_BACKEND=sumopod` bersama `SKD_READ_BACKEND=sumopod` di
   produksi. Impor, review, publikasi, Data Explorer, data terbit, dan alias
   pendidikan memakai SumoPod. Metadata PDF dibaca dari SumoPod, berkas PDF
   tetap di Supabase Storage. Publikasi tetap menolak permintaan jika pemeriksaan
   relasi Supabase belum lolos.
4. Selaraskan catatan audit historis dengan
   `tools/sscasn/sync_audit_to_sumopod.mjs --apply` sebelum merilis jalur audit
   SumoPod. Sinkronisasi hanya menyalin baris yang belum ada, dan batal jika ada
   konflik. Saat kedua flag memakai SumoPod, audit, approval, dan pasangan SKD
   yang dipakai katalog membaca database yang sama. Publikasi batch membuat
   instansi tersedia untuk audit, tetapi bukan persetujuan pasangan Aesen.
   Pertahankan arsip formasi, batch, statistik dan pasangan lama di Supabase;
   jangan mengembalikan penulisan ke Supabase tanpa menyelaraskan perubahan.

## Bersihkan salinan skor saja

- Setelah uji WhatsApp di produksi lolos, verifikasi arsip skor dengan
  `tools/skd/verify_sumopod_score_restore.mjs <folder-arsip>`. Alat ini
  memulihkan seluruh skor beserta prasyarat relasinya ke database lokal
  terpisah, lalu membandingkan sidik jari semua baris.
- Jalankan hanya SQL final yang sudah diisi jumlah baris dan sidik jari hasil
  pemulihan. Template dalam Git sengaja tidak dapat langsung dijalankan.
  SQL final menolak perubahan data atau relasi yang tak terduga, mempertahankan
  baris review dan UUID-nya, serta mengosongkan hanya `public.skd_scores`.
- Sesudah pembersihan, jangan kembalikan flag baca atau admin ke Supabase
  sebelum memulihkan skor dan menyelaraskan data. Rollback deployment saja
  tidak memulihkan data.

## Pemeriksaan sebelum peralihan

- Jalankan [inventaris relasi](../tools/skd/cutover/inspect_supabase_skd_links.sql)
  di SQL Editor Supabase. Hasilnya hanya ukuran tabel dan nama relasi, tanpa
  mengubah data atau menampilkan informasi akun.
- Cek ulang jumlah tabel dan status batch dengan
  `node --env-file=.env --env-file=.env.local --experimental-strip-types tools/skd/check_cutover_readiness.mjs`
  setelah URL tujuan disetel di environment lokal. Perintah hanya membaca kedua
  database dan menulis laporan agregat di `output/skd-transfer/cutover-preflight.json`.
- Uji pencarian, detail, katalog, simulasi manual, audit SSCASN, impor,
  review/publikasi, dan jalur kode hingga kartu terkirim dari Hermes di preview
  yang memakai database SKD tujuan. Pastikan satu sumber penulisan SKD saja
  untuk menghindari batch yang berbeda antar database.
- Buat cadangan yang bisa dipulihkan sebelum peralihan. Simpan cadangan PDF
  terpisah dari dump database. Simpan rahasia di server, bukan di Git.
- Jaga ID nilai dan formasi. Sebelum data lama dibersihkan, lepaskan
  ketergantungan `leads`, `result_sessions`, dan `skd_analysis_jobs` dengan
  [SQL khusus](../tools/skd/cutover/detach_supabase_skd_foreign_keys.sql).
  SQL hanya melepaskan relasi antar database, bukan menghapus UUID atau baris.
  Jangan pakai `TRUNCATE CASCADE`.
- Saat pindah, hentikan sementara impor dan publikasi, sinkronkan perubahan
  terakhir, uji dari deployment Vercel dan Hermes, dan siapkan cara mengembalikan
  pembacaan ke Supabase. Jangan hapus data sumber sampai jalur baru dan
  pemulihan terverifikasi.
