import { createFileRoute } from "@tanstack/react-router";
import { getAuthenticatedUser } from "@/lib/auth/server";
import {
  catalogCompetition,
  catalogEducationOptions,
  catalogLevel,
  catalogSort,
  catalogText,
} from "@/lib/formationCatalog";
import { getServerSupabase, jsonResponse } from "@/lib/supabase/server";
import { aesenCatalogEnabled, getAesenEducationKeys } from "@/server/aesenCatalog";
import {
  browseFormationCatalog,
  getCatalogInstitutions,
  getPilotEducationKeys,
  getUnifiedFormationCatalog,
} from "@/server/formationCatalog";
import { useSumopodSkdReads as readsSkdFromSumopod } from "@/server/skdPreview";

export const Route = createFileRoute("/api/formation-catalog")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const params = new URL(request.url).searchParams;
        try {
          const mode = params.get("mode");
          if (mode === "institutions" || mode === "education") {
            const query = catalogText(params.get("q")) ?? "";
            const body =
              mode === "institutions"
                ? { institutions: await getCatalogInstitutions() }
                : {
                    options: catalogEducationOptions(
                      aesenCatalogEnabled()
                        ? await getAesenEducationKeys()
                        : getPilotEducationKeys(),
                      query,
                    ),
                  };
            return Response.json(body, {
              headers: { "cache-control": "public, max-age=300, s-maxage=900" },
            });
          }
          const { client: sb } = getServerSupabase();
          const auth = sb ? await getAuthenticatedUser(request, sb) : null;
          const catalog = sb
            ? await getUnifiedFormationCatalog(
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
              )
            : browseFormationCatalog({}, false, null);
          if (mode === "page") {
            const { institutions: _institutions, ...page } = catalog;
            return jsonResponse(page);
          }
          return jsonResponse(catalog);
        } catch {
          return jsonResponse({ message: "Daftar formasi belum dapat dimuat." }, 503);
        }
      },
    },
  },
});
