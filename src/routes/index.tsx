import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileText,
  ChartNoAxesCombined,
  SlidersHorizontal,
} from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { ScoreOrbit } from "@/components/public/ScoreOrbit";
import { SkdSearchTool } from "@/components/public/SkdSearchTool";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { countStats } from "@/services/skdService";

export const Route = createFileRoute("/")({ component: LandingPage });

function LandingPage() {
  const stats = useQuery({
    queryKey: ["public-dataset-stats"],
    queryFn: countStats,
    enabled: isSupabaseConfigured,
    staleTime: 300_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const metric = (value?: number) =>
    value !== undefined ? value.toLocaleString("id-ID") : stats.isFetching ? "Memuat…" : "—";
  return (
    <div className="public-page min-h-screen bg-background">
      <SiteHeader />
      <main className="public-workspace editorial-home">
        <section className="decision-hero" aria-labelledby="hero-title">
          <div className="decision-copy">
            <p className="public-kicker">BUKAN SEKADAR LOLOS PASSING GRADE</p>
            <h1 id="hero-title">
              Kenali nilaimu.
              <br />
              <em>Petakan peluangmu.</em>
            </h1>
            <p className="decision-description">
              Baca persaingan di balik angka. Telusuri hasil SKD, bandingkan pilihan, dan temukan
              formasi yang layak kamu pertimbangkan.
            </p>
            <div className="hero-actions">
              <a href="#mulai" className="public-primary-button">
                Cek nilai saya <ArrowRight size={17} />
              </a>
              <Link to="/formasi" className="hero-text-link">
                Jelajahi formasi <ArrowUpRight size={17} />
              </Link>
            </div>
            <p className="hero-footnote">
              <Check size={15} /> Bersumber dari pengumuman instansi <span>•</span> SKD 2024
            </p>
          </div>
          <ScoreOrbit />
        </section>
        <section className="dataset-ribbon" aria-label="Cakupan data">
          <div>
            <FileText size={20} />
            <span>
              Dari dokumen resmi.
              <br />
              <strong>Untuk keputusanmu berikutnya.</strong>
            </span>
          </div>
          <div>
            <strong>{metric(stats.data?.scores)}</strong>
            <span>peserta dalam basis data</span>
          </div>
          <div>
            <strong>{metric(stats.data?.formations)}</strong>
            <span>formasi untuk ditelusuri</span>
          </div>
          <div>
            <strong>2024</strong>
            <span>tahun data historis</span>
          </div>
        </section>
        <section id="mulai" className="home-search-desk">
          <div className="desk-intro">
            <span className="section-index">01 / TEMUKAN DATAMU</span>
            <h2>
              Mulai dari
              <br />
              nilai sendiri.
            </h2>
            <p>
              Cari nama atau nomor peserta. Setelah ketemu, buka hasil untuk membaca posisi dan
              pilihan formasi.
            </p>
            <span className="desk-note">
              Belum tahu targetnya?{" "}
              <Link to="/formasi">
                Lihat formasi <ArrowUpRight size={14} />
              </Link>
            </span>
          </div>
          <div className="desk-form">
            <SkdSearchTool compact />
          </div>
        </section>
        <section className="next-decisions" aria-labelledby="next-title">
          <div className="section-heading">
            <div>
              <span className="section-index">02 / SUSUN PILIHANMU</span>
              <h2 id="next-title">Jangan berhenti di total nilai.</h2>
            </div>
            <p>Lihat ruang pilihan sebelum menentukan tujuan.</p>
          </div>
          <div className="decision-links">
            <Link to="/formasi">
              <SlidersHorizontal size={23} />
              <div>
                <span>TELUSURI</span>
                <h3>Temukan formasi yang relevan</h3>
                <p>Saring berdasarkan pendidikan, instansi, dan tingkat persaingan.</p>
              </div>
              <ArrowUpRight size={24} />
            </Link>
            <Link to="/formasi/banding" search={{ ids: undefined }}>
              <ChartNoAxesCombined size={23} />
              <div>
                <span>BANDINGKAN</span>
                <h3>Baca pilihan berdampingan</h3>
                <p>Bandingkan hingga tiga formasi: kuota, peserta, dan batas nilai.</p>
              </div>
              <ArrowUpRight size={24} />
            </Link>
          </div>
        </section>
        <section id="cara-kerja" className="method-ledger">
          <div>
            <span className="section-index">03 / PAHAMI KONTEKSNYA</span>
            <h2>
              Data membantu.
              <br />
              Keputusan tetap di kamu.
            </h2>
            <p>AnalisaCPNS adalah alat bantu membaca data historis, bukan pengumuman kelulusan.</p>
          </div>
          <ol>
            {[
              [
                "Sumber yang bisa ditelusuri",
                "Nilai berasal dari PDF pengumuman instansi yang telah diproses. Periksa kembali dokumen sumber untuk hasil resmi.",
              ],
              [
                "Persaingan, bukan sekadar passing grade",
                "Baca nilai bersama kuota, peserta, pendidikan, dan batas historis formasi.",
              ],
              [
                "Bawa hasilnya ke langkah berikutnya",
                "Lanjutkan dari hasil peserta untuk memilih target dan menerima ringkasan analisis melalui WhatsApp.",
              ],
            ].map(([title, copy], i) => (
              <li key={title}>
                <span>0{i + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
