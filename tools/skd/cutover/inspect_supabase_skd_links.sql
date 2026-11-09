-- Read-only inventory for the Supabase SQL Editor. No user records are returned.
with targets(oid) as (
  values ('public.skd_scores'::regclass), ('public.skd_formations'::regclass),
    ('public.skd_formation_stats'::regclass), ('public.skd_batches'::regclass),
    ('public.skd_sources'::regclass), ('public.skd_review_issues'::regclass),
    ('public.skd_education_aliases'::regclass)
)
select
  pg_size_pretty(pg_database_size(current_database())) as database_size,
  (select jsonb_object_agg(oid::text, pg_size_pretty(pg_total_relation_size(oid)))
    from targets) as skd_table_sizes,
  (select coalesce(jsonb_agg(jsonb_build_object('table', c.conrelid::regclass::text,
      'constraint', c.conname, 'target', c.confrelid::regclass::text)
      order by c.conrelid::regclass::text, c.conname), '[]'::jsonb)
    from pg_catalog.pg_constraint c
    where c.contype = 'f'
      and c.confrelid in (select oid from targets)
      and c.conrelid not in (select oid from targets)) as external_foreign_keys;
