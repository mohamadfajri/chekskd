alter table public.leads
add column if not exists recommendation_mode text not null default 'related';

alter table public.leads
drop constraint if exists leads_recommendation_mode_check;

alter table public.leads
add constraint leads_recommendation_mode_check
check (recommendation_mode in ('related', 'all'));

comment on column public.leads.recommendation_mode is
  'Controls automatic target recommendations: related position family or all exact-education formations.';

create or replace function public.skd_position_keywords(p_position text)
returns text[]
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select coalesce(array_agg(distinct token order by token), '{}'::text[])
  from regexp_split_to_table(
    upper(regexp_replace(coalesce(p_position, ''), '[^A-Za-z0-9]+', ' ', 'g')),
    '\s+'
  ) token
  where length(token) >= 4
    and token not in (
      'AHLI', 'PERTAMA', 'MUDA', 'MADYA', 'UTAMA', 'PEMULA', 'TERAMPIL',
      'MAHIR', 'PENYELIA', 'ANALIS', 'ASISTEN', 'PENGELOLA', 'PENATA',
      'PETUGAS', 'PRANATA', 'TEKNIS', 'ADMINISTRASI', 'APARATUR', 'NEGARA'
    );
$$;

revoke all on function public.skd_position_keywords(text)
from public, anon, authenticated;
grant execute on function public.skd_position_keywords(text)
to service_role;

comment on function public.skd_position_keywords(text) is
  'Extracts conservative domain keywords from a formation title for deterministic related-position matching.';

create or replace function public.get_skd_rationalization_v3(
  p_score_id uuid,
  p_recommendation_mode text default 'related',
  p_preferred_target_formation_id uuid default null
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
      source_formation.jabatan as source_position,
      public.skd_position_keywords(source_formation.jabatan) as source_keywords,
      public.get_skd_rationalization(score.id) as base_snapshot,
      case when p_recommendation_mode = 'all' then 'all' else 'related' end as recommendation_mode
    from public.skd_scores score
    join public.skd_batches source_batch
      on source_batch.id = score.batch_id
      and source_batch.status = 'published'
    join public.skd_formations source_formation
      on source_formation.id = score.formation_id
    where score.id = p_score_id
      and score.quality_status = 'verified'
      and score.pendidikan is not null
  ),
  eligible as (
    select
      source.*,
      formation.id as target_formation_id,
      target_batch.selection_year as target_selection_year,
      formation.nama_instansi as target_institution,
      formation.jabatan as target_position,
      formation.lokasi_formasi as target_location,
      formation.jenis_formasi as target_formation_type,
      formation.pendidikan as target_education_requirement,
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
      stats.calculated_at as target_stats_calculated_at,
      formation.id = p_preferred_target_formation_id as is_preferred,
      case
        when upper(regexp_replace(trim(formation.jabatan), '\s+', ' ', 'g'))
          = upper(regexp_replace(trim(source.source_position), '\s+', ' ', 'g'))
          then 'same_position'
        when public.skd_position_keywords(formation.jabatan) && source.source_keywords
          then 'related_position'
        else 'cross_position'
      end as position_relation,
      source.user_total - stats.cutoff_total as score_gap
    from source
    join public.skd_formations formation
      on formation.id <> source.source_formation_id
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
      and stats.attended_count > 0
      and stats.cutoff_total is not null
    where source.official_status not in ('TH', 'TMS', 'DIS', 'TL')
      and source.user_total is not null
  ),
  dataset_coverage as (
    select
      count(*)::integer as formation_count,
      count(distinct formation.nama_instansi)::integer as institution_count
    from public.skd_formations formation
    join public.skd_batches batch
      on batch.id = formation.batch_id
      and batch.status = 'published'
    join public.skd_formation_stats stats
      on stats.formation_id = formation.id
      and stats.attended_count > 0
      and stats.cutoff_total is not null
    where formation.quality_status = 'verified'
      and upper(trim(coalesce(formation.jenis_formasi, ''))) = 'UMUM'
  ),
  recommendation_coverage as (
    select
      count(*)::integer as eligible_formation_count,
      count(distinct eligible.target_institution)::integer as eligible_institution_count,
      count(*) filter (
        where eligible.position_relation in ('same_position', 'related_position')
      )::integer as related_formation_count
    from eligible
  ),
  preselected as (
    select eligible.*
    from eligible
    order by
      eligible.is_preferred desc,
      case
        when eligible.recommendation_mode = 'related'
          and eligible.position_relation = 'cross_position' then 1
        else 0
      end,
      coalesce(
        (eligible.user_total, eligible.user_tkp, eligible.user_tiu, eligible.user_twk)
          >= (
            eligible.target_cutoff_total,
            eligible.target_cutoff_tkp,
            eligible.target_cutoff_tiu,
            eligible.target_cutoff_twk
          ),
        false
      ) desc,
      eligible.score_gap desc nulls last,
      eligible.target_competition_ratio asc nulls last,
      eligible.target_attended_count desc,
      eligible.target_institution,
      eligible.target_position
    limit 150
  ),
  simulated as (
    select
      preselected.*,
      1 + (
        select count(*)
        from public.skd_scores peer
        where peer.formation_id = preselected.target_formation_id
          and peer.quality_status = 'verified'
          and peer.total is not null
          and (peer.total, peer.tkp, peer.tiu, peer.twk)
            > (
              preselected.user_total,
              preselected.user_tkp,
              preselected.user_tiu,
              preselected.user_twk
            )
      )::integer as simulated_rank,
      (
        select count(*)
        from public.skd_scores peer
        where peer.formation_id = preselected.target_formation_id
          and peer.quality_status = 'verified'
          and (peer.total, peer.tkp, peer.tiu, peer.twk)
            = (
              preselected.user_total,
              preselected.user_tkp,
              preselected.user_tiu,
              preselected.user_twk
            )
      )::integer as simulated_tied_count
    from preselected
  ),
  classified as (
    select
      simulated.*,
      case
        when simulated.simulated_rank <= greatest(simulated.target_quota, 1)
          then 'most_rational'
        when simulated.simulated_rank <= greatest(
          coalesce(simulated.target_shortlist_capacity, simulated.target_quota * 3),
          1
        ) then 'competitive'
        when simulated.score_gap >= -10 then 'ambitious'
        else 'below'
      end as recommendation_tier,
      case
        when simulated.target_capacity_consistent
          and simulated.target_attended_count >= 30 then 'strong'
        when simulated.target_attended_count >= 10 then 'moderate'
        else 'limited'
      end as confidence_code,
      case
        when simulated.recommendation_mode = 'related'
          and simulated.position_relation = 'cross_position' then true
        else false
      end as is_mode_fallback
    from simulated
  ),
  diversified as (
    select
      classified.*,
      row_number() over (
        partition by classified.target_institution
        order by
          classified.is_preferred desc,
          case classified.recommendation_tier
            when 'most_rational' then 0
            when 'competitive' then 1
            when 'ambitious' then 2
            else 3
          end,
          classified.simulated_rank::numeric
            / greatest(
                coalesce(classified.target_shortlist_capacity, classified.target_quota * 3),
                1
              ),
          classified.score_gap desc,
          classified.target_position
      ) as institution_rank
    from classified
  ),
  selected as (
    select diversified.*
    from diversified
    order by
      diversified.is_preferred desc,
      diversified.is_mode_fallback,
      case when diversified.institution_rank = 1 then 0 else 1 end,
      case diversified.recommendation_tier
        when 'most_rational' then 0
        when 'competitive' then 1
        when 'ambitious' then 2
        else 3
      end,
      case diversified.confidence_code
        when 'strong' then 0
        when 'moderate' then 1
        else 2
      end,
      diversified.simulated_rank::numeric
        / greatest(
            coalesce(diversified.target_shortlist_capacity, diversified.target_quota * 3),
            1
          ),
      diversified.score_gap desc,
      diversified.target_competition_ratio asc nulls last,
      diversified.target_institution,
      diversified.target_position
    limit 3
  ),
  recommendations as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'formation_id', selected.target_formation_id,
          'dataset_year', selected.target_selection_year,
          'institution', selected.target_institution,
          'position', selected.target_position,
          'location', selected.target_location,
          'formation_type', selected.target_formation_type,
          'education_requirement', selected.target_education_requirement,
          'education_match', 'exact',
          'position_relation', selected.position_relation,
          'is_mode_fallback', selected.is_mode_fallback,
          'is_preferred', selected.is_preferred,
          'quota', selected.target_quota,
          'participants', selected.target_participant_count,
          'attended', selected.target_attended_count,
          'passing_grade', selected.target_passing_count,
          'shortlist_capacity', selected.target_shortlist_capacity,
          'competition_ratio', selected.target_competition_ratio,
          'minimum_total', selected.target_minimum_total,
          'median_total', selected.target_median_total,
          'maximum_total', selected.target_maximum_total,
          'simulated_rank', selected.simulated_rank,
          'simulated_tied_count', selected.simulated_tied_count,
          'score_gap_to_shortlist_cutoff', selected.score_gap,
          'above_historical_cutoff', coalesce(
            (selected.user_total, selected.user_tkp, selected.user_tiu, selected.user_twk)
              >= (
                selected.target_cutoff_total,
                selected.target_cutoff_tkp,
                selected.target_cutoff_tiu,
                selected.target_cutoff_twk
              ),
            false
          ),
          'cutoff', jsonb_build_object(
            'total', selected.target_cutoff_total,
            'tkp', selected.target_cutoff_tkp,
            'tiu', selected.target_cutoff_tiu,
            'twk', selected.target_cutoff_twk
          ),
          'verdict', jsonb_build_object(
            'code', case selected.recommendation_tier
              when 'most_rational' then 'very_competitive'
              when 'competitive' then 'competitive'
              when 'ambitious' then 'close'
              else 'below'
            end,
            'label', case selected.recommendation_tier
              when 'most_rational' then 'Paling rasional'
              when 'competitive' then 'Kompetitif'
              when 'ambitious' then 'Pilihan ambisius'
              else 'Perlu peningkatan'
            end
          ),
          'recommendation_tier', selected.recommendation_tier,
          'confidence', jsonb_build_object(
            'code', selected.confidence_code,
            'label', case selected.confidence_code
              when 'strong' then 'Data kuat'
              when 'moderate' then 'Data cukup'
              else 'Data terbatas'
            end
          ),
          'data_quality', jsonb_build_object(
            'basis', 'official_2024_result',
            'capacity_consistent', selected.target_capacity_consistent,
            'stats_calculated_at', selected.target_stats_calculated_at
          )
        )
        order by
          selected.is_preferred desc,
          selected.is_mode_fallback,
          case when selected.institution_rank = 1 then 0 else 1 end,
          case selected.recommendation_tier
            when 'most_rational' then 0
            when 'competitive' then 1
            when 'ambitious' then 2
            else 3
          end,
          selected.simulated_rank::numeric
            / greatest(
                coalesce(selected.target_shortlist_capacity, selected.target_quota * 3),
                1
              ),
          selected.score_gap desc
      ),
      '[]'::jsonb
    ) as items,
    count(*)::integer as returned_count
    from selected
  )
  select source.base_snapshot || jsonb_build_object(
    'version', 3,
    'recommendation_mode', source.recommendation_mode,
    'recommendation_summary', jsonb_build_object(
      'mode', source.recommendation_mode,
      'mode_label', case source.recommendation_mode
        when 'related' then 'Jabatan sejenis'
        else 'Semua sesuai pendidikan'
      end,
      'returned_count', recommendations.returned_count,
      'eligible_formations', recommendation_coverage.eligible_formation_count,
      'eligible_institutions', recommendation_coverage.eligible_institution_count,
      'related_formations', recommendation_coverage.related_formation_count,
      'dataset_formations', dataset_coverage.formation_count,
      'dataset_institutions', dataset_coverage.institution_count,
      'education_match', 'exact',
      'formation_type', 'UMUM',
      'scope_note', format(
        'Dihitung dari %s instansi dan %s formasi UMUM terverifikasi dalam database.',
        dataset_coverage.institution_count,
        dataset_coverage.formation_count
      )
    ),
    'target_recommendations', recommendations.items
  )
  from source
  cross join dataset_coverage
  cross join recommendation_coverage
  cross join recommendations
  where source.base_snapshot is not null;
$$;

revoke all on function public.get_skd_rationalization_v3(uuid, text, uuid)
from public, anon, authenticated;
grant execute on function public.get_skd_rationalization_v3(uuid, text, uuid)
to service_role;

comment on function public.get_skd_rationalization_v3(uuid, text, uuid) is
  'Returns deterministic Top 3 exact-education UMUM recommendations with related/all modes, confidence, diversification, and coverage.';

notify pgrst, 'reload schema';
