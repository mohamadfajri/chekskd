import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BarChart3, FileCheck2, MessageCircle, Search } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { HomeJourney, HomeTrustStrip } from "@/components/public/HomeJourney";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { countStats } from "@/services/skdService";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const stats = useQuery({
    queryKey: ["public-dataset-stats"],
    queryFn: countStats,
    enabled: isSupabaseConfigured,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="public-page min-h-screen bg-background">
      <SiteHeader />
      <main className="public-workspace">
        <header className="public-page-heading home-page-heading">
          <div>
            <p className="public-kicker font-mono">Cara kerja AnalisaCPNS</p>
            <h1>Dari data resmi sampai analisis WhatsApp</h1>
            <p>
              Temukan peserta, pahami posisi nilai, lalu pilih target yang lebih rasional dalam satu
              alur.
            </p>
          </div>
          <span className="public-meta-badge font-mono">
            <i />
            SIMULASI BERJALAN
          </span>
        </header>

        <HomeJourney />
        <HomeTrustStrip />

        <section className="home-data-band" aria-label="Cakupan data">
          <div>
            <p className="public-kicker font-mono">Cakupan data aktif</p>
            <h2>Data yang siap dicari dan dibandingkan</h2>
          </div>
          <div className="home-data-metrics">
            <DataMetric label="Peserta" value={stats.data?.scores} loading={stats.isLoading} />
            <DataMetric label="Formasi" value={stats.data?.formations} loading={stats.isLoading} />
            <DataMetric label="Tahun data" value="2024" />
          </div>
          <Link to="/formasi" className="public-secondary-button">
            Jelajahi formasi <ArrowRight className="h-4 w-4" />
          </Link>
        </section>

        <section id="cara-kerja" className="home-method-section">
          <header>
            <p className="public-kicker font-mono">Metode rasionalisasi</p>
            <h2>Nilai dibaca dalam konteks persaingan</h2>
            <p>
              Passing grade adalah titik awal. Mesin juga membaca kuota, peserta hadir, batas
              historis, pendidikan, dan kualitas sumber.
            </p>
          </header>
          <div className="home-method-grid">
            <MethodStep icon={FileCheck2} number="01" title="Mulai dari sumber resmi">
              Nilai peserta diambil dari PDF pengumuman yang telah diproses dan diperiksa.
            </MethodStep>
            <MethodStep icon={BarChart3} number="02" title="Baca posisi historis">
              Nilai dibandingkan dengan peserta dan batas historis pada kelompok formasi.
            </MethodStep>
            <MethodStep icon={MessageCircle} number="03" title="Kirim hasil yang ringkas">
              Rekomendasi lengkap dikemas menjadi satu kartu yang diterima melalui WhatsApp.
            </MethodStep>
          </div>
          <div className="home-method-action">
            <p>
              AnalisaCPNS tidak menjanjikan kelulusan. Hasil dipakai sebagai bahan pertimbangan.
            </p>
            <Link to="/search" className="public-primary-button">
              Cari data saya <Search className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function DataMetric({
  label,
  value,
  loading = false,
}: {
  label: string;
  value?: number | string;
  loading?: boolean;
}) {
  const displayValue = loading
    ? "..."
    : typeof value === "number"
      ? value.toLocaleString("id-ID")
      : (value ?? "-");
  return (
    <div>
      <span className="font-mono">{label}</span>
      <strong>{displayValue}</strong>
    </div>
  );
}

function MethodStep({
  icon: Icon,
  number,
  title,
  children,
}: {
  icon: typeof Search;
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article>
      <div>
        <span>
          <Icon className="h-5 w-5" />
        </span>
        <b className="font-mono">{number}</b>
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </article>
  );
}
