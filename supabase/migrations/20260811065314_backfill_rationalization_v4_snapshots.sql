begin;

with calculated as materialized (
  select
    session.id as session_id,
    session.lead_id,
    public.get_skd_rationalization_v4(
      session.score_id,
      case when lead.recommendation_mode = 'all' then 'all' else 'related' end,
      lead.target_formation_id
    ) as snapshot
  from public.result_sessions session
  left join public.leads lead on lead.id = session.lead_id
  where session.score_id is not null
    and session.rationalization_snapshot <> '{}'::jsonb
)
update public.result_sessions session
set rationalization_snapshot = calculated.snapshot,
    updated_at = now()
from calculated
where session.id = calculated.session_id
  and calculated.snapshot is not null;

with latest as (
  select distinct on (session.lead_id)
    session.lead_id,
    session.rationalization_snapshot as snapshot
  from public.result_sessions session
  where session.lead_id is not null
    and session.rationalization_snapshot->>'version' = '4'
  order by session.lead_id, session.created_at desc
)
update public.leads lead
set segment = case
  when latest.snapshot #>> '{verdict,code}' = 'ineligible' then 'needs_passing_grade'
  when jsonb_array_length(
    coalesce(latest.snapshot->'target_recommendations', '[]'::jsonb)
  ) = 0 then 'analysis_limited'
  when latest.snapshot #>> '{target_recommendations,0,recommendation_tier}' = 'most_rational'
    and coalesce(
      (latest.snapshot #>> '{target_recommendations,0,recommendation_score}')::integer,
      0
    ) >= 80 then 'competitive_ready'
  when latest.snapshot #>> '{target_recommendations,0,recommendation_tier}' = 'competitive'
    then 'competitive_growth'
  else 'score_improvement'
end
from latest
where lead.id = latest.lead_id;

commit;
