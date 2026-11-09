create table if not exists aesen.formation_categories (
  source_id text primary key references aesen.formations(source_id),
  category_code text not null check (category_code ~ '^[0-9]+$'),
  category text not null check (trim(category) <> ''),
  evidence_source text not null check (evidence_source in ('archive', 'detail_api')),
  verified_registered integer check (verified_registered >= 0),
  checked_at timestamptz not null default now(),
  check (evidence_source <> 'detail_api' or verified_registered is not null)
);

create table if not exists aesen.skd_zero_recaps (
  formation_id uuid primary key,
  institution text not null,
  job text not null,
  location text not null,
  education text not null,
  category text not null,
  pdf_page integer not null check (pdf_page > 0),
  quota integer not null check (quota > 0),
  pdf_sha256 text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  checked_at timestamptz not null default now()
);

create index if not exists skd_zero_recaps_institution_idx on aesen.skd_zero_recaps (institution);
alter table aesen.skd_zero_recaps add column if not exists source_id uuid;
