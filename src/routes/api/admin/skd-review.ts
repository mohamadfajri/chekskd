import { createFileRoute } from "@tanstack/react-router";
import { getServerSupabase, jsonResponse, requireAdmin } from "@/lib/supabase/server";
import { skdAdminError, skdAdminUsesSumopod, sumopodSkdAdminRows } from "@/server/skdAdminStore";

export const Route = createFileRoute("/api/admin/skd-review")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const authError = requireAdmin(request);
        if (authError) return authError;

        const url = new URL(request.url);
        const batchId = url.searchParams.get("batchId")?.trim();
        const limit = Math.min(
          Math.max(Math.trunc(Number(url.searchParams.get("limit"))) || 100, 1),
          200,
        );
        if (!batchId) return jsonResponse({ message: "batchId wajib diisi." }, 400);
        if (skdAdminUsesSumopod()) {
          try {
            const issues = await sumopodSkdAdminRows(
              `select i.id, i.score_id, i.formation_id, i.field_name, i.issue_code, i.severity,
                i.raw_value, i.suggested_value, i.confidence::float8, i.status,
                s.no_peserta, s.nama, s.nama_raw, coalesce(s.pendidikan, f.pendidikan) as pendidikan,
                s.pendidikan_raw, s.twk, s.tiu, s.tkp, s.total, s.keterangan,
                coalesce(s.source_page, f.page_number) as source_page,
                f.nama_instansi as institution_name, f.jabatan as formation_name,
                pdf.file_name as source_file_name, pdf.source_url,
                coalesce(s.source_id, f.source_id) as source_id
              from public.skd_review_issues i
              left join public.skd_scores s on s.id = i.score_id and s.batch_id = i.batch_id
              left join public.skd_formations f on f.id = coalesce(s.formation_id, i.formation_id)
                and f.batch_id = i.batch_id
              left join public.skd_sources pdf on pdf.id = coalesce(s.source_id, f.source_id)
                and pdf.batch_id = i.batch_id
              where i.batch_id = $1 and i.status = 'open' order by i.created_at, i.id limit $2`,
              [batchId, limit],
            );
            return jsonResponse({ issues });
          } catch (error) {
            const { message, status } = skdAdminError(error);
            return jsonResponse({ message }, status);
          }
        }

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
      POST: async ({ request }: { request: Request }) => {
        const body = (await request.json().catch(() => null)) as {
          action?: string;
          batchId?: string;
          confirmation?: string;
          resolutionNote?: string;
          adminPassword?: string;
        } | null;
        if (!body) return jsonResponse({ message: "Body JSON tidak valid." }, 400);

        const authError = requireAdmin(request, body);
        if (authError) return authError;
        const step = body.action === "bulk_verify_step";
        if (!step && body.action !== "bulk_verify") {
          return jsonResponse({ message: "Action tidak dikenal." }, 400);
        }
        if (!body.batchId?.trim()) return jsonResponse({ message: "batchId wajib diisi." }, 400);
        if (body.confirmation !== "VERIFY_ALL") {
          return jsonResponse({ message: "Konfirmasi bulk verification belum diberikan." }, 400);
        }

        if (skdAdminUsesSumopod()) {
          try {
            const [result] = await sumopodSkdAdminRows<{
              issues_resolved: number;
              scores_verified: number;
              formations_verified: number;
              batch_status: string;
            }>(
              step
                ? "select * from public.bulk_verify_skd_batch_step($1,$2)"
                : "select * from public.bulk_verify_skd_batch($1,$2)",
              [
                body.batchId,
                body.resolutionNote?.trim() || "Bulk verification approved from SKD Data Desk",
              ],
            );
            if (
              result?.batch_status !== "verified" &&
              (!step || result?.batch_status !== "review")
            ) {
              return jsonResponse({ message: "Status verifikasi dari database tidak valid." }, 502);
            }
            return jsonResponse({
              issuesResolved: result.issues_resolved,
              scoresVerified: result.scores_verified,
              formationsVerified: result.formations_verified,
              batchStatus: result.batch_status,
            });
          } catch (error) {
            const { message, status } = skdAdminError(error);
            return jsonResponse({ message }, status);
          }
        }
        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) {
          return jsonResponse({ message: `Supabase server belum siap: ${configError}` }, 503);
        }

        const { data, error } = await sb.rpc(
          step ? "bulk_verify_skd_batch_step" : "bulk_verify_skd_batch",
          {
            p_batch_id: body.batchId,
            p_resolution_note:
              body.resolutionNote?.trim() || "Bulk verification approved from SKD Data Desk",
          },
        );
        if (step && error?.code === "PGRST202") {
          return jsonResponse(
            { message: "Migration verifikasi bertahap belum tersedia di Supabase." },
            503,
          );
        }
        if (error?.code === "57014") {
          return jsonResponse(
            {
              message: step
                ? "Langkah ini melewati batas waktu. Langkah yang sudah selesai tetap tersimpan. Coba verifikasi lagi untuk melanjutkan tanpa impor ulang."
                : "Verifikasi batch melewati batas waktu database. Perubahan verifikasi dibatalkan. Tidak perlu impor ulang CSV.",
            },
            504,
          );
        }
        if (error) return jsonResponse({ message: error.message }, 400);

        const result = Array.isArray(data) ? data[0] : data;
        if (result?.batch_status !== "verified" && (!step || result?.batch_status !== "review")) {
          return jsonResponse({ message: "Status verifikasi dari database tidak valid." }, 502);
        }
        return jsonResponse({
          issuesResolved: Number(result?.issues_resolved ?? 0),
          scoresVerified: Number(result?.scores_verified ?? 0),
          formationsVerified: Number(result?.formations_verified ?? 0),
          batchStatus: result.batch_status,
        });
      },
    },
  },
});
