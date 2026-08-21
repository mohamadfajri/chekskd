import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  GraduationCap,
  LoaderCircle,
  MapPin,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react";
import {
  getPublicFormationDetail,
  type FormationDataConfidence,
  type PublicFormationDetail as FormationDetailData,
} from "@/services/formationService";

export function FormationDetail({ formationId }: { formationId: string }) {
  const detail = useQuery({
    queryKey: ["public-formation-detail", formationId],
    queryFn: () => getPublicFormationDetail(formationId),
  });

  if (detail.isLoading) return <DetailLoading />;
  if (detail.isError) return <DetailError message={readError(detail.error)} />;
  if (!detail.data) return <DetailNotFound />;

  return <DetailContent detail={detail.data} />;
}

function DetailContent({ detail }: { detail: FormationDetailData }) {
  const stats = detail.stats;

  return (
    <div>
      <section className="border-b border-border bg-muted">
        <div className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6 sm:py-10">
          <Link
            to="/formasi"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Kembali ke daftar formasi
          </Link>
          <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-[10px] font-semibold uppercase text-primary">
                  Formasi SKD {detail.selection_year}
                </p>
                <ConfidenceBadge confidence={detail.data_confidence} />
              </div>
              <h1 className="mt-2 max-w-4xl text-2xl font-extrabold leading-tight text-[#071b36] sm:text-3xl">
                {detail.jabatan}
              </h1>
              <p className="mt-2 text-sm font-semibold text-[#476078]">{detail.nama_instansi}</p>
              <p className="mt-3 flex max-w-4xl items-start gap-1.5 text-xs leading-5 text-muted-foreground">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{detail.lokasi_formasi || "Lokasi tidak tercatat"}</span>
              </p>
            </div>
            <Link
              to="/search"
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-bold text-white transition hover:bg-[#255de8]"
            >
              Gunakan nilai saya
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6 sm:py-8">
        <section
          aria-label="Ringkasan statistik formasi"
          className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4"
        >
          <SummaryMetric label="Kuota" value={formatNumber(stats.quota)} detail="kursi tersedia" />
          <SummaryMetric
            label="Peserta hadir"
            value={formatNumber(stats.attended_count)}
            detail={`${formatNumber(stats.no_show_count)} tidak hadir`}
          />
          <SummaryMetric
            label="Persaingan"
            value={
              stats.competition_ratio == null ? "-" : `${formatRatio(stats.competition_ratio)}x`
            }
            detail={competitionLabel(stats.competition_ratio)}
          />
          <SummaryMetric
            label="Batas historis"
            value={String(stats.cutoff_total ?? "-")}
            detail={`kapasitas ${formatNumber(stats.shortlist_capacity)} peserta`}
            accent
          />
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <div className="space-y-6">
            <section className="overflow-hidden rounded-lg border border-border bg-white">
              <SectionHeader
                icon={<BarChart3 className="h-4 w-4" />}
                title="Sebaran nilai peserta hadir"
                subtitle={`${formatNumber(stats.attended_count)} nilai SKD dalam kelompok 25 poin`}
              />
              <div className="p-4 sm:p-5">
                <ScoreDistribution detail={detail} />
                <div className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-5">
                  <ScoreMetric label="Minimum" value={stats.minimum_total} />
                  <ScoreMetric label="Median" value={stats.median_total} />
                  <ScoreMetric label="P75" value={stats.p75_total} />
                  <ScoreMetric label="Batas" value={stats.cutoff_total} strong />
                  <ScoreMetric label="Maksimum" value={stats.maximum_total} wide />
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border border-border bg-white">
              <SectionHeader
                icon={<Users className="h-4 w-4" />}
                title="Status hasil SKD"
                subtitle="Ringkasan kode status pada pengumuman sumber"
              />
              <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
                <StatusMetric
                  code="P/L"
                  label="Masuk shortlist"
                  value={statusValue(detail, "P/L")}
                  tone="success"
                />
                <StatusMetric
                  code="P"
                  label="Lulus ambang batas"
                  value={statusValue(detail, "P")}
                  tone="primary"
                />
                <StatusMetric code="TL" label="Tidak lulus" value={statusValue(detail, "TL")} />
                <StatusMetric code="TH" label="Tidak hadir" value={statusValue(detail, "TH")} />
              </div>
            </section>
          </div>

          <aside className="space-y-5">
            <EducationPanel detail={detail} />
            <ConfidencePanel detail={detail} />
            <SourcePanel detail={detail} />
          </aside>
        </div>

        <div className="mt-6 flex gap-3 border-l-2 border-[#39d4d8] bg-[#f4f8ff] px-4 py-3 text-xs leading-5 text-[#476078]">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#16805c]" />
          <p>
            Statistik ini berasal dari pengumuman SKD {detail.selection_year}. Angka historis tidak
            menjamin hasil pada seleksi berikutnya.
          </p>
        </div>
      </main>
    </div>
  );
}

function ScoreDistribution({ detail }: { detail: FormationDetailData }) {
  const buckets = detail.score_distribution;
  const maximumCount = Math.max(1, ...buckets.map((bucket) => bucket.count));

  if (!buckets.length) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Sebaran nilai belum tersedia.
      </p>
    );
  }

  return (
    <div>
      <div
        className="grid h-52 items-end gap-1 border-b border-border px-1 pt-5"
        style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}
        aria-label="Grafik sebaran nilai"
      >
        {buckets.map((bucket) => {
          const height = Math.max(3, (bucket.count / maximumCount) * 100);
          const containsCutoff =
            detail.stats.cutoff_total != null &&
            detail.stats.cutoff_total >= bucket.from &&
            detail.stats.cutoff_total <= bucket.to;
          return (
            <div
              key={bucket.from}
              className="flex h-full min-w-0 items-end"
              title={`${bucket.from}-${bucket.to}: ${formatNumber(bucket.count)} peserta`}
            >
              <div
                className={`w-full rounded-t-sm ${containsCutoff ? "bg-[#39d4d8]" : "bg-[#2f6bff]"}`}
                style={{ height: `${height}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[9px] font-semibold text-muted-foreground">
        <span>{buckets[0].from}</span>
        <span>Nilai total SKD</span>
        <span>{buckets[buckets.length - 1].to}</span>
      </div>
      <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-primary" /> Peserta
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-[#39d4d8]" /> Kelompok batas historis
        </span>
      </div>
    </div>
  );
}

function EducationPanel({ detail }: { detail: FormationDetailData }) {
  const [expanded, setExpanded] = useState(false);
  const options = useMemo(() => normalizedEducationOptions(detail), [detail]);
  const visible = expanded ? options : options.slice(0, 8);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-white">
      <SectionHeader
        icon={<GraduationCap className="h-4 w-4" />}
        title="Pendidikan diterima"
        subtitle={`${formatNumber(options.length)} pilihan tercatat`}
      />
      <ul className="divide-y divide-border px-4">
        {visible.map((option) => (
          <li key={option} className="py-2.5 text-xs font-medium leading-5 text-[#29435e]">
            {option}
          </li>
        ))}
      </ul>
      {options.length > 8 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border bg-[#f8fbff] px-3 py-2.5 text-xs font-bold text-primary hover:bg-[#edf3ff]"
        >
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          {expanded ? "Ringkas daftar" : `Lihat ${formatNumber(options.length - 8)} lainnya`}
        </button>
      )}
    </section>
  );
}

function ConfidencePanel({ detail }: { detail: FormationDetailData }) {
  const config = confidenceConfig(detail.data_confidence);
  return (
    <section className="rounded-lg border border-border bg-white p-4">
      <div className="flex items-start gap-3">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${config.iconStyle}`}>
          <ShieldCheck className="h-4 w-4" />
        </span>
        <div>
          <p className="text-xs font-bold text-[#071b36]">{config.label}</p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{config.description}</p>
        </div>
      </div>
    </section>
  );
}

function SourcePanel({ detail }: { detail: FormationDetailData }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-white">
      <SectionHeader
        icon={<FileText className="h-4 w-4" />}
        title="Sumber data"
        subtitle="Dokumen pengumuman SKD"
      />
      <div className="space-y-3 p-4 text-xs">
        <div>
          <p className="font-semibold text-muted-foreground">Nama file</p>
          <p className="mt-1 break-words font-medium leading-5 text-[#29435e]">
            {detail.source.file_name || "Nama file tidak tercatat"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SourceMetric label="Halaman" value={String(detail.source.page_number ?? "-")} />
          <SourceMetric label="Total halaman" value={String(detail.source.total_pages ?? "-")} />
        </div>
        {detail.source.source_url && (
          <a
            href={detail.source.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 font-bold text-primary hover:underline"
          >
            Buka dokumen sumber <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </section>
  );
}

function SummaryMetric({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 bg-white px-4 py-4 sm:px-5">
      <p className="text-[10px] font-bold uppercase text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-mono text-xl font-bold ${accent ? "text-primary" : "text-[#071b36]"}`}
      >
        {value}
      </p>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function ScoreMetric({
  label,
  value,
  strong = false,
  wide = false,
}: {
  label: string;
  value: number | null;
  strong?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`bg-white px-2 py-3 text-center ${wide ? "col-span-2 sm:col-span-1" : ""}`}>
      <p className="text-[9px] font-bold uppercase text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-mono text-sm font-bold ${strong ? "text-primary" : "text-[#071b36]"}`}
      >
        {value == null ? "-" : formatRatio(value)}
      </p>
    </div>
  );
}

function StatusMetric({
  code,
  label,
  value,
  tone = "neutral",
}: {
  code: string;
  label: string;
  value: number;
  tone?: "neutral" | "success" | "primary";
}) {
  const codeStyle =
    tone === "success" ? "text-[#16805c]" : tone === "primary" ? "text-primary" : "text-[#476078]";
  return (
    <div className="bg-white px-4 py-4">
      <p className={`font-mono text-[10px] font-bold ${codeStyle}`}>{code}</p>
      <p className="mt-1 font-mono text-lg font-bold text-[#071b36]">{formatNumber(value)}</p>
      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{label}</p>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border bg-[#f8fbff] px-4 py-3.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#edf3ff] text-primary">
        {icon}
      </span>
      <div>
        <h2 className="text-sm font-bold text-[#071b36]">{title}</h2>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: FormationDataConfidence }) {
  const config = confidenceConfig(confidence);
  return (
    <span className={`rounded px-1.5 py-1 text-[9px] font-bold ${config.badgeStyle}`}>
      {config.label}
    </span>
  );
}

function SourceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-[#f8fbff] px-3 py-2.5">
      <p className="text-[9px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-xs font-bold text-[#071b36]">{value}</p>
    </div>
  );
}

function DetailLoading() {
  return (
    <div className="mx-auto flex min-h-[65vh] max-w-[1180px] items-center justify-center px-4 text-sm text-muted-foreground">
      <LoaderCircle className="mr-2 h-5 w-5 animate-spin text-primary" /> Memuat detail formasi
    </div>
  );
}

function DetailError({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <Target className="mx-auto h-8 w-8 text-[#b43b45]" />
      <h1 className="mt-3 text-xl font-bold text-[#071b36]">Detail formasi gagal dimuat</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <BackToExplorer />
    </div>
  );
}

function DetailNotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <Target className="mx-auto h-8 w-8 text-muted-foreground" />
      <h1 className="mt-3 text-xl font-bold text-[#071b36]">Formasi tidak ditemukan</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Data belum dipublikasikan atau alamat formasi tidak valid.
      </p>
      <BackToExplorer />
    </div>
  );
}

function BackToExplorer() {
  return (
    <Link
      to="/formasi"
      className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:underline"
    >
      <ArrowLeft className="h-4 w-4" /> Kembali ke explorer
    </Link>
  );
}

function normalizedEducationOptions(detail: FormationDetailData): string[] {
  const supplied = (detail.pendidikan_options ?? []).map((value) => value.trim()).filter(Boolean);
  if (supplied.length) return [...new Set(supplied)];
  return (detail.pendidikan ?? "Tidak tercatat")
    .split(" / ")
    .map((value) => value.trim())
    .filter(Boolean);
}

function confidenceConfig(confidence: FormationDataConfidence) {
  if (confidence === "high") {
    return {
      label: "Data kuat",
      description: "Kuota, peserta hadir, dan kapasitas shortlist tercatat konsisten.",
      badgeStyle: "bg-[#eaf7f1] text-[#16805c]",
      iconStyle: "bg-[#eaf7f1] text-[#16805c]",
    };
  }
  if (confidence === "medium") {
    return {
      label: "Data cukup",
      description:
        "Statistik utama tersedia, tetapi terdapat sinyal konsistensi yang perlu diperhatikan.",
      badgeStyle: "bg-[#edf3ff] text-[#2457cc]",
      iconStyle: "bg-[#edf3ff] text-[#2457cc]",
    };
  }
  return {
    label: "Data terbatas",
    description: "Jumlah peserta atau batas historis belum cukup untuk pembacaan yang kuat.",
    badgeStyle: "bg-[#fff5e5] text-[#9a5b00]",
    iconStyle: "bg-[#fff5e5] text-[#9a5b00]",
  };
}

function statusValue(detail: FormationDetailData, status: string): number {
  return Number(detail.status_counts[status] ?? 0);
}

function competitionLabel(ratio: number | null): string {
  if (ratio == null) return "belum tersedia";
  if (ratio <= 10) return "persaingan rendah";
  if (ratio <= 30) return "persaingan menengah";
  return "persaingan tinggi";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("id-ID").format(value);
}

function formatRatio(value: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(value);
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Terjadi gangguan saat membaca data.";
}
