import { createFileRoute } from "@tanstack/react-router";
import { getAuthenticatedUser } from "@/lib/auth/server";
import { getServerSupabase, jsonResponse } from "@/lib/supabase/server";
import { getSscasnContext } from "@/server/sscasn";

const SORTS = new Set([
  "competition_desc",
  "competition_asc",
  "cutoff_desc",
  "quota_desc",
  "name_asc",
]);
const COMPETITION_LEVELS = new Set(["quiet", "low", "medium", "high"]);

function textParam(url: URL, name: string, maxLength = 100): string | null {
  const value = url.searchParams.get(name)?.trim() ?? "";
  return value && value.length <= maxLength ? value : null;
}

function integerParam(url: URL, name: string, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(url.searchParams.get(name) ?? "", 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(1, parsed)) : fallback;
}

export const Route = createFileRoute("/api/formations")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) return jsonResponse({ message: `Supabase belum siap: ${configError}` }, 503);

        const auth = await getAuthenticatedUser(request, sb);
        const url = new URL(request.url);
        const fullAccess = Boolean(auth);
        const requestedSort = textParam(url, "sort", 40);
        const requestedCompetition = textParam(url, "competition_level", 20);

        const { data, error } = await sb.rpc("search_public_skd_formations", {
          p_query: fullAccess ? textParam(url, "query") : null,
          p_instansi: fullAccess ? textParam(url, "institution", 160) : null,
          p_pendidikan: fullAccess ? textParam(url, "education", 160) : null,
          p_jenis_formasi: fullAccess ? textParam(url, "formation_type", 80) : null,
          p_competition_level:
            fullAccess && requestedCompetition && COMPETITION_LEVELS.has(requestedCompetition)
              ? requestedCompetition
              : null,
          p_sort:
            fullAccess && requestedSort && SORTS.has(requestedSort)
              ? requestedSort
              : "competition_desc",
          p_page: fullAccess ? integerParam(url, "page", 1, 10_000) : 1,
          p_page_size: fullAccess ? integerParam(url, "page_size", 24, 24) : 6,
        });
        if (error) return jsonResponse({ message: "Data formasi belum dapat dimuat." }, 500);
        if (!data || typeof data !== "object") {
          return jsonResponse({ message: "Respons data formasi tidak valid." }, 500);
        }

        const response = data as Record<string, unknown>;
        const formations = Array.isArray(response.formations)
          ? (response.formations as Array<{ id: string }>)
          : [];
        const context = await getSscasnContext(
          sb,
          formations.map((row) => row.id),
        );
        return jsonResponse({
          ...response,
          formations: formations.map((row) => ({ ...row, sscasn: context[row.id] ?? null })),
          access: fullAccess ? "full" : "preview",
          available_filters: fullAccess
            ? response.available_filters
            : {
                institutions: [],
                formation_types: [],
                years:
                  typeof response.available_filters === "object" && response.available_filters
                    ? ((response.available_filters as Record<string, unknown>).years ?? [])
                    : [],
              },
        });
      },
    },
  },
});
