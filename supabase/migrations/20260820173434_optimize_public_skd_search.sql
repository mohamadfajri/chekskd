begin;

create index if not exists skd_scores_no_peserta_trgm_idx
  on public.skd_scores
  using gin (no_peserta extensions.gin_trgm_ops)
  where quality_status = 'verified';

create index if not exists skd_formations_instansi_trgm_idx
  on public.skd_formations
  using gin (nama_instansi extensions.gin_trgm_ops)
  where quality_status = 'verified';

create index if not exists skd_formations_jabatan_trgm_idx
  on public.skd_formations
  using gin (jabatan extensions.gin_trgm_ops)
  where quality_status = 'verified';

drop policy if exists "read verified published formations"
  on public.skd_formations;
create policy "read verified published formations"
on public.skd_formations for select
to anon, authenticated
using (
  quality_status = 'verified'
  and batch_id in (
    select b.id
    from public.skd_batches b
    where b.status = 'published'
  )
);

drop policy if exists "read verified published scores"
  on public.skd_scores;
create policy "read verified published scores"
on public.skd_scores for select
to anon, authenticated
using (
  quality_status = 'verified'
  and batch_id in (
    select b.id
    from public.skd_batches b
    where b.status = 'published'
  )
);

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
language plpgsql
stable
security invoker
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_nama text := nullif(btrim(p_nama), '');
  v_no_peserta text := nullif(btrim(p_no_peserta), '');
  v_instansi text := nullif(btrim(p_instansi), '');
  v_formasi text := nullif(btrim(p_formasi), '');
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_sql text;
begin
  if v_nama is null
    and v_no_peserta is null
    and v_instansi is null
    and v_formasi is null
  then
    raise exception 'Isi minimal satu kata pencarian.' using errcode = '22023';
  end if;

  v_sql := $query$
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
    join public.skd_batches b
      on b.id = s.batch_id
      and b.status = 'published'
    join public.skd_formations f
      on f.id = s.formation_id
      and f.batch_id = b.id
      and f.quality_status = 'verified'
    where s.quality_status = 'verified'
  $query$;

  if v_nama is not null then
    v_sql := v_sql || ' and s.nama_normalized ilike ''%'' || $1 || ''%''';
  end if;

  if v_no_peserta is not null then
    v_sql := v_sql || ' and s.no_peserta ilike ''%'' || $2 || ''%''';
  end if;

  if v_instansi is not null then
    v_sql := v_sql || ' and f.nama_instansi ilike ''%'' || $3 || ''%''';
  end if;

  if v_formasi is not null then
    v_sql := v_sql || ' and f.jabatan ilike ''%'' || $4 || ''%''';
  end if;

  v_sql := v_sql || $order$
    order by
      case when $1 is not null and s.nama_normalized = $1 then 0 else 1 end,
      case when $2 is not null and s.no_peserta = $2 then 0 else 1 end,
      s.nama_normalized,
      s.no_peserta
    limit $5
  $order$;

  return query execute v_sql
    using v_nama, v_no_peserta, v_instansi, v_formasi, v_limit;
end;
$$;

revoke all on function public.search_public_skd_scores(text, text, text, text, integer)
  from public;
grant execute on function public.search_public_skd_scores(text, text, text, text, integer)
  to anon, authenticated, service_role;

comment on function public.search_public_skd_scores(text, text, text, text, integer) is
  'Searches verified scores in published batches with custom query plans and trigram-backed public filters.';

notify pgrst, 'reload schema';

commit;
