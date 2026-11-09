create or replace function public.bulk_verify_skd_batch_step(
  p_batch_id uuid,
  p_resolution_note text
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
set statement_timeout = '20s'
as $$
declare
  v_status text;
  v_changed integer;
  v_limit constant integer := 1500;
begin
  select b.status into v_status
  from public.skd_batches b where b.id = p_batch_id for update;

  if v_status is null then
    raise exception 'Batch tidak ditemukan.';
  end if;
  if v_status = 'verified' then
    return query select 0, 0, 0, 'verified'::text;
    return;
  end if;
  if v_status <> 'review' then
    raise exception 'Batch harus berstatus review sebelum diverifikasi.';
  end if;
  if exists (select 1 from public.skd_scores s
             where s.batch_id = p_batch_id and s.quality_status = 'rejected')
     or exists (select 1 from public.skd_formations f
                where f.batch_id = p_batch_id and f.quality_status = 'rejected') then
    raise exception 'Batch masih memiliki data rejected dan tidak dapat diverifikasi massal.';
  end if;

  update public.skd_scores s set quality_status = 'verified'
  where s.id in (
    select next.id from public.skd_scores next
    where next.batch_id = p_batch_id and next.quality_status in ('parsed', 'auto_corrected', 'needs_review')
    limit v_limit
  ) and s.quality_status in ('parsed', 'auto_corrected', 'needs_review');
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    return query select 0, v_changed, 0, 'review'::text;
    return;
  end if;

  update public.skd_formations f set quality_status = 'verified'
  where f.id in (
    select next.id from public.skd_formations next
    where next.batch_id = p_batch_id and next.quality_status in ('parsed', 'auto_corrected', 'needs_review')
    limit v_limit
  ) and f.quality_status in ('parsed', 'auto_corrected', 'needs_review');
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    return query select 0, 0, v_changed, 'review'::text;
    return;
  end if;

  update public.skd_review_issues i
  set status = 'resolved',
      resolution_note = left(coalesce(nullif(trim(p_resolution_note), ''), 'Bulk verification approved by admin'), 500),
      resolved_at = now()
  where i.id in (
    select next.id from public.skd_review_issues next
    where next.batch_id = p_batch_id and next.status = 'open'
    limit v_limit
  ) and i.status = 'open';
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    return query select v_changed, 0, 0, 'review'::text;
    return;
  end if;

  -- The batch stays private until all steps finish; publication remains separate.
  if exists (select 1 from public.skd_scores s where s.batch_id = p_batch_id and s.quality_status <> 'verified')
     or exists (select 1 from public.skd_formations f where f.batch_id = p_batch_id and f.quality_status <> 'verified')
     or exists (select 1 from public.skd_review_issues i where i.batch_id = p_batch_id and i.status = 'open') then
    raise exception 'Data batch berubah saat diverifikasi. Muat ulang Review dan coba lagi.';
  end if;
  update public.skd_batches b
  set status = 'verified', review_issue_count = 0, verified_at = coalesce(b.verified_at, now())
  where b.id = p_batch_id;
  return query select 0, 0, 0, 'verified'::text;
end;
$$;

revoke all on function public.bulk_verify_skd_batch_step(uuid, text) from public, anon, authenticated;
grant execute on function public.bulk_verify_skd_batch_step(uuid, text) to service_role;

notify pgrst, 'reload schema';
