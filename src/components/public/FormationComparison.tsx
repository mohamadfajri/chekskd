import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Columns3,
  LoaderCircle,
  ShieldCheck,
  Target,
  Users,
  X,
} from "lucide-react";
import { serializeFormationIds } from "@/lib/formationSelection";
import { getPublicFormationDetail, type PublicFormationDetail } from "@/services/formationService";

export function FormationComparison({ formationIds }: { formationIds: string[] }) {
  const queries = useQueries({
    queries: formationIds.map((formationId) => ({
      queryKey: ["public-formation-detail", formationId],
      queryFn: () => getPublicFormationDetail(formationId),
      staleTime: 60_000,
    })),
  });
  const isLoading = queries.some((query) => query.isPending);
  const isError = queries.some((query) => query.isError);
  const details = queries.flatMap((query) => (query.data ? [query.data] : []));

  if (!formationIds.length) return <EmptyComparison />;
  if (isLoading) return <ComparisonLoading />;
  if (isError) return <ComparisonError />;
  if (!details.length) return <EmptyComparison />;

  return <ComparisonContent details={details} />;
}

function ComparisonContent({ details }: { details: PublicFormationDetail[] }) {
  const ids = details.map((detail) => detail.id);
  const quotaWinner = bestIndex(details, (detail) => detail.stats.quota, "max");
  const competitionWinner = bestIndex(details, (detail) => detail.stats.competition_ratio, "min");
  const cutoffWinner = bestIndex(details, (detail) => detail.stats.cutoff_total, "min");

  return (
    <div>
      <section className="border-b border-border bg-muted">
        <div className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6 sm:py-10">
          <Link
            to="/formasi"
            search={{ banding: serializeFormationIds(ids) }}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Ubah pilihan formasi
          </Link>
          <div className="mt-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase text-primary">
                Perbandingan historis
              </p>
              <h1 className="mt-2 text-2xl font-extrabold text-[#071b36] sm:text-3xl">
                Bandingkan formasi
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Baca kuota, persaingan, dan batas historis pada skala yang sama sebelum menentukan
                target nilai.
              </p>
            </div>
            <p className="font-mono text-xs font-semibold text-[#476078]">
              {details.length} FORMASI
            </p>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6 sm:py-8">
        {details.length === 1 ? (
          <div className="mb-5 flex items-start gap-3 border-l-2 border-[#39d4d8] bg-[#f4f8ff] px-4 py-3 text-xs leading-5 text-[#476078]">
            <Columns3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>Pilih satu atau dua formasi lagi agar perbedaannya dapat dibandingkan.</p>
          </div>
        ) : null}

        <DesktopComparison
          details={details}
          quotaWinner={quotaWinner}
          competitionWinner={competitionWinner}
          cutoffWinner={cutoffWinner}
        />
        <MobileComparison
          details={details}
          quotaWinner={quotaWinner}
          competitionWinner={competitionWinner}
          cutoffWinner={cutoffWinner}
        />

        <div className="mt-6 flex items-start gap-3 border-l-2 border-[#39d4d8] bg-[#f4f8ff] px-4 py-3 text-xs leading-5 text-[#476078]">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#16805c]" />
          <p>
            Formasi dengan rasio lebih rendah belum tentu paling cocok. Pendidikan, lokasi, jenis
            formasi, dan pengumuman terbaru tetap harus diperiksa.
          </p>
        </div>
      </main>
    </div>
  );
}

function DesktopComparison({
  details,
  quotaWinner,
  competitionWinner,
  cutoffWinner,
}: ComparisonProps) {
  return (
    <section className="hidden overflow-x-auto rounded-lg border border-border bg-white md:block">
      <table className="min-w-[780px] table-fixed text-left text-xs">
        <thead>
          <tr className="bg-[#f4f8ff] align-top">
            <th className="w-40 px-4 py-4 font-bold text-[#476078]">Data pembanding</th>
            {details.map((detail) => (
              <th key={detail.id} className="border-l border-border px-4 py-4">
                <FormationHeading detail={detail} removableIds={details.map((item) => item.id)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <MetricRow
            label="Kuota"
            details={details}
            render={(detail) => formatNumber(detail.stats.quota)}
            winner={quotaWinner}
            winnerLabel="Terbesar"
          />
          <MetricRow
            label="Peserta hadir"
            details={details}
            render={(detail) => formatNumber(detail.stats.attended_count)}
          />
          <MetricRow
            label="Persaingan"
            details={details}
            render={(detail) => formatRatio(detail.stats.competition_ratio)}
            winner={competitionWinner}
            winnerLabel="Paling ringan"
          />
          <MetricRow
            label="Batas historis"
            details={details}
            render={(detail) => String(detail.stats.cutoff_total ?? "-")}
            winner={cutoffWinner}
            winnerLabel="Terendah"
          />
          <MetricRow
            label="Median nilai"
            details={details}
            render={(detail) => String(detail.stats.median_total ?? "-")}
          />
          <MetricRow
            label="Pendidikan"
            details={details}
            render={(detail) => summarizeEducation(detail)}
            compact
          />
          <tr className="border-t border-border align-top">
            <th className="bg-[#fbfdff] px-4 py-4 font-bold text-[#476078]">Target nilai</th>
            {details.map((detail) => (
              <td key={detail.id} className="border-l border-border px-4 py-4">
                <TargetAction detail={detail} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function MobileComparison({
  details,
  quotaWinner,
  competitionWinner,
  cutoffWinner,
}: ComparisonProps) {
  return (
    <section className="space-y-4 md:hidden" aria-label="Perbandingan formasi">
      {details.map((detail, index) => (
        <article
          key={detail.id}
          className="overflow-hidden rounded-lg border border-border bg-white"
        >
          <div className="bg-[#f4f8ff] p-4">
            <FormationHeading detail={detail} removableIds={details.map((item) => item.id)} />
          </div>
          <div className="grid grid-cols-2 gap-px bg-border">
            <MobileMetric
              label="Kuota"
              value={formatNumber(detail.stats.quota)}
              badge={quotaWinner === index ? "Terbesar" : undefined}
            />
            <MobileMetric label="Hadir" value={formatNumber(detail.stats.attended_count)} />
            <MobileMetric
              label="Persaingan"
              value={formatRatio(detail.stats.competition_ratio)}
              badge={competitionWinner === index ? "Paling ringan" : undefined}
            />
            <MobileMetric
              label="Batas historis"
              value={String(detail.stats.cutoff_total ?? "-")}
              badge={cutoffWinner === index ? "Terendah" : undefined}
            />
          </div>
          <div className="border-t border-border p-4">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">Pendidikan</p>
            <p className="mt-1 text-xs leading-5 text-[#476078]">{summarizeEducation(detail)}</p>
            <div className="mt-4">
              <TargetAction detail={detail} />
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}

function FormationHeading({
  detail,
  removableIds,
}: {
  detail: PublicFormationDetail;
  removableIds: string[];
}) {
  const remainingIds = removableIds.filter((id) => id !== detail.id);
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-extrabold leading-5 text-[#071b36]">{detail.jabatan}</p>
        <p className="mt-1 text-[11px] font-semibold leading-5 text-[#476078]">
          {detail.nama_instansi}
        </p>
        <p className="mt-2 font-mono text-[9px] font-semibold uppercase text-primary">
          {detail.jenis_formasi || "Jenis tidak tercatat"}
        </p>
        {isQuietFormation(detail) ? (
          <span className="mt-2 inline-flex items-center gap-1 rounded bg-[#eaf7f1] px-1.5 py-1 text-[9px] font-bold text-[#16805c]">
            <Users className="h-3 w-3" />
            Sepi peminat
          </span>
        ) : null}
      </div>
      <Link
        to="/formasi/banding"
        search={{ ids: serializeFormationIds(remainingIds) }}
        aria-label={`Hapus ${detail.jabatan} dari perbandingan`}
        title="Hapus dari perbandingan"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-white hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function MetricRow({
  label,
  details,
  render,
  winner,
  winnerLabel,
  compact = false,
}: {
  label: string;
  details: PublicFormationDetail[];
  render: (detail: PublicFormationDetail) => string;
  winner?: number;
  winnerLabel?: string;
  compact?: boolean;
}) {
  return (
    <tr className="border-t border-border align-top">
      <th className="bg-[#fbfdff] px-4 py-4 font-bold text-[#476078]">{label}</th>
      {details.map((detail, index) => (
        <td key={detail.id} className="border-l border-border px-4 py-4">
          <p
            className={
              compact
                ? "text-xs leading-5 text-[#476078]"
                : "font-mono text-base font-bold text-[#071b36]"
            }
          >
            {render(detail)}
          </p>
          {winner === index && winnerLabel ? <BestBadge>{winnerLabel}</BestBadge> : null}
        </td>
      ))}
    </tr>
  );
}

function MobileMetric({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <div className="min-w-0 bg-white p-3">
      <p className="text-[9px] font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-base font-bold text-[#071b36]">{value}</p>
      {badge ? <BestBadge>{badge}</BestBadge> : null}
    </div>
  );
}

function BestBadge({ children }: { children: string }) {
  return (
    <span className="mt-1.5 inline-flex items-center gap-1 rounded bg-[#eaf7f1] px-1.5 py-0.5 text-[9px] font-bold text-[#16805c]">
      <CheckCircle2 className="h-2.5 w-2.5" />
      {children}
    </span>
  );
}

function TargetAction({ detail }: { detail: PublicFormationDetail }) {
  if (!isGeneralFormation(detail)) {
    return (
      <p className="text-[10px] leading-4 text-muted-foreground">
        Simulasi target khusus saat ini tersedia untuk formasi UMUM.
      </p>
    );
  }
  return (
    <Link
      to="/search"
      search={{ targetFormationId: detail.id }}
      className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-xs font-bold text-white transition hover:bg-[#255de8]"
    >
      <Target className="h-3.5 w-3.5" />
      Pakai sebagai target
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
}

function ComparisonLoading() {
  return (
    <div className="flex min-h-[460px] items-center justify-center text-sm text-muted-foreground">
      <LoaderCircle className="mr-2 h-5 w-5 animate-spin text-primary" />
      Menyiapkan perbandingan formasi
    </div>
  );
}

function ComparisonError() {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <Columns3 className="mx-auto h-8 w-8 text-[#b43b45]" />
      <h1 className="mt-3 text-xl font-bold text-[#071b36]">Perbandingan belum dapat dimuat</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coba pilih ulang formasi dari daftar.</p>
      <Link to="/formasi" className="mt-5 inline-flex text-sm font-bold text-primary">
        Kembali ke daftar formasi
      </Link>
    </div>
  );
}

function EmptyComparison() {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <Columns3 className="mx-auto h-8 w-8 text-[#8ca0b7]" />
      <h1 className="mt-3 text-xl font-bold text-[#071b36]">Belum ada formasi dipilih</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Pilih maksimal tiga formasi dari halaman penjelajah.
      </p>
      <Link
        to="/formasi"
        className="mt-5 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-bold text-white"
      >
        Pilih formasi
      </Link>
    </div>
  );
}

interface ComparisonProps {
  details: PublicFormationDetail[];
  quotaWinner: number;
  competitionWinner: number;
  cutoffWinner: number;
}

function bestIndex(
  details: PublicFormationDetail[],
  selector: (detail: PublicFormationDetail) => number | null,
  mode: "min" | "max",
): number {
  const values = details.map(selector);
  const valid = values.filter((value): value is number => value != null);
  if (valid.length < 2) return -1;
  const best = mode === "min" ? Math.min(...valid) : Math.max(...valid);
  return values.indexOf(best);
}

function isGeneralFormation(detail: PublicFormationDetail): boolean {
  return detail.jenis_formasi?.trim().toUpperCase() === "UMUM";
}

function isQuietFormation(detail: PublicFormationDetail): boolean {
  return (
    detail.stats.quota > 0 &&
    detail.stats.attended_count > 0 &&
    detail.stats.attended_count <= detail.stats.quota
  );
}

function summarizeEducation(detail: PublicFormationDetail): string {
  const options = detail.pendidikan_options?.filter(Boolean) ?? [];
  if (!options.length) return detail.pendidikan || "Tidak tercatat";
  if (options.length <= 2) return options.join(" / ");
  return `${options.slice(0, 2).join(" / ")} (+${options.length - 2} lainnya)`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("id-ID").format(value);
}

function formatRatio(value: number | null): string {
  return value == null
    ? "-"
    : `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(value)}x`;
}
