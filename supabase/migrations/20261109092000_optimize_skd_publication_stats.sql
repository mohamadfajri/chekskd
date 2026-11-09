create or replace function private.refresh_skd_formation_stats(p_batch_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
-- A large newly verified batch can be underestimated before auto-analyze runs.
set enable_nestloop = off
as $$
declare
  v_rows integer;
begin
  if p_batch_id is null then
    delete from public.skd_formation_stats;
  else
    delete from public.skd_formation_stats where batch_id = p_batch_id;
  end if;

  with verified_formations as materialized (
    select f.id, f.batch_id, f.jumlah_formasi as quota
    from public.skd_formations f
    join public.skd_batches b on b.id = f.batch_id
    where b.status = 'published' and f.quality_status = 'verified'
      and (p_batch_id is null or f.batch_id = p_batch_id)
  ),
  verified_scores as materialized (
    select s.formation_id, s.keterangan, s.total, s.tkp, s.tiu, s.twk
    from public.skd_scores s
    join verified_formations f on f.id = s.formation_id
    where s.quality_status = 'verified'
  ),
  formation_aggregates as (
    select
      f.id, f.batch_id, f.quota,
      count(s.formation_id)::integer as participant_count,
      count(s.total)::integer as attended_count,
      count(*) filter (where s.keterangan = 'P' or s.keterangan like 'P/L%')::integer as passing_count,
      count(*) filter (where s.keterangan like 'P/L%')::integer as shortlisted_count,
      count(*) filter (where s.keterangan in ('TH', 'TMS', 'DIS'))::integer as no_show_count,
      min(s.total) as minimum_total,
      (percentile_cont(0.5) within group (order by s.total))::numeric(7,2) as median_total,
      (percentile_cont(0.75) within group (order by s.total))::numeric(7,2) as p75_total,
      max(s.total) as maximum_total
    from verified_formations f
    left join verified_scores s on s.formation_id = f.id
    group by f.id, f.batch_id, f.quota
  ),
  -- Group ties and pick the lowest shortlisted score once across this batch.
  cutoff as (
    select distinct on (s.formation_id)
      s.formation_id, s.total, s.tkp, s.tiu, s.twk, count(*)::integer as tie_count
    from verified_scores s
    where s.keterangan like 'P/L%'
    group by s.formation_id, s.total, s.tkp, s.tiu, s.twk
    order by s.formation_id, s.total, s.tkp, s.tiu, s.twk
  )
  insert into public.skd_formation_stats (
    formation_id, batch_id, calculated_at, quota, shortlist_capacity,
    participant_count, attended_count, passing_count, shortlisted_count, no_show_count,
    competition_ratio, minimum_total, median_total, p75_total, maximum_total,
    cutoff_total, cutoff_tkp, cutoff_tiu, cutoff_twk, cutoff_tie_count, capacity_consistent
  )
  select
    a.id, a.batch_id, now(), a.quota, a.quota * 3,
    a.participant_count, a.attended_count, a.passing_count, a.shortlisted_count, a.no_show_count,
    round(a.attended_count::numeric / nullif(a.quota, 0), 2),
    a.minimum_total, a.median_total, a.p75_total, a.maximum_total,
    c.total, c.tkp, c.tiu, c.twk, coalesce(c.tie_count, 0),
    a.shortlisted_count <= (a.quota * 3 + greatest(coalesce(c.tie_count, 0) - 1, 0))
  from formation_aggregates a
  left join cutoff c on c.formation_id = a.id;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function private.refresh_skd_formation_stats(uuid)
from public, anon, authenticated;

alter function public.publish_skd_batch(uuid) set statement_timeout = '45s';
notify pgrst, 'reload schema';
