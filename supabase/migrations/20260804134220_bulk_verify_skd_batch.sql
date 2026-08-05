create or replace function public.bulk_verify_skd_batch(
  p_batch_id uuid,
  p_resolution_note text default 'Bulk verification approved by admin'
)
returns table (
  issues_resolved integer,
  scores_verified integer,
  formations_verified integer,
  batch_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch_status text;
  v_rejected_scores integer;
  v_rejected_formations integer;
  v_issues_resolved integer := 0;
  v_scores_verified integer := 0;
  v_formations_verified integer := 0;
  v_remaining_issues integer := 0;
begin
  select b.status
  into v_batch_status
  from public.skd_batches b
  where b.id = p_batch_id
  for update;

  if v_batch_status is null then
    raise exception 'Batch tidak ditemukan.';
  end if;

  if v_batch_status not in ('review', 'verified') then
    raise exception 'Batch harus berstatus review sebelum diverifikasi.';
  end if;

  select count(*)::integer
  into v_rejected_scores
  from public.skd_scores s
  where s.batch_id = p_batch_id
    and s.quality_status = 'rejected';

  select count(*)::integer
  into v_rejected_formations
  from public.skd_formations f
  where f.batch_id = p_batch_id
    and f.quality_status = 'rejected';

  if v_rejected_scores > 0 or v_rejected_formations > 0 then
    raise exception 'Batch masih memiliki data rejected dan tidak dapat diverifikasi massal.';
  end if;

  update public.skd_review_issues i
  set
    status = 'resolved',
    resolution_note = left(coalesce(nullif(trim(p_resolution_note), ''), 'Bulk verification approved by admin'), 500),
    resolved_at = now()
  where i.batch_id = p_batch_id
    and i.status = 'open';
  get diagnostics v_issues_resolved = row_count;

  update public.skd_scores s
  set quality_status = 'verified'
  where s.batch_id = p_batch_id
    and s.quality_status <> 'verified';
  get diagnostics v_scores_verified = row_count;

  update public.skd_formations f
  set quality_status = 'verified'
  where f.batch_id = p_batch_id
    and f.quality_status <> 'verified';
  get diagnostics v_formations_verified = row_count;

  select count(*)::integer
  into v_remaining_issues
  from public.skd_review_issues i
  where i.batch_id = p_batch_id
    and i.status = 'open';

  if v_remaining_issues > 0 then
    raise exception 'Masih ada issue terbuka setelah bulk verification.';
  end if;

  update public.skd_batches b
  set
    status = 'verified',
    review_issue_count = 0,
    verified_at = coalesce(b.verified_at, now())
  where b.id = p_batch_id;

  return query
  select
    v_issues_resolved,
    v_scores_verified,
    v_formations_verified,
    'verified'::text;
end;
$$;

revoke all on function public.bulk_verify_skd_batch(uuid, text) from public, anon, authenticated;
grant execute on function public.bulk_verify_skd_batch(uuid, text) to service_role;

comment on function public.bulk_verify_skd_batch(uuid, text) is
  'Atomically resolves all open review issues and verifies every non-rejected score and formation in one SKD batch.';

notify pgrst, 'reload schema';
