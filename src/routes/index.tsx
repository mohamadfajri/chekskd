import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Search } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { HomeJourney } from "@/components/public/HomeJourney";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="public-page min-h-screen bg-background">
      <SiteHeader />
      <main className="home-workspace">
        <header className="home-intro">
          <p className="home-eyebrow">AnalisaCPNS &mdash; Analisis Nilai &amp; Formasi Gratis</p>
          <h1>
            Seberapa Besar Peluangmu <span>di CPNS Berikutnya?</span>
          </h1>
          <p className="home-intro-copy">
            Cek nilai SKD lama, bandingkan skor tryout dan pesaing, lalu temukan formasi yang paling
            sesuai dengan nilaimu.
          </p>
          <div className="home-actions">
            <Link
              to="/search"
              search={{ targetFormationId: undefined }}
              className="public-primary-button"
            >
              <Search className="size-4" aria-hidden /> Cari nilai
            </Link>
            <Link to="/formasi" className="home-catalog-link">
              Lihat formasi <ArrowUpRight className="size-4" aria-hidden />
            </Link>
          </div>
        </header>
        <HomeJourney />
      </main>
      <footer className="home-note">Analisis historis, bukan penentu kelulusan.</footer>
    </div>
  );
}
