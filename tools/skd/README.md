# SKD Data Tools

Alat lokal untuk mengubah PDF SKD menjadi batch staging yang dapat diaudit.

## Launcher Windows

Klik dua kali `JALANKAN PARSER SKD.cmd` di root proyek, lalu pilih nomor
instansi. Launcher mendukung BPK, Kementan, KLHK, KPU, Kemenkumham, Kemenag,
ATR/BPN, Bawaslu, BPOM, Kemenperin, dan KKP. Sumber dicari di
`output/pdfinstansi`, `output/PDF INSTANSI`, lalu
`FILE SKD 2024`. Untuk memilih file sendiri, seret PDF ke launcher.

Launcher memeriksa tahun dan kode pada rekap, menjalankan parser serta builder
v3, lalu membuka folder hasil di `data/staging/skd-satu-klik`. Unggah hanya
`*-v3-staging.csv` yang berada di luar folder `PEMERIKSAAN`. Bila proses
ditahan, lihat laporannya dan jangan unggah CSV diagnostik. Launcher tidak
melakukan OCR, mengunggah PDF, atau menulis ke database.

Untuk banyak PDF sekaligus, klik dua kali `PROSES SEMUA PDF SKD.cmd` atau pilih
**Proses semua PDF** di menu launcher. Mode ini membaca PDF langsung dari
`output/pdfinstansi` (atau nama lama `output/PDF INSTANSI`). Kamu juga bisa
menyeret beberapa PDF atau satu folder ke launcher. Mode ini mengenali kode
instansi dari rekap PDF dengan kamus lokal `institusi_sscasn_2024.json`
(kode dan nama dari snapshot katalog SSCASN/Aesen 2024, tanpa data peserta).
Daftar di menu hanyalah pintasan. Kode tidak dikenal atau isi PDF yang tidak
cocok tetap ditahan. **SUDAH ADA** berarti CSV ada di disk, bukan sudah
diimpor; cek status batch di Admin sebelum mengunggah.

PDF diproses satu per satu. PDF yang ditahan tidak menghentikan antrean.
Setiap instansi yang lolos punya CSV sendiri di folder `CSV STAGING`.
Jika hanya ada `RINGKASAN HASIL.txt`, belum ada PDF yang lolos. Jika dua PDF
punya kode instansi sama, keduanya ditahan
agar tidak membuat data ganda.

Klik lagi setelah menambahkan PDF baru. Hasil batch yang sudah sukses
ditandai **SUDAH ADA** jika PDF dan CSV-nya masih sama. File yang ditahan
ditampilkan dengan alasan dan dicoba lagi saat launcher dijalankan ulang.

## Alur per instansi

1. Pilih PDF **Hasil SKD** asli di `FILE SKD 2024`. Lewati PDF SKB dan
   integrasi SKD-SKB. Cek teks dan struktur halaman dengan probe. Jika PDF
   benar-benar berupa scan, OCR terlebih dulu dan cek sampel terhadap PDF
   asli; parser Panselnas tidak melakukan OCR sendiri.
2. Jalankan parser sesuai layout, lalu siapkan **CSV untuk Admin**
   (`*-admin-import.csv` atau `*-staging.csv`, tergantung parser). Cocokkan
   instansi, formasi, kuota, rekap peserta, nilai, dan nomor halaman sumber.
   Catat status instansi di tracker.
3. Di Admin, pilih **Import batch** dan unggah CSV staging. PDF asli tidak
   diunggah lewat menu ini; unggah ke Storage privat setelah sumber batch
   terdaftar agar bisa dibuka dari layar review.
4. Di **Review**, cek isu dan sampel terhadap PDF asli. Setelah sesuai,
   pilih **Verifikasi semua**, lalu **Publikasikan data**. Jika batch sudah
   ada di Review, jangan impor ulang.
5. Setelah terbit, gunakan **SSCASN > Audit instansi** bila ingin
   menghubungkan hasil SKD dengan katalog Aesen. Audit SSCASN tidak
   diperlukan agar hasil SKD bisa dicari.

Jika **Verifikasi semua** timeout pada batch besar, terapkan
[migration verifikasi bertahap](../../supabase/migrations/20261109091000_add_skd_bulk_verify_step.sql)
di Supabase dan gunakan Admin dengan kode terbaru. Setiap langkah menangani
maksimal 1.500 baris. Jika terputus, buka kembali batch dan klik verifikasi
lagi untuk melanjutkan; jangan impor ulang. Batch belum bisa dipublikasikan
selama verifikasi belum lengkap.

Jika yang timeout adalah **Publikasikan data**, jangan jalankan ulang verifikasi.
Terapkan [migration publikasi](../../supabase/migrations/20261109092000_optimize_skd_publication_stats.sql),
lalu coba lagi dari batch yang sama. Statistik tetap dihitung dalam transaksi
publikasi, sehingga batch tidak tampil tanpa statistik lengkap.

## Preview lokal SumoPod

Setelah salinan SKD selesai, set `SKD_DATABASE_URL` pada environment server
lokal, jalankan `node --experimental-strip-types tools/skd/install_sumopod_preview_functions.mjs`,
lalu mulai Vite dengan `VITE_SKD_LOCAL_PREVIEW=true` dan host `127.0.0.1`.
URL database jangan diberi awalan `VITE_`. Flag ini tidak mengaktifkan SumoPod
di build produksi.

Preview memakai SumoPod untuk pencarian, detail nilai, target, dan perhitungan
v6. Login dan penyimpanan kode tetap di Supabase. Kode preview berlaku 30 menit,
terikat pada WhatsApp akun yang sedang login, dan tidak membuat lead marketing.
Impor, review, publikasi, serta worker produksi belum dipindahkan.

## Persiapan

```powershell
pip install -r tools/skd/requirements.txt
```

Export Google Sheet `Riset 2026` sebagai XLSX lalu simpan di
`data/raw/riset-2026.xlsx`.

## Katalog dan Download

```powershell
python tools/skd/build_source_catalog.py
python tools/skd/download_pdfs_from_catalog.py --limit 0
```

Output lokal disimpan di `data/staging/` dan `data/raw/pdfs/`; keduanya diabaikan Git.

## PDF Admin di Supabase Storage

Simpan PDF asli di folder `FILE SKD 2024` pada root project, lalu unggah PDF yang
sudah memiliki sumber di database:

```powershell
npm run skd:upload-pdfs
```

Script membuat bucket privat `skd-source-pdfs` dan mencocokkan nama file lokal
dengan `file_name` di `skd_sources`. Admin menggunakan signed URL berdurasi pendek
untuk membuka langsung halaman `source_page`, sehingga preview juga bekerja di
Vercel tanpa Google Drive.

Jika PDF disimpan di lokasi lain, isi `SKD_PDF_DIR` di `.env` dengan path absolut:

```env
SKD_PDF_DIR=C:\path\to\FILE SKD 2024
```

Folder lokal hanya diperlukan ketika upload dan tetap diabaikan Git. PDF yang sudah
masuk Storage tidak bergantung pada komputer lokal.

Proyek Supabase Free membatasi satu objek Storage sampai 50 MiB. Pecah PDF yang
lebih besar menjadi part berdasarkan halaman sebelum menjalankan upload:

```powershell
python tools/skd/split_pdf_for_storage.py `
  "FILE SKD 2024/2024-3010-Kemendikbudristek-Hasil-SKD.pdf"
npm run skd:upload-pdfs
```

Part disimpan di `tmp/storage-pdfs` dan tetap privat. Endpoint admin memilih part
serta nomor halaman lokal secara otomatis dari `source_page`.

Gunakan probe untuk mengenali text layer dan struktur PDF sebelum membuat parser instansi:

```powershell
python tools/skd/batch_probe_downloaded_pdfs.py
```

## PDF lokal dengan layout Panselnas SKD

Untuk PDF hasil SKD murni yang sudah ada di `FILE SKD 2024`, jalankan parser lokal
tanpa katalog atau URL Google Drive:

```powershell
python tools/skd/parse_skd_panselnas.py `
  --pdf "FILE SKD 2024/2024-4011-BKN-Hasil-SKD.pdf" `
  --institution-code 4011 `
  --institution-name "Badan Kepegawaian Negara" `
  --source-sheet-row 2 `
  --output-prefix data/staging/bkn-2024-v2
```

Output tetap berada di `data/staging/` dan `source_url` dikosongkan. Nama file
sumber diambil langsung dari nama PDF lokal.

## Kemenhub

Parser layout v2 membaca 2.612 halaman, formasi, halaman lanjutan, peserta tidak hadir,
dan nilai rekap:

```powershell
python tools/skd/parse_kemenhub_v2.py
```

Builder v3 menambahkan raw value, pencocokan pendidikan, confidence, dan status kualitas:

```powershell
python tools/skd/build_kemenhub_v3.py
```

Output utama:

- `kemenhub-2024-v3-staging.csv`: upload/import ke batch staging.
- `kemenhub-2024-v3-review.csv`: baris yang harus dibandingkan dengan PDF.
- `kemenhub-2024-v3-report.json`: jumlah dan status kualitas.

Import lewat `/admin`, atau gunakan endpoint admin lokal:

```powershell
$env:ADMIN_PASSWORD="password-admin-lokal"
$env:ADMIN_BASE_URL="http://127.0.0.1:4175"
node tools/skd/import_staging_csv.mjs data/staging/kemenhub-2024-v3-staging.csv
```

## Aturan Kualitas

- `parsed`: struktur dan nilai terbaca konsisten, belum diverifikasi manusia.
- `auto_corrected`: koreksi deterministik ber-confidence tinggi, tetap belum verified.
- `needs_review`: wajib diperiksa pada `source_page` PDF asli.
- `verified`: sudah disetujui untuk publikasi.
- `rejected`: tidak boleh dipakai.

Batch `review` dan seluruh row non-`verified` tidak dapat dibaca pengguna publik.

## Evaluasi mesin rasionalisasi

Jalankan benchmark read-only setelah data atau formula rasionalisasi berubah:

```powershell
npm run skd:evaluate-rationalization
```

Evaluator mengambil sampel kecil lintas instansi dan status `P/L`, `P`, `TL`,
`TH`, `TMS`, serta `DIS`. Statistik formasi, peringkat, tie-break, verdict, dan
kontrak rekomendasi v5 dihitung ulang secara independen. Nomor peserta disamarkan
di laporan dan tidak ada data yang diubah.

Laporan JSON dan Markdown tersimpan di `output/` (diabaikan Git). Untuk cakupan
lebih besar atau batas audit formasi berbeda:

```powershell
npm run skd:evaluate-rationalization -- --sample-size 36 --max-formation-rows 30000
```

Script mengembalikan exit code `1` jika ada error logika. Warning seperti sampel
historis terbatas tetap dilaporkan tetapi tidak menggagalkan command.

## Test

```powershell
python -m unittest discover -s tools/skd -p "test_*.py"
```
