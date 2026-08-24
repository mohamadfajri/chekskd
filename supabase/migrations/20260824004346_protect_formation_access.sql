begin;

revoke execute on function api_private.search_public_skd_formations(
  text, text, text, text, text, text, integer, integer
) from anon, authenticated;
revoke execute on function api_private.get_public_skd_formation_detail(uuid)
from anon, authenticated;

grant execute on function api_private.search_public_skd_formations(
  text, text, text, text, text, text, integer, integer
) to service_role;
grant execute on function api_private.get_public_skd_formation_detail(uuid)
to service_role;

create or replace function public.search_public_skd_formations(
  p_query text default null,
  p_instansi text default null,
  p_pendidikan text default null,
  p_jenis_formasi text default null,
  p_competition_level text default null,
  p_sort text default 'competition_desc',
  p_page integer default 1,
  p_page_size integer default 24
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if current_user = 'service_role' then
    return api_private.search_public_skd_formations(
      p_query,
      p_instansi,
      p_pendidikan,
      p_jenis_formasi,
      p_competition_level,
      p_sort,
      p_page,
      p_page_size
    );
  end if;

  return api_private.search_public_skd_formations(
    null,
    null,
    null,
    null,
    null,
    'competition_desc',
    1,
    6
  );
end;
$$;

create or replace function public.get_public_skd_formation_detail(
  p_formation_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    return null;
  end if;
  return api_private.get_public_skd_formation_detail(p_formation_id);
end;
$$;

revoke all on function public.search_public_skd_formations(
  text, text, text, text, text, text, integer, integer
) from public;
revoke all on function public.get_public_skd_formation_detail(uuid) from public;

grant execute on function public.search_public_skd_formations(
  text, text, text, text, text, text, integer, integer
) to anon, authenticated, service_role;
grant execute on function public.get_public_skd_formation_detail(uuid)
to anon, authenticated, service_role;

comment on function public.search_public_skd_formations(
  text, text, text, text, text, text, integer, integer
) is 'Returns a six-row fixed preview to browser roles and full explorer access to the application server.';
comment on function public.get_public_skd_formation_detail(uuid) is
  'Returns formation detail only to the application server; browser roles receive null.';

notify pgrst, 'reload schema';

commit;
