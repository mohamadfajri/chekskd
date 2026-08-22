import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns3,
  FilterX,
  GraduationCap,
  LoaderCircle,
  MapPin,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { MAX_COMPARISON_FORMATIONS, serializeFormationIds } from "@/lib/formationSelection";
import {
  searchPublicFormations,
  type FormationCompetitionLevel,
  type FormationSort,
  type PublicFormation,
} from "@/services/formationService";

const PAGE_SIZE = 24;

const sortOptions: Array<{ value: FormationSort; label: string }> = [
  { value: "competition_desc", label: "Persaingan tertinggi" },
  { value: "competition_asc", label: "Persaingan terendah" },
  { value: "cutoff_desc", label: "Batas nilai tertinggi" },
  { value: "quota_desc", label: "Kuota terbesar" },
  { value: "name_asc", label: "Nama jabatan A-Z" },
];

export function FormationExplorer({
  initialComparisonIds = [],
}: {
  initialComparisonIds?: string[];
}) {
  const [queryInput, setQueryInput] = useState("");
  const [educationInput, setEducationInput] = useState("");
  const [query, setQuery] = useState("");
  const [education, setEducation] = useState("");
  const [institution, setInstitution] = useState("");
  const [formationType, setFormationType] = useState("");
  const [competitionLevel, setCompetitionLevel] = useState<FormationCompetitionLevel | "">("");
  const [sort, setSort] = useState<FormationSort>("competition_desc");
  const [page, setPage] = useState(1);
  const [comparisonIds, setComparisonIds] = useState(initialComparisonIds.slice(0, 3));
  const initialComparisonKey = serializeFormationIds(initialComparisonIds) ?? "";

  useEffect(() => {
    setComparisonIds(initialComparisonKey ? initialComparisonKey.split(",") : []);
  }, [initialComparisonKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(queryInput.trim());
      setEducation(educationInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [educationInput, queryInput]);

  const explorer = useQuery({
    queryKey: [
      "public-formations",
      query,
      institution,
      education,
      formationType,
      competitionLevel,
      sort,
      page,
    ],
    queryFn: () =>
      searchPublicFormations({
        query,
        institution,
        education,
        formationType,
        competitionLevel,
        sort,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: (previous) => previous,
  });

  const activeFilterCount = useMemo(
    () => [query, institution, education, formationType, competitionLevel].filter(Boolean).length,
    [competitionLevel, education, formationType, institution, query],
  );

  function resetFilters() {
    setQueryInput("");
    setEducationInput("");
    setQuery("");
    setEducation("");
    setInstitution("");
    setFormationType("");
    setCompetitionLevel("");
    setSort("competition_desc");
    setPage(1);
  }

  function toggleComparison(formationId: string) {
    setComparisonIds((current) => {
      if (current.includes(formationId)) {
        return current.filter((id) => id !== formationId);
      }
      if (current.length >= MAX_COMPARISON_FORMATIONS) return current;
      return [...current, formationId];
    });
  }

  function toggleQuietFormations() {
    const enable = competitionLevel !== "quiet";
    setCompetitionLevel(enable ? "quiet" : "");
    if (enable) setSort("competition_asc");
    setPage(1);
  }

  const pagination = explorer.data?.pagination;

  return (
    <div>
      <section className="border-b border-border bg-muted">
        <div className="mx-auto max-w-[1240px] px-4 py-9 sm:px-6 sm:py-11">
          <p className="font-mono text-[11px] font-semibold uppercase text-primary">
            Data formasi historis
          </p>
          <div className="mt-2 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-3xl font-extrabold text-[#071b36] sm:text-4xl">
                Jelajahi persaingan formasi
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                Bandingkan kuota, peserta hadir, dan batas nilai dari data SKD yang sudah
                diverifikasi.
              </p>
            </div>
            <p className="font-mono text-xs font-semibold text-[#476078]">
              DATA {explorer.data?.available_filters.years.join(", ") || "HISTORIS"}
            </p>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6 sm:py-8">
        <section
          aria-label="Filter formasi"
          className="overflow-hidden rounded-lg border border-border bg-white"
        >
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-6">
            <label className="xl:col-span-2">
              <FilterLabel>Jabatan, lokasi, atau pendidikan</FilterLabel>
              <div className="relative mt-1.5">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  value={queryInput}
                  onChange={(event) => setQueryInput(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                  placeholder="Contoh: analis hukum"
                />
              </div>
            </label>

            <label>
              <FilterLabel>Instansi</FilterLabel>
              <select
                value={institution}
                onChange={(event) => {
                  setInstitution(event.target.value);
                  setPage(1);
                }}
                className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              >
                <option value="">Semua instansi</option>
                {explorer.data?.available_filters.institutions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value} ({formatNumber(option.count)})
                  </option>
                ))}
              </select>
            </label>

            <label>
              <FilterLabel>Pendidikan</FilterLabel>
              <div className="relative mt-1.5">
                <GraduationCap className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  value={educationInput}
                  onChange={(event) => setEducationInput(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                  placeholder="Contoh: S-1 Hukum"
                />
              </div>
            </label>

            <label>
              <FilterLabel>Jenis formasi</FilterLabel>
              <select
                value={formationType}
                onChange={(event) => {
                  setFormationType(event.target.value);
                  setPage(1);
                }}
                className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              >
                <option value="">Semua jenis</option>
                {explorer.data?.available_filters.formation_types.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value} ({formatNumber(option.count)})
                  </option>
                ))}
              </select>
            </label>

            <label>
              <FilterLabel>Tingkat persaingan</FilterLabel>
              <select
                value={competitionLevel}
                onChange={(event) => {
                  setCompetitionLevel(event.target.value as FormationCompetitionLevel | "");
                  setPage(1);
                }}
                className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              >
                <option value="">Semua tingkat</option>
                <option value="quiet">Sepi (minimal 1 hadir, maks. kuota)</option>
                <option value="low">Rendah (lebih dari 1-10x)</option>
                <option value="medium">Menengah (11-30x)</option>
                <option value="high">Tinggi (di atas 30x)</option>
              </select>
            </label>
          </div>

          <div className="flex flex-col gap-3 border-t border-border bg-[#f8fbff] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <button
                type="button"
                onClick={toggleQuietFormations}
                aria-pressed={competitionLevel === "quiet"}
                className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-bold transition ${
                  competitionLevel === "quiet"
                    ? "border-[#16805c] bg-[#eaf7f1] text-[#16805c]"
                    : "border-input bg-white text-[#476078] hover:border-[#16805c] hover:text-[#16805c]"
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                Sepi peminat
              </button>
              <span className="inline-flex items-center gap-2">
                {explorer.isFetching && (
                  <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                )}
                <span>
                  <strong className="font-semibold text-foreground">
                    {formatNumber(pagination?.total ?? 0)}
                  </strong>{" "}
                  formasi ditemukan
                </span>
              </span>
              {activeFilterCount > 0 && (
                <span className="font-mono text-[11px] font-semibold text-primary">
                  {activeFilterCount} FILTER
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <select
                aria-label="Urutkan formasi"
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as FormationSort);
                  setPage(1);
                }}
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-white px-3 text-xs font-semibold outline-none focus:border-primary sm:min-w-52"
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={resetFilters}
                disabled={activeFilterCount === 0 && sort === "competition_desc"}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-white text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Reset filter"
                title="Reset filter"
              >
                <FilterX className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>

        {comparisonIds.length > 0 ? (
          <ComparisonSelectionBar ids={comparisonIds} onClear={() => setComparisonIds([])} />
        ) : null}

        {explorer.isLoading ? (
          <FormationLoading />
        ) : explorer.error ? (
          <FormationError message={readError(explorer.error)} onRetry={() => explorer.refetch()} />
        ) : explorer.data?.formations.length ? (
          <section
            aria-label="Daftar formasi"
            className="mt-5 overflow-hidden rounded-lg border border-border bg-white"
          >
            {competitionLevel === "quiet" ? (
              <div className="flex items-start gap-3 border-b border-border bg-[#eaf7f1] px-4 py-3">
                <Users className="mt-0.5 h-4 w-4 shrink-0 text-[#16805c]" />
                <div>
                  <h2 className="text-sm font-bold text-[#0e684a]">Daftar formasi sepi peminat</h2>
                  <p className="mt-0.5 text-[11px] leading-5 text-[#476078]">
                    Ada peserta hadir dan jumlahnya tidak melebihi kuota. Ini bukan jumlah
                    pendaftar.
                  </p>
                </div>
              </div>
            ) : null}
            <DesktopFormationTable
              formations={explorer.data.formations}
              comparisonIds={comparisonIds}
              onToggleComparison={toggleComparison}
            />
            <MobileFormationList
              formations={explorer.data.formations}
              comparisonIds={comparisonIds}
              onToggleComparison={toggleComparison}
            />
            <PaginationBar
              page={pagination?.page ?? 1}
              totalPages={pagination?.total_pages ?? 1}
              total={pagination?.total ?? 0}
              onPageChange={setPage}
            />
          </section>
        ) : (
          <div className="mt-5 border-y border-border bg-white px-4 py-14 text-center">
            <Search className="mx-auto h-8 w-8 text-[#8aa0b8]" />
            <h2 className="mt-3 text-base font-bold text-[#071b36]">Formasi tidak ditemukan</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ubah kata pencarian atau kurangi filter yang aktif.
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="mt-5 inline-flex h-9 items-center gap-2 rounded-md border border-input bg-white px-3 text-sm font-semibold hover:bg-muted"
            >
              <FilterX className="h-4 w-4" />
              Reset filter
            </button>
          </div>
        )}

        <div className="mt-5 flex gap-3 border-l-2 border-[#39d4d8] bg-[#f4f8ff] px-4 py-3 text-xs leading-5 text-[#476078]">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#16805c]" />
          <p>
            Angka menunjukkan persaingan historis dari dokumen SKD terverifikasi, bukan kuota atau
            hasil resmi seleksi berikutnya.
          </p>
        </div>
      </div>
    </div>
  );
}

function DesktopFormationTable({
  formations,
  comparisonIds,
  onToggleComparison,
}: {
  formations: PublicFormation[];
  comparisonIds: string[];
  onToggleComparison: (formationId: string) => void;
}) {
  return (
    <div className="hidden overflow-x-auto lg:block">
      <table className="min-w-full table-fixed text-left text-xs">
        <thead className="bg-[#f4f8ff] text-[#476078]">
          <tr>
            <TableHead className="w-[43%]">Formasi</TableHead>
            <TableHead className="w-[9%] text-right">Kuota</TableHead>
            <TableHead className="w-[10%] text-right">Hadir</TableHead>
            <TableHead className="w-[12%] text-right">Persaingan</TableHead>
            <TableHead className="w-[14%] text-right">Batas historis</TableHead>
            <TableHead className="w-[12%] text-right">Aksi</TableHead>
          </tr>
        </thead>
        <tbody>
          {formations.map((formation) => (
            <tr
              key={formation.id}
              className="border-t border-border align-top transition hover:bg-[#fbfdff]"
            >
              <td className="px-4 py-4">
                <p className="text-sm font-bold leading-5 text-[#071b36]">{formation.jabatan}</p>
                <p className="mt-1.5 font-semibold text-[#476078]">{formation.nama_instansi}</p>
                {isQuietFormation(formation) ? (
                  <div className="mt-2">
                    <QuietInterestBadge />
                  </div>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] leading-4 text-muted-foreground">
                  <span className="grid min-w-0 grid-cols-[12px_1fr] items-start gap-1">
                    <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="line-clamp-2" title={formation.lokasi_formasi ?? undefined}>
                      {summarizeValue(formation.lokasi_formasi, " | ", 3, "Lokasi tidak tercatat")}
                    </span>
                  </span>
                  <span className="grid min-w-0 grid-cols-[12px_1fr] items-start gap-1">
                    <GraduationCap className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="line-clamp-2" title={formation.pendidikan ?? undefined}>
                      {summarizeValue(formation.pendidikan, " / ", 3, "Pendidikan tidak tercatat")}
                    </span>
                  </span>
                </div>
              </td>
              <td className="px-4 py-4 text-right font-mono text-sm font-semibold">
                {formatNumber(formation.quota)}
              </td>
              <td className="px-4 py-4 text-right font-mono text-sm">
                {formatNumber(formation.attended_count)}
              </td>
              <td className="px-4 py-4 text-right">
                <CompetitionValue ratio={formation.competition_ratio} />
              </td>
              <td className="px-4 py-4 text-right">
                <p className="font-mono text-sm font-bold text-[#071b36]">
                  {formation.cutoff_total ?? "-"}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">SKD 2024</p>
              </td>
              <td className="px-4 py-4">
                <div className="flex justify-end gap-1">
                  <ComparisonToggle
                    formation={formation}
                    selected={comparisonIds.includes(formation.id)}
                    disabled={
                      comparisonIds.length >= MAX_COMPARISON_FORMATIONS &&
                      !comparisonIds.includes(formation.id)
                    }
                    onToggle={onToggleComparison}
                  />
                  <Link
                    to="/formasi/$formationId"
                    params={{ formationId: formation.id }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-primary transition hover:bg-[#edf3ff]"
                    aria-label={`Lihat detail ${formation.jabatan}`}
                    title="Lihat detail"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileFormationList({
  formations,
  comparisonIds,
  onToggleComparison,
}: {
  formations: PublicFormation[];
  comparisonIds: string[];
  onToggleComparison: (formationId: string) => void;
}) {
  return (
    <div className="lg:hidden">
      {formations.map((formation) => (
        <article key={formation.id} className="border-b border-border px-4 py-4 last:border-b-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold leading-5 text-[#071b36]">{formation.jabatan}</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-[#476078]">
                {formation.nama_instansi}
              </p>
            </div>
            {isQuietFormation(formation) ? <QuietInterestBadge /> : null}
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="line-clamp-2" title={formation.lokasi_formasi ?? undefined}>
              {summarizeValue(formation.lokasi_formasi, " | ", 3, "Lokasi tidak tercatat")}
            </span>
          </p>
          <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
            <GraduationCap className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="line-clamp-2" title={formation.pendidikan ?? undefined}>
              {summarizeValue(formation.pendidikan, " / ", 3, "Pendidikan tidak tercatat")}
            </span>
          </p>
          <div className="mt-4 grid grid-cols-4 gap-px overflow-hidden rounded-md border border-border bg-border">
            <MobileMetric label="Kuota" value={formatNumber(formation.quota)} />
            <MobileMetric label="Hadir" value={formatNumber(formation.attended_count)} />
            <MobileMetric
              label="Rasio"
              value={
                formation.competition_ratio == null
                  ? "-"
                  : `${formatRatio(formation.competition_ratio)}x`
              }
            />
            <MobileMetric label="Batas" value={String(formation.cutoff_total ?? "-")} />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <CompetitionLabel ratio={formation.competition_ratio} />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onToggleComparison(formation.id)}
                disabled={
                  comparisonIds.length >= MAX_COMPARISON_FORMATIONS &&
                  !comparisonIds.includes(formation.id)
                }
                className="inline-flex items-center gap-1 text-xs font-bold text-[#476078] disabled:cursor-not-allowed disabled:opacity-35"
                aria-pressed={comparisonIds.includes(formation.id)}
              >
                {comparisonIds.includes(formation.id) ? (
                  <Check className="h-3.5 w-3.5 text-[#16805c]" />
                ) : (
                  <Columns3 className="h-3.5 w-3.5" />
                )}
                {comparisonIds.includes(formation.id) ? "Dipilih" : "Bandingkan"}
              </button>
              <Link
                to="/formasi/$formationId"
                params={{ formationId: formation.id }}
                className="inline-flex items-center gap-1 text-xs font-bold text-primary"
              >
                Detail
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function ComparisonSelectionBar({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  return (
    <section
      aria-label="Pilihan perbandingan"
      className="mt-5 flex flex-col gap-3 border-l-2 border-primary bg-[#edf3ff] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <Columns3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-bold text-[#071b36]">
            {ids.length} dari {MAX_COMPARISON_FORMATIONS} formasi dipilih
          </p>
          <p className="mt-0.5 text-xs leading-5 text-[#476078]">
            Pilih minimal dua agar perbedaannya mudah dibaca.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-9 items-center justify-center rounded-md px-3 text-xs font-bold text-[#476078] hover:bg-white"
        >
          Kosongkan
        </button>
        {ids.length >= 2 ? (
          <Link
            to="/formasi/banding"
            search={{ ids: serializeFormationIds(ids) }}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-xs font-bold text-white transition hover:bg-[#255de8]"
          >
            Bandingkan sekarang
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <span className="inline-flex h-9 items-center justify-center rounded-md bg-[#dbe5f2] px-4 text-xs font-bold text-[#6f8298]">
            Pilih 1 lagi
          </span>
        )}
      </div>
    </section>
  );
}

function ComparisonToggle({
  formation,
  selected,
  disabled,
  onToggle,
}: {
  formation: PublicFormation;
  selected: boolean;
  disabled: boolean;
  onToggle: (formationId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(formation.id)}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`${selected ? "Hapus dari" : "Tambahkan ke"} perbandingan ${formation.jabatan}`}
      title={selected ? "Hapus dari perbandingan" : "Tambahkan ke perbandingan"}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-30 ${
        selected ? "bg-[#eaf7f1] text-[#16805c]" : "text-[#476078] hover:bg-[#edf3ff]"
      }`}
    >
      {selected ? <Check className="h-4 w-4" /> : <Columns3 className="h-4 w-4" />}
    </button>
  );
}

function CompetitionValue({ ratio }: { ratio: number | null }) {
  if (ratio == null) return <span className="text-muted-foreground">-</span>;
  return (
    <div>
      <p className="font-mono text-sm font-bold text-[#071b36]">{formatRatio(ratio)}x</p>
      <div className="mt-1 flex justify-end">
        <CompetitionLabel ratio={ratio} />
      </div>
    </div>
  );
}

function CompetitionLabel({ ratio }: { ratio: number | null }) {
  if (ratio == null)
    return <span className="text-[10px] text-muted-foreground">Belum tersedia</span>;
  const style =
    ratio <= 10
      ? "bg-[#eaf7f1] text-[#16805c]"
      : ratio <= 30
        ? "bg-[#fff5e5] text-[#9a5b00]"
        : "bg-[#fff0f1] text-[#a72f3a]";
  const label = ratio <= 10 ? "Rendah" : ratio <= 30 ? "Menengah" : "Tinggi";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${style}`}>{label}</span>;
}

function QuietInterestBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-[#eaf7f1] px-1.5 py-1 text-[10px] font-bold text-[#16805c]">
      <Users className="h-3 w-3" />
      Sepi peminat
    </span>
  );
}

function isQuietFormation(formation: Pick<PublicFormation, "quota" | "attended_count">): boolean {
  return (
    formation.quota > 0 &&
    formation.attended_count > 0 &&
    formation.attended_count <= formation.quota
  );
}

function PaginationBar({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border bg-[#f8fbff] px-4 py-3">
      <p className="text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{formatNumber(total)}</span> formasi
        <span className="hidden sm:inline">
          {" "}
          - halaman {page} dari {totalPages}
        </span>
      </p>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-semibold text-[#476078] sm:hidden">
          {page}/{totalPages}
        </span>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-white transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Halaman sebelumnya"
          title="Halaman sebelumnya"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-white transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Halaman berikutnya"
          title="Halaman berikutnya"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function FormationLoading() {
  return (
    <div
      className="mt-5 overflow-hidden rounded-lg border border-border bg-white"
      aria-label="Memuat formasi"
    >
      {Array.from({ length: 7 }).map((_, index) => (
        <div key={index} className="flex gap-4 border-b border-border px-4 py-5 last:border-b-0">
          <div className="h-4 flex-1 animate-pulse rounded bg-[#e9eff6]" />
          <div className="h-4 w-20 animate-pulse rounded bg-[#e9eff6]" />
          <div className="hidden h-4 w-24 animate-pulse rounded bg-[#e9eff6] sm:block" />
        </div>
      ))}
    </div>
  );
}

function FormationError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-5 border border-red-200 bg-red-50 px-4 py-10 text-center">
      <Users className="mx-auto h-7 w-7 text-[#b43b45]" />
      <h2 className="mt-3 text-base font-bold text-[#7f232b]">Data formasi gagal dimuat</h2>
      <p className="mt-1 text-sm text-[#92343c]">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex h-9 items-center rounded-md bg-[#b43b45] px-3 text-sm font-semibold text-white hover:bg-[#9d3039]"
      >
        Coba lagi
      </button>
    </div>
  );
}

function MobileMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-white px-2 py-2.5 text-center">
      <p className="text-[9px] font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-xs font-bold text-[#071b36]">{value}</p>
    </div>
  );
}

function FilterLabel({ children }: { children: ReactNode }) {
  return <span className="block text-xs font-bold text-[#476078]">{children}</span>;
}

function TableHead({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <th className={`px-4 py-3 font-bold ${className}`}>{children}</th>;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("id-ID").format(value);
}

function formatRatio(value: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(value);
}

function summarizeValue(
  value: string | null,
  separator: string,
  visibleItems: number,
  fallback: string,
): string {
  if (!value?.trim()) return fallback;
  const items = value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length <= visibleItems) return value;
  return `${items.slice(0, visibleItems).join(separator)} (+${items.length - visibleItems} lainnya)`;
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Terjadi gangguan saat membaca data.";
}
