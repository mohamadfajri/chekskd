begin;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'legacy_20260731'
  loop
    execute format(
      'drop policy %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end
$$;

revoke all on function public.rls_auto_enable() from public, anon, authenticated;

alter extension pg_trgm set schema extensions;

create index lead_events_lead_id_idx on public.lead_events (lead_id);
create index leads_score_id_idx on public.leads (score_id);
create index result_sessions_lead_id_idx on public.result_sessions (lead_id);
create index result_sessions_score_id_idx on public.result_sessions (score_id);
create index skd_formations_source_id_idx on public.skd_formations (source_id);
create index skd_scores_source_id_idx on public.skd_scores (source_id);
create index skd_review_issues_formation_id_idx on public.skd_review_issues (formation_id);
create index skd_review_issues_score_id_idx on public.skd_review_issues (score_id);

notify pgrst, 'reload schema';

commit;
