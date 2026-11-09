import type { SupabaseClient } from "@supabase/supabase-js";
import {
  belowManualSkdThreshold,
  manualSkdAheadFilter,
  MANUAL_SKD_SORT,
  type ManualSkdResult,
  type ManualSkdScore,
  type ManualSkdTarget,
} from "../lib/manualSkd.ts";

export async function approvedEducationLabels(sb: SupabaseClient, education: string) {
  const normalized = education.trim().replace(/\s+/g, " ").toUpperCase();
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
): Promise<ManualSkdTarget[]> {
  const labels = await approvedEducationLabels(sb, input.education);
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
  const text = input.query?.replace(/[%,()_\\*"]/g, " ").trim();
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
): Promise<ManualSkdResult> {
  const belowThreshold = belowManualSkdThreshold(score);
  const base = { target, score, scoreGap: score.total - target.cutoff, belowThreshold };
  if (belowThreshold.length) return { ...base, rank: null, ties: null };
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
