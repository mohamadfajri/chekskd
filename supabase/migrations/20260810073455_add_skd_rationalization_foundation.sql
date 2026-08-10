create table public.skd_formation_stats (
  formation_id uuid primary key references public.skd_formations(id) on delete cascade,
  batch_id uuid not null references public.skd_batches(id) on delete cascade,
  calculated_at timestamptz not null default now(),
  quota integer not null check (quota >= 0),
  shortlist_capacity integer not null check (shortlist_capacity >= 0),
  participant_count integer not null check (participant_count >= 0),
  attended_count integer not null check (attended_count >= 0),
  passing_count integer not null check (passing_count >= 0),
  shortlisted_count integer not null check (shortlisted_count >= 0),
  no_show_count integer not null check (no_show_count >= 0),
  competition_ratio numeric(10,2),
  minimum_total integer,
  median_total numeric(7,2),
  p75_total numeric(7,2),
  maximum_total integer,
  cutoff_total integer,
  cutoff_tkp integer,
  cutoff_tiu integer,
  cutoff_twk integer,
  cutoff_tie_count integer not null default 0 check (cutoff_tie_count >= 0),
  capacity_consistent boolean not null default true
);

create index skd_formation_stats_batch_idx
on public.skd_formation_stats (batch_id);

alter table public.skd_formation_stats enable row level security;

revoke all on table public.skd_formation_stats from public, anon, authenticated;
grant select, insert, update, delete on table public.skd_formation_stats to service_role;

comment on table public.skd_formation_stats is
  'Compact historical SKD statistics calculated once per verified formation. P/L and P labels are the source of truth for historical eligibility.';

create or replace function private.refresh_skd_formation_stats(p_batch_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_batch_id is null then
    delete from public.skd_formation_stats;
  else
    delete from public.skd_formation_stats stats
    using public.skd_formations formation
    where stats.formation_id = formation.id
      and formation.batch_id = p_batch_id;
  end if;

  with formation_aggregates as (
    select
      formation.id as formation_id,
      formation.batch_id,
      formation.jumlah_formasi as quota,
      formation.jumlah_formasi * 3 as shortlist_capacity,
      count(score.id)::integer as participant_count,
      count(score.id) filter (where score.total is not null)::integer as attended_count,
      count(score.id) filter (
        where score.keterangan = 'P' or score.keterangan like 'P/L%'
      )::integer as passing_count,
      count(score.id) filter (where score.keterangan like 'P/L%')::integer
        as shortlisted_count,
      count(score.id) filter (where score.keterangan in ('TH', 'TMS', 'DIS'))::integer
        as no_show_count,
      min(score.total) filter (where score.total is not null) as minimum_total,
      (
        percentile_cont(0.5) within group (order by score.total)
        filter (where score.total is not null)
      )::numeric(7,2) as median_total,
      (
        percentile_cont(0.75) within group (order by score.total)
        filter (where score.total is not null)
      )::numeric(7,2) as p75_total,
      max(score.total) filter (where score.total is not null) as maximum_total
    from public.skd_formations formation
    join public.skd_batches batch
      on batch.id = formation.batch_id
      and batch.status = 'published'
    left join public.skd_scores score
      on score.formation_id = formation.id
      and score.quality_status = 'verified'
    where formation.quality_status = 'verified'
      and (p_batch_id is null or formation.batch_id = p_batch_id)
    group by formation.id
  ),
  aggregate_with_cutoff as (
    select
      aggregate.*,
      cutoff.total as cutoff_total,
      cutoff.tkp as cutoff_tkp,
      cutoff.tiu as cutoff_tiu,
      cutoff.twk as cutoff_twk,
      coalesce(cutoff.cutoff_tie_count, 0) as cutoff_tie_count
    from formation_aggregates aggregate
    left join lateral (
      select
        score.total,
        score.tkp,
        score.tiu,
        score.twk,
        count(*) over (
          partition by score.total, score.tkp, score.tiu, score.twk
        )::integer as cutoff_tie_count
      from public.skd_scores score
      where score.formation_id = aggregate.formation_id
        and score.quality_status = 'verified'
        and score.keterangan like 'P/L%'
      order by score.total, score.tkp, score.tiu, score.twk
      limit 1
    ) cutoff on true
  )
  insert into public.skd_formation_stats (
    formation_id,
    batch_id,
    calculated_at,
    quota,
    shortlist_capacity,
    participant_count,
    attended_count,
    passing_count,
    shortlisted_count,
    no_show_count,
    competition_ratio,
    minimum_total,
    median_total,
    p75_total,
    maximum_total,
    cutoff_total,
    cutoff_tkp,
    cutoff_tiu,
    cutoff_twk,
    cutoff_tie_count,
    capacity_consistent
  )
  select
    aggregate.formation_id,
    aggregate.batch_id,
    now(),
    aggregate.quota,
    aggregate.shortlist_capacity,
    aggregate.participant_count,
    aggregate.attended_count,
    aggregate.passing_count,
    aggregate.shortlisted_count,
    aggregate.no_show_count,
    round(aggregate.attended_count::numeric / nullif(aggregate.quota, 0), 2),
    aggregate.minimum_total,
    aggregate.median_total,
    aggregate.p75_total,
    aggregate.maximum_total,
    aggregate.cutoff_total,
    aggregate.cutoff_tkp,
    aggregate.cutoff_tiu,
    aggregate.cutoff_twk,
    aggregate.cutoff_tie_count,
    aggregate.shortlisted_count <= (
      aggregate.shortlist_capacity + greatest(aggregate.cutoff_tie_count - 1, 0)
    )
  from aggregate_with_cutoff aggregate;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function private.refresh_skd_formation_stats(uuid)
from public, anon, authenticated;

create or replace function private.refresh_skd_formation_stats_after_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_skd_formation_stats(new.id);
  return new;
end;
$$;

revoke all on function private.refresh_skd_formation_stats_after_publish()
from public, anon, authenticated;

create trigger skd_batches_refresh_rationalization_stats
after update of status on public.skd_batches
for each row
when (new.status = 'published' and old.status is distinct from new.status)
execute function private.refresh_skd_formation_stats_after_publish();

create or replace function public.get_skd_rationalization(p_score_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with target as (
    select
      score.*,
      formation.nama_instansi,
      formation.jabatan,
      formation.lokasi_formasi,
      formation.jenis_formasi,
      formation.pendidikan as pendidikan_formasi,
      batch.selection_year,
      stats.quota,
      stats.shortlist_capacity,
      stats.participant_count,
      stats.attended_count,
      stats.passing_count,
      stats.shortlisted_count,
      stats.no_show_count,
      stats.competition_ratio,
      stats.minimum_total,
      stats.median_total,
      stats.p75_total,
      stats.maximum_total,
      stats.cutoff_total,
      stats.cutoff_tkp,
      stats.cutoff_tiu,
      stats.cutoff_twk,
      stats.cutoff_tie_count,
      stats.capacity_consistent,
      stats.calculated_at
    from public.skd_scores score
    join public.skd_batches batch
      on batch.id = score.batch_id
      and batch.status = 'published'
    join public.skd_formations formation
      on formation.id = score.formation_id
      and formation.quality_status = 'verified'
    join public.skd_formation_stats stats
      on stats.formation_id = score.formation_id
    where score.id = p_score_id
      and score.quality_status = 'verified'
  ),
  positioned as (
    select
      target.*,
      case
        when target.total is null then null
        else 1 + (
          select count(*)
          from public.skd_scores peer
          where peer.formation_id = target.formation_id
            and peer.quality_status = 'verified'
            and peer.total is not null
            and (peer.total, peer.tkp, peer.tiu, peer.twk)
              > (target.total, target.tkp, target.tiu, target.twk)
        )::integer
      end as overall_rank,
      case
        when target.keterangan = 'P' or target.keterangan like 'P/L%' then 1 + (
          select count(*)
          from public.skd_scores peer
          where peer.formation_id = target.formation_id
            and peer.quality_status = 'verified'
            and (peer.keterangan = 'P' or peer.keterangan like 'P/L%')
            and (peer.total, peer.tkp, peer.tiu, peer.twk)
              > (target.total, target.tkp, target.tiu, target.twk)
        )::integer
        else null
      end as passing_rank,
      case
        when target.total is null then 0
        else (
          select count(*)
          from public.skd_scores peer
          where peer.formation_id = target.formation_id
            and peer.quality_status = 'verified'
            and (peer.total, peer.tkp, peer.tiu, peer.twk)
              = (target.total, target.tkp, target.tiu, target.twk)
        )::integer
      end as tied_count
    from target
  ),
  classified as (
    select
      positioned.*,
      case
        when positioned.keterangan in ('TH', 'TMS', 'DIS') then 'unavailable'
        when positioned.keterangan = 'TL' then 'ineligible'
        when positioned.keterangan = 'P' then 'less_rational'
        when positioned.keterangan like 'P/L%'
          and positioned.passing_rank <= positioned.quota then 'strong'
        when positioned.keterangan like 'P/L%'
          and positioned.passing_rank <= positioned.quota * 2 then 'rational'
        when positioned.keterangan like 'P/L%' then 'borderline'
        else 'unavailable'
      end as verdict_code
    from positioned
  )
  select jsonb_build_object(
    'version', 1,
    'generated_at', now(),
    'score_id', classified.id,
    'formation_id', classified.formation_id,
    'dataset_year', classified.selection_year,
    'participant', jsonb_build_object(
      'name', classified.nama,
      'participant_number', classified.no_peserta,
      'education', classified.pendidikan,
      'twk', classified.twk,
      'tiu', classified.tiu,
      'tkp', classified.tkp,
      'total', classified.total,
      'official_status', classified.keterangan
    ),
    'formation', jsonb_build_object(
      'institution', classified.nama_instansi,
      'position', classified.jabatan,
      'location', classified.lokasi_formasi,
      'formation_type', classified.jenis_formasi,
      'education_requirement', classified.pendidikan_formasi,
      'quota', classified.quota
    ),
    'historical_position', jsonb_build_object(
      'overall_rank', classified.overall_rank,
      'passing_rank', classified.passing_rank,
      'tied_count', classified.tied_count,
      'top_percent', case
        when classified.overall_rank is null or classified.attended_count = 0 then null
        else round(classified.overall_rank::numeric * 100 / classified.attended_count, 1)
      end,
      'score_gap_to_shortlist_cutoff', case
        when classified.total is null or classified.cutoff_total is null then null
        else classified.total - classified.cutoff_total
      end
    ),
    'historical_stats', jsonb_build_object(
      'participants', classified.participant_count,
      'attended', classified.attended_count,
      'passing_grade', classified.passing_count,
      'shortlisted_for_skb', classified.shortlisted_count,
      'not_attended', classified.no_show_count,
      'shortlist_capacity', classified.shortlist_capacity,
      'competition_ratio', classified.competition_ratio,
      'minimum_total', classified.minimum_total,
      'median_total', classified.median_total,
      'p75_total', classified.p75_total,
      'maximum_total', classified.maximum_total,
      'cutoff', jsonb_build_object(
        'total', classified.cutoff_total,
        'tkp', classified.cutoff_tkp,
        'tiu', classified.cutoff_tiu,
        'twk', classified.cutoff_twk,
        'tied_count', classified.cutoff_tie_count
      )
    ),
    'verdict', jsonb_build_object(
      'code', classified.verdict_code,
      'label', case classified.verdict_code
        when 'strong' then 'Rasional kuat'
        when 'rational' then 'Rasional'
        when 'borderline' then 'Cukup rasional'
        when 'less_rational' then 'Kurang rasional'
        when 'ineligible' then 'Tidak memenuhi ambang batas'
        else 'Data tidak dapat dianalisis'
      end
    ),
    'data_quality', jsonb_build_object(
      'basis', 'official_2024_result',
      'capacity_consistent', classified.capacity_consistent,
      'stats_calculated_at', classified.calculated_at
    )
  )
  from classified;
$$;

revoke all on function public.get_skd_rationalization(uuid)
from public, anon, authenticated;
grant execute on function public.get_skd_rationalization(uuid) to service_role;

comment on function public.get_skd_rationalization(uuid) is
  'Returns deterministic historical SKD positioning for one verified score. It does not predict final CPNS graduation.';

select private.refresh_skd_formation_stats();

notify pgrst, 'reload schema';
