create or replace function public.search_public_skd_scores(
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
  select
    s.id,
    s.no_peserta,
    s.nama,
    s.pendidikan,
    s.tahun_skd,
    s.twk,
    s.tiu,
    s.tkp,
    s.total,
    s.keterangan,
    s.formation_id,
    s.source_page,
    s.created_at,
    s.nama_normalized,
    f.source_id,
    f.nama_instansi,
    f.jabatan,
    f.kode_instansi,
    f.kode_jabatan,
    f.tahun,
    f.lokasi_formasi,
    f.jenis_formasi,
    f.pendidikan,
    f.jumlah_formasi,
    f.kode_lokasi,
    f.page_number,
    f.created_at
  from public.skd_scores s
  join public.skd_formations f on f.id = s.formation_id
  where
    (nullif(btrim(p_nama), '') is null or s.nama_normalized ilike '%' || btrim(p_nama) || '%')
    and (nullif(btrim(p_no_peserta), '') is null or s.no_peserta ilike '%' || btrim(p_no_peserta) || '%')
    and (nullif(btrim(p_instansi), '') is null or f.nama_instansi ilike '%' || btrim(p_instansi) || '%')
    and (nullif(btrim(p_formasi), '') is null or f.jabatan ilike '%' || btrim(p_formasi) || '%')
  order by
    case when s.nama_normalized = btrim(p_nama) then 0 else 1 end,
    s.nama_normalized,
    s.no_peserta
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

revoke all on function public.search_public_skd_scores(text, text, text, text, integer)
  from public;
grant execute on function public.search_public_skd_scores(text, text, text, text, integer)
  to anon, authenticated, service_role;

comment on function public.search_public_skd_scores(text, text, text, text, integer) is
  'Searches verified scores and formations visible through published-batch RLS without PostgREST relation embedding.';

notify pgrst, 'reload schema';
