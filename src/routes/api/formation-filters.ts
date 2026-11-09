import { createFileRoute } from "@tanstack/react-router";
import { getServerSupabase, jsonResponse } from "@/lib/supabase/server";
import {
  getSumopodSkdFormationFilters,
  useSumopodSkdReads as readsSkdFromSumopod,
} from "@/server/skdPreview";

export const Route = createFileRoute("/api/formation-filters")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) return jsonResponse({ message: `Supabase belum siap: ${configError}` }, 503);

        let data: unknown;
        try {
          if (readsSkdFromSumopod(request)) {
            data = await getSumopodSkdFormationFilters();
          } else {
            const result = await sb.rpc("get_skd_formation_filter_options");
            if (result.error) throw result.error;
            data = result.data;
          }
        } catch {
          return jsonResponse({ message: "Pilihan filter belum dapat dimuat." }, 500);
        }
        if (!data || typeof data !== "object") {
          return jsonResponse({ message: "Pilihan filter belum dapat dimuat." }, 500);
        }

        return new Response(JSON.stringify(data), {
          headers: {
            "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
            "content-type": "application/json; charset=utf-8",
          },
        });
      },
    },
  },
});
