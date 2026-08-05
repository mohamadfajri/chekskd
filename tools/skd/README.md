# SKD Data Tools

Alat lokal untuk mengubah PDF SKD menjadi batch staging yang dapat diaudit.

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

## Test

```powershell
python -m unittest discover -s tools/skd -p "test_*.py"
```
