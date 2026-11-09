# Katalog Formasi Aesen

Katalog CASN 2024 berada di schema `aesen` pada PostgreSQL SumoPod. Isinya data
formasi, bukan data pribadi peserta. Nilai SKD, akun, dan persetujuan pencocokan
tetap di Supabase. Salinan pilot Supabase dipertahankan karena review lama
merujuk ke sana; importer katalog tidak mengubah data Supabase.

## Impor dan konfigurasi

1. Set `AESEN_IMPORT_DATABASE_URL` pada lingkungan terminal atau file env lokal
   yang diabaikan Git. Gunakan kredensial yang memiliki akses tulis pada database Aesen.
2. Jalankan dari root repo dengan Node.js 22.14 atau lebih baru:

   ```powershell
   node --experimental-strip-types tools/sscasn/import_aesen_postgres.mjs "C:\folder\aesen\data"
   ```

   Jika URL impor ada di `.env.local`, tambahkan `--env-file=.env.local`
   setelah `node`. Folder sumber berisi `aesen.sqlite`, `audit.json`, dan `formasi.jsonl`.
   Impor memverifikasi checksum dan total, berjalan dalam satu transaksi, dan
   tidak menimpa snapshot berbeda. File mentah tetap disimpan terpisah.

3. Set `AESEN_DATABASE_URL` ke URL Transaction Pooler di Vercel (Production,
   dan Preview bila perlu), lalu redeploy. Untuk lokal, masukkan ke `.env.local`
   dan jalankan `node --env-file=.env --env-file=.env.local node_modules/vite/bin/vite.js`.
   Jangan gunakan awalan `VITE_` dan jangan menaruh kredensial di Git. Pakai
   role baca saja jika tersedia. Koneksi memverifikasi sertifikat TLS.

Tanpa `AESEN_DATABASE_URL`, aplikasi memakai katalog pilot lama. Dengan URL
terpasang, daftar dan filter Aesen berjalan di server. Pengguna yang belum
masuk tetap hanya mendapat pratinjau. Semua baris, gaji, kuota, dan pelamar
lolos administrasi di Formasi berasal dari Aesen. Ketetatan dibulatkan untuk
tampilan; filter dan urutan memakai nilai sebenarnya.

Statistik SKD ditambahkan ke baris Aesen hanya jika pasangan sudah disetujui
dan data PDF sudah terbit serta terverifikasi. Formasi PDF tanpa pasangan tetap
bisa dipakai di alur Cek Nilai, tetapi tidak menjadi baris kedua di Formasi.
