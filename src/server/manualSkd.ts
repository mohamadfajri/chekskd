import type { SupabaseClient } from "@supabase/supabase-js";
import {
  belowManualSkdThreshold,
  manualSkdAheadFilter,
  MANUAL_SKD_SORT,
  type ManualSkdResult,
  type ManualSkdScore,
  type ManualSkdTarget,
} from "../lib/manualSkd.ts";
import { getSkdDatabase } from "./skdPreview.ts";

export async function approvedEducationLabels(
  sb: SupabaseClient,
  education: string,
  fromSumopod = false,
) {
  const normalized = education.trim().replace(/\s+/g, " ").toUpperCase();
  if (fromSumopod) {
    const { rows } = await getSkdDatabase().query<{ label: string }>(
      `with source as (select public.skd_canonical_education($1) as canonical)
      select $1::text as label
      union select canonical from source
      union select a.normalized_label from public.skd_education_aliases a
        join source on a.canonical_label = source.canonical
        where a.review_status = 'approved' and a.match_kind in ('exact', 'equivalent')`,
      [normalized],
    );
    return rows.map(({ label }) => label);
  }
  const canonical = await sb.rpc("skd_canonical_education", { p_education: normalized });
  if (canonical.error || typeof canonical.data !== "string")
    throw new Error("Pendidikan belum dapat dibaca.");
  const aliases = await sb
    .from("skd_education_aliases")
    .select("normalized_label")
    .eq("canonical_label", canonical.data)
    .eq("review_status", "approved")
    .in("match_kind", ["exact", "equivalent"]);
  if (aliases.error) throw new Error("Pilihan pendidikan belum dapat dibaca.");
  return [
    ...new Set<string>([
      normalized,
      canonical.data,
      ...aliases.data.map((row) => row.normalized_label),
    ]),
  ];
}

export async function getManualSkdTargets(
  sb: SupabaseClient,
  input: { education: string; query?: string; targetId?: string; recommendations?: boolean },
  fromSumopod = false,
): Promise<ManualSkdTarget[]> {
  const labels = await approvedEducationLabels(sb, input.education, fromSumopod);
  const text = input.query?.replace(/[%,()_\\*"]/g, " ").trim();
  if (fromSumopod) {
    const { rows } = await getSkdDatabase().query<ManualSkdTarget>(
      `select f.id, f.nama_instansi as institution, f.jabatan as job, f.lokasi_formasi as location,
        (select label from unnest(f.pendidikan_options) label where label = any($1::text[]) limit 1)
          as "matchedEducation",
        st.quota, st.cutoff_total as cutoff, st.shortlist_capacity as "shortlistCapacity"
      from public.skd_formations f
      join public.skd_batches b on b.id = f.batch_id and b.status = 'published'
      join public.skd_formation_stats st on st.formation_id = f.id
      where f.tahun = 2024 and f.quality_status = 'verified' and f.jenis_formasi ilike 'UMUM'
        and f.pendidikan_options && $1::text[]
        and ($2::uuid is null or f.id = $2::uuid)
        and ($3::text is null or f.nama_instansi ilike $3 or f.jabatan ilike $3 or f.lokasi_formasi ilike $3)
        and st.attended_count > 0 and st.passing_count >= 3 and st.shortlisted_count >= 1
        and st.shortlist_capacity > 0 and st.cutoff_total is not null and st.cutoff_tkp is not null
        and st.cutoff_tiu is not null and st.cutoff_twk is not null
        and exists (
          select 1 from public.skd_scores s
          where s.formation_id = f.id and s.quality_status = 'verified' and s.total is not null
        )
      order by case when $5 then st.cutoff_total end,
        case when $5 then st.quota end desc, f.nama_instansi, f.jabatan, f.id limit $4`,
      [
        labels,
        input.targetId ?? null,
        text ? `%${text}%` : null,
        input.targetId ? 1 : input.recommendations ? 4 : 25,
        Boolean(input.recommendations),
      ],
    );
    return rows;
  }
  const options = `{${labels.map((label) => JSON.stringify(label)).join(",")}}`;
  let query = sb
    .from("skd_formations")
    .select(
      "id,nama_instansi,jabatan,lokasi_formasi,pendidikan_options,skd_batches!inner(status),skd_formation_stats!inner(quota,cutoff_total,shortlist_capacity),comparison_scores:skd_scores!inner(id)",
    )
    .eq("tahun", 2024)
    .eq("quality_status", "verified")
    .ilike("jenis_formasi", "UMUM")
    .eq("skd_batches.status", "published")
    .overlaps("pendidikan_options", options)
    .gt("skd_formation_stats.attended_count", 0)
    .gte("skd_formation_stats.passing_count", 3)
    .gte("skd_formation_stats.shortlisted_count", 1)
    .gt("skd_formation_stats.shortlist_capacity", 0)
    .not("skd_formation_stats.cutoff_total", "is", null)
    .not("skd_formation_stats.cutoff_tkp", "is", null)
    .not("skd_formation_stats.cutoff_tiu", "is", null)
    .not("skd_formation_stats.cutoff_twk", "is", null)
    .eq("comparison_scores.quality_status", "verified")
    .not("comparison_scores.total", "is", null)
    .limit(1, { referencedTable: "comparison_scores" });
  if (input.targetId) query = query.eq("id", input.targetId);
  if (text)
    query = query.or(
      `nama_instansi.ilike.%${text}%,jabatan.ilike.%${text}%,lokasi_formasi.ilike.%${text}%`,
    );
  if (input.recommendations) {
    query = query
      .order("skd_formation_stats(cutoff_total)", { ascending: true })
      .order("skd_formation_stats(quota)", { ascending: false });
  }
  const { data, error } = await query
    .order("nama_instansi")
    .order("jabatan")
    .order("id")
    .limit(input.targetId ? 1 : input.recommendations ? 4 : 25);
  if (error) throw new Error("Formasi pembanding belum dapat dimuat.");
  return data.flatMap((row) => {
    const stats = Array.isArray(row.skd_formation_stats)
      ? row.skd_formation_stats[0]
      : row.skd_formation_stats;
    const matchedEducation = (row.pendidikan_options as string[]).find((label) =>
      labels.includes(label),
    );
    if (!stats || !matchedEducation) return [];
    return [
      {
        id: row.id,
        institution: row.nama_instansi,
        job: row.jabatan,
        location: row.lokasi_formasi,
        matchedEducation,
        quota: stats.quota,
        cutoff: stats.cutoff_total,
        shortlistCapacity: stats.shortlist_capacity,
      },
    ];
  });
}

export async function simulateManualSkd(
  sb: SupabaseClient,
  target: ManualSkdTarget,
  score: ManualSkdScore,
  fromSumopod = false,
): Promise<ManualSkdResult> {
  const belowThreshold = belowManualSkdThreshold(score);
  const base = { target, score, scoreGap: score.total - target.cutoff, belowThreshold };
  if (fromSumopod) {
    const {
      rows: [{ ahead, ties, average }],
    } = await getSkdDatabase().query<{ ahead: number; ties: number; average: number | null }>(
      `select avg(total)::float8 as average,
        count(*) filter (where eligible and (total, tkp, tiu, twk) > ($2, $3, $4, $5))::int as ahead,
        count(*) filter (where eligible and (total, tkp, tiu, twk) = ($2, $3, $4, $5))::int as ties
      from (
        select total, tkp, tiu, twk, (keterangan = 'P' or keterangan like 'P/L%') as eligible
      from public.skd_scores
      where formation_id = $1 and quality_status = 'verified' and total is not null
      ) scores`,
      [target.id, score.total, score.tkp, score.tiu, score.twk],
    );
    return {
      ...base,
      average,
      rank: belowThreshold.length || average === null ? null : ahead + 1,
      ties: belowThreshold.length || average === null ? null : ties,
    };
  }
  const average = await getManualSkdAverage(sb, target.id);
  if (belowThreshold.length || average === null)
    return { ...base, average, rank: null, ties: null };
  const countEligible = () =>
    sb
      .from("skd_scores")
      .select("id", { head: true, count: "exact" })
      .eq("formation_id", target.id)
      .eq("quality_status", "verified")
      .not("total", "is", null)
      .or("keterangan.eq.P,keterangan.like.P/L*");
  let ties = countEligible();
  for (const field of MANUAL_SKD_SORT) ties = ties.eq(field, score[field]);
  const [ahead, tied] = await Promise.all([countEligible().or(manualSkdAheadFilter(score)), ties]);
  if (ahead.error || tied.error || ahead.count === null || tied.count === null) {
    throw new Error("Posisi historis belum dapat dihitung.");
  }
  return { ...base, average, rank: ahead.count + 1, ties: tied.count };
}

async function getManualSkdAverage(sb: SupabaseClient, formationId: string) {
  let sum = 0;
  let count = 0;
  let cursor: string | undefined;
  const size = 500;
  for (;;) {
    let query = sb
      .from("skd_scores")
      .select("id,total")
      .eq("formation_id", formationId)
      .eq("quality_status", "verified")
      .not("total", "is", null)
      .order("id")
      .limit(size);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw new Error("Rata-rata historis belum dapat dihitung.");
    for (const row of data) sum += Number(row.total);
    count += data.length;
    if (data.length < size) return count ? sum / count : null;
    cursor = data[data.length - 1].id;
  }
}
