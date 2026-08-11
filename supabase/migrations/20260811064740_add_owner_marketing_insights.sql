begin;

create or replace function public.get_skd_marketing_insights()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with funnel as (
    select
      (select count(*) from public.leads)::integer as leads,
      (select count(*) from public.result_sessions)::integer as codes_created,
      (select count(*) from public.result_sessions where used_count > 0)::integer as requested_on_whatsapp,
      (
        select count(*)
        from public.result_sessions
        where rationalization_snapshot <> '{}'::jsonb
      )::integer as analyses_completed,
      (
        select count(*)
        from public.result_sessions
        where delivered_at is not null or status = 'delivered'
      )::integer as results_delivered,
      (
        select count(*)
        from public.leads
        where whatsapp is not null
          and consent_marketing
          and opt_out_at is null
      )::integer as marketing_ready
  ),
  segment_rows as (
    select coalesce(segment, 'unclassified') as label, count(*)::integer as total
    from public.leads
    group by coalesce(segment, 'unclassified')
  ),
  segments as (
    select coalesce(jsonb_object_agg(label, total), '{}'::jsonb) as value
    from segment_rows
  ),
  mode_rows as (
    select recommendation_mode as label, count(*)::integer as total
    from public.leads
    group by recommendation_mode
  ),
  modes as (
    select coalesce(jsonb_object_agg(label, total), '{}'::jsonb) as value
    from mode_rows
  ),
  priority_rows as (
    select
      coalesce(rationalization_snapshot #>> '{score_profile,priority_subtest}', 'unknown') as label,
      count(*)::integer as total
    from public.result_sessions
    where rationalization_snapshot <> '{}'::jsonb
    group by coalesce(rationalization_snapshot #>> '{score_profile,priority_subtest}', 'unknown')
  ),
  priorities as (
    select coalesce(jsonb_object_agg(label, total), '{}'::jsonb) as value
    from priority_rows
  ),
  recommendation_rows as (
    select item->>'institution' as institution
    from public.result_sessions session
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(session.rationalization_snapshot->'target_recommendations') = 'array'
          then session.rationalization_snapshot->'target_recommendations'
        else '[]'::jsonb
      end
    ) item
    where nullif(item->>'institution', '') is not null
  ),
  top_institutions as (
    select coalesce(
      jsonb_agg(jsonb_build_object('institution', ranked.institution, 'mentions', ranked.total)),
      '[]'::jsonb
    ) as value
    from (
      select institution, count(*)::integer as total
      from recommendation_rows
      group by institution
      order by total desc, institution
      limit 10
    ) ranked
  ),
  recent_daily as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'date', daily.day,
          'codes_created', daily.codes_created,
          'whatsapp_requests', daily.whatsapp_requests,
          'delivered', daily.delivered
        ) order by daily.day
      ),
      '[]'::jsonb
    ) as value
    from (
      select
        generated.day::date as day,
        count(session.id)::integer as codes_created,
        count(session.id) filter (where session.used_count > 0)::integer as whatsapp_requests,
        count(session.id) filter (
          where session.delivered_at is not null or session.status = 'delivered'
        )::integer as delivered
      from generate_series(
        current_date - interval '29 days',
        current_date,
        interval '1 day'
      ) generated(day)
      left join public.result_sessions session
        on session.created_at >= generated.day
        and session.created_at < generated.day + interval '1 day'
      group by generated.day
    ) daily
  )
  select jsonb_build_object(
    'generated_at', now(),
    'funnel', jsonb_build_object(
      'leads', funnel.leads,
      'codes_created', funnel.codes_created,
      'requested_on_whatsapp', funnel.requested_on_whatsapp,
      'analyses_completed', funnel.analyses_completed,
      'results_delivered', funnel.results_delivered,
      'marketing_ready', funnel.marketing_ready,
      'code_to_whatsapp_rate', case
        when funnel.codes_created = 0 then 0
        else round(funnel.requested_on_whatsapp::numeric * 100 / funnel.codes_created, 1)
      end,
      'delivery_rate', case
        when funnel.requested_on_whatsapp = 0 then 0
        else round(funnel.results_delivered::numeric * 100 / funnel.requested_on_whatsapp, 1)
      end
    ),
    'segments', segments.value,
    'recommendation_modes', modes.value,
    'priority_subtests', priorities.value,
    'top_recommended_institutions', top_institutions.value,
    'recent_daily', recent_daily.value
  )
  from funnel
  cross join segments
  cross join modes
  cross join priorities
  cross join top_institutions
  cross join recent_daily;
$$;

revoke all on function public.get_skd_marketing_insights()
from public, anon, authenticated;
grant execute on function public.get_skd_marketing_insights() to service_role;

comment on function public.get_skd_marketing_insights() is
  'Returns aggregate owner funnel and product-interest signals without using an LLM or scanning raw participant rows.';

notify pgrst, 'reload schema';

commit;
