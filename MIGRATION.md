# MIGRATION.md — Cek Rasionalisasi SKD (cpnsguru.id)

Panduan memindahkan project ini ke luar Lovable dan menghubungkannya ke Supabase sendiri.

## 1. Stack

- React 19 + TypeScript
- Vite 8 + TanStack Start (SSR-ready). Bisa juga dijalankan sebagai SPA Vite murni jika di-eject.
- Tailwind CSS v4
- Supabase (Postgres + REST client via `@supabase/supabase-js`)
- Papaparse (CSV parsing di admin)

Semua business logic bebas Lovable Cloud. Yang dipakai hanya Supabase.

## 2. Struktur portable

```
src/
  lib/
    supabase/
      client.ts       # inisialisasi Supabase client (VITE_ envs)
      types.ts        # DB types
    analysis.ts       # pure logic: passing grade, zona, analysis text, token
  services/
    skdService.ts     # search / getById / counts
    leadService.ts    # createLeadAndSession, getSessionByToken
    adminService.ts   # importCsvRows
  components/         # UI reusable
  routes/             # TanStack Start routes
    api/wa-result.ts  # endpoint publik untuk Hermes (mock/real)
```

Tidak ada komponen yang query Supabase langsung — semua lewat `services/`.

## 3. Environment variables

Copy `.env.example` menjadi `.env`.

| Var | Wajib | Keterangan |
|---|---|---|
| `VITE_SUPABASE_URL` | ya | URL project Supabase |
| `VITE_SUPABASE_ANON_KEY` | ya | Anon/publishable key |
| `VITE_WHATSAPP_BOT_NUMBER` | ya | Nomor bot WA (format 62xxxxxxxxxx, tanpa `+`) |
| `VITE_ADMIN_PASSWORD` | ya (MVP) | Password statis untuk `/admin` |
| `SUPABASE_URL` | opsional | Untuk server-side (endpoint `/api/wa-result`). Fallback ke `VITE_` |
| `SUPABASE_PUBLISHABLE_KEY` | opsional | Sama seperti di atas |

## 4. Supabase schema

Jalankan SQL berikut di Supabase (SQL Editor):

```sql
-- pdf_sources
create table public.pdf_sources (
  id uuid primary key default gen_random_uuid(),
  tahun int,
  instansi text,
  file_name text,
  source_url text,
  total_pages int,
  imported_at timestamptz default now()
);

-- skd_formations
create table public.skd_formations (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.pdf_sources(id) on delete set null,
  tahun int,
  kode_instansi text,
  nama_instansi text,
  kode_jabatan text,
  jabatan text,
  kode_lokasi text,
  lokasi_formasi text,
  jenis_formasi text,
  pendidikan text,
  jumlah_formasi int,
  page_number int,
  created_at timestamptz default now()
);

-- skd_scores
create table public.skd_scores (
  id uuid primary key default gen_random_uuid(),
  formation_id uuid references public.skd_formations(id) on delete cascade,
  no_peserta text,
  nama text not null,
  pendidikan text,
  tahun_skd int,
  twk int,
  tiu int,
  tkp int,
  total int,
  keterangan text,
  nama_normalized text,
  source_page int,
  created_at timestamptz default now()
);
create index on public.skd_scores (nama);
create index on public.skd_scores (no_peserta);
-- Nanti untuk fuzzy search:
-- create extension if not exists pg_trgm;
-- create index on public.skd_scores using gin (nama gin_trgm_ops);

-- leads
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  score_id uuid references public.skd_scores(id) on delete set null,
  nama_panggilan text,
  whatsapp text,
  target_tahun text,
  target_instansi text,
  target_formasi text,
  rencana text,
  consent_whatsapp boolean default false,
  segment text,
  created_at timestamptz default now(),
  last_contacted_at timestamptz,
  opt_out_at timestamptz
);

-- result_sessions
create table public.result_sessions (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  score_id uuid references public.skd_scores(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  nama_peserta text,
  instansi text,
  formasi text,
  twk int, tiu int, tkp int, total int,
  zona text,
  analysis_text text,
  created_at timestamptz default now(),
  expired_at timestamptz,
  used_count int default 0
);
create index on public.result_sessions (token);

-- lead_events
create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  event_type text,
  metadata jsonb,
  created_at timestamptz default now()
);

-- Grants (Data API access)
grant select on public.skd_scores       to anon, authenticated;
grant select on public.skd_formations   to anon, authenticated;
grant insert on public.leads            to anon, authenticated;
grant insert on public.result_sessions  to anon, authenticated;
grant select on public.result_sessions  to anon, authenticated;
grant insert, select on public.skd_formations to authenticated; -- admin import
grant insert, select on public.skd_scores      to authenticated; -- admin import

-- RLS (MVP: read publik, insert publik untuk lead/session)
alter table public.skd_scores       enable row level security;
alter table public.skd_formations   enable row level security;
alter table public.leads            enable row level security;
alter table public.result_sessions  enable row level security;
alter table public.lead_events      enable row level security;
alter table public.pdf_sources      enable row level security;

create policy "public read scores"       on public.skd_scores      for select to anon, authenticated using (true);
create policy "public read formations"   on public.skd_formations  for select to anon, authenticated using (true);
create policy "public insert leads"      on public.leads           for insert to anon, authenticated with check (true);
create policy "public insert sessions"   on public.result_sessions for insert to anon, authenticated with check (true);
create policy "public read sessions"     on public.result_sessions for select to anon, authenticated using (true);
-- Admin import (untuk MVP, sementara izinkan authenticated insert; produksi: pindahkan ke service role):
create policy "auth insert formations"   on public.skd_formations  for insert to authenticated with check (true);
create policy "auth insert scores"       on public.skd_scores      for insert to authenticated with check (true);
```

> Catatan produksi: matikan `insert` publik ke `leads`/`result_sessions` dan pindahkan ke Edge Function
> yang memvalidasi input. Untuk MVP tanpa login, insert publik masih dapat diterima.

## 5. Menjalankan lokal

```bash
bun install
cp .env.example .env   # isi env
bun run dev
```

Aplikasi tersedia di `http://localhost:8080`.

## 6. Endpoint untuk Hermes (Bot WhatsApp)

MVP menyediakan route TanStack: `GET /api/wa-result?token=RSKD-XXXXX`.

Response:
```json
{ "success": true, "message": "<analysis_text lengkap siap kirim ke WA>" }
```
atau
```json
{ "success": false, "message": "Kode hasil tidak ditemukan. Silakan cek ulang kode dari website cpnsguru.id." }
```

**Migrasi ke Supabase Edge Function** (opsional):
1. `supabase functions new wa-result`
2. Isi handler dengan logic yang sama: query `result_sessions` by token, kembalikan `analysis_text`.
3. Deploy: `supabase functions deploy wa-result --no-verify-jwt` (public).
4. Update URL di Hermes ke `https://<project>.supabase.co/functions/v1/wa-result?token=...`.

## 7. Migrasi ke React/Vite murni

TanStack Start bisa dibuang jika hanya butuh SPA:

1. Ganti `@tanstack/react-start` dengan `react-router-dom` v6.
2. Pindahkan setiap file di `src/routes/*.tsx` menjadi komponen page di `src/pages/`, wire ke `<BrowserRouter>`.
3. Pindahkan `src/routes/api/wa-result.ts` menjadi Supabase Edge Function atau Express/Node endpoint terpisah.
4. `src/lib/`, `src/services/`, `src/components/` tetap tanpa perubahan.

## 8. CSV Import (admin)

Format kolom (header baris pertama, comma-separated):

```
tahun,nama_instansi,kode_instansi,jabatan,kode_jabatan,lokasi_formasi,jenis_formasi,pendidikan,jumlah_formasi,no_peserta,nama,tahun_skd,twk,tiu,tkp,total,keterangan,source_pdf,source_page
```

Importer akan:
1. Group by kombinasi `(tahun, kode_instansi, kode_jabatan, lokasi_formasi)` → insert ke `skd_formations`.
2. Insert baris ke `skd_scores` dengan `formation_id` yang sesuai.
3. Menghitung `nama_normalized` (lowercase + strip aksen) untuk pencarian.

## 9. Copywriting guardrail

Hindari kata: *pasti lulus*, *dijamin*, *resmi dari BKN*, *prediksi kelulusan pasti*.
Gunakan: *simulasi*, *rasionalisasi*, *analisa edukatif*, *estimasi zona*, *strategi persiapan*.
