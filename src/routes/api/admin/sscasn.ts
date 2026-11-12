import { createFileRoute } from "@tanstack/react-router";
import { getServerSupabase, jsonResponse, requireAdmin } from "@/lib/supabase/server";
import { getSscasnAdminData, reviewSscasnMatch } from "@/server/sscasn";
import { SSCASN_MANUAL_BATCH_LIMIT } from "@/lib/sscasnReconciliation";
import {
  approveSelectedSscasnAudit,
  approveSscasnBulkPlan,
  approveSscasnAudit,
  getSscasnAudit,
  listSscasnAuditInstitutions,
  planSscasnBulkApproval,
} from "@/server/sscasnAudit";

export const Route = createFileRoute("/api/admin/sscasn")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const auth = requireAdmin(request);
        if (auth) return auth;
        const { client } = getServerSupabase();
        if (!client) return jsonResponse({ message: "Supabase server belum siap." }, 503);
        const params = new URL(request.url).searchParams;
        try {
          if (params.get("mode") === "audit-institutions") {
            return jsonResponse({ institutions: await listSscasnAuditInstitutions(client) });
          }
          if (params.get("mode") === "audit-bulk-plan") {
            const institution = params.get("institution")?.trim();
            if (!institution || institution.length > 200)
              return jsonResponse({ message: "Pilih instansi untuk diaudit." }, 400);
            return jsonResponse(await planSscasnBulkApproval(client, institution));
          }
          if (params.get("mode") === "audit") {
            const institution = params.get("institution")?.trim();
            if (!institution || institution.length > 200)
              return jsonResponse({ message: "Pilih instansi untuk diaudit." }, 400);
            return jsonResponse(
              await getSscasnAudit(
                client,
                institution,
                "review",
                Number(params.get("page") ?? 1),
                params.get("refresh") === "1",
              ),
            );
          }
          return jsonResponse(await getSscasnAdminData(client, params));
        } catch (error) {
          return jsonResponse(
            { message: error instanceof Error ? error.message : "Data SSCASN gagal dimuat." },
            503,
          );
        }
      },
      POST: async ({ request }: { request: Request }) => {
        const auth = requireAdmin(request);
        if (auth) return auth;
        const body = await request.json().catch(() => null);
        if (body?.action === "approve-bulk-plan") {
          const institution = typeof body.institution === "string" ? body.institution.trim() : "";
          if (!institution || institution.length > 200 || typeof body.fingerprint !== "string" ||
              !/^[a-f0-9]{64}$/.test(body.fingerprint))
            return jsonResponse({ message: "Rencana persetujuan tidak valid." }, 400);
          const { client } = getServerSupabase();
          if (!client) return jsonResponse({ message: "Supabase server belum siap." }, 503);
          try {
            return jsonResponse(await approveSscasnBulkPlan(client, institution, body.fingerprint));
          } catch (error) {
            return jsonResponse(
              { message: error instanceof Error ? error.message : "Persetujuan massal belum tersimpan." },
              409,
            );
          }
        }
        if (body?.action === "approve-selected") {
          const institution = typeof body.institution === "string" ? body.institution.trim() : "";
          if (
            !institution ||
            institution.length > 200 ||
            typeof body.note !== "string" ||
            !Array.isArray(body.selections) ||
            !body.selections.length ||
            body.selections.length > SSCASN_MANUAL_BATCH_LIMIT ||
            body.selections.some(
              (row: { formationId?: unknown; sourceId?: unknown } | null) =>
                typeof row?.formationId !== "string" ||
                !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.formationId) ||
                typeof row.sourceId !== "string" ||
                !/^[a-zA-Z0-9-]{1,80}$/.test(row.sourceId),
            )
          ) {
            return jsonResponse({ message: "Pilihan persetujuan tidak valid." }, 400);
          }
          const { client } = getServerSupabase();
          if (!client) return jsonResponse({ message: "Supabase server belum siap." }, 503);
          try {
            return jsonResponse(
              await approveSelectedSscasnAudit(
                client,
                institution,
                body.selections,
                body.note,
                Number(body.page ?? 1),
              ),
            );
          } catch (error) {
            return jsonResponse(
              {
                message: error instanceof Error ? error.message : "Pilihan belum dapat disetujui.",
              },
              409,
            );
          }
        }
        if (body?.action === "approve-audit") {
          const institution = typeof body.institution === "string" ? body.institution.trim() : "";
          if (!institution || institution.length > 200)
            return jsonResponse({ message: "Pilih instansi untuk diaudit." }, 400);
          const { client } = getServerSupabase();
          if (!client) return jsonResponse({ message: "Supabase server belum siap." }, 503);
          try {
            return jsonResponse(await approveSscasnAudit(client, institution));
          } catch (error) {
            return jsonResponse(
              { message: error instanceof Error ? error.message : "Audit belum dapat diproses." },
              409,
            );
          }
        }
        if (
          !body ||
          typeof body.formation_id !== "string" ||
          !/^[0-9a-f-]{36}$/i.test(body.formation_id) ||
          typeof body.source_id !== "string" ||
          !/^[a-zA-Z0-9-]{1,80}$/.test(body.source_id) ||
          typeof body.snapshot_id !== "string" ||
          !/^[a-zA-Z0-9-]{1,100}$/.test(body.snapshot_id) ||
          !["approved", "rejected", "pending"].includes(body.review_status)
        )
          return jsonResponse({ message: "Review tidak valid." }, 400);
        const { client } = getServerSupabase();
        if (!client) return jsonResponse({ message: "Supabase server belum siap." }, 503);
        try {
          await reviewSscasnMatch(client, {
            formation_id: body.formation_id,
            source_id: body.source_id,
            snapshot_id: body.snapshot_id,
            review_status: body.review_status,
            notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) || null : null,
          });
          return jsonResponse({ saved: true });
        } catch (error) {
          return jsonResponse(
            { message: error instanceof Error ? error.message : "Review gagal disimpan." },
            409,
          );
        }
      },
    },
  },
});
