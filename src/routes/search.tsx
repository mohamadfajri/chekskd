import { createFileRoute } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { SkdSearchTool } from "@/components/public/SkdSearchTool";

export const Route = createFileRoute("/search")({
  head: () => ({
    meta: [
      { title: "Cari Data SKD - AnalisaCPNS" },
      {
        name: "description",
        content: "Cari data nilai SKD berdasarkan nama atau nomor peserta.",
      },
    ],
  }),
  component: SearchPage,
});

function SearchPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main>
        <section className="border-b border-border bg-muted">
          <div className="mx-auto max-w-[960px] px-4 py-10 sm:px-6 sm:py-14">
            <p className="font-mono text-[11px] font-semibold uppercase text-primary">
              Data SKD historis
            </p>
            <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">Temukan data Anda</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Cari nama atau nomor peserta, lalu cocokkan instansi, formasi, dan nilai sebelum
              melanjutkan ke analisis.
            </p>
            <div className="mt-7">
              <SkdSearchTool compact />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
