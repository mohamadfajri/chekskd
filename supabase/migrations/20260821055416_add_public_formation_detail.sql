begin;

create or replace function api_private.get_public_skd_formation_detail(
  p_formation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_detail jsonb;
  v_distribution jsonb;
  v_status_counts jsonb;
begin
  select jsonb_build_object(
    'id', f.id,
    'kode_instansi', f.kode_instansi,
    'nama_instansi', f.nama_instansi,
    'kode_jabatan', f.kode_jabatan,
    'jabatan', f.jabatan,
    'kode_lokasi', f.kode_lokasi,
    'lokasi_formasi', f.lokasi_formasi,
    'jenis_formasi', f.jenis_formasi,
    'pendidikan', f.pendidikan,
    'pendidikan_options', f.pendidikan_options,
    'selection_year', b.selection_year,
    'data_confidence', case
      when st.capacity_consistent
        and st.attended_count >= 3
        and st.cutoff_total is not null then 'high'
      when st.attended_count >= 3 and st.cutoff_total is not null then 'medium'
      else 'limited'
    end,
    'stats', jsonb_build_object(
      'quota', st.quota,
      'shortlist_capacity', st.shortlist_capacity,
      'participant_count', st.participant_count,
      'attended_count', st.attended_count,
      'passing_count', st.passing_count,
      'shortlisted_count', st.shortlisted_count,
      'no_show_count', st.no_show_count,
      'competition_ratio', st.competition_ratio,
      'minimum_total', st.minimum_total,
      'median_total', st.median_total,
      'p75_total', st.p75_total,
      'maximum_total', st.maximum_total,
      'cutoff_total', st.cutoff_total,
      'cutoff_twk', st.cutoff_twk,
      'cutoff_tiu', st.cutoff_tiu,
      'cutoff_tkp', st.cutoff_tkp,
      'cutoff_tie_count', st.cutoff_tie_count,
      'capacity_consistent', st.capacity_consistent,
      'calculated_at', st.calculated_at
    ),
    'source', jsonb_build_object(
      'file_name', src.file_name,
      'source_url', src.source_url,
      'page_number', f.page_number,
      'total_pages', src.total_pages,
      'document_type', src.document_type
    )
  )
  into v_detail
  from public.skd_formations f
  join public.skd_batches b
    on b.id = f.batch_id
    and b.status = 'published'
  join public.skd_formation_stats st
    on st.formation_id = f.id
    and st.batch_id = b.id
  left join public.skd_sources src
    on src.id = f.source_id
    and src.batch_id = b.id
  where f.id = p_formation_id
    and f.quality_status = 'verified'
  limit 1;

  if v_detail is null then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'from', buckets.bucket_start,
        'to', buckets.bucket_start + 24,
        'count', buckets.score_count
      )
      order by buckets.bucket_start
    ),
    '[]'::jsonb
  )
  into v_distribution
  from (
    select
      (floor(s.total / 25.0) * 25)::integer as bucket_start,
      count(*)::integer as score_count
    from public.skd_scores s
    where s.formation_id = p_formation_id
      and s.quality_status = 'verified'
      and s.total is not null
    group by 1
  ) buckets;

  select coalesce(
    jsonb_object_agg(statuses.status, statuses.score_count order by statuses.status),
    '{}'::jsonb
  )
  into v_status_counts
  from (
    select
      coalesce(nullif(btrim(s.keterangan), ''), 'TIDAK TERCATAT') as status,
      count(*)::integer as score_count
    from public.skd_scores s
    where s.formation_id = p_formation_id
      and s.quality_status = 'verified'
    group by 1
  ) statuses;

  return v_detail || jsonb_build_object(
    'score_distribution', v_distribution,
    'status_counts', v_status_counts
  );
end;
$$;

revoke all on function api_private.get_public_skd_formation_detail(uuid) from public;
grant execute on function api_private.get_public_skd_formation_detail(uuid)
  to anon, authenticated, service_role;

create or replace function public.get_public_skd_formation_detail(
  p_formation_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select api_private.get_public_skd_formation_detail(p_formation_id);
$$;

revoke all on function public.get_public_skd_formation_detail(uuid) from public;
grant execute on function public.get_public_skd_formation_detail(uuid)
  to anon, authenticated, service_role;

comment on function api_private.get_public_skd_formation_detail(uuid) is
  'Internal formation detail with aggregate score distribution. Enforces published and verified data.';

comment on function public.get_public_skd_formation_detail(uuid) is
  'Public security-invoker wrapper for one published and verified formation detail.';

notify pgrst, 'reload schema';

commit;
