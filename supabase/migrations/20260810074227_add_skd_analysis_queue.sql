begin;

alter table public.result_sessions
  add column if not exists status text not null default 'ready',
  add column if not exists rationalization_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists queued_at timestamptz,
  add column if not exists processing_started_at timestamptz,
  add column if not exists ready_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists failure_message text,
  add column if not exists updated_at timestamptz not null default now();

update public.result_sessions
set status = 'ready',
    ready_at = coalesce(ready_at, created_at),
    updated_at = now();

alter table public.result_sessions
  drop constraint if exists result_sessions_status_check,
  add constraint result_sessions_status_check
    check (status in (
      'waiting', 'queued', 'processing', 'ready', 'delivered', 'failed', 'expired'
    ));

create index if not exists result_sessions_status_created_idx
  on public.result_sessions (status, created_at);

drop trigger if exists result_sessions_set_updated_at on public.result_sessions;
create trigger result_sessions_set_updated_at
before update on public.result_sessions
for each row execute function private.set_updated_at();

create table public.skd_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique
    references public.result_sessions(id) on delete cascade,
  score_id uuid not null
    references public.skd_scores(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  worker_id text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index skd_analysis_jobs_claim_idx
  on public.skd_analysis_jobs (status, available_at, created_at);

create trigger skd_analysis_jobs_set_updated_at
before update on public.skd_analysis_jobs
for each row execute function private.set_updated_at();

alter table public.skd_analysis_jobs enable row level security;
revoke all on table public.skd_analysis_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.skd_analysis_jobs to service_role;

comment on table public.skd_analysis_jobs is
  'Compact deterministic rationalization queue. Standard SKD jobs do not require an LLM.';
comment on column public.result_sessions.rationalization_snapshot is
  'Deterministic historical positioning generated only after WhatsApp claims the token.';

create or replace function public.claim_skd_result_session(
  p_token text,
  p_sender text,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.result_sessions%rowtype;
  v_job_id uuid;
  v_is_new_message boolean;
begin
  if p_token !~ '^RSKD-[A-HJ-NP-Z2-9]{5,8}$'
    or p_sender !~ '^[0-9]{8,20}$'
    or nullif(btrim(p_message_id), '') is null
    or length(p_message_id) > 200 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  select session.*
  into v_session
  from public.result_sessions session
  where session.token = p_token
  for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if v_session.expired_at <= now() then
    update public.result_sessions
    set status = 'expired'
    where id = v_session.id and status <> 'delivered';
    return jsonb_build_object('outcome', 'expired');
  end if;

  if v_session.sender_wa_id is not null and v_session.sender_wa_id <> p_sender then
    return jsonb_build_object('outcome', 'sender_conflict');
  end if;

  if exists (
    select 1
    from public.result_sessions other_session
    where other_session.last_inbound_message_id = p_message_id
      and other_session.id <> v_session.id
  ) then
    return jsonb_build_object('outcome', 'duplicate_message');
  end if;

  v_is_new_message := v_session.last_inbound_message_id is distinct from p_message_id;
  if v_is_new_message then
    update public.result_sessions
    set sender_wa_id = p_sender,
        last_inbound_message_id = p_message_id,
        used_count = used_count + 1
    where id = v_session.id;

    if v_session.lead_id is not null then
      update public.leads
      set whatsapp = p_sender
      where id = v_session.lead_id;

      insert into public.lead_events (lead_id, event_type, metadata)
      values (
        v_session.lead_id,
        'rationalization_requested',
        jsonb_build_object('message_id', p_message_id, 'provider', 'hermes')
      );
    end if;
  end if;

  if v_session.status = 'waiting' then
    insert into public.skd_analysis_jobs (session_id, score_id)
    values (v_session.id, v_session.score_id)
    on conflict (session_id) do update
      set status = case
          when public.skd_analysis_jobs.status = 'failed' then 'queued'
          else public.skd_analysis_jobs.status
        end,
        available_at = case
          when public.skd_analysis_jobs.status = 'failed' then now()
          else public.skd_analysis_jobs.available_at
        end,
        error_message = case
          when public.skd_analysis_jobs.status = 'failed' then null
          else public.skd_analysis_jobs.error_message
        end
    returning id into v_job_id;

    update public.result_sessions
    set status = 'queued',
        queued_at = coalesce(queued_at, now()),
        failure_message = null,
        failed_at = null
    where id = v_session.id;
    v_session.status := 'queued';
  else
    select job.id
    into v_job_id
    from public.skd_analysis_jobs job
    where job.session_id = v_session.id;
  end if;

  return jsonb_build_object(
    'outcome', case
      when v_session.status in ('ready', 'delivered') then 'ready'
      when v_session.status = 'failed' then 'failed'
      when v_session.status = 'expired' then 'expired'
      else 'pending'
    end,
    'session_id', v_session.id,
    'job_id', v_job_id,
    'status', v_session.status,
    'is_new_message', v_is_new_message
  );
end;
$$;

revoke all on function public.claim_skd_result_session(text, text, text)
from public, anon, authenticated;
grant execute on function public.claim_skd_result_session(text, text, text)
to service_role;

create or replace function public.claim_next_skd_analysis_job(p_worker_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.skd_analysis_jobs%rowtype;
  v_session public.result_sessions%rowtype;
begin
  if nullif(btrim(p_worker_id), '') is null or length(p_worker_id) > 100 then
    return null;
  end if;

  update public.skd_analysis_jobs job
  set status = 'failed',
      completed_at = now(),
      error_message = 'result_session_expired'
  from public.result_sessions session
  where job.session_id = session.id
    and job.status = 'queued'
    and session.expired_at <= now();

  update public.result_sessions
  set status = 'expired'
  where status in ('waiting', 'queued')
    and expired_at <= now();

  with next_job as (
    select job.id
    from public.skd_analysis_jobs job
    join public.result_sessions session on session.id = job.session_id
    where job.status = 'queued'
      and job.available_at <= now()
      and session.expired_at > now()
    order by job.created_at
    for update of job skip locked
    limit 1
  )
  update public.skd_analysis_jobs job
  set status = 'processing',
      attempts = attempts + 1,
      claimed_at = now(),
      worker_id = p_worker_id,
      error_message = null
  from next_job
  where job.id = next_job.id
  returning job.* into v_job;

  if not found then
    return null;
  end if;

  update public.result_sessions
  set status = 'processing',
      processing_started_at = now()
  where id = v_job.session_id
  returning * into v_session;

  return jsonb_build_object(
    'job_id', v_job.id,
    'session_id', v_job.session_id,
    'score_id', v_job.score_id,
    'token', v_session.token,
    'sender', v_session.sender_wa_id,
    'attempt', v_job.attempts,
    'expires_at', v_session.expired_at
  );
end;
$$;

revoke all on function public.claim_next_skd_analysis_job(text)
from public, anon, authenticated;
grant execute on function public.claim_next_skd_analysis_job(text) to service_role;

create or replace function public.complete_skd_analysis_job(
  p_job_id uuid,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.skd_analysis_jobs%rowtype;
  v_session public.result_sessions%rowtype;
begin
  if p_snapshot is null or p_snapshot = '{}'::jsonb then
    return jsonb_build_object('outcome', 'invalid_snapshot');
  end if;

  select job.* into v_job
  from public.skd_analysis_jobs job
  where job.id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  update public.skd_analysis_jobs
  set status = 'completed',
      completed_at = coalesce(completed_at, now()),
      error_message = null
  where id = v_job.id;

  update public.result_sessions
  set status = 'ready',
      rationalization_snapshot = p_snapshot,
      ready_at = coalesce(ready_at, now()),
      failure_message = null,
      failed_at = null
  where id = v_job.session_id
  returning * into v_session;

  return jsonb_build_object(
    'outcome', 'ready',
    'session_id', v_session.id,
    'token', v_session.token,
    'sender', v_session.sender_wa_id,
    'expires_at', v_session.expired_at
  );
end;
$$;

revoke all on function public.complete_skd_analysis_job(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.complete_skd_analysis_job(uuid, jsonb) to service_role;

create or replace function public.fail_skd_analysis_job(
  p_job_id uuid,
  p_error_message text,
  p_retry_delay_seconds integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.skd_analysis_jobs%rowtype;
  v_retry boolean;
begin
  select job.* into v_job
  from public.skd_analysis_jobs job
  where job.id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  v_retry := v_job.attempts < 3;

  update public.skd_analysis_jobs
  set status = case when v_retry then 'queued' else 'failed' end,
      available_at = case
        when v_retry then now() + make_interval(secs => greatest(p_retry_delay_seconds, 0))
        else available_at
      end,
      completed_at = case when v_retry then null else now() end,
      error_message = left(coalesce(p_error_message, 'unknown_error'), 500)
  where id = v_job.id;

  update public.result_sessions
  set status = case when v_retry then 'queued' else 'failed' end,
      failed_at = case when v_retry then null else now() end,
      failure_message = left(coalesce(p_error_message, 'unknown_error'), 500)
  where id = v_job.session_id;

  return jsonb_build_object(
    'outcome', case when v_retry then 'retrying' else 'failed' end,
    'attempts', v_job.attempts
  );
end;
$$;

revoke all on function public.fail_skd_analysis_job(uuid, text, integer)
from public, anon, authenticated;
grant execute on function public.fail_skd_analysis_job(uuid, text, integer) to service_role;

create or replace function public.mark_skd_result_delivered(p_session_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.result_sessions
  set status = 'delivered',
      delivered_at = coalesce(delivered_at, now())
  where id = p_session_id
    and status in ('ready', 'delivered')
  returning true;
$$;

revoke all on function public.mark_skd_result_delivered(uuid)
from public, anon, authenticated;
grant execute on function public.mark_skd_result_delivered(uuid) to service_role;

notify pgrst, 'reload schema';

commit;
