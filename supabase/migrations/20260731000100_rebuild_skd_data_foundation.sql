begin;

create schema if not exists legacy_20260731;
create schema if not exists private;

revoke all on schema legacy_20260731 from public, anon, authenticated;
revoke all on schema private from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'lead_events',
    'result_sessions',
    'leads',
    'skd_scores',
    'skd_formations',
    'pdf_sources'
  ]
  loop
    if to_regclass('public.' || table_name) is not null
      and to_regclass('legacy_20260731.' || table_name) is null then
      execute format('alter table public.%I set schema legacy_20260731', table_name);
    end if;
  end loop;
end
$$;

revoke all on all tables in schema legacy_20260731 from public, anon, authenticated;
revoke all on all sequences in schema legacy_20260731 from public, anon, authenticated;
revoke all on all functions in schema legacy_20260731 from public, anon, authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;

create table public.skd_batches (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  institution_code text,
  institution_name text not null,
  selection_year integer not null check (selection_year between 2000 and 2100),
  parser_family text not null,
  parser_version text not null,
  status text not null default 'draft'
    check (status in ('draft', 'importing', 'review', 'verified', 'published', 'rejected')),
  source_count integer not null default 0 check (source_count >= 0),
  source_page_count integer not null default 0 check (source_page_count >= 0),
  formation_count integer not null default 0 check (formation_count >= 0),
  participant_count integer not null default 0 check (participant_count >= 0),
  review_issue_count integer not null default 0 check (review_issue_count >= 0),
  quality_report jsonb not null default '{}'::jsonb,
  notes text,
  verified_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.skd_sources (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.skd_batches(id) on delete cascade,
  sheet_row integer,
  file_name text not null,
  drive_file_id text,
  source_url text not null,
  sha256 text,
  total_pages integer check (total_pages is null or total_pages > 0),
  document_type text not null default 'skd'
    check (document_type in ('skd', 'integration', 'unknown')),
  has_text_layer boolean,
  created_at timestamptz not null default now(),
  unique (batch_id, file_name)
);

create table public.skd_formations (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.skd_batches(id) on delete cascade,
  source_id uuid not null references public.skd_sources(id) on delete restrict,
  formation_key text not null,
  tahun integer not null check (tahun between 2000 and 2100),
  kode_instansi text,
  nama_instansi text not null,
  kode_jabatan text,
  jabatan text not null,
  kode_lokasi text,
  lokasi_formasi text,
  kode_jenis_formasi text,
  jenis_formasi text,
  pendidikan text,
  pendidikan_options text[] not null default '{}',
  jumlah_formasi integer not null default 0 check (jumlah_formasi >= 0),
  page_number integer check (page_number is null or page_number > 0),
  quality_status text not null default 'parsed'
    check (quality_status in ('parsed', 'auto_corrected', 'needs_review', 'verified', 'rejected')),
  parser_confidence numeric(5,4)
    check (parser_confidence is null or parser_confidence between 0 and 1),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, formation_key)
);

create table public.skd_scores (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.skd_batches(id) on delete cascade,
  source_id uuid not null references public.skd_sources(id) on delete restrict,
  formation_id uuid not null references public.skd_formations(id) on delete cascade,
  no_peserta text not null check (no_peserta ~ '^[0-9]{15,20}$'),
  nama text not null,
  nama_raw text,
  nama_normalized text not null,
  pendidikan text,
  pendidikan_raw text,
  tahun_skd integer check (tahun_skd is null or tahun_skd between 2000 and 2100),
  twk integer check (twk is null or twk between 0 and 150),
  tiu integer check (tiu is null or tiu between 0 and 175),
  tkp integer check (tkp is null or tkp between 0 and 225),
  total integer check (total is null or total between 0 and 550),
  keterangan text not null
    check (keterangan ~ '^(P/L(-[A-Z0-9]+)?|P|TL|TH|TMS|DIS)$'),
  source_page integer not null check (source_page > 0),
  quality_status text not null default 'parsed'
    check (quality_status in ('parsed', 'auto_corrected', 'needs_review', 'verified', 'rejected')),
  parser_confidence numeric(5,4)
    check (parser_confidence is null or parser_confidence between 0 and 1),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, no_peserta),
  constraint skd_scores_values_complete check (
    (
      twk is null and tiu is null and tkp is null and total is null
      and keterangan in ('TH', 'TMS', 'DIS')
    )
    or
    (
      twk is not null and tiu is not null and tkp is not null and total is not null
      and twk + tiu + tkp = total
    )
  )
);

create table public.skd_review_issues (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.skd_batches(id) on delete cascade,
  formation_id uuid references public.skd_formations(id) on delete cascade,
  score_id uuid references public.skd_scores(id) on delete cascade,
  field_name text not null,
  issue_code text not null,
  severity text not null default 'warning'
    check (severity in ('info', 'warning', 'error')),
  raw_value text,
  suggested_value text,
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  status text not null default 'open'
    check (status in ('open', 'resolved', 'ignored')),
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint skd_review_issue_target check (
    (formation_id is not null and score_id is null)
    or (formation_id is null and score_id is not null)
  )
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  score_id uuid references public.skd_scores(id) on delete set null,
  nama_panggilan text,
  whatsapp text,
  target_tahun text,
  target_instansi text,
  target_formasi text,
  rencana text,
  consent_whatsapp boolean not null default false,
  segment text,
  created_at timestamptz not null default now(),
  last_contacted_at timestamptz,
  opt_out_at timestamptz
);

create table public.result_sessions (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  score_id uuid references public.skd_scores(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  nama_peserta text,
  instansi text,
  formasi text,
  twk integer,
  tiu integer,
  tkp integer,
  total integer,
  zona text,
  analysis_text text not null,
  created_at timestamptz not null default now(),
  expired_at timestamptz,
  used_count integer not null default 0
);

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  event_type text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index skd_batches_status_idx on public.skd_batches (status, selection_year);
create index skd_sources_batch_idx on public.skd_sources (batch_id);
create index skd_formations_batch_idx on public.skd_formations (batch_id);
create index skd_formations_instansi_idx on public.skd_formations (nama_instansi);
create index skd_formations_jabatan_idx on public.skd_formations (jabatan);
create index skd_scores_batch_idx on public.skd_scores (batch_id);
create index skd_scores_formation_idx on public.skd_scores (formation_id);
create index skd_scores_no_peserta_idx on public.skd_scores (no_peserta);
create index skd_scores_nama_trgm_idx on public.skd_scores using gin (nama_normalized gin_trgm_ops);
create index skd_review_issues_batch_status_idx on public.skd_review_issues (batch_id, status);
create trigger skd_batches_set_updated_at
before update on public.skd_batches
for each row execute function private.set_updated_at();

create trigger skd_formations_set_updated_at
before update on public.skd_formations
for each row execute function private.set_updated_at();

create trigger skd_scores_set_updated_at
before update on public.skd_scores
for each row execute function private.set_updated_at();

create trigger skd_review_issues_set_updated_at
before update on public.skd_review_issues
for each row execute function private.set_updated_at();

alter table public.skd_batches enable row level security;
alter table public.skd_sources enable row level security;
alter table public.skd_formations enable row level security;
alter table public.skd_scores enable row level security;
alter table public.skd_review_issues enable row level security;
alter table public.leads enable row level security;
alter table public.result_sessions enable row level security;
alter table public.lead_events enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.skd_batches, public.skd_sources, public.skd_formations, public.skd_scores
  to anon, authenticated;
grant all on public.skd_batches, public.skd_sources, public.skd_formations, public.skd_scores,
  public.skd_review_issues, public.leads, public.result_sessions, public.lead_events
  to service_role;

create policy "read published batches"
on public.skd_batches for select
to anon, authenticated
using (status = 'published');

create policy "read sources from published batches"
on public.skd_sources for select
to anon, authenticated
using (
  exists (
    select 1 from public.skd_batches b
    where b.id = batch_id and b.status = 'published'
  )
);

create policy "read verified published formations"
on public.skd_formations for select
to anon, authenticated
using (
  quality_status = 'verified'
  and exists (
    select 1 from public.skd_batches b
    where b.id = batch_id and b.status = 'published'
  )
);

create policy "read verified published scores"
on public.skd_scores for select
to anon, authenticated
using (
  quality_status = 'verified'
  and exists (
    select 1 from public.skd_batches b
    where b.id = batch_id and b.status = 'published'
  )
);

comment on schema legacy_20260731 is
  'Read-only rollback archive of the pre-batch SKD schema created on 2026-07-31.';
comment on table public.skd_batches is
  'One versioned, reviewable institution import. Only published batches are public.';
comment on table public.skd_review_issues is
  'Field-level parser/OCR issues that must be resolved before publication.';
comment on column public.skd_scores.raw_payload is
  'Compact parser evidence for needs_review rows only; full staging rows stay in local audit CSV files.';
comment on column public.skd_formations.raw_payload is
  'Compact parser evidence for needs_review rows only; full staging rows stay in local audit CSV files.';

notify pgrst, 'reload schema';

commit;
