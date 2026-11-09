create schema if not exists aesen;
revoke all on schema aesen from public;

create extension if not exists pg_trgm with schema public;

create table if not exists aesen.snapshot (
  selection_year integer primary key check (selection_year = 2024),
  source_url text not null,
  captured_at timestamptz not null,
  checksum text not null,
  row_count integer not null check (row_count > 0)
);

create table if not exists aesen.institutions (
  name text primary key,
  level text not null check (level in ('pusat', 'daerah'))
);

create table if not exists aesen.formations (
  source_id text primary key,
  institution text not null references aesen.institutions(name),
  job text not null,
  location text not null,
  education text not null,
  quota integer not null check (quota >= 0),
  passed_admin integer not null check (passed_admin >= 0),
  salary_min double precision check (salary_min >= 0),
  salary_max double precision check (salary_max >= 0 and salary_max >= coalesce(salary_min, 0)),
  search_text text not null,
  education_keys text[] not null
);

create index if not exists aesen_institution_job_idx on aesen.formations (institution, job, source_id);
create index if not exists aesen_job_idx on aesen.formations (job, source_id);
create index if not exists aesen_quota_idx on aesen.formations (quota desc, institution, job, source_id);
create index if not exists aesen_search_idx on aesen.formations using gin (search_text public.gin_trgm_ops);
create index if not exists aesen_education_idx on aesen.formations using gin (education_keys);
