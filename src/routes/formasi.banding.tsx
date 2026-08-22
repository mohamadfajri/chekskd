import { createFileRoute } from "@tanstack/react-router";
import { FormationComparison } from "@/components/public/FormationComparison";
import { parseFormationIds, serializeFormationIds } from "@/lib/formationSelection";

export const Route = createFileRoute("/formasi/banding")({
  validateSearch: (search: Record<string, unknown>) => ({
    ids: serializeFormationIds(parseFormationIds(search.ids)),
  }),
  head: () => ({
    meta: [
      { title: "Bandingkan Formasi CPNS - AnalisaCPNS" },
      {
        name: "description",
        content: "Bandingkan kuota, persaingan, dan batas historis hingga tiga formasi CPNS.",
      },
    ],
  }),
  component: FormationComparisonPage,
});

function FormationComparisonPage() {
  const { ids } = Route.useSearch();
  return <FormationComparison formationIds={parseFormationIds(ids)} />;
}
