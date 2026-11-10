-- Supabase only. Use the generated SQL with the tested backup count and SHA-256.
-- This template fails without those values. No CASCADE, no other table emptied.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';
set local time zone 'UTC';

lock table only public.skd_scores in access exclusive mode;

do $$
declare
  expected_count bigint := '__VERIFIED_SCORE_COUNT__'::bigint;
  expected_sha text := '__VERIFIED_SCORE_SHA256__';
  legacy_count bigint;
  legacy_sha text;
begin
  if expected_count <= 0 or expected_sha !~ '^[a-f0-9]{64}$' then
    raise exception 'Verified backup fingerprint missing; nothing removed';
  end if;
  if public.skd_cross_database_ready() is distinct from true then
    raise exception 'Account or queue still linked to the old SKD table; nothing removed';
  end if;
  if exists (
    select 1 from pg_catalog.pg_inherits where inhparent = 'public.skd_scores'::regclass
  ) then
    raise exception 'Unexpected child table; nothing removed';
  end if;
  if exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.skd_scores'::regclass and not tgisinternal
      and (tgtype & 32) <> 0 and tgenabled <> 'D'
  ) then
    raise exception 'Unexpected TRUNCATE trigger; nothing removed';
  end if;
  if exists (
    select 1 from pg_catalog.pg_constraint
    where contype = 'f' and confrelid = 'public.skd_scores'::regclass
      and not (conrelid = 'public.skd_review_issues'::regclass
        and conname = 'skd_review_issues_score_id_fkey')
  ) then
    raise exception 'Unexpected score reference; nothing removed';
  end if;

  select count(*),
    encode(sha256(convert_to(string_agg(
      encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex'), '' order by s.id
    ),'UTF8')),'hex')
  into legacy_count, legacy_sha
  from public.skd_scores s;

  if legacy_count <> expected_count or legacy_sha is distinct from expected_sha then
    raise exception 'Score count or fingerprint differs from the restored backup; nothing removed';
  end if;
end;
$$;

-- Preserve every historical review row and its score UUID.
alter table public.skd_review_issues
  drop constraint if exists skd_review_issues_score_id_fkey;

truncate table only public.skd_scores continue identity restrict;
notify pgrst, 'reload schema';
commit;

select (select count(*) from public.skd_scores) as scores_remaining,
  pg_size_pretty(pg_total_relation_size('public.skd_scores')) as score_table_size,
  pg_size_pretty(pg_database_size(current_database())) as database_size;
