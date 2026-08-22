import { createFileRoute } from "@tanstack/react-router";
import { FormationExplorer } from "@/components/public/FormationExplorer";
import { parseFormationIds, serializeFormationIds } from "@/lib/formationSelection";

export const Route = createFileRoute("/formasi/")({
  validateSearch: (search: Record<string, unknown>) => ({
    banding: serializeFormationIds(parseFormationIds(search.banding)),
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
  const { banding } = Route.useSearch();
  return (
    <main>
      <FormationExplorer initialComparisonIds={parseFormationIds(banding)} />
    </main>
  );
}
