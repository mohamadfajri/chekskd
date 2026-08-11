begin;

create index if not exists lead_events_type_created_idx
  on public.lead_events (event_type, created_at desc);

create or replace function public.skd_position_families(p_position text)
returns text[]
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  with normalized as (
    select upper(regexp_replace(coalesce(p_position, ''), '[^A-Za-z0-9]+', ' ', 'g')) as value
  )
  select array_remove(array[
    case when value ~ '(HUKUM|JAKSA|PERATURAN|PERUNDANG|LEGAL|ADVOKAT)' then 'hukum' end,
    case when value ~ '(KEUANGAN|ANGGARAN|AKUNTAN|AUDITOR|PAJAK|PERBENDAHARAAN)' then 'keuangan' end,
    case when value ~ '(INFORMATIKA|KOMPUTER|SIBER|SISTEM INFORMASI|TEKNOLOGI INFORMASI|PROGRAMMER)' then 'teknologi' end,
    case when value ~ '(DATA|STATISTIK|PENELITI|RISET)' then 'data_riset' end,
    case when value ~ '(KEPEGAWAIAN|SUMBER DAYA MANUSIA|TALENTA|PERSONALIA)' then 'sdm' end,
    case when value ~ '(HUMAS|KOMUNIKASI|PUBLIKASI|INFORMASI PUBLIK)' then 'komunikasi' end,
    case when value ~ '(PENGADAAN|BARANG JASA|LOGISTIK)' then 'pengadaan' end,
    case when value ~ '(ARSIP|PUSTAKA|DOKUMENTASI)' then 'arsip_pustaka' end,
    case when value ~ '(KEBIJAKAN|PEMERINTAHAN|PERENCANAAN)' then 'kebijakan' end,
    case when value ~ '(KESEHATAN|DOKTER|PERAWAT|FARMASI|GIZI)' then 'kesehatan' end,
    case when value ~ '(PENDIDIKAN|GURU|DOSEN|WIDYAISWARA)' then 'pendidikan' end,
    case when value ~ '(PERTANIAN|PANGAN|PERIKANAN|PETERNAKAN|KEHUTANAN)' then 'pangan_sda' end,
    case when value ~ '(TEKNIK|INFRASTRUKTUR|BANGUNAN|JALAN|PERUMAHAN)' then 'teknik_infrastruktur' end
  ], null)
  from normalized;
$$;

revoke all on function public.skd_position_families(text)
from public, anon, authenticated;
grant execute on function public.skd_position_families(text) to service_role;

comment on function public.skd_position_families(text) is
  'Maps CPNS position titles into conservative domain families used by rationalization v4.';

create or replace function public.get_skd_rationalization_v4(
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
      public.skd_position_families(source_formation.jabatan) as source_families,
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
      stats.shortlisted_count as target_shortlisted_count,
      stats.competition_ratio as target_competition_ratio,
      stats.minimum_total as target_minimum_total,
      stats.median_total as target_median_total,
      stats.maximum_total as target_maximum_total,
      stats.cutoff_total as target_cutoff_total,
      stats.cutoff_tkp as target_cutoff_tkp,
      stats.cutoff_tiu as target_cutoff_tiu,
      stats.cutoff_twk as target_cutoff_twk,
      stats.cutoff_tie_count as target_cutoff_tie_count,
      stats.capacity_consistent as target_capacity_consistent,
      stats.calculated_at as target_stats_calculated_at,
      coalesce(formation.id = p_preferred_target_formation_id, false) as is_preferred,
      case
        when upper(regexp_replace(trim(formation.jabatan), '\s+', ' ', 'g'))
          = upper(regexp_replace(trim(source.source_position), '\s+', ' ', 'g'))
          then 'same_position'
        when public.skd_position_families(formation.jabatan) && source.source_families
          then 'related_position'
        when public.skd_position_keywords(formation.jabatan) && source.source_keywords
          then 'related_position'
        else 'cross_position'
      end as position_relation,
      case
        when upper(regexp_replace(trim(formation.jabatan), '\s+', ' ', 'g'))
          = upper(regexp_replace(trim(source.source_position), '\s+', ' ', 'g')) then 1.00
        when public.skd_position_families(formation.jabatan) && source.source_families then 0.75
        when public.skd_position_keywords(formation.jabatan) && source.source_keywords then 0.55
        else 0.00
      end::numeric(4,2) as position_similarity,
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
      and stats.passing_count > 0
      and stats.cutoff_total is not null
    where (source.official_status = 'P' or source.official_status like 'P/L%')
      and source.user_total is not null
  ),
  dataset_coverage as (
    select
      count(*)::integer as formation_count,
      count(distinct formation.nama_instansi)::integer as institution_count
    from public.skd_formations formation
    join public.skd_batches batch
      on batch.id = formation.batch_id and batch.status = 'published'
    join public.skd_formation_stats stats
      on stats.formation_id = formation.id
      and stats.passing_count > 0
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
      eligible.target_capacity_consistent desc,
      case
        when eligible.target_passing_count >= 30 then 0
        when eligible.target_passing_count >= 10 then 1
        else 2
      end,
      eligible.score_gap desc nulls last,
      eligible.target_competition_ratio asc nulls last,
      eligible.target_attended_count desc,
      eligible.target_institution,
      eligible.target_position
    limit 200
  ),
  simulated as (
    select
      preselected.*,
      1 + (
        select count(*)
        from public.skd_scores peer
        where peer.formation_id = preselected.target_formation_id
          and peer.quality_status = 'verified'
          and (peer.keterangan = 'P' or peer.keterangan like 'P/L%')
          and (peer.total, peer.tkp, peer.tiu, peer.twk)
            > (preselected.user_total, preselected.user_tkp, preselected.user_tiu, preselected.user_twk)
      )::integer as simulated_rank,
      (
        select count(*)
        from public.skd_scores peer
        where peer.formation_id = preselected.target_formation_id
          and peer.quality_status = 'verified'
          and (peer.keterangan = 'P' or peer.keterangan like 'P/L%')
          and (peer.total, peer.tkp, peer.tiu, peer.twk)
            = (preselected.user_total, preselected.user_tkp, preselected.user_tiu, preselected.user_twk)
      )::integer as simulated_tied_count
    from preselected
  ),
  classified as (
    select
      simulated.*,
      case
        when simulated.simulated_rank <= greatest(simulated.target_quota, 1)
          then 'most_rational'
        when simulated.simulated_rank <= greatest(simulated.target_shortlist_capacity, 1)
          then 'competitive'
        when simulated.score_gap >= -10 then 'ambitious'
        else 'below'
      end as recommendation_tier,
      case
        when simulated.target_capacity_consistent
          and simulated.target_passing_count >= 30
          and simulated.target_shortlisted_count >= 3 then 'strong'
        when simulated.target_capacity_consistent
          and simulated.target_passing_count >= 10
          and simulated.target_shortlisted_count >= 1 then 'moderate'
        else 'limited'
      end as confidence_code,
      case
        when simulated.recommendation_mode = 'related'
          and simulated.position_relation = 'cross_position' then true
        else false
      end as is_mode_fallback
    from simulated
  ),
  scored as (
    select
      classified.*,
      least(
        550,
        classified.target_cutoff_total + case classified.confidence_code
          when 'strong' then 5
          when 'moderate' then 8
          else 12
        end
      )::integer as recommended_total,
      least(
        100,
        (case classified.recommendation_tier
          when 'most_rational' then 45
          when 'competitive' then 35
          when 'ambitious' then 22
          else 5
        end)
        + (case classified.confidence_code when 'strong' then 20 when 'moderate' then 12 else 4 end)
        + (case classified.position_relation when 'same_position' then 15 when 'related_position' then 10 else 0 end)
        + (case
            when classified.target_competition_ratio <= 10 then 10
            when classified.target_competition_ratio <= 25 then 6
            else 2
          end)
        + (case
            when classified.score_gap >= 10 then 10
            when classified.score_gap >= 0 then 7
            when classified.score_gap >= -10 then 3
            else 0
          end)
      )::integer as recommendation_score
    from classified
  ),
  diversified as (
    select
      scored.*,
      row_number() over (
        partition by scored.target_institution
        order by
          scored.is_preferred desc,
          scored.recommendation_score desc,
          scored.simulated_rank::numeric / greatest(scored.target_shortlist_capacity, 1),
          scored.score_gap desc,
          scored.target_position
      ) as institution_rank
    from scored
  ),
  selected as (
    select diversified.*
    from diversified
    order by
      diversified.is_preferred desc,
      diversified.is_mode_fallback,
      case when diversified.institution_rank = 1 then 0 else 1 end,
      diversified.recommendation_score desc,
      diversified.simulated_rank::numeric / greatest(diversified.target_shortlist_capacity, 1),
      diversified.score_gap desc,
      diversified.target_competition_ratio asc nulls last,
      diversified.target_institution,
      diversified.target_position
    limit 3
  ),
  recommendations as (
    select
      coalesce(
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
            'position_similarity', selected.position_similarity,
            'is_mode_fallback', selected.is_mode_fallback,
            'is_preferred', selected.is_preferred,
            'quota', selected.target_quota,
            'participants', selected.target_participant_count,
            'attended', selected.target_attended_count,
            'passing_grade', selected.target_passing_count,
            'eligible_pool', selected.target_passing_count,
            'shortlisted_historical', selected.target_shortlisted_count,
            'shortlist_capacity', selected.target_shortlist_capacity,
            'competition_ratio', selected.target_competition_ratio,
            'minimum_total', selected.target_minimum_total,
            'median_total', selected.target_median_total,
            'maximum_total', selected.target_maximum_total,
            'simulated_rank', selected.simulated_rank,
            'simulated_tied_count', selected.simulated_tied_count,
            'eligible_percentile', round(
              selected.simulated_rank::numeric * 100 / greatest(selected.target_passing_count, 1),
              1
            ),
            'score_gap_to_shortlist_cutoff', selected.score_gap,
            'score_needed_to_historical_cutoff', greatest(0, -selected.score_gap),
            'recommended_total', selected.recommended_total,
            'score_needed_to_recommended_total', greatest(
              0,
              selected.recommended_total - selected.user_total
            ),
            'above_historical_cutoff', selected.score_gap >= 0,
            'recommendation_score', selected.recommendation_score,
            'strategy', case selected.recommendation_tier
              when 'most_rational' then 'Pengaman historis'
              when 'competitive' then 'Target seimbang'
              when 'ambitious' then 'Target ambisius'
              else 'Perlu peningkatan'
            end,
            'risk_flags', to_jsonb(array_remove(array[
              case when selected.confidence_code = 'limited' then 'small_sample' end,
              case when selected.target_cutoff_tie_count > 1 then 'cutoff_tie' end,
              case when selected.is_mode_fallback then 'cross_position' end,
              case when selected.target_competition_ratio > 25 then 'high_competition' end,
              case when selected.score_gap < 0 then 'below_cutoff' end
            ], null)),
            'reason', case selected.recommendation_tier
              when 'most_rational' then format(
                'Nilai berada pada posisi %s dari %s peserta yang memenuhi PG dan masuk kuota historis.',
                selected.simulated_rank,
                selected.target_passing_count
              )
              when 'competitive' then format(
                'Nilai berada pada posisi %s dari %s peserta yang memenuhi PG dan masuk kapasitas SKB historis.',
                selected.simulated_rank,
                selected.target_passing_count
              )
              when 'ambitious' then format(
                'Nilai berjarak %s poin dari batas SKB historis sehingga masih layak menjadi target peningkatan.',
                abs(selected.score_gap)
              )
              else format(
                'Nilai masih berjarak %s poin dari batas SKB historis.',
                abs(selected.score_gap)
              )
            end,
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
              'ranking_pool', 'passing_grade_only',
              'capacity_consistent', selected.target_capacity_consistent,
              'stats_calculated_at', selected.target_stats_calculated_at
            )
          )
          order by
            selected.is_preferred desc,
            selected.is_mode_fallback,
            case when selected.institution_rank = 1 then 0 else 1 end,
            selected.recommendation_score desc,
            selected.score_gap desc
        ),
        '[]'::jsonb
      ) as items,
      count(*)::integer as returned_count,
      min(selected.recommended_total)::integer as minimum_recommended_total,
      min(greatest(0, selected.recommended_total - selected.user_total))::integer
        as minimum_score_increase
    from selected
  )
  select source.base_snapshot || jsonb_build_object(
    'version', 4,
    'recommendation_mode', source.recommendation_mode,
    'score_profile', jsonb_build_object(
      'eligible_for_simulation', source.official_status = 'P' or source.official_status like 'P/L%',
      'passing_thresholds', jsonb_build_object('twk', 65, 'tiu', 80, 'tkp', 166),
      'threshold_buffers', jsonb_build_object(
        'twk', source.user_twk - 65,
        'tiu', source.user_tiu - 80,
        'tkp', source.user_tkp - 166
      ),
      'priority_subtest', case
        when source.user_twk is null or source.user_tiu is null or source.user_tkp is null then null
        when source.user_twk - 65 <= source.user_tiu - 80
          and source.user_twk - 65 <= source.user_tkp - 166 then 'TWK'
        when source.user_tiu - 80 <= source.user_tkp - 166 then 'TIU'
        else 'TKP'
      end,
      'minimum_recommended_total', recommendations.minimum_recommended_total,
      'minimum_score_increase', recommendations.minimum_score_increase
    ),
    'methodology', jsonb_build_object(
      'model', 'v4_rule_based',
      'ranking_pool', 'passing_grade_only',
      'excluded_statuses', jsonb_build_array('TL', 'TH', 'TMS', 'DIS'),
      'score_order', jsonb_build_array('total', 'tkp', 'tiu', 'twk'),
      'uses_final_skb_result', false
    ),
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
        'Dihitung dari %s instansi dan %s formasi UMUM dengan peserta lolos PG terverifikasi.',
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

revoke all on function public.get_skd_rationalization_v4(uuid, text, uuid)
from public, anon, authenticated;
grant execute on function public.get_skd_rationalization_v4(uuid, text, uuid)
to service_role;

comment on function public.get_skd_rationalization_v4(uuid, text, uuid) is
  'Returns explainable Top 3 recommendations ranked only against historical passing-grade participants, with job families, reliability weighting, score targets, and risk flags.';

notify pgrst, 'reload schema';

commit;
