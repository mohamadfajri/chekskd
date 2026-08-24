begin;

create or replace function api_private.get_skd_formation_filter_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_institutions jsonb;
  v_formation_types jsonb;
  v_education_options jsonb;
  v_education_total integer;
  v_years jsonb;
begin
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

  with raw_options as (
    select
      f.id as formation_id,
      upper(regexp_replace(btrim(option_name), '\s+', ' ', 'g')) as normalized_label
    from public.skd_formations f
    join public.skd_batches b on b.id = f.batch_id and b.status = 'published'
    cross join lateral unnest(coalesce(f.pendidikan_options, '{}'::text[])) option_name
    where f.quality_status = 'verified'
      and nullif(btrim(option_name), '') is not null
  ), canonical_options as (
    select distinct
      raw.formation_id,
      coalesce(
        upper(regexp_replace(btrim(alias.canonical_label), '\s+', ' ', 'g')),
        raw.normalized_label
      ) as value
    from raw_options raw
    left join public.skd_education_aliases alias
      on upper(regexp_replace(btrim(alias.normalized_label), '\s+', ' ', 'g'))
        = raw.normalized_label
      and alias.review_status = 'approved'
      and alias.match_kind in ('exact', 'equivalent')
  ), ranked as (
    select value, count(*)::bigint as total
    from canonical_options
    group by value
  ), alias_groups as (
    select
      upper(regexp_replace(btrim(alias.canonical_label), '\s+', ' ', 'g')) as value,
      array_agg(
        upper(regexp_replace(btrim(alias.normalized_label), '\s+', ' ', 'g'))
        order by upper(regexp_replace(btrim(alias.normalized_label), '\s+', ' ', 'g'))
      ) as aliases
    from public.skd_education_aliases alias
    where alias.review_status = 'approved'
      and alias.match_kind in ('exact', 'equivalent')
      and upper(regexp_replace(btrim(alias.normalized_label), '\s+', ' ', 'g'))
        <> upper(regexp_replace(btrim(alias.canonical_label), '\s+', ' ', 'g'))
    group by upper(regexp_replace(btrim(alias.canonical_label), '\s+', ' ', 'g'))
  ), numbered as (
    select
      ranked.value,
      ranked.total,
      coalesce(alias_groups.aliases, '{}'::text[]) as aliases,
      row_number() over (order by ranked.total desc, ranked.value) as position
    from ranked
    left join alias_groups on alias_groups.value = ranked.value
  )
  select
    count(*)::integer,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'value', value,
          'count', total,
          'aliases', aliases
        )
        order by total desc, value
      ) filter (where position <= 120),
      '[]'::jsonb
    )
  into v_education_total, v_education_options
  from numbered;

  select coalesce(jsonb_agg(options.selection_year order by options.selection_year desc), '[]'::jsonb)
  into v_years
  from (
    select distinct b.selection_year
    from public.skd_batches b
    where b.status = 'published'
  ) options;

  return jsonb_build_object(
    'institutions', v_institutions,
    'formation_types', v_formation_types,
    'education_options', v_education_options,
    'education_total', coalesce(v_education_total, 0),
    'years', v_years
  );
end;
$$;

revoke all on function api_private.get_skd_formation_filter_options()
from public, anon, authenticated;
grant execute on function api_private.get_skd_formation_filter_options()
to service_role;

comment on function api_private.get_skd_formation_filter_options() is
  'Returns public aggregate filter options with approved education aliases for display.';

notify pgrst, 'reload schema';

commit;
