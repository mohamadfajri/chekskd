import { createFileRoute } from "@tanstack/react-router";
import { FormationExplorer } from "@/components/public/FormationExplorer";

export const Route = createFileRoute("/formasi/")({
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
  return (
    <main>
      <FormationExplorer />
    </main>
  );
}
