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

Flag ini mencakup pencarian, detail, jumlah publik, pencarian target, dan
perhitungan v6 pada worker Hermes. Flag tidak mengalihkan formulir pembuatan
kode yang masih memeriksa ID dan kelayakan di Supabase, impor, review/publikasi,
katalog/formasi historis, atau simulasi manual. Tabel sumber belum boleh
dikosongkan.

## Pemeriksaan sebelum peralihan

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
  perubahan yang eksplisit dan teruji. Jangan pakai `TRUNCATE CASCADE`.
- Saat pindah, hentikan sementara impor dan publikasi, sinkronkan perubahan
  terakhir, uji dari deployment Vercel dan Hermes, dan siapkan cara mengembalikan
  pembacaan ke Supabase. Jangan hapus data sumber sampai jalur baru dan
  pemulihan terverifikasi.
