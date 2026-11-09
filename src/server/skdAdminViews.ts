import { sumopodSkdAdminRows } from "./skdAdminStore.ts";

export async function sumopodSkdExplorerOverview(batchId: string) {
  const [[batch], [counts], formations] = await Promise.all([
    sumopodSkdAdminRows(
      `select id, institution_name, institution_code, selection_year, status,
        formation_count, participant_count, review_issue_count
      from public.skd_batches where id = $1`,
      [batchId],
    ),
    sumopodSkdAdminRows<{
      present_count: number;
      absent_count: number;
      passing_count: number;
      needs_review_count: number;
    }>(
      `select count(total)::int as present_count,
        count(*) filter (where total is null)::int as absent_count,
        count(*) filter (where twk >= 65 and tiu >= 80 and tkp >= 166)::int as passing_count,
        count(*) filter (where quality_status = 'needs_review')::int as needs_review_count
      from public.skd_scores where batch_id = $1`,
      [batchId],
    ),
    sumopodSkdAdminRows<{ jumlah_formasi: number }>(
      `select id, kode_jabatan, jabatan, lokasi_formasi, jenis_formasi, pendidikan, jumlah_formasi,
        quality_status from public.skd_formations where batch_id = $1 order by jabatan, id`,
      [batchId],
    ),
  ]);
  if (!batch) return null;
  const seats = formations.reduce((total, formation) => total + formation.jumlah_formasi, 0);
  return {
    summary: {
      ...batch,
      ...counts,
      seat_count: seats,
      competition_ratio: seats ? Number((counts.present_count / seats).toFixed(2)) : null,
    },
    formations,
  };
}

function pagination(page: number, pageSize: number, total: number) {
  return {
    page,
    page_size: pageSize,
    total,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function sumopodSkdExplorerRows(input: {
  batchId: string;
  page: number;
  pageSize: number;
  search: string;
  searchByNumber: boolean;
  formationId: string | null;
  attendance: string;
  passing: string;
  quality: string | null;
  sort: string;
}) {
  const order =
    input.sort === "total_desc"
      ? "total desc nulls last, id"
      : input.sort === "total_asc"
        ? "total asc nulls last, id"
        : input.sort === "name"
          ? "nama, id"
          : "source_page, nama, id";
  const [result] = await sumopodSkdAdminRows<{ rows: unknown[]; total: number }>(
    `with filtered as (
      select s.id, s.source_id, s.no_peserta, s.nama, s.pendidikan, s.twk, s.tiu, s.tkp, s.total,
        s.keterangan, s.source_page, s.quality_status, s.parser_confidence, f.id as formation_id,
        f.kode_jabatan, f.jabatan, f.lokasi_formasi, f.jenis_formasi,
        f.pendidikan as pendidikan_formasi, f.jumlah_formasi, pdf.file_name as source_file_name
      from public.skd_scores s
      join public.skd_formations f on f.id = s.formation_id
      join public.skd_sources pdf on pdf.id = s.source_id
      where s.batch_id = $1 and ($2::text is null or ${input.searchByNumber ? "s.no_peserta" : "s.nama_normalized"} ilike $2)
        and ($3::uuid is null or s.formation_id = $3)
        and ($4 <> 'present' or s.total is not null) and ($4 <> 'absent' or s.total is null)
        and ($5 <> 'pass' or (s.twk >= 65 and s.tiu >= 80 and s.tkp >= 166))
        and ($5 <> 'fail' or (s.total is not null and (s.twk < 65 or s.tiu < 80 or s.tkp < 166)))
        and ($6::text is null or s.quality_status = $6)
    )
    select (select count(*)::int from filtered) as total,
      coalesce((select jsonb_agg(to_jsonb(r) order by ${order}) from
        (select * from filtered order by ${order} limit $7 offset $8) r), '[]') as rows`,
    [
      input.batchId,
      input.search ? `%${input.search}%` : null,
      input.formationId,
      input.attendance,
      input.passing,
      input.quality,
      input.pageSize,
      (input.page - 1) * input.pageSize,
    ],
  );
  return { rows: result.rows, pagination: pagination(input.page, input.pageSize, result.total) };
}

export async function sumopodPublishedFormations(input: {
  batchIds: string[];
  search: string;
  sort: string;
  page: number;
  pageSize: number;
}) {
  const order = input.sort === "name" ? "jabatan, id" : "jumlah_formasi desc, id";
  const [result] = await sumopodSkdAdminRows<{ formations: unknown[]; total: number }>(
    `with filtered as (
      select f.id, f.batch_id, f.kode_jabatan, f.jabatan, f.lokasi_formasi, f.jenis_formasi,
        f.pendidikan, f.jumlah_formasi, f.quality_status, b.institution_name,
        case when st.formation_id is null then null else jsonb_build_object(
          'quota', st.quota, 'participant_count', st.participant_count, 'attended_count', st.attended_count,
          'passing_count', st.passing_count, 'competition_ratio', st.competition_ratio,
          'minimum_total', st.minimum_total, 'median_total', st.median_total, 'maximum_total', st.maximum_total,
          'cutoff_total', st.cutoff_total, 'capacity_consistent', st.capacity_consistent
        ) end as stats
      from public.skd_formations f join public.skd_batches b on b.id = f.batch_id and b.status = 'published'
      left join public.skd_formation_stats st on st.formation_id = f.id
      where f.batch_id = any($1::uuid[])
        and ($2::text is null or f.jabatan ilike $2 or f.lokasi_formasi ilike $2 or f.pendidikan ilike $2)
    )
    select (select count(*)::int from filtered) as total,
      coalesce((select jsonb_agg(to_jsonb(r) order by ${order}) from
        (select * from filtered order by ${order} limit $3 offset $4) r), '[]') as formations`,
    [
      input.batchIds,
      input.search ? `%${input.search}%` : null,
      input.pageSize,
      (input.page - 1) * input.pageSize,
    ],
  );
  return {
    formations: result.formations,
    pagination: pagination(input.page, input.pageSize, result.total),
  };
}
