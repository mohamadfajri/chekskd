-- Read-only checks before applying the SSCASN migration and importing the catalog.
select current_database() as database_name,
  pg_database_size(current_database()) as database_bytes,
  pg_size_pretty(pg_database_size(current_database())) as database_size;

select c.relname as table_name,
  pg_total_relation_size(c.oid) as total_bytes,
  pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
  pg_size_pretty(pg_indexes_size(c.oid)) as index_size,
  c.relrowsecurity as rls_enabled
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r'
  and (c.relname like 'skd_%' or c.relname like 'sscasn_%')
order by pg_total_relation_size(c.oid) desc;

select to_regclass('public.sscasn_snapshots') as snapshot_table,
  to_regclass('public.sscasn_formations') as catalog_table,
  to_regclass('public.sscasn_matches') as mapping_table,
  to_regprocedure('public.get_approved_sscasn_context(uuid[])') as context_function,
  has_table_privilege('service_role','public.skd_formations','SELECT') as backend_can_read_formations,
  has_table_privilege('service_role','public.skd_batches','SELECT') as backend_can_read_batches;

select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='skd_formations'
  and column_name in ('id','batch_id','tahun','nama_instansi','jabatan','quality_status')
order by column_name;
