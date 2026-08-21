begin;

create schema if not exists api_private;
revoke all on schema api_private from public;
grant usage on schema api_private to anon, authenticated, service_role;

alter function public.search_public_skd_scores(text, text, text, text, integer)
  set schema api_private;
alter function api_private.search_public_skd_scores(text, text, text, text, integer)
  security definer;

revoke all on function api_private.search_public_skd_scores(text, text, text, text, integer)
  from public;
grant execute on function api_private.search_public_skd_scores(text, text, text, text, integer)
  to anon, authenticated, service_role;

create function public.search_public_skd_scores(
  p_nama text default null,
  p_no_peserta text default null,
  p_instansi text default null,
  p_formasi text default null,
  p_limit integer default 30
)
returns table (
  score_id uuid,
  no_peserta text,
  nama text,
  pendidikan text,
  tahun_skd integer,
  twk integer,
  tiu integer,
  tkp integer,
  total integer,
  keterangan text,
  formation_id uuid,
  source_page integer,
  score_created_at timestamptz,
  nama_normalized text,
  formation_source_id uuid,
  nama_instansi text,
  jabatan text,
  kode_instansi text,
  kode_jabatan text,
  tahun integer,
  lokasi_formasi text,
  jenis_formasi text,
  pendidikan_formasi text,
  jumlah_formasi integer,
  kode_lokasi text,
  page_number integer,
  formation_created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from api_private.search_public_skd_scores(
    p_nama,
    p_no_peserta,
    p_instansi,
    p_formasi,
    p_limit
  );
$$;

revoke all on function public.search_public_skd_scores(text, text, text, text, integer)
  from public;
grant execute on function public.search_public_skd_scores(text, text, text, text, integer)
  to anon, authenticated, service_role;

comment on schema api_private is
  'Non-exposed helpers for public APIs that enforce published and verified data boundaries.';
comment on function api_private.search_public_skd_scores(text, text, text, text, integer) is
  'Internal search implementation. Explicitly filters published batches and verified rows before bypassing RLS.';
comment on function public.search_public_skd_scores(text, text, text, text, integer) is
  'Public security-invoker wrapper for the non-exposed SKD search implementation.';

notify pgrst, 'reload schema';

commit;
