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
  input: { education: string; query?: string; targetId?: string },
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
      order by f.nama_instansi, f.jabatan, f.id limit $4`,
      [labels, input.targetId ?? null, text ? `%${text}%` : null, input.targetId ? 1 : 25],
    );
    return rows;
  }
  const options = `{${labels.map((label) => JSON.stringify(label)).join(",")}}`;
  let query = sb
    .from("skd_formations")
    .select(
      "id,nama_instansi,jabatan,lokasi_formasi,pendidikan_options,skd_batches!inner(status),skd_formation_stats!inner(quota,cutoff_total,shortlist_capacity)",
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
    .not("skd_formation_stats.cutoff_twk", "is", null);
  if (input.targetId) query = query.eq("id", input.targetId);
  if (text)
    query = query.or(
      `nama_instansi.ilike.%${text}%,jabatan.ilike.%${text}%,lokasi_formasi.ilike.%${text}%`,
    );
  const { data, error } = await query
    .order("nama_instansi")
    .order("jabatan")
    .order("id")
    .limit(input.targetId ? 1 : 25);
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
  if (belowThreshold.length) return { ...base, rank: null, ties: null };
  if (fromSumopod) {
    const {
      rows: [{ ahead, ties }],
    } = await getSkdDatabase().query<{ ahead: number; ties: number }>(
      `select count(*) filter (where (total, tkp, tiu, twk) > ($2, $3, $4, $5))::int as ahead,
        count(*) filter (where (total, tkp, tiu, twk) = ($2, $3, $4, $5))::int as ties
      from public.skd_scores
      where formation_id = $1 and quality_status = 'verified' and total is not null
        and (keterangan = 'P' or keterangan like 'P/L%')`,
      [target.id, score.total, score.tkp, score.tiu, score.twk],
    );
    return { ...base, rank: ahead + 1, ties };
  }
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
  return { ...base, rank: ahead.count + 1, ties: tied.count };
}
