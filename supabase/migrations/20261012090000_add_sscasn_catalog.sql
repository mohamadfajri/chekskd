begin;

create table public.sscasn_snapshots (
  id text primary key,
  selection_year integer not null check (selection_year between 2000 and 2100),
  source_url text not null,
  captured_at timestamptz not null,
  checksum text not null,
  scope_institution text,
  row_count integer not null check (row_count >= 0),
  quota_total bigint not null check (quota_total >= 0),
  passed_admin_total bigint not null check (passed_admin_total >= 0),
  import_status text not null default 'importing' check (import_status in ('importing','ready')),
  created_at timestamptz not null default now()
);

create table public.sscasn_formations (
  snapshot_id text not null references public.sscasn_snapshots(id) on delete restrict,
  source_id text not null,
  institution text not null,
  job text not null,
  location text not null,
  education text not null,
  education_options text[] not null default '{}',
  quota integer not null check (quota >= 0),
  passed_admin integer not null check (passed_admin >= 0),
  salary_min bigint check (salary_min is null or salary_min >= 0),
  salary_max bigint check (salary_max is null or (salary_max >= 0 and (salary_min is null or salary_max >= salary_min))),
  primary key (snapshot_id, source_id)
);

create index sscasn_formations_institution_job_idx
  on public.sscasn_formations(snapshot_id, institution, job, source_id);
create index sscasn_formations_education_idx on public.sscasn_formations using gin(education_options);

create table public.sscasn_institutions (
  snapshot_id text not null references public.sscasn_snapshots(id) on delete restrict,
  institution text not null,
  row_count integer not null,
  quota bigint not null,
  passed_admin bigint not null,
  primary key (snapshot_id, institution)
);

create table public.sscasn_matches (
  formation_id uuid primary key references public.skd_formations(id) on delete cascade,
  snapshot_id text not null,
  source_id text not null,
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected')),
  notes text,
  reviewed_at timestamptz,
  foreign key (snapshot_id, source_id) references public.sscasn_formations(snapshot_id,source_id) on delete restrict,
  check (review_status <> 'approved' or reviewed_at is not null)
);

create unique index sscasn_matches_approved_source_idx
  on public.sscasn_matches(snapshot_id,source_id) where review_status='approved';

create or replace function public.get_approved_sscasn_context(p_formation_ids uuid[])
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_object_agg(m.formation_id::text, jsonb_build_object(
    'snapshot_id', s.id, 'selection_year', s.selection_year,
    'source_url', s.source_url, 'captured_at', s.captured_at,
    'passed_admin', f.passed_admin, 'quota', f.quota,
    'administrative_ratio', case when f.quota > 0 then round(f.passed_admin::numeric/f.quota,2) end,
    'salary_min', f.salary_min, 'salary_max', f.salary_max
  )), '{}'::jsonb)
  from public.sscasn_matches m
  join public.sscasn_formations f on f.snapshot_id=m.snapshot_id and f.source_id=m.source_id
  join public.sscasn_snapshots s on s.id=f.snapshot_id
  join public.skd_formations pdf on pdf.id=m.formation_id
  join public.skd_batches b on b.id=pdf.batch_id
  where m.formation_id=any(p_formation_ids) and m.review_status='approved'
    and s.import_status='ready' and b.status='published' and pdf.quality_status='verified'
    and pdf.tahun=s.selection_year
    and upper(regexp_replace(trim(pdf.nama_instansi),'\s+',' ','g'))=upper(regexp_replace(trim(f.institution),'\s+',' ','g'))
    and upper(regexp_replace(trim(pdf.jabatan),'\s+',' ','g'))=upper(regexp_replace(trim(f.job),'\s+',' ','g'));
$$;

alter table public.sscasn_snapshots enable row level security;
alter table public.sscasn_formations enable row level security;
alter table public.sscasn_institutions enable row level security;
alter table public.sscasn_matches enable row level security;
revoke all on public.sscasn_snapshots,public.sscasn_formations,public.sscasn_institutions,public.sscasn_matches from public,anon,authenticated;
grant all on public.sscasn_snapshots,public.sscasn_formations,public.sscasn_institutions,public.sscasn_matches to service_role;
revoke all on function public.get_approved_sscasn_context(uuid[]) from public,anon,authenticated;
grant execute on function public.get_approved_sscasn_context(uuid[]) to service_role;
comment on column public.sscasn_formations.passed_admin is 'Pelamar lulus administrasi; bukan peserta hadir SKD atau probabilitas kelulusan.';
comment on table public.sscasn_matches is 'Human-reviewed one-to-one mapping. Missing source formation type prevents automatic approval.';
notify pgrst, 'reload schema';
commit;
