import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, ListChecks, Eye, MessageCircle, ShieldCheck, GraduationCap } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-24 right-[-10%] h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute top-40 left-[-10%] h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
        </div>
        <div className="mx-auto max-w-6xl px-4 pt-16 pb-20 sm:pt-24 sm:pb-28">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
              <GraduationCap className="h-3.5 w-3.5 text-primary" />
              cpnsguru.id · Simulasi Edukatif
            </span>
            <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
              Cek Rasionalisasi <span className="text-primary">Nilai SKD</span> Kamu
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
              Cari data nilai SKD tahun lalu, bandingkan dengan formasi sejenis, dan lihat apakah
              nilaimu masih layak dipertahankan atau lebih aman tes ulang.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                to="/search"
                className="inline-flex items-center gap-2 rounded-lg bg-brand-gradient px-6 py-3 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition hover:opacity-95"
              >
                <Search className="h-4 w-4" />
                Cek Nilai SKD Saya
              </Link>
              <a
                href="#cara-kerja"
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground transition hover:bg-muted"
              >
                Lihat cara kerja
              </a>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Gratis · Tanpa perlu login · Data dari pengumuman instansi
            </p>
          </div>
        </div>
      </section>

      {/* Cara Kerja */}
      <section id="cara-kerja" className="border-t border-border bg-muted/40 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Cara Kerja</h2>
            <p className="mt-3 text-muted-foreground">
              Empat langkah singkat untuk memahami posisi nilai SKD Kakak.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: Search,
                title: "Cari data",
                desc: "Ketik nama atau nomor peserta SKD Kakak.",
              },
              {
                icon: ListChecks,
                title: "Pilih data",
                desc: "Pilih baris yang benar-benar milik Kakak.",
              },
              {
                icon: Eye,
                title: "Lihat preview",
                desc: "Nilai TWK, TIU, TKP, total, dan zona nilai.",
              },
              {
                icon: MessageCircle,
                title: "Analisa via WA",
                desc: "Terima analisa lengkap lewat WhatsApp.",
              },
            ].map((s, i) => (
              <div
                key={s.title}
                className="rounded-xl border border-border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft text-primary">
                    <s.icon className="h-4 w-4" />
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">
                    Langkah {i + 1}
                  </span>
                </div>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Value / soft-sell */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 lg:grid-cols-2 lg:items-center">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-warm-soft px-3 py-1 text-xs font-semibold text-accent-foreground">
              Kenapa penting?
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              Passing grade lolos ≠ otomatis ranking aman
            </h2>
            <p className="mt-3 text-muted-foreground">
              Persaingan CPNS tidak hanya soal ambang batas. Ranking, jumlah pesaing, dan kuota
              formasi sama-sama menentukan. Rasionalisasi membantu Kakak memutuskan: pakai nilai
              lama atau tes ulang.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                "Estimasi zona nilai (Aman / Waspada / Rawan)",
                "Perbandingan terhadap data formasi sejenis",
                "Rekomendasi strategi persiapan yang realistis",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Contoh preview
            </p>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Nama</span>
                <span className="font-medium">Andi ***</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Instansi</span>
                <span className="font-medium">Kemen. XYZ</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Formasi</span>
                <span className="font-medium">Analis Kebijakan</span>
              </div>
              <div className="my-3 h-px bg-border" />
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  { l: "TWK", v: 90 },
                  { l: "TIU", v: 125 },
                  { l: "TKP", v: 178 },
                  { l: "Total", v: 393 },
                ].map((c) => (
                  <div key={c.l} className="rounded-lg bg-muted p-2">
                    <div className="text-[10px] text-muted-foreground">{c.l}</div>
                    <div className="text-lg font-bold text-primary">{c.v}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <span className="font-semibold">Zona Waspada.</span> Peluang tetap ada, tapi
                bergantung tingkat kompetisi.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Disclaimer */}
      <section className="pb-16">
        <div className="mx-auto max-w-4xl px-4">
          <div className="rounded-xl border border-border bg-muted/50 p-5 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">Disclaimer</p>
            <p className="mt-1">
              Hasil analisa ini bukan pengumuman resmi dan tidak menjamin kelulusan. Data bersumber
              dari pengumuman instansi yang telah dipublikasikan. Gunakan sebagai bahan pertimbangan
              strategi persiapan, bukan sebagai jaminan hasil.
            </p>
          </div>
          <div className="mt-8 text-center">
            <Link
              to="/search"
              className="inline-flex items-center gap-2 rounded-lg bg-brand-gradient px-6 py-3 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition hover:opacity-95"
            >
              <Search className="h-4 w-4" />
              Mulai Cek Nilai SKD
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
