import { createFileRoute } from "@tanstack/react-router";
import { getServerSupabase, jsonResponse, requireAdmin } from "@/lib/supabase/server";

export const Route = createFileRoute("/api/admin/pdf-sources")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const authError = requireAdmin(request);
        if (authError) return authError;

        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) {
          return jsonResponse({ message: `Supabase server belum siap: ${configError}` }, 503);
        }

        const { data, error } = await sb
          .from("skd_sources")
          .select("id, source_url, skd_batches!inner(selection_year)");
        if (error) return jsonResponse({ message: error.message }, 500);

        const rows = (data ?? []) as Array<{
          id: string;
          source_url: string | null;
          skd_batches: Array<{ selection_year: number }>;
        }>;
        const stats = rows.reduce(
          (acc, row) => {
            const year = row.skd_batches[0]?.selection_year?.toString() ?? "tanpa tahun";
            acc.total += 1;
            if (row.source_url?.trim()) acc.withUrl += 1;
            else acc.withoutUrl += 1;
            acc.byYear[year] = (acc.byYear[year] ?? 0) + 1;
            return acc;
          },
          { total: 0, withUrl: 0, withoutUrl: 0, byYear: {} as Record<string, number> },
        );

        return jsonResponse(stats);
      },
      POST: async ({ request }: { request: Request }) => {
        const body = (await request.json().catch(() => null)) as {
          adminPassword?: string;
        } | null;
        const authError = requireAdmin(request, body);
        if (authError) return authError;
        return jsonResponse(
          {
            message:
              "Sumber PDF sekarang wajib dibuat sebagai bagian dari batch instansi melalui endpoint skd-batches.",
          },
          410,
        );
      },
    },
  },
});
