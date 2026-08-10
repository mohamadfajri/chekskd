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
  return {
    kind: "skd_rationalization",
    version: 1,
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
      stats_calculated_at: new Date().toISOString(),
    },
  };
}

export const Route = createFileRoute("/api/result-card")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        let snapshot: AnalysisSnapshot | RationalizationSnapshot;

        if (url.searchParams.has("demo") && process.env.NODE_ENV !== "production") {
          snapshot =
            url.searchParams.get("demo") === "v2" ? demoRationalizationSnapshot() : demoSnapshot();
        } else {
          const token = extractResultToken(url.searchParams.get("token") ?? "");
          if (!token) return jsonResponse({ message: "Token hasil tidak valid." }, 400);

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
          ? renderRationalizationCard(snapshot, fontPath)
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
