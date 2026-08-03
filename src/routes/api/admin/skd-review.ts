import { createFileRoute } from "@tanstack/react-router";
import { getServerSupabase, jsonResponse, requireAdmin } from "@/lib/supabase/server";

export const Route = createFileRoute("/api/admin/skd-review")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const authError = requireAdmin(request);
        if (authError) return authError;

        const url = new URL(request.url);
        const batchId = url.searchParams.get("batchId")?.trim();
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 200);
        if (!batchId) return jsonResponse({ message: "batchId wajib diisi." }, 400);

        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) {
          return jsonResponse({ message: `Supabase server belum siap: ${configError}` }, 503);
        }

        const { data: issueRows, error: issueError } = await sb
          .from("skd_review_issues")
          .select(
            "id, score_id, formation_id, field_name, issue_code, severity, raw_value, suggested_value, confidence, status",
          )
          .eq("batch_id", batchId)
          .eq("status", "open")
          .order("created_at", { ascending: true })
          .limit(limit);
        if (issueError) return jsonResponse({ message: issueError.message }, 500);

        const scoreIds = (issueRows ?? []).flatMap((row) => (row.score_id ? [row.score_id] : []));
        const formationIssueIds = (issueRows ?? []).flatMap((row) =>
          row.formation_id ? [row.formation_id] : [],
        );
        const { data: scores, error: scoreError } = scoreIds.length
          ? await sb
              .from("skd_scores")
              .select(
                "id, no_peserta, nama, nama_raw, pendidikan, pendidikan_raw, twk, tiu, tkp, total, keterangan, source_page, formation_id, source_id, parser_confidence",
              )
              .in("id", scoreIds)
          : { data: [], error: null };
        if (scoreError) return jsonResponse({ message: scoreError.message }, 500);

        const formationIds = [
          ...new Set([
            ...formationIssueIds,
            ...(scores ?? []).map((score) => score.formation_id as string),
          ]),
        ];
        const { data: formations, error: formationError } = formationIds.length
          ? await sb
              .from("skd_formations")
              .select("id, nama_instansi, jabatan, pendidikan, page_number, source_id")
              .in("id", formationIds)
          : { data: [], error: null };
        if (formationError) return jsonResponse({ message: formationError.message }, 500);

        const sourceIds = [
          ...new Set([
            ...(scores ?? []).map((score) => score.source_id as string),
            ...(formations ?? []).map((formation) => formation.source_id as string),
          ]),
        ];
        const { data: sources, error: sourceError } = sourceIds.length
          ? await sb.from("skd_sources").select("id, file_name, source_url").in("id", sourceIds)
          : { data: [], error: null };
        if (sourceError) return jsonResponse({ message: sourceError.message }, 500);

        const scoreMap = new Map((scores ?? []).map((row) => [row.id as string, row]));
        const formationMap = new Map((formations ?? []).map((row) => [row.id as string, row]));
        const sourceMap = new Map((sources ?? []).map((row) => [row.id as string, row]));
        const issues = (issueRows ?? []).map((issue) => {
          const score = issue.score_id ? scoreMap.get(issue.score_id) : null;
          const formationId = score?.formation_id ?? issue.formation_id;
          const formation = formationId ? formationMap.get(formationId) : null;
          const sourceId = score?.source_id ?? formation?.source_id;
          const source = sourceId ? sourceMap.get(sourceId) : null;
          return {
            ...issue,
            no_peserta: score?.no_peserta ?? null,
            nama: score?.nama ?? null,
            nama_raw: score?.nama_raw ?? null,
            pendidikan: score?.pendidikan ?? formation?.pendidikan ?? null,
            pendidikan_raw: score?.pendidikan_raw ?? null,
            twk: score?.twk ?? null,
            tiu: score?.tiu ?? null,
            tkp: score?.tkp ?? null,
            total: score?.total ?? null,
            keterangan: score?.keterangan ?? null,
            source_page: score?.source_page ?? formation?.page_number ?? null,
            institution_name: formation?.nama_instansi ?? null,
            formation_name: formation?.jabatan ?? null,
            source_file_name: source?.file_name ?? null,
            source_url: source?.source_url ?? null,
            source_id: sourceId ?? null,
          };
        });

        return jsonResponse({ issues });
      },
    },
  },
});
