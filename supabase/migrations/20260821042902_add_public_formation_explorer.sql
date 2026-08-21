begin;

create index if not exists skd_formations_location_trgm_idx
  on public.skd_formations using gin (lokasi_formasi gin_trgm_ops)
  where quality_status = 'verified';

create index if not exists skd_formations_education_trgm_idx
  on public.skd_formations using gin (pendidikan gin_trgm_ops)
  where quality_status = 'verified';

create or replace function api_private.search_public_skd_formations(
  p_query text default null,
  p_instansi text default null,
  p_pendidikan text default null,
  p_jenis_formasi text default null,
  p_competition_level text default null,
  p_sort text default 'competition_desc',
  p_page integer default 1,
  p_page_size integer default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_query text := nullif(regexp_replace(lower(btrim(coalesce(p_query, ''))), '[%_]', '', 'g'), '');
  v_instansi text := nullif(btrim(p_instansi), '');
  v_pendidikan text := nullif(regexp_replace(lower(btrim(coalesce(p_pendidikan, ''))), '[%_]', '', 'g'), '');
  v_jenis_formasi text := nullif(btrim(p_jenis_formasi), '');
  v_competition_level text := lower(nullif(btrim(p_competition_level), ''));
  v_sort text := lower(coalesce(nullif(btrim(p_sort), ''), 'competition_desc'));
  v_page integer := least(greatest(coalesce(p_page, 1), 1), 100000);
  v_page_size integer := least(greatest(coalesce(p_page_size, 24), 1), 48);
  v_offset integer;
  v_total bigint;
  v_formations jsonb;
  v_institutions jsonb;
  v_formation_types jsonb;
  v_years jsonb;
begin
  if v_competition_level not in ('low', 'medium', 'high') then
    v_competition_level := null;
  end if;

  if v_sort not in (
    'competition_desc',
    'competition_asc',
    'cutoff_desc',
    'quota_desc',
    'name_asc'
  ) then
    v_sort := 'competition_desc';
  end if;

  v_offset := (v_page - 1) * v_page_size;

  with filtered as materialized (
    select
      f.id,
      f.kode_instansi,
      f.nama_instansi,
      f.kode_jabatan,
      f.jabatan,
      f.lokasi_formasi,
      f.jenis_formasi,
      f.pendidikan,
      b.selection_year,
      s.quota,
      s.participant_count,
      s.attended_count,
      s.passing_count,
      s.competition_ratio,
      s.minimum_total,
      s.median_total,
      s.p75_total,
      s.maximum_total,
      s.cutoff_total,
      s.capacity_consistent,
      s.calculated_at
    from public.skd_formations f
    join public.skd_batches b
      on b.id = f.batch_id
      and b.status = 'published'
    join public.skd_formation_stats s
      on s.formation_id = f.id
      and s.batch_id = b.id
    where f.quality_status = 'verified'
      and (
        v_query is null
        or f.jabatan ilike '%' || v_query || '%'
        or f.lokasi_formasi ilike '%' || v_query || '%'
        or f.pendidikan ilike '%' || v_query || '%'
      )
      and (v_instansi is null or lower(f.nama_instansi) = lower(v_instansi))
      and (v_pendidikan is null or f.pendidikan ilike '%' || v_pendidikan || '%')
      and (
        v_jenis_formasi is null
        or coalesce(nullif(btrim(f.jenis_formasi), ''), 'Tidak tercatat') = v_jenis_formasi
      )
      and (
        v_competition_level is null
        or (v_competition_level = 'low' and s.competition_ratio <= 10)
        or (
          v_competition_level = 'medium'
          and s.competition_ratio > 10
          and s.competition_ratio <= 30
        )
        or (v_competition_level = 'high' and s.competition_ratio > 30)
      )
  ),
  counted as (
    select count(*)::bigint as total
    from filtered
  ),
  page_rows as (
    select
      id,
      kode_instansi,
      nama_instansi,
      kode_jabatan,
      jabatan,
      lokasi_formasi,
      jenis_formasi,
      pendidikan,
      selection_year,
      quota,
      participant_count,
      attended_count,
      passing_count,
      competition_ratio,
      minimum_total,
      median_total,
      p75_total,
      maximum_total,
      cutoff_total,
      capacity_consistent,
      calculated_at,
      case
        when capacity_consistent
          and attended_count >= 3
          and cutoff_total is not null then 'high'
        when attended_count >= 3 and cutoff_total is not null then 'medium'
        else 'limited'
      end as data_confidence
    from filtered
    order by
      case when v_sort = 'competition_desc' then competition_ratio end desc nulls last,
      case when v_sort = 'competition_asc' then competition_ratio end asc nulls last,
      case when v_sort = 'cutoff_desc' then cutoff_total end desc nulls last,
      case when v_sort = 'quota_desc' then quota end desc nulls last,
      case when v_sort = 'name_asc' then jabatan end asc nulls last,
      jabatan asc,
      id asc
    limit v_page_size
    offset v_offset
  )
  select
    counted.total,
    coalesce(
      jsonb_agg(to_jsonb(page_rows)) filter (where page_rows.id is not null),
      '[]'::jsonb
    )
  into v_total, v_formations
  from counted
  left join page_rows on true
  group by counted.total;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('value', options.nama_instansi, 'count', options.total)
      order by options.nama_instansi
    ),
    '[]'::jsonb
  )
  into v_institutions
  from (
    select f.nama_instansi, count(*)::bigint as total
    from public.skd_formations f
    join public.skd_batches b on b.id = f.batch_id and b.status = 'published'
    where f.quality_status = 'verified'
    group by f.nama_instansi
  ) options;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('value', options.jenis_formasi, 'count', options.total)
      order by options.total desc, options.jenis_formasi
    ),
    '[]'::jsonb
  )
  into v_formation_types
  from (
    select
      coalesce(nullif(btrim(f.jenis_formasi), ''), 'Tidak tercatat') as jenis_formasi,
      count(*)::bigint as total
    from public.skd_formations f
    join public.skd_batches b on b.id = f.batch_id and b.status = 'published'
    where f.quality_status = 'verified'
    group by 1
  ) options;

  select coalesce(jsonb_agg(options.selection_year order by options.selection_year desc), '[]'::jsonb)
  into v_years
  from (
    select distinct b.selection_year
    from public.skd_batches b
    where b.status = 'published'
  ) options;

  return jsonb_build_object(
    'formations', coalesce(v_formations, '[]'::jsonb),
    'pagination', jsonb_build_object(
      'page', v_page,
      'page_size', v_page_size,
      'total', coalesce(v_total, 0),
      'total_pages', greatest(1, ceil(coalesce(v_total, 0)::numeric / v_page_size)::integer)
    ),
    'available_filters', jsonb_build_object(
      'institutions', v_institutions,
      'formation_types', v_formation_types,
      'years', v_years
    )
  );
end;
$$;

revoke all on function api_private.search_public_skd_formations(
  text, text, text, text, text, text, integer, integer
) from public;
grant execute on function api_private.search_public_skd_formations(
  text, text, text, text, text, text, integer, integer
) to anon, authenticated, service_role;

create or replace function public.search_public_skd_formations(
  p_query text default null,
  p_instansi text default null,
  p_pendidikan text default null,
  p_jenis_formasi text default null,
  p_competition_level text default null,
  p_sort text default 'competition_desc',
  p_page integer default 1,
  p_page_size integer default 24
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select api_private.search_public_skd_formations(
    p_query,
    p_instansi,
    p_pendidikan,
    p_jenis_formasi,
    p_competition_level,
    p_sort,
    p_page,
    p_page_size
  );
$$;

revoke all on function public.search_public_skd_formations(
  text, text, text, text, text, text, integer, integer
) from public;
grant execute on function public.search_public_skd_formations(
  text, text, text, text, text, text, integer, integer
) to anon, authenticated, service_role;

comment on function api_private.search_public_skd_formations(
  text, text, text, text, text, text, integer, integer
) is 'Internal paginated formation explorer. Enforces published batches and verified formations.';

comment on function public.search_public_skd_formations(
  text, text, text, text, text, text, integer, integer
) is 'Public security-invoker wrapper for the paginated formation explorer.';

notify pgrst, 'reload schema';

commit;
