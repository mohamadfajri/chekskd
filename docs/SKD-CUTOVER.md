# Peralihan SKD ke SumoPod

Salinan SumoPod dan preview lokal bukan pengganti produksi. Jangan kosongkan
tabel SKD Supabase selama aplikasi produksi atau admin masih memakainya.
Jangan hapus proyek Supabase, akun, lead, riwayat kode, atau Storage PDF.

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
