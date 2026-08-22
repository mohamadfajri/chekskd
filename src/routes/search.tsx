import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Target } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { SkdSearchTool } from "@/components/public/SkdSearchTool";
import { cleanFormationId } from "@/lib/formationSelection";
import { getPublicFormationDetail } from "@/services/formationService";

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>) => ({
    targetFormationId: cleanFormationId(search.targetFormationId),
  }),
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
  const { targetFormationId } = Route.useSearch();
  const target = useQuery({
    queryKey: ["public-formation-detail", targetFormationId],
    queryFn: () => getPublicFormationDetail(targetFormationId!),
    enabled: Boolean(targetFormationId),
  });

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
            {targetFormationId ? (
              <div className="mt-5 flex max-w-2xl items-start gap-3 border-l-2 border-[#39d4d8] bg-white px-4 py-3">
                {target.isLoading ? (
                  <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
                ) : (
                  <Target className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#071b36]">Target perbandingan dipilih</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {target.data
                      ? `${target.data.jabatan} - ${target.data.nama_instansi}`
                      : target.isError
                        ? "Target belum dapat dibaca. Anda tetap dapat mencari data peserta."
                        : "Memuat formasi target..."}
                  </p>
                </div>
              </div>
            ) : null}
            <div className="mt-7">
              <SkdSearchTool compact targetFormationId={targetFormationId} />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
