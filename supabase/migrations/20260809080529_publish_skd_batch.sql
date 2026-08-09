create or replace function public.publish_skd_batch(p_batch_id uuid)
returns table (
  participant_count integer,
  formation_count integer,
  batch_status text,
  published_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch_status text;
  v_open_issues integer;
  v_unverified_scores integer;
  v_unverified_formations integer;
  v_participant_count integer;
  v_formation_count integer;
  v_published_at timestamptz;
begin
  select b.status, b.published_at
  into v_batch_status, v_published_at
  from public.skd_batches b
  where b.id = p_batch_id
  for update;

  if v_batch_status is null then
    raise exception 'Batch tidak ditemukan.';
  end if;

  if v_batch_status = 'published' then
    select count(*)::integer
    into v_participant_count
    from public.skd_scores s
    where s.batch_id = p_batch_id;

    select count(*)::integer
    into v_formation_count
    from public.skd_formations f
    where f.batch_id = p_batch_id;

    return query
    select v_participant_count, v_formation_count, 'published'::text, v_published_at;
    return;
  end if;

  if v_batch_status <> 'verified' then
    raise exception 'Batch harus berstatus verified sebelum dipublikasikan.';
  end if;

  select count(*)::integer
  into v_open_issues
  from public.skd_review_issues i
  where i.batch_id = p_batch_id
    and i.status = 'open';

  select count(*)::integer
  into v_unverified_scores
  from public.skd_scores s
  where s.batch_id = p_batch_id
    and s.quality_status <> 'verified';

  select count(*)::integer
  into v_unverified_formations
  from public.skd_formations f
  where f.batch_id = p_batch_id
    and f.quality_status <> 'verified';

  if v_open_issues > 0 then
    raise exception 'Batch masih memiliki % issue terbuka.', v_open_issues;
  end if;

  if v_unverified_scores > 0 or v_unverified_formations > 0 then
    raise exception
      'Batch masih memiliki % peserta dan % formasi yang belum verified.',
      v_unverified_scores,
      v_unverified_formations;
  end if;

  select count(*)::integer
  into v_participant_count
  from public.skd_scores s
  where s.batch_id = p_batch_id;

  select count(*)::integer
  into v_formation_count
  from public.skd_formations f
  where f.batch_id = p_batch_id;

  if v_participant_count = 0 or v_formation_count = 0 then
    raise exception 'Batch kosong dan tidak dapat dipublikasikan.';
  end if;

  v_published_at := now();

  update public.skd_batches b
  set
    status = 'published',
    participant_count = v_participant_count,
    formation_count = v_formation_count,
    review_issue_count = 0,
    verified_at = coalesce(b.verified_at, v_published_at),
    published_at = v_published_at
  where b.id = p_batch_id;

  return query
  select v_participant_count, v_formation_count, 'published'::text, v_published_at;
end;
$$;

revoke all on function public.publish_skd_batch(uuid) from public, anon, authenticated;
grant execute on function public.publish_skd_batch(uuid) to service_role;

comment on function public.publish_skd_batch(uuid) is
  'Publishes one verified SKD batch only after every score and formation is verified and no review issue remains open.';

notify pgrst, 'reload schema';
