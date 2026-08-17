import { createFileRoute } from "@tanstack/react-router";
import { buildAnalysisSnapshot, extractResultToken, type AnalysisSnapshot } from "@/lib/analysis";
import { isRationalizationSnapshot, type RationalizationSnapshot } from "@/lib/rationalization";
import { getServerSupabase, jsonResponse } from "@/lib/supabase/server";
import {
  prepareResultCardFont,
  renderRationalizationCard,
  renderResultCard,
} from "@/server/result-card";

function demoSnapshot(): AnalysisSnapshot {
  return buildAnalysisSnapshot({
    nama_panggilan: "Fajri",
    nama_peserta: "FAJRI RAMADHAN",
    instansi: "Kementerian Perhubungan",
    formasi: "ANALIS HUKUM AHLI PERTAMA",
    twk: 110,
    tiu: 140,
    tkp: 140,
    total: 390,
    target_tahun: "2026",
    target_instansi: "Kementerian Hukum",
    target_formasi: "Analis Hukum Ahli Pertama",
    rencana: "Tes ulang",
  });
}

function demoRationalizationSnapshot(): RationalizationSnapshot {
  const calculatedAt = new Date().toISOString();
  const recommendation = (
    id: string,
    institution: string,
    position: string,
    location: string,
    quota: number,
    attended: number,
    rank: number,
    minimum: number,
    median: number,
    maximum: number,
    verdict: "competitive" | "close" | "below",
    label: string,
  ): NonNullable<RationalizationSnapshot["target_recommendations"]>[number] => ({
    formation_id: id,
    dataset_year: 2024,
    institution,
    position,
    location,
    formation_type: "UMUM",
    education_requirement: "S-1 HUKUM",
    education_match: "exact",
    position_relation: "same_position",
    quota,
    participants: attended + 6,
    attended,
    passing_grade: attended,
    eligible_pool: attended,
    shortlisted_historical: Math.min(attended, quota * 3),
    shortlist_capacity: quota * 3,
    competition_ratio: Number((attended / quota).toFixed(2)),
    minimum_total: minimum,
    median_total: median,
    maximum_total: maximum,
    simulated_rank: rank,
    simulated_tied_count: 1,
    score_gap_to_shortlist_cutoff: verdict === "below" ? -8 : 11,
    score_needed_to_historical_cutoff: verdict === "below" ? 8 : 0,
    recommended_total: verdict === "below" ? 410 : 400,
    score_needed_to_recommended_total: verdict === "below" ? 20 : 10,
    eligible_percentile: Number((((attended - rank) / attended) * 100).toFixed(1)),
    above_historical_cutoff: verdict !== "below",
    recommendation_score: verdict === "competitive" ? 88 : verdict === "close" ? 72 : 48,
    strategy: label,
    cutoff: { total: verdict === "below" ? 398 : 379, tkp: 170, tiu: 120, twk: 89 },
    verdict: { code: verdict, label },
    recommendation_tier:
      verdict === "competitive"
        ? "most_rational"
        : verdict === "close"
          ? "competitive"
          : "ambitious",
    confidence: { code: "strong", label: "Data kuat" },
    data_quality: {
      basis: "official_2024_result",
      ranking_pool: "passing_grade_only",
      capacity_consistent: true,
      stats_calculated_at: calculatedAt,
    },
  });

  return {
    kind: "skd_rationalization",
    version: 5,
    generated_at: new Date().toISOString(),
    score_id: "demo-score",
    formation_id: "demo-formation",
    dataset_year: 2024,
    participant: {
      name: "FAJRI RAMADHAN",
      participant_number: "24300920120001947",
      education: "S-1 HUKUM",
      twk: 110,
      tiu: 140,
      tkp: 140,
      total: 390,
      official_status: "P/L",
    },
    formation: {
      institution: "Kementerian Perhubungan",
      position: "ANALIS HUKUM AHLI PERTAMA",
      location: "Unit Kerja Pusat",
      formation_type: "UMUM",
      education_requirement: "S-1 HUKUM",
      quota: 24,
    },
    historical_position: {
      overall_rank: 19,
      passing_rank: 17,
      tied_count: 1,
      top_percent: 25.7,
      score_gap_to_shortlist_cutoff: 11,
    },
    historical_stats: {
      participants: 86,
      attended: 74,
      passing_grade: 48,
      shortlisted_for_skb: 48,
      not_attended: 12,
      shortlist_capacity: 72,
      competition_ratio: 3.08,
      minimum_total: 285,
      median_total: 358,
      p75_total: 386,
      maximum_total: 465,
      cutoff: { total: 379, tkp: 170, tiu: 120, twk: 89, tied_count: 1 },
    },
    verdict: { code: "rational", label: "Rasional" },
    request: {
      nickname: "Fajri",
      target_year: "2026",
      target_institution: null,
      target_formation: null,
      plan: "Tes ulang",
    },
    data_quality: {
      basis: "official_2024_result",
      capacity_consistent: true,
      stats_calculated_at: calculatedAt,
    },
    recommendation_mode: "related",
    recommendation_summary: {
      mode: "related",
      mode_label: "Jabatan sama dan sejenis",
      returned_count: 3,
      eligible_formations: 42,
      eligible_institutions: 18,
      related_formations: 42,
      dataset_formations: 6068,
      dataset_institutions: 69,
      education_match: "exact",
      formation_type: "UMUM",
      scope_note:
        "Membandingkan 42 formasi umum dengan pendidikan S-1 Hukum pada 18 instansi yang memiliki data layak analisis.",
    },
    target_recommendations: [
      recommendation(
        "demo-target-1",
        "Kementerian Hukum dan HAM",
        "ANALIS HUKUM AHLI PERTAMA",
        "Jawa Tengah",
        8,
        74,
        19,
        354,
        381,
        432,
        "competitive",
        "Cukup rasional",
      ),
      recommendation(
        "demo-target-2",
        "Kementerian Agama",
        "ANALIS HUKUM AHLI PERTAMA",
        "Sulawesi Selatan",
        5,
        48,
        13,
        362,
        386,
        421,
        "competitive",
        "Cukup rasional",
      ),
      recommendation(
        "demo-target-3",
        "Kejaksaan Republik Indonesia",
        "ANALIS PERKARA PERADILAN",
        "Jakarta",
        2,
        186,
        112,
        378,
        411,
        464,
        "below",
        "Kurang rasional",
      ),
    ],
  };
}

export const Route = createFileRoute("/api/result-card")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        let snapshot: AnalysisSnapshot | RationalizationSnapshot;
        let resultToken: string | null = null;

        if (url.searchParams.has("demo") && process.env.NODE_ENV !== "production") {
          resultToken = "RSKD-DEMO2026";
          snapshot =
            url.searchParams.get("demo") === "v2" || url.searchParams.get("demo") === "v5"
              ? demoRationalizationSnapshot()
              : demoSnapshot();
        } else {
          const token = extractResultToken(url.searchParams.get("token") ?? "");
          if (!token) return jsonResponse({ message: "Token hasil tidak valid." }, 400);
          resultToken = token;

          const { client: sb, error: configError } = getServerSupabase();
          if (!sb) return jsonResponse({ message: `Supabase belum siap: ${configError}` }, 503);

          const { data, error } = await sb
            .from("result_sessions")
            .select("analysis_snapshot, rationalization_snapshot, expired_at")
            .eq("token", token)
            .maybeSingle();
          if (error) return jsonResponse({ message: "Kartu hasil belum dapat dibuat." }, 500);
          if (!data) return jsonResponse({ message: "Token hasil tidak ditemukan." }, 404);
          if (data.expired_at && new Date(data.expired_at).getTime() <= Date.now()) {
            return jsonResponse({ message: "Token hasil sudah kedaluwarsa." }, 410);
          }
          snapshot = isRationalizationSnapshot(data.rationalization_snapshot)
            ? data.rationalization_snapshot
            : (data.analysis_snapshot as unknown as AnalysisSnapshot);
          if (!isRationalizationSnapshot(snapshot) && snapshot?.version !== 1) {
            return jsonResponse({ message: "Snapshot analisis belum tersedia." }, 409);
          }
        }

        const fontPath = await prepareResultCardFont();
        const png = isRationalizationSnapshot(snapshot)
          ? renderRationalizationCard(snapshot, fontPath, resultToken)
          : renderResultCard(snapshot, fontPath);
        return new Response(new Blob([png], { type: "image/png" }), {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-disposition": 'inline; filename="hasil-analisis-skd.png"',
            "cache-control": "private, no-store, max-age=0",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
