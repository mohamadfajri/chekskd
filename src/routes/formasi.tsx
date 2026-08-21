import { createFileRoute } from "@tanstack/react-router";
import { FormationExplorer } from "@/components/public/FormationExplorer";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";

export const Route = createFileRoute("/formasi")({
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
  component: FormationPage,
});

function FormationPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main>
        <FormationExplorer />
      </main>
      <SiteFooter />
    </div>
  );
}
