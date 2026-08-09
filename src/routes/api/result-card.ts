import { createFileRoute } from "@tanstack/react-router";
import { buildAnalysisSnapshot, extractResultToken, type AnalysisSnapshot } from "@/lib/analysis";
import { getServerSupabase, jsonResponse } from "@/lib/supabase/server";
import { prepareResultCardFont, renderResultCard } from "@/server/result-card";

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

export const Route = createFileRoute("/api/result-card")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        let snapshot: AnalysisSnapshot;

        if (url.searchParams.get("demo") === "1" && process.env.NODE_ENV !== "production") {
          snapshot = demoSnapshot();
        } else {
          const token = extractResultToken(url.searchParams.get("token") ?? "");
          if (!token) return jsonResponse({ message: "Token hasil tidak valid." }, 400);

          const { client: sb, error: configError } = getServerSupabase();
          if (!sb) return jsonResponse({ message: `Supabase belum siap: ${configError}` }, 503);

          const { data, error } = await sb
            .from("result_sessions")
            .select("analysis_snapshot, expired_at")
            .eq("token", token)
            .maybeSingle();
          if (error) return jsonResponse({ message: "Kartu hasil belum dapat dibuat." }, 500);
          if (!data) return jsonResponse({ message: "Token hasil tidak ditemukan." }, 404);
          if (data.expired_at && new Date(data.expired_at).getTime() <= Date.now()) {
            return jsonResponse({ message: "Token hasil sudah kedaluwarsa." }, 410);
          }
          snapshot = data.analysis_snapshot as unknown as AnalysisSnapshot;
          if (snapshot?.version !== 1) {
            return jsonResponse({ message: "Snapshot analisis belum tersedia." }, 409);
          }
        }

        const fontPath = await prepareResultCardFont();
        const png = renderResultCard(snapshot, fontPath);
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
