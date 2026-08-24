import { createFileRoute } from "@tanstack/react-router";
import { FormationExplorer } from "@/components/public/FormationExplorer";
import { parseFormationIds, serializeFormationIds } from "@/lib/formationSelection";
import type { FormationCompetitionLevel, FormationSort } from "@/services/formationService";

const competitionLevels = new Set<FormationCompetitionLevel>(["quiet", "low", "medium", "high"]);
const formationSorts = new Set<FormationSort>([
  "competition_desc",
  "competition_asc",
  "cutoff_desc",
  "quota_desc",
  "name_asc",
]);

function searchText(value: unknown, maximum = 160): string | undefined {
  return typeof value === "string" && value.trim() && value.trim().length <= maximum
    ? value.trim()
    : undefined;
}

export const Route = createFileRoute("/formasi/")({
  validateSearch: (search: Record<string, unknown>) => ({
    banding: serializeFormationIds(parseFormationIds(search.banding)),
    q: searchText(search.q, 100),
    instansi: searchText(search.instansi),
    pendidikan: searchText(search.pendidikan),
    jenis: searchText(search.jenis, 80),
    persaingan:
      typeof search.persaingan === "string" &&
      competitionLevels.has(search.persaingan as FormationCompetitionLevel)
        ? (search.persaingan as FormationCompetitionLevel)
        : undefined,
    urut:
      typeof search.urut === "string" && formationSorts.has(search.urut as FormationSort)
        ? (search.urut as FormationSort)
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Jelajahi Formasi CPNS - AnalisaCPNS" },
      {
        name: "description",
        content:
          "Bandingkan kuota, persaingan, dan batas nilai historis formasi CPNS dari data SKD terverifikasi.",
      },
    ],
  }),
  component: FormationIndexPage,
});

function FormationIndexPage() {
  const { banding, q, instansi, pendidikan, jenis, persaingan, urut } = Route.useSearch();
  return (
    <main>
      <FormationExplorer
        initialComparisonIds={parseFormationIds(banding)}
        initialFilters={{
          query: q,
          institution: instansi,
          education: pendidikan,
          formationType: jenis,
          competitionLevel: persaingan,
          sort: urut,
        }}
      />
    </main>
  );
}
