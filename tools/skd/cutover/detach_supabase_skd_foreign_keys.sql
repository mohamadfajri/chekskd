-- Prepare the account/result database to keep external SKD IDs.
-- Run only after validating the SumoPod copy and before enabling SKD writes there.
-- This transaction does not delete or update any records.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.leads
  drop constraint if exists leads_score_id_fkey,
  drop constraint if exists leads_target_formation_id_fkey;
alter table public.result_sessions
  drop constraint if exists result_sessions_score_id_fkey;
alter table public.skd_analysis_jobs
  drop constraint if exists skd_analysis_jobs_score_id_fkey;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_constraint
    where contype = 'f'
      and conrelid in ('public.leads'::regclass, 'public.result_sessions'::regclass,
        'public.skd_analysis_jobs'::regclass)
      and confrelid in ('public.skd_scores'::regclass, 'public.skd_formations'::regclass)
  ) then
    raise exception 'Unexpected SKD foreign key remains; no changes committed';
  end if;
end;
$$;

create or replace function public.skd_cross_database_ready()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select not exists (
    select 1
    from pg_catalog.pg_constraint
    where contype = 'f'
      and conrelid in ('public.leads'::regclass, 'public.result_sessions'::regclass,
        'public.skd_analysis_jobs'::regclass)
      and confrelid in ('public.skd_scores'::regclass, 'public.skd_formations'::regclass)
  );
$$;

revoke all on function public.skd_cross_database_ready() from public, anon, authenticated;
grant execute on function public.skd_cross_database_ready() to service_role;

notify pgrst, 'reload schema';
commit;

select public.skd_cross_database_ready() as ready_for_sumopod_admin;
