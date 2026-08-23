begin;

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  whatsapp text not null unique,
  password_hash text not null,
  whatsapp_verified_at timestamptz,
  marketing_opt_in boolean not null default false,
  marketing_opt_in_at timestamptz,
  marketing_opt_out_at timestamptz,
  status text not null default 'active',
  failed_login_count smallint not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_whatsapp_check check (whatsapp ~ '^62[0-9]{8,13}$'),
  constraint app_users_password_hash_check check (length(password_hash) between 80 and 512),
  constraint app_users_status_check check (status in ('active', 'suspended')),
  constraint app_users_failed_login_count_check check (failed_login_count between 0 and 20),
  constraint app_users_marketing_consent_check check (
    (marketing_opt_in and marketing_opt_in_at is not null and marketing_opt_out_at is null)
    or (not marketing_opt_in)
  )
);

create table public.app_auth_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  code text not null unique,
  purpose text not null,
  expected_whatsapp text not null,
  poll_token_hash text not null,
  pending_password_hash text,
  sender_wa_id text,
  inbound_message_id text unique,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  verified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint app_auth_challenges_code_check check (code ~ '^AUTH-[A-HJ-NP-Z2-9]{8}$'),
  constraint app_auth_challenges_purpose_check check (purpose in ('signup', 'password_reset')),
  constraint app_auth_challenges_expected_whatsapp_check check (
    expected_whatsapp ~ '^62[0-9]{8,13}$'
  ),
  constraint app_auth_challenges_sender_check check (
    sender_wa_id is null or sender_wa_id ~ '^62[0-9]{8,13}$'
  ),
  constraint app_auth_challenges_poll_hash_check check (poll_token_hash ~ '^[a-f0-9]{64}$'),
  constraint app_auth_challenges_pending_password_check check (
    (purpose = 'signup' and pending_password_hash is null)
    or (purpose = 'password_reset' and pending_password_hash is not null)
  )
);

create table public.app_user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint app_user_sessions_token_hash_check check (token_hash ~ '^[a-f0-9]{64}$')
);

create index app_auth_challenges_user_created_idx
  on public.app_auth_challenges (user_id, created_at desc);

create index app_auth_challenges_phone_created_idx
  on public.app_auth_challenges (expected_whatsapp, created_at desc);

create index app_auth_challenges_active_idx
  on public.app_auth_challenges (expires_at)
  where verified_at is null;

create index app_user_sessions_active_idx
  on public.app_user_sessions (user_id, expires_at desc)
  where revoked_at is null;

drop trigger if exists app_users_set_updated_at on public.app_users;
create trigger app_users_set_updated_at
before update on public.app_users
for each row execute function private.set_updated_at();

alter table public.app_users enable row level security;
alter table public.app_auth_challenges enable row level security;
alter table public.app_user_sessions enable row level security;

revoke all on public.app_users, public.app_auth_challenges, public.app_user_sessions
from public, anon, authenticated;

grant all on public.app_users, public.app_auth_challenges, public.app_user_sessions
to service_role;

comment on table public.app_users is
  'Server-managed AnalisaCPNS accounts anchored to a verified WhatsApp number.';
comment on column public.app_users.password_hash is
  'Versioned scrypt password hash. Raw passwords are never stored.';
comment on table public.app_auth_challenges is
  'Short-lived WhatsApp verification challenges consumed through the Hermes bot.';
comment on table public.app_user_sessions is
  'Hashed browser sessions issued after password login or WhatsApp verification.';

create or replace function public.verify_app_auth_challenge(
  p_code text,
  p_sender text,
  p_message_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  challenge public.app_auth_challenges%rowtype;
begin
  if p_code !~ '^AUTH-[A-HJ-NP-Z2-9]{8}$'
    or p_sender !~ '^62[0-9]{8,13}$'
    or nullif(trim(p_message_id), '') is null
    or length(p_message_id) > 200 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  select * into challenge
  from public.app_auth_challenges
  where code = p_code
  for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if challenge.expires_at <= now() then
    return jsonb_build_object('outcome', 'expired');
  end if;
  if challenge.expected_whatsapp <> p_sender then
    return jsonb_build_object('outcome', 'sender_mismatch');
  end if;
  if challenge.verified_at is not null then
    return jsonb_build_object(
      'outcome', 'verified',
      'purpose', challenge.purpose,
      'user_id', challenge.user_id
    );
  end if;
  if exists (
    select 1
    from public.app_auth_challenges other
    where other.inbound_message_id = p_message_id
      and other.id <> challenge.id
  ) then
    return jsonb_build_object('outcome', 'duplicate_message');
  end if;

  update public.app_auth_challenges
  set verified_at = now(),
      sender_wa_id = p_sender,
      inbound_message_id = p_message_id
  where id = challenge.id;

  if challenge.purpose = 'password_reset' then
    update public.app_users
    set password_hash = challenge.pending_password_hash,
        failed_login_count = 0,
        locked_until = null
    where id = challenge.user_id;

    update public.app_user_sessions
    set revoked_at = now()
    where user_id = challenge.user_id
      and revoked_at is null;
  else
    update public.app_users
    set whatsapp_verified_at = coalesce(whatsapp_verified_at, now()),
        failed_login_count = 0,
        locked_until = null
    where id = challenge.user_id;
  end if;

  return jsonb_build_object(
    'outcome', 'verified',
    'purpose', challenge.purpose,
    'user_id', challenge.user_id
  );
end;
$$;

revoke all on function public.verify_app_auth_challenge(text, text, text)
from public, anon, authenticated;
grant execute on function public.verify_app_auth_challenge(text, text, text)
to service_role;

comment on function public.verify_app_auth_challenge(text, text, text) is
  'Atomically verifies one Hermes auth message and activates or recovers the matching account.';

notify pgrst, 'reload schema';

commit;
