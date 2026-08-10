alter table public.leads
add column if not exists target_formation_id uuid
references public.skd_formations(id) on delete set null;

create index if not exists leads_target_formation_idx
on public.leads (target_formation_id)
where target_formation_id is not null;

comment on column public.leads.target_formation_id is
  'Verified general formation selected by the user for one-target historical simulation.';

create or replace function public.search_skd_target_formations(
  p_score_id uuid,
  p_query text,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with source as (
    select
      score.id,
      score.formation_id,
      score.pendidikan,
      score.total,
      score.tkp,
      score.tiu,
      score.twk
    from public.skd_scores score
    join public.skd_batches batch
      on batch.id = score.batch_id
      and batch.status = 'published'
    where score.id = p_score_id
      and score.quality_status = 'verified'
      and score.pendidikan is not null
  ),
  matches as (
    select
      formation.id,
      formation.nama_instansi,
      formation.jabatan,
      formation.lokasi_formasi,
      formation.jenis_formasi,
      formation.pendidikan,
      stats.quota,
      stats.attended_count,
      stats.competition_ratio,
      stats.cutoff_total,
      source.total - stats.cutoff_total as score_gap,
      coalesce(
        (source.total, source.tkp, source.tiu, source.twk)
          >= (stats.cutoff_total, stats.cutoff_tkp, stats.cutoff_tiu, stats.cutoff_twk),
        false
      ) as above_historical_cutoff,
      case
        when lower(formation.nama_instansi) = lower(trim(coalesce(p_query, ''))) then 0
        when lower(formation.jabatan) = lower(trim(coalesce(p_query, ''))) then 0
        when formation.nama_instansi ilike trim(coalesce(p_query, '')) || '%' then 1
        when formation.jabatan ilike trim(coalesce(p_query, '')) || '%' then 1
        else 2
      end as relevance
    from source
    join public.skd_formations formation
      on formation.id <> source.formation_id
      and formation.quality_status = 'verified'
      and upper(trim(coalesce(formation.jenis_formasi, ''))) = 'UMUM'
      and exists (
        select 1
        from unnest(coalesce(formation.pendidikan_options, '{}'::text[])) option_name
        where upper(regexp_replace(trim(option_name), '\s+', ' ', 'g'))
          = upper(regexp_replace(trim(source.pendidikan), '\s+', ' ', 'g'))
      )
    join public.skd_batches target_batch
      on target_batch.id = formation.batch_id
      and target_batch.status = 'published'
    join public.skd_formation_stats stats
      on stats.formation_id = formation.id
    where trim(coalesce(p_query, '')) = ''
       or formation.nama_instansi ilike '%' || trim(p_query) || '%'
       or formation.jabatan ilike '%' || trim(p_query) || '%'
       or coalesce(formation.lokasi_formasi, '') ilike '%' || trim(p_query) || '%'
  ),
  limited as (
    select *
    from matches
    order by
      relevance,
      above_historical_cutoff desc,
      abs(coalesce(score_gap, -9999)),
      competition_ratio nulls last,
      nama_instansi,
      jabatan
    limit least(greatest(coalesce(p_limit, 20), 1), 30)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', limited.id,
        'institution', limited.nama_instansi,
        'position', limited.jabatan,
        'location', limited.lokasi_formasi,
        'formation_type', limited.jenis_formasi,
        'education_requirement', limited.pendidikan,
        'quota', limited.quota,
        'attended', limited.attended_count,
        'competition_ratio', limited.competition_ratio,
        'cutoff_total', limited.cutoff_total,
        'score_gap', limited.score_gap,
        'above_historical_cutoff', limited.above_historical_cutoff
      )
      order by
        limited.relevance,
        limited.above_historical_cutoff desc,
        abs(coalesce(limited.score_gap, -9999)),
        limited.competition_ratio nulls last,
        limited.nama_instansi,
        limited.jabatan
    ),
    '[]'::jsonb
  )
  from limited;
$$;

revoke all on function public.search_skd_target_formations(uuid, text, integer)
from public, anon, authenticated;
grant execute on function public.search_skd_target_formations(uuid, text, integer)
to service_role;

comment on function public.search_skd_target_formations(uuid, text, integer) is
  'Returns verified published UMUM formations that exactly accept the participant education.';

create or replace function public.get_skd_rationalization_v2(
  p_score_id uuid,
  p_target_formation_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with source as (
    select
      score.id as score_id,
      score.formation_id as source_formation_id,
      score.pendidikan as participant_education,
      score.total as user_total,
      score.tkp as user_tkp,
      score.tiu as user_tiu,
      score.twk as user_twk,
      score.keterangan as official_status,
      public.get_skd_rationalization(score.id) as base_snapshot
    from public.skd_scores score
    join public.skd_batches batch
      on batch.id = score.batch_id
      and batch.status = 'published'
    where score.id = p_score_id
      and score.quality_status = 'verified'
      and score.pendidikan is not null
  ),
  target as (
    select
      formation.id as target_formation_id,
      formation.nama_instansi as target_institution,
      formation.jabatan as target_position,
      formation.lokasi_formasi as target_location,
      formation.jenis_formasi as target_formation_type,
      formation.pendidikan as target_education_requirement,
      target_batch.selection_year as target_selection_year,
      stats.quota as target_quota,
      stats.shortlist_capacity as target_shortlist_capacity,
      stats.participant_count as target_participant_count,
      stats.attended_count as target_attended_count,
      stats.passing_count as target_passing_count,
      stats.competition_ratio as target_competition_ratio,
      stats.minimum_total as target_minimum_total,
      stats.median_total as target_median_total,
      stats.maximum_total as target_maximum_total,
      stats.cutoff_total as target_cutoff_total,
      stats.cutoff_tkp as target_cutoff_tkp,
      stats.cutoff_tiu as target_cutoff_tiu,
      stats.cutoff_twk as target_cutoff_twk,
      stats.capacity_consistent as target_capacity_consistent,
      stats.calculated_at as target_stats_calculated_at
    from source
    join public.skd_formations formation
      on formation.id = p_target_formation_id
      and formation.id <> source.source_formation_id
      and formation.quality_status = 'verified'
      and upper(trim(coalesce(formation.jenis_formasi, ''))) = 'UMUM'
      and exists (
        select 1
        from unnest(coalesce(formation.pendidikan_options, '{}'::text[])) option_name
        where upper(regexp_replace(trim(option_name), '\s+', ' ', 'g'))
          = upper(regexp_replace(trim(source.participant_education), '\s+', ' ', 'g'))
      )
    join public.skd_batches target_batch
      on target_batch.id = formation.batch_id
      and target_batch.status = 'published'
    join public.skd_formation_stats stats
      on stats.formation_id = formation.id
  ),
  simulated as (
    select
      source.*,
      target.*,
      case
        when source.user_total is null then null
        else 1 + (
          select count(*)
          from public.skd_scores peer
          where peer.formation_id = target.target_formation_id
            and peer.quality_status = 'verified'
            and peer.total is not null
            and (peer.total, peer.tkp, peer.tiu, peer.twk)
              > (source.user_total, source.user_tkp, source.user_tiu, source.user_twk)
        )::integer
      end as simulated_rank,
      case
        when source.user_total is null then 0
        else (
          select count(*)
          from public.skd_scores peer
          where peer.formation_id = target.target_formation_id
            and peer.quality_status = 'verified'
            and (peer.total, peer.tkp, peer.tiu, peer.twk)
              = (source.user_total, source.user_tkp, source.user_tiu, source.user_twk)
        )::integer
      end as simulated_tied_count,
      source.user_total - target.target_cutoff_total as score_gap
    from source
    cross join target
  ),
  classified as (
    select
      simulated.*,
      case
        when simulated.official_status in ('TH', 'TMS', 'DIS') then 'unavailable'
        when simulated.official_status = 'TL' then 'ineligible'
        when simulated.user_total is null or simulated.target_cutoff_total is null then 'unavailable'
        when simulated.simulated_rank <= simulated.target_quota then 'very_competitive'
        when simulated.simulated_rank <= simulated.target_shortlist_capacity then 'competitive'
        when simulated.score_gap >= -10 then 'close'
        else 'below'
      end as target_verdict_code
    from simulated
  )
  select classified.base_snapshot || jsonb_build_object(
    'version', 2,
    'target_simulation', jsonb_build_object(
      'formation_id', classified.target_formation_id,
      'dataset_year', classified.target_selection_year,
      'institution', classified.target_institution,
      'position', classified.target_position,
      'location', classified.target_location,
      'formation_type', classified.target_formation_type,
      'education_requirement', classified.target_education_requirement,
      'education_match', 'exact',
      'quota', classified.target_quota,
      'participants', classified.target_participant_count,
      'attended', classified.target_attended_count,
      'passing_grade', classified.target_passing_count,
      'shortlist_capacity', classified.target_shortlist_capacity,
      'competition_ratio', classified.target_competition_ratio,
      'minimum_total', classified.target_minimum_total,
      'median_total', classified.target_median_total,
      'maximum_total', classified.target_maximum_total,
      'simulated_rank', classified.simulated_rank,
      'simulated_tied_count', classified.simulated_tied_count,
      'score_gap_to_shortlist_cutoff', classified.score_gap,
      'above_historical_cutoff', coalesce(
        (classified.user_total, classified.user_tkp, classified.user_tiu, classified.user_twk)
          >= (
            classified.target_cutoff_total,
            classified.target_cutoff_tkp,
            classified.target_cutoff_tiu,
            classified.target_cutoff_twk
          ),
        false
      ),
      'cutoff', jsonb_build_object(
        'total', classified.target_cutoff_total,
        'tkp', classified.target_cutoff_tkp,
        'tiu', classified.target_cutoff_tiu,
        'twk', classified.target_cutoff_twk
      ),
      'verdict', jsonb_build_object(
        'code', classified.target_verdict_code,
        'label', case classified.target_verdict_code
          when 'very_competitive' then 'Sangat kompetitif'
          when 'competitive' then 'Kompetitif'
          when 'close' then 'Dekat batas'
          when 'below' then 'Belum kompetitif'
          when 'ineligible' then 'Belum memenuhi ambang batas'
          else 'Data tidak dapat dianalisis'
        end
      ),
      'data_quality', jsonb_build_object(
        'basis', 'official_2024_result',
        'capacity_consistent', classified.target_capacity_consistent,
        'stats_calculated_at', classified.target_stats_calculated_at
      )
    )
  )
  from classified
  where classified.base_snapshot is not null;
$$;

revoke all on function public.get_skd_rationalization_v2(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.get_skd_rationalization_v2(uuid, uuid)
to service_role;

comment on function public.get_skd_rationalization_v2(uuid, uuid) is
  'Adds one exact-education UMUM target simulation to the original historical SKD rationalization.';

notify pgrst, 'reload schema';
