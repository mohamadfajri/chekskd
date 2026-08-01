# SKD Data Staging

Folder ini menyimpan bahan riset lokal sebelum masuk ke Supabase.

- `raw/`: export spreadsheet dan PDF asli, diabaikan Git.
- `staging/`: CSV/JSON hasil parser, diabaikan Git.
- `.gitkeep`: menjaga struktur folder tetap ada di repo.

Data diproses per instansi dengan alur berikut:

1. Buat katalog sumber dari spreadsheet.
2. Download PDF dan identifikasi keluarga layout-nya.
3. Jalankan parser khusus instansi.
4. Validasi skor, nomor peserta, formasi, pendidikan, dan halaman sumber.
5. Masukkan CSV parser v3 ke staging Supabase melalui `/admin`.
6. Periksa baris `needs_review` terhadap PDF asli.
7. Publish hanya setelah seluruh data yang akan ditampilkan berstatus `verified`.

Kemenhub saat ini menggunakan:

```text
data/staging/kemenhub-2024-v3-staging.csv
```

File tersebut tidak dianggap siap publish. Ringkasan kualitas tersedia pada
`kemenhub-2024-v3-report.json`, sedangkan baris yang perlu pemeriksaan ada pada
`kemenhub-2024-v3-review.csv`.
