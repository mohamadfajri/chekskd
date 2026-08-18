import { createFileRoute } from "@tanstack/react-router";
import { getServerSupabase, jsonResponse, requireAdmin } from "@/lib/supabase/server";

const STATUSES = [
  "waiting",
  "queued",
  "processing",
  "ready",
  "delivered",
  "failed",
  "expired",
] as const;

export const Route = createFileRoute("/api/admin/result-sessions")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const authError = requireAdmin(request);
        if (authError) return authError;

        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) {
          return jsonResponse({ message: `Supabase server belum siap: ${configError}` }, 503);
        }

        const [sessionRows, phoneCount, marketingCount, ...statusCounts] = await Promise.all([
          sb
            .from("result_sessions")
            .select(
              "id, token, status, sender_wa_id, used_count, nama_peserta, instansi, formasi, twk, tiu, tkp, total, zona, created_at, updated_at, ready_at, delivered_at, failure_message, leads(nama_panggilan, target_instansi, target_formasi, recommendation_mode, consent_marketing)",
            )
            .order("created_at", { ascending: false })
            .limit(100),
          sb
            .from("result_sessions")
            .select("id", { count: "exact", head: true })
            .not("sender_wa_id", "is", null),
          sb
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq("consent_marketing", true)
            .not("whatsapp", "is", null),
          ...STATUSES.map((status) =>
            sb
              .from("result_sessions")
              .select("id", { count: "exact", head: true })
              .eq("status", status),
          ),
        ]);

        const firstError = [sessionRows, phoneCount, marketingCount, ...statusCounts].find(
          (result) => result.error,
        )?.error;
        if (firstError) return jsonResponse({ message: firstError.message }, 500);

        return jsonResponse({
          summary: {
            by_status: Object.fromEntries(
              STATUSES.map((status, index) => [status, statusCounts[index].count ?? 0]),
            ),
            phone_bound: phoneCount.count ?? 0,
            marketing_consented: marketingCount.count ?? 0,
          },
          sessions: sessionRows.data ?? [],
        });
      },
    },
  },
});
