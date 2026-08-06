begin;

alter table public.skd_scores
  alter column nama_raw drop not null;

comment on column public.skd_scores.raw_payload is
  'Compact parser evidence for needs_review rows only; full staging rows stay in local audit CSV files.';
comment on column public.skd_formations.raw_payload is
  'Compact parser evidence for needs_review rows only; full staging rows stay in local audit CSV files.';

commit;
