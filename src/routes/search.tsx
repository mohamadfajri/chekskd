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
    <div className="public-page min-h-screen bg-background">
      <SiteHeader />
      <main className="public-workspace">
        <header className="public-page-heading">
          <div>
            <p className="public-kicker font-mono">Workspace pencarian</p>
            <h1>Temukan posisi nilai SKD</h1>
            <p>Cari peserta dari data PDF resmi dan lanjutkan ke analisis target.</p>
          </div>
          <span className="public-meta-badge font-mono">
            <i />
            EDISI SKD 2024
          </span>
        </header>

        <section className="public-search-workbench">
          <div className="public-search-main">
            <p className="font-mono">Mulai dari data peserta</p>
            <h2>
              Cari nama, lalu lihat <span>posisinya dalam persaingan.</span>
            </h2>
            <p>Nama dapat dicari sebagian. Gunakan filter jika hasil terlalu banyak.</p>
            {targetFormationId ? (
              <div className="public-target-notice">
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
            <div className="mt-6">
              <SkdSearchTool compact targetFormationId={targetFormationId} />
            </div>
          </div>

          <aside className="public-rank-preview" aria-label="Pratinjau peta data">
            <div>
              <p className="font-mono">Peta data aktif</p>
              <span className="font-mono">LIVE</span>
            </div>
            <h2>Living Rankline</h2>
            <svg viewBox="0 0 320 145" preserveAspectRatio="none" aria-hidden>
              <path d="M0 128 C35 124,55 111,82 108 S128 91,160 81 S206 55,246 48 S282 24,320 18" />
              <circle cx="52" cy="116" r="5" />
              <circle cx="155" cy="83" r="5" />
              <circle cx="244" cy="49" r="5" />
              <circle cx="304" cy="25" r="5" />
            </svg>
            <div className="public-rank-summary">
              <div>
                <strong>SKD</strong>
                <span className="font-mono">DATA</span>
              </div>
              <div>
                <strong>2024</strong>
                <span className="font-mono">TAHUN</span>
              </div>
              <div>
                <strong>PDF</strong>
                <span className="font-mono">SUMBER</span>
              </div>
            </div>
          </aside>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
