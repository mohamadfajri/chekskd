begin;

alter table public.leads
  add column if not exists consent_marketing boolean not null default false;

alter table public.result_sessions
  add column if not exists analysis_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists sender_wa_id text,
  add column if not exists last_inbound_message_id text,
  add column if not exists delivered_at timestamptz,
  add column if not exists card_rendered_at timestamptz;

update public.result_sessions
set expired_at = created_at + interval '30 minutes'
where expired_at is null;

alter table public.result_sessions
  alter column expired_at set default (now() + interval '30 minutes'),
  alter column expired_at set not null;

alter table public.result_sessions
  drop constraint if exists result_sessions_token_format_check,
  add constraint result_sessions_token_format_check
    check (token ~ '^RSKD-[A-HJ-NP-Z2-9]{5,8}$'),
  drop constraint if exists result_sessions_sender_wa_id_check,
  add constraint result_sessions_sender_wa_id_check
    check (sender_wa_id is null or sender_wa_id ~ '^[0-9]{8,20}$');

create unique index if not exists result_sessions_inbound_message_uidx
  on public.result_sessions (last_inbound_message_id)
  where last_inbound_message_id is not null;

create index if not exists result_sessions_expired_at_idx
  on public.result_sessions (expired_at);

comment on column public.leads.consent_marketing is
  'Optional consent for promotional WhatsApp messages, separate from the requested result delivery.';
comment on column public.result_sessions.analysis_snapshot is
  'Immutable versioned data used to render the WhatsApp result card consistently.';
comment on column public.result_sessions.sender_wa_id is
  'Actual WhatsApp sender identifier supplied by Hermes after the user sends the result token.';
comment on column public.result_sessions.last_inbound_message_id is
  'Hermes inbound message identifier used to make delivery retries idempotent.';

notify pgrst, 'reload schema';

commit;
