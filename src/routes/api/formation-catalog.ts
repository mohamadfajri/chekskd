import { createFileRoute } from "@tanstack/react-router";
import { getAuthenticatedUser } from "@/lib/auth/server";
import { catalogCompetition, catalogLevel, catalogSort, catalogText } from "@/lib/formationCatalog";
import { getServerSupabase, jsonResponse } from "@/lib/supabase/server";
import { browseFormationCatalog, getUnifiedFormationCatalog } from "@/server/formationCatalog";
import { useSumopodSkdReads as readsSkdFromSumopod } from "@/server/skdPreview";

export const Route = createFileRoute("/api/formation-catalog")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { client: sb } = getServerSupabase();
        const auth = sb ? await getAuthenticatedUser(request, sb) : null;
        const params = new URL(request.url).searchParams;
        if (!sb) return jsonResponse(browseFormationCatalog({}, false, null));
        try {
          return jsonResponse(
            await getUnifiedFormationCatalog(
              sb,
              {
                query: catalogText(params.get("query")),
                institution: catalogText(params.get("institution"), 160),
                education: catalogText(params.get("education"), 160),
                level: catalogLevel(params.get("level")),
                page: Number(params.get("page") ?? 1),
                hasSkd: params.get("hasSkd") === "true",
                formationType: catalogText(params.get("formationType"), 80),
                competitionLevel: catalogCompetition(params.get("competitionLevel")),
                sort: catalogSort(params.get("sort")),
              },
              Boolean(auth),
              readsSkdFromSumopod(request),
            ),
          );
        } catch {
          return jsonResponse({ message: "Daftar formasi belum dapat dimuat." }, 503);
        }
      },
    },
  },
});
