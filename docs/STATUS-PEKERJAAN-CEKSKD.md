# Status Pekerjaan CekSKD

Catatan acuan per 8 November 2026. Perbarui dokumen ini setelah tiap tahap; bedakan **selesai lokal**, **sudah di Supabase**, dan **sudah dirilis di Vercel**.

## Keputusan produk

- **Aesen/SSCASN:** katalog historis 2024 untuk mencari instansi, jabatan, lokasi, pendidikan, kuota, dan kisaran gaji yang tercantum. Katalog mencakup pusat dan daerah, tanpa menunggu semua PDF diparse.
- **PDF SKD resmi:** sumber nilai, peringkat, batas historis, dan pembanding simulasi. Katalog Aesen saja tidak cukup untuk menghitung posisi atau peluang. Pelamar lolos administrasi tidak sama dengan peserta hadir SKD.
- **Simulasi manual:** instansi asal peserta boleh belum ada di database. Yang perlu data SKD terverifikasi adalah formasi tujuan yang ingin disimulasikan. Mesin tidak dibatasi ke instansi pusat; rekomendasi alternatif saat ini mengikuti aturan formasi UMUM dan syarat data mesin.

## Status sekarang

| Bagian | Status |
| --- | --- |
| Data Aesen lengkap | **Sudah di SumoPod:** 111.921 baris formasi dari 544 instansi, diverifikasi terhadap SQLite lokal. Data mentah tetap di lokal. |
| Pilot SSCASN Kejaksaan | **Sudah di Supabase:** 75 formasi. Admin SSCASN dan tab Pencocokan Kejaksaan sudah diuji di lokal. |
| Audit pasangan Kejaksaan | **65 pasangan exact disetujui di Supabase**, setelah dicocokkan dengan PDF asli dan katalog Aesen. Sepuluh pasangan dengan awalan kode jabatan tetap perlu review. |
| Audit pasangan instansi lain | **Skrip tersedia dan audit sudah dijalankan.** Persetujuan dijalankan terpisah per instansi; lihat [panduan bulk](../tools/sscasn/README.md). |
| Kategori Aesen dan audit nol | **Tarikan kategori sedang berjalan.** Sudah memeriksa 1.787 rekap nol pada 20 instansi SKD 2024 terbit; 1.669 bukti PDF tersimpan di SumoPod, 118 belum terverifikasi dari PDF. Bukti API detail, kategori yang sama, dan pasangan unik tetap wajib untuk persetujuan otomatis di Admin. |
| Data SKD resmi | **Sudah di Supabase:** 20 instansi dengan batch 2024 terbit, semuanya instansi pusat. Belum semua PDF diparse; PDF daerah belum terbit pada pengecekan ini. |
| Pilot PDF daerah: Pemprov Jawa Timur | **Selesai ekstraksi lokal, siap cek sampel admin:** 3.968 halaman, 1.553 kelompok, 2.314 kuota, 26.369 peserta, 1.959 tidak hadir. Kuota dan jumlah peserta setiap kelompok cocok dengan rekap PDF. Belum diimpor atau diterbitkan. |
| Tabel Formasi untuk publik | **Teruji lokal dengan SumoPod dan Supabase:** satu baris per formasi Aesen, termasuk gaji. SKD terverifikasi hanya menjadi pelengkap pada pasangan yang sudah disetujui. Belum dirilis di Vercel. |
| Simulasi Nilai SKD 2024 | **Versi uji target selesai lokal:** input TWK, TIU, TKP dan pendidikan, lalu pilih satu formasi UMUM dengan data cukup. Hasil rank dibandingkan dengan mesin v6 menggunakan target dan skor yang sama. Belum ada rekomendasi otomatis atau kode WhatsApp untuk jalur manual. |
| WhatsApp dan marketing | Hermes sudah terbaca terhubung setelah scan ulang pada pengecekan terakhir. Cloud API ditunda. Bot hasil dan nomor resmi tryout tetap dipisahkan; siaran hanya untuk penerima yang sudah setuju. Bukan bagian dari tahap katalog atau simulasi web. |

Laporan: `data/staging/sscasn/audit-kejaksaan-2024.json` (lokal, tidak ditrack Git). Skrip: [audit_kejaksaan.py](../tools/sscasn/audit_kejaksaan.py). Panduan impor: [SSCASN README](../tools/sscasn/README.md).

## Antrean kerja berikutnya

1. **Katalog publik Aesen: siap dikonfigurasi untuk rilis.** Atur `AESEN_DATABASE_URL` di Vercel sesuai [panduan katalog](KATALOG-AESEN.md). Katalog penuh dipaginasi di SumoPod. Data SKD dari Supabase hanya tampil pada baris Aesen yang tertaut. Tamu melihat enam contoh; pencarian, filter, pagination, dan perbandingan lengkap setelah login. Buka `/formasi`.
2. **Simulasi manual: uji satu target selesai lokal.** Buka `/search` > **Masukkan nilai sendiri**, atau tekan **Simulasikan** pada baris yang memenuhi syarat data. Target dipertahankan saat login dan pendidikan tetap diperiksa. Cakupan pusat/daerah dihitung dari data pembanding yang tersedia, bukan dibatasi tetap ke pusat. Nilai manual tidak ditulis ke tabel resmi. Rekomendasi otomatis dan jalur WhatsApp manual masih terpisah.
3. **Perluas cakupan SKD: Pemprov Jatim sudah di staging.** Cek sampel peserta dan halaman sumber sebelum impor atau publikasi; periksa kapasitas database. File: `data/staging/pemprov-jatim-2024-pilot-report.json` dan CSV dengan awalan yang sama. Aesen Jatim berisi 1.551 kelompok, 2.312 kuota, dan 26.312 pelamar lolos administrasi; jangan gabungkan otomatis. Untuk instansi berikutnya, jangan pakai PDF SKB sebagai sumber nilai SKD.
4. **Sambungkan simulasi manual ke WhatsApp: belum dikerjakan.** Kerjakan setelah alur web dicoba dengan akun nyata. Butuh sesi hasil manual yang tidak membuat ID peserta resmi. Hermes tetap menjadi pengantar kode dan kartu; keputusan Cloud API atau siaran marketing dibahas terpisah.

## Uji ulang lokal

```powershell
node --experimental-strip-types --test tools/sscasn/catalog.test.mjs tools/skd/manual_skd.test.mjs
node --env-file=.env --env-file=.env.local --experimental-strip-types tools/skd/check_manual_skd_parity.mjs
npm run build
```

Uji paritas hanya membaca Supabase. Uji browser memakai sesi contoh untuk alur setelah login; akun nyata belum digunakan dalam pengecekan ini.

## Batas rilis

- Jangan ubah mesin ranking resmi untuk membuat katalog tampil. Katalog dan simulasi boleh dikembangkan terpisah, dengan status cakupan data yang sama.
- Jangan impor katalog penuh ke Supabase, menyetujui pasangan, atau menandai PDF sebagai terbit hanya karena skrip audit berhasil.
- Perubahan SSCASN dan UI masih ada di working tree lokal. Tidak ada push atau deploy Vercel yang dilakukan saat membuat catatan ini. Folder kerja aktif: `C:/Users/fajri/Documents/chekskd/skd-chance-analyzer`. User yang melakukan push.
