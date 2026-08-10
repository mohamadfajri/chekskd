import { createFileRoute } from "@tanstack/react-router";
import { getServerSupabase, jsonResponse } from "@/lib/supabase/server";

function validUuid(value: string | null): string | null {
  const cleaned = value?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleaned)
    ? cleaned
    : null;
}

export const Route = createFileRoute("/api/rationalization-targets")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        const scoreId = validUuid(url.searchParams.get("score_id"));
        const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);

        if (!scoreId || query.length < 2) {
          return jsonResponse({ items: [] });
        }

        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) {
          return jsonResponse({ message: `Supabase server belum siap: ${configError}` }, 503);
        }

        const { data, error } = await sb.rpc("search_skd_target_formations", {
          p_score_id: scoreId,
          p_query: query,
          p_limit: 20,
        });
        if (error) {
          return jsonResponse({ message: "Target formasi belum dapat dicari." }, 500);
        }

        return jsonResponse({ items: Array.isArray(data) ? data : [] });
      },
    },
  },
});
