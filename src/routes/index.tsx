import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, BarChart3, Database, MessageCircle, Search, ShieldCheck } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { SkdSearchTool } from "@/components/public/SkdSearchTool";
import { countStats } from "@/services/skdService";
import { isSupabaseConfigured } from "@/lib/supabase/client";

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
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <main>
        <section className="border-b border-border bg-muted">
          <div className="mx-auto max-w-[1240px] px-4 pb-10 pt-10 sm:px-6 sm:pb-14 sm:pt-14">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-end">
              <div>
                <p className="font-mono text-[11px] font-semibold uppercase text-primary">
                  Analisis persaingan SKD
                </p>
                <h1 className="mt-3 max-w-3xl text-4xl font-extrabold leading-[1.08] sm:text-5xl lg:text-[58px]">
                  Nilai menjadi posisi yang bisa dipahami.
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                  Temukan data SKD Anda, lihat konteks persaingannya, lalu uji nilai yang sama pada
                  formasi lain sebelum mengambil keputusan.
                </p>
                <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-[#16805c]" /> Tanpa login
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Database className="h-4 w-4 text-primary" /> Data pengumuman instansi
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MessageCircle className="h-4 w-4 text-[#16805c]" /> Hasil melalui WhatsApp
                  </span>
                </div>
              </div>

              <PositionRail />
            </div>

            <div className="mt-8 max-w-4xl">
              <SkdSearchTool />
            </div>
          </div>
        </section>

        <section aria-label="Cakupan data" className="border-b border-border bg-white">
          <div className="mx-auto grid max-w-[1240px] grid-cols-2 px-4 sm:px-6 md:grid-cols-4">
            <CoverageMetric
              label="Peserta terpublikasi"
              value={stats.data?.scores}
              loading={stats.isLoading}
            />
            <CoverageMetric
              label="Formasi terpublikasi"
              value={stats.data?.formations}
              loading={stats.isLoading}
            />
            <CoverageMetric label="Tahun data" value="2024" />
            <CoverageMetric label="Status" value="Historis" />
          </div>
        </section>

        <section id="cara-kerja" className="bg-white py-14 sm:py-20">
          <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="font-mono text-[11px] font-semibold uppercase text-primary">
                Alur analisis
              </p>
              <h2 className="mt-2 text-2xl font-bold sm:text-3xl">
                Dari data lama ke keputusan berikutnya
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Passing grade hanya titik awal. AnalisaCPNS membantu membaca posisi, persaingan, dan
                alternatif target dari data yang tersedia.
              </p>
            </div>

            <div className="mt-8 grid border-y border-border md:grid-cols-3">
              <FlowStep
                icon={Search}
                step="01"
                title="Temukan data Anda"
                description="Cari nama atau nomor peserta, lalu pastikan instansi dan formasinya benar."
              />
              <FlowStep
                icon={BarChart3}
                step="02"
                title="Tentukan target"
                description="Pilih jabatan sejenis, semua yang sesuai pendidikan, atau satu formasi tertentu."
              />
              <FlowStep
                icon={MessageCircle}
                step="03"
                title="Terima analisis"
                description="Kirim kode RSKD ke WhatsApp dan terima satu kartu analisis yang ringkas."
              />
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-muted py-14 sm:py-20">
          <div className="mx-auto grid max-w-[1240px] gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_500px] lg:items-center">
            <div>
              <p className="font-mono text-[11px] font-semibold uppercase text-primary">
                Yang dibaca mesin
              </p>
              <h2 className="mt-2 text-2xl font-bold sm:text-3xl">
                Bukan sekadar lolos ambang batas
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
                Mesin membandingkan skor, kuota, peserta hadir, batas historis, pendidikan, dan
                kualitas data. Hasilnya berupa posisi simulasi, kebutuhan kenaikan nilai, serta
                beberapa target yang lebih rasional.
              </p>
              <div className="mt-6 flex items-center gap-3 text-sm font-semibold text-foreground">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#071b36] text-white">
                  <ArrowRight className="h-4 w-4" />
                </span>
                Analisis lengkap tetap dikirim melalui WhatsApp.
              </div>
            </div>

            <AnalysisSample />
          </div>
        </section>

        <section className="bg-white py-10">
          <div className="mx-auto max-w-[960px] px-4 text-center sm:px-6">
            <p className="text-xs leading-6 text-muted-foreground">
              AnalisaCPNS bukan pengumuman resmi dan tidak menjamin kelulusan. Data historis dipakai
              sebagai bahan perbandingan; syarat serta formasi terbaru tetap mengikuti pengumuman
              resmi pemerintah.
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function PositionRail() {
  return (
    <div className="border-l-2 border-[#cddbf0] pl-5 lg:pb-1">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase text-muted-foreground">
            Contoh pembacaan
          </p>
          <p className="mt-1 text-xl font-bold">Total 412</p>
        </div>
        <span className="rounded-sm bg-[#e8f7f1] px-2 py-1 text-[10px] font-bold text-[#16805c]">
          KOMPETITIF
        </span>
      </div>
      <div className="relative mt-5 h-3 rounded-full bg-[#dce5f0]">
        <div className="rankline-fill absolute inset-y-0 left-0 w-[78%] rounded-full bg-primary" />
        <span className="rankline-point absolute left-[calc(78%-6px)] top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-4 border-white bg-accent shadow-sm" />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[9px] text-muted-foreground">
        <span>Batas historis</span>
        <span>Posisi nilai</span>
      </div>
    </div>
  );
}

function CoverageMetric({
  label,
  value,
  loading = false,
}: {
  label: string;
  value?: number | string;
  loading?: boolean;
}) {
  return (
    <div className="border-r border-border px-4 py-5 first:pl-0 last:border-r-0 md:px-6">
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold text-foreground">
        {loading
          ? "..."
          : typeof value === "number"
            ? value.toLocaleString("id-ID")
            : (value ?? "-")}
      </p>
    </div>
  );
}

function FlowStep({
  icon: Icon,
  step,
  title,
  description,
}: {
  icon: typeof Search;
  step: string;
  title: string;
  description: string;
}) {
  return (
    <article className="border-b border-border py-6 last:border-b-0 md:border-b-0 md:border-r md:px-6 md:first:pl-0 md:last:border-r-0 md:last:pr-0">
      <div className="flex items-center justify-between">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-muted text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <span className="font-mono text-xs font-semibold text-[#8ca0b7]">{step}</span>
      </div>
      <h3 className="mt-5 text-base font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </article>
  );
}

function AnalysisSample() {
  return (
    <div className="overflow-hidden rounded-lg border border-[#214263] bg-[#071b36] text-white shadow-lg shadow-[#071b36]/10">
      <div className="flex items-center justify-between border-b border-[#214263] px-5 py-4">
        <div>
          <p className="font-mono text-[9px] font-semibold uppercase text-[#7f9bb8]">
            Kartu analisis
          </p>
          <p className="mt-1 text-sm font-bold">Contoh hasil rasionalisasi</p>
        </div>
        <span className="font-mono text-[9px] text-[#7f9bb8]">RSKD-XXXXXXXX</span>
      </div>
      <div className="p-5">
        <div className="grid grid-cols-4 border border-[#214263]">
          {[
            ["TWK", "90"],
            ["TIU", "135"],
            ["TKP", "187"],
            ["Total", "412"],
          ].map(([label, value], index) => (
            <div key={label} className={`${index ? "border-l border-[#214263]" : ""} p-3`}>
              <p className="text-[9px] font-semibold uppercase text-[#7f9bb8]">{label}</p>
              <p
                className={`mt-1 font-mono text-lg font-semibold ${index === 3 ? "text-[#6f98ff]" : ""}`}
              >
                {value}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase text-[#7f9bb8]">Posisi simulasi</p>
            <p className="mt-1 text-sm font-bold">Layak dipertimbangkan</p>
          </div>
          <span className="rounded-sm bg-[#153f39] px-2 py-1 text-[10px] font-bold text-[#6de2be]">
            DATA CUKUP
          </span>
        </div>
        <div className="relative mt-4 h-2 rounded-full bg-[#193451]">
          <div className="absolute inset-y-0 left-0 w-[72%] rounded-full bg-[#2f6bff]" />
          <span className="absolute left-[calc(72%-5px)] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-[#071b36] bg-[#39d4d8]" />
        </div>
        <p className="mt-4 text-xs leading-5 text-[#a9b9cb]">
          Tiga target disusun dari kecocokan pendidikan, batas historis, dan selisih nilai.
        </p>
      </div>
    </div>
  );
}
