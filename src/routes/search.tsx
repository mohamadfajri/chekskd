import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Target } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { SkdModeNav } from "@/components/public/SkdModeNav";
import { SkdSearchTool } from "@/components/public/SkdSearchTool";
import { cleanFormationId } from "@/lib/formationSelection";
import { getPublicFormationDetail } from "@/services/formationService";

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>): { targetFormationId?: string } => ({
    targetFormationId: cleanFormationId(search.targetFormationId),
  }),
  head: () => ({
    meta: [
      { title: "Cari Data SKD - AnalisaCPNS" },
      { name: "description", content: "Cari data nilai SKD berdasarkan nama atau nomor peserta." },
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
    <div className="public-page min-h-screen bg-background">
      <SiteHeader />
      <main className="public-workspace skd-value-workspace">
        <SkdModeNav mode="skd" targetFormationId={targetFormationId} />
        {targetFormationId && (
          <div className="public-target-notice" role="status">
            {target.isLoading ? (
              <LoaderCircle
                className="mt-0.5 size-4 shrink-0 motion-safe:animate-spin text-primary"
                aria-hidden
              />
            ) : (
              <Target className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            )}
            <div className="min-w-0">
              <p className="text-xs font-bold">Target perbandingan</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                {target.data
                  ? `${target.data.jabatan} - ${target.data.nama_instansi}`
                  : target.isError
                    ? "Target belum dapat dibaca. Anda tetap dapat mencari data peserta."
                    : "Memuat formasi target..."}
              </p>
            </div>
          </div>
        )}
        <SkdSearchTool targetFormationId={targetFormationId} />
        <Link
          to="/simulasi-skd"
          search={{ targetFormationId, sumber: "skd" }}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
        >
          Masukkan nilai SKD 2024 manual
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
