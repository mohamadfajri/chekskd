import { createFileRoute } from "@tanstack/react-router";
import { FormationDetail } from "@/components/public/FormationDetail";

export const Route = createFileRoute("/formasi/$formationId")({
  head: () => ({
    meta: [
      { title: "Detail Formasi CPNS - AnalisaCPNS" },
      {
        name: "description",
        content:
          "Lihat persaingan, sebaran nilai, batas historis, dan sumber data satu formasi CPNS.",
      },
    ],
  }),
  component: FormationDetailPage,
});

function FormationDetailPage() {
  const { formationId } = Route.useParams();
  return <FormationDetail formationId={formationId} />;
}
