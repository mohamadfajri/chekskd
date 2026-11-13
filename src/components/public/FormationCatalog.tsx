import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  FilterX,
  LoaderCircle,
  Plus,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  catalogCompetition,
  catalogCompetitionRatio,
  catalogLevel,
  catalogSort,
  type CatalogFilters,
  type CatalogFormation,
  type CatalogPageResponse,
  type CatalogResponse,
} from "@/lib/formationCatalog";
import { MAX_COMPARISON_FORMATIONS, serializeFormationIds } from "@/lib/formationSelection";
import { getFormationFilterOptions } from "@/services/formationService";
import { CatalogInstitutionPicker } from "./CatalogInstitutionPicker";
import { CatalogOptionPicker } from "./CatalogOptionPicker";

const number = new Intl.NumberFormat("id-ID");
const salary = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});
const field =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const action =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";

async function loadCatalog(
  filters: CatalogFilters,
  signal: AbortSignal,
): Promise<CatalogPageResponse> {
  const params = new URLSearchParams({ mode: "page", page: String(filters.page ?? 1) });
  for (const key of [
    "query",
    "job",
    "institution",
    "education",
    "level",
    "hasSkd",
    "formationType",
    "competitionLevel",
    "sort",
  ] as const) {
    const value = filters[key];
    if (value) params.set(key, String(value));
  }
  const response = await fetch(`/api/formation-catalog?${params}`, { signal });
  if (!response.ok) throw new Error("Katalog belum dapat dimuat.");
  return response.json();
}

function catalogSearch(filters: CatalogFilters) {
  return {
    tampilan: undefined,
    skd: filters.hasSkd || undefined,
    q: filters.query?.trim() || undefined,
    jabatan: filters.job || undefined,
    instansi: filters.institution || undefined,
    pendidikan: filters.education?.trim() || undefined,
    lingkup: filters.level,
    halaman: filters.page && filters.page > 1 ? filters.page : undefined,
    jenis: filters.formationType || undefined,
    persaingan: filters.competitionLevel,
    urut: filters.sort,
  };
}

function coverage(row: CatalogFormation) {
  if (row.skd) {
    return (
      <>
        <span className="font-semibold text-foreground">SKD terverifikasi</span>
        <span className="mt-0.5 block text-muted-foreground">
          {row.skd.formationType ? `${row.skd.formationType} · ` : ""}
          {number.format(row.skd.attended)} dari {number.format(row.skd.registered)} hadir
          {row.skd.cutoff !== null ? ` · Batas ${row.skd.cutoff}` : ""}
        </span>
        {!row.skd.canSimulate && (
          <span className="block text-muted-foreground">Belum tersedia untuk simulasi</span>
        )}
      </>
    );
  }
  if (row.coverage === "institution_skd") {
    return (
      <>
        <span className="font-semibold text-foreground">SKD instansi tersedia</span>
        <span className="block text-xs text-muted-foreground">Belum tertaut ke formasi</span>
      </>
    );
  }
  return (
    <span className="text-muted-foreground">
      {row.coverage === "no_skd" ? "SKD belum tersedia" : "Cakupan SKD belum diketahui"}
    </span>
  );
}

function compensation(row: CatalogFormation) {
  if (row.salaryMin === null)
    return row.salaryMax === null ? "Tidak tercantum" : `Hingga ${salary.format(row.salaryMax)}`;
  if (row.salaryMax === null) return `Mulai ${salary.format(row.salaryMin)}`;
  if (row.salaryMin === row.salaryMax) return salary.format(row.salaryMin);
  return `${salary.format(row.salaryMin)} – ${salary.format(row.salaryMax)}`;
}

type CatalogRowProps = {
  row: CatalogFormation;
  selected: boolean;
  compareFull: boolean;
  onCompare: (id: string) => void;
};

function CatalogDegrees({ education }: { education: string }) {
  const degrees = [
    ...new Set(
      education
        .split("/")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  if (degrees.length <= 1) return degrees[0] || "Tidak tercantum";
  return (
    <details>
      <summary className="cursor-pointer break-words font-medium">
        {degrees[0]} <span className="ml-1 text-primary">+{degrees.length - 1}</span>
      </summary>
      <ul className="mt-1 space-y-1 break-words text-muted-foreground">
        {degrees.slice(1).map((degree) => (
          <li key={degree}>{degree}</li>
        ))}
      </ul>
    </details>
  );
}

function CatalogSkdActions({ row, selected, compareFull, onCompare }: CatalogRowProps) {
  const skd = row.skd;
  if (!skd) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Link
        to="/formasi/$formationId"
        params={{ formationId: skd.id }}
        className="inline-flex min-h-10 items-center gap-1 font-semibold text-primary hover:underline lg:min-h-8"
      >
        Detail SKD <ArrowUpRight className="size-3" aria-hidden />
      </Link>
      {skd.canSimulate && (
        <Link
          to="/simulasi-skd"
          search={{ targetFormationId: skd.id }}
          className="inline-flex min-h-10 items-center font-semibold text-primary hover:underline lg:min-h-8"
        >
          Simulasikan
        </Link>
      )}
      <button
        type="button"
        title={selected ? "Hapus dari perbandingan" : "Tambah ke perbandingan"}
        aria-label={`${selected ? "Hapus dari" : "Tambah ke"} perbandingan: ${row.job}`}
        aria-pressed={selected}
        disabled={compareFull && !selected}
        onClick={() => onCompare(skd.id)}
        className="inline-flex size-10 items-center justify-center rounded-md text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40 lg:size-8"
      >
        {selected ? (
          <Check className="size-4" aria-hidden />
        ) : (
          <Plus className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
}

function CatalogMobileRow(props: CatalogRowProps) {
  const { row } = props;
  const metrics = [
    ["Kuota", number.format(row.quota)],
    ["Lolos admin", row.passedAdmin == null ? "-" : number.format(row.passedAdmin)],
    ["Ketetatan", catalogCompetitionRatio(row) ?? "-"],
  ];
  return (
    <li className="min-w-0 border-b border-border py-4 last:border-b-0">
      <h2 className="text-[15px] font-bold leading-snug [overflow-wrap:anywhere]">{row.job}</h2>
      <p className="mt-1 text-sm leading-snug text-muted-foreground [overflow-wrap:anywhere]">
        {row.institution}
      </p>
      <dl className="mt-3 grid grid-cols-3 divide-x divide-border">
        {metrics.map(([label, value]) => (
          <div key={label} className="min-w-0 px-2 first:pl-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <details className="group mt-1 text-sm">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 font-semibold text-primary [&::-webkit-details-marker]:hidden">
          Rincian formasi <ChevronDown className="size-4 group-open:rotate-180" aria-hidden />
        </summary>
        <dl className="grid gap-2 pb-2 text-sm [overflow-wrap:anywhere]">
          <div>
            <dt className="text-xs text-muted-foreground">Pendidikan</dt>
            <dd>
              <CatalogDegrees education={row.education} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Gaji 2024</dt>
            <dd>{compensation(row)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Lokasi</dt>
            <dd>{row.location || "Tidak tercantum"}</dd>
          </div>
          {(row.level || row.category) && (
            <div>
              <dt className="text-xs text-muted-foreground">Jenis dan lingkup</dt>
              <dd>
                {[
                  row.category,
                  row.level === "pusat" ? "Pusat" : row.level === "daerah" ? "Daerah" : null,
                ]
                  .filter(Boolean)
                  .join(" / ")}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-muted-foreground">Hasil SKD</dt>
            <dd>{coverage(row)}</dd>
          </div>
        </dl>
      </details>
      {row.skd && (
        <div className="text-sm">
          <CatalogSkdActions {...props} />
        </div>
      )}
    </li>
  );
}

function CatalogRow(props: CatalogRowProps) {
  const { row } = props;
  const ratio = catalogCompetitionRatio(row);
  const applicants = row.passedAdmin;
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-muted/20">
      <td className="min-w-0 sm:px-3 sm:py-3">
        <p className="break-words font-bold leading-snug">{row.job}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {row.institution}
          {row.level ? (row.level === "pusat" ? " · Pusat" : " · Daerah") : ""}
          {row.category ? ` · ${row.category}` : ""}
        </p>
        {row.location && row.location !== row.institution && (
          <details className="mt-1 break-words text-xs text-muted-foreground">
            <summary className="cursor-pointer">Lokasi penempatan</summary>
            <p className="mt-1">{row.location}</p>
          </details>
        )}
      </td>
      <td className="min-w-0 text-xs leading-5 sm:px-3 sm:py-3">
        <CatalogDegrees education={row.education} />
      </td>
      <td className="text-sm tabular-nums sm:px-2 sm:py-3 sm:text-right">
        {number.format(row.quota)}
      </td>
      <td className="min-w-0 text-xs sm:px-2 sm:py-3 sm:text-right">
        {applicants != null ? (
          <>
            <span className="font-semibold tabular-nums">{number.format(applicants)}</span>
          </>
        ) : (
          <span className="text-muted-foreground" aria-label="Jumlah pelamar tidak tersedia">
            -
          </span>
        )}
      </td>
      <td className="min-w-0 text-xs sm:px-2 sm:py-3">
        {ratio ? (
          <span className="font-semibold tabular-nums">{ratio}</span>
        ) : (
          <span className="text-muted-foreground" aria-label="Ketetatan tidak tersedia">
            -
          </span>
        )}
      </td>
      <td className="break-words text-xs tabular-nums sm:px-3 sm:py-3">{compensation(row)}</td>
      <td className="text-xs sm:px-3 sm:py-3">
        {coverage(row)}
        <CatalogSkdActions {...props} />
      </td>
    </tr>
  );
}

export function FormationCatalog({
  filters,
  initialComparisonIds,
}: {
  filters: CatalogFilters;
  initialComparisonIds: string[];
}) {
  const navigate = useNavigate();
  const initialComparisonKey = serializeFormationIds(initialComparisonIds);
  const [comparison, setComparison] = useState(initialComparisonIds);
  useEffect(() => {
    setComparison(initialComparisonKey?.split(",") ?? []);
  }, [initialComparisonKey]);
  const result = useQuery({
    queryKey: ["formation-catalog", filters],
    queryFn: ({ signal }) => loadCatalog(filters, signal),
    placeholderData: (previous) => previous,
  });
  const data = result.data;
  const refreshing = result.isFetching && Boolean(data);
  const pagination = data?.pagination;
  const preview = data?.access === "preview";
  const institutionOptions = useQuery({
    queryKey: ["catalog-institutions"],
    queryFn: async ({ signal }): Promise<CatalogResponse["institutions"]> => {
      const response = await fetch("/api/formation-catalog?mode=institutions", { signal });
      if (!response.ok) throw new Error("Pilihan instansi belum dapat dimuat.");
      return (await response.json()).institutions;
    },
    staleTime: 15 * 60_000,
  });
  const options = useQuery({
    queryKey: ["formation-filter-options"],
    queryFn: getFormationFilterOptions,
    staleTime: 30 * 60_000,
  });

  function apply(next: CatalogFilters) {
    if (!data) return;
    const search = catalogSearch(next);
    if (preview) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(search)) {
        if (value !== undefined) params.set(key, String(value));
      }
      void navigate({ to: "/login", search: { next: `/formasi?${params}` } });
      return;
    }
    void navigate({
      to: "/formasi",
      search: (old) => ({ ...old, ...search }),
    });
  }

  function compare(id: string) {
    if (preview) {
      void navigate({
        to: "/login",
        search: { next: `/formasi?banding=${encodeURIComponent(id)}` },
      });
      return;
    }
    setComparison((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length < MAX_COMPARISON_FORMATIONS
          ? [...current, id]
          : current,
    );
  }
  const changed = Boolean(
    filters.query ||
    filters.job ||
    filters.education ||
    filters.institution ||
    filters.level ||
    filters.hasSkd ||
    filters.formationType ||
    filters.competitionLevel ||
    filters.sort,
  );
  const advancedCount = [
    filters.hasSkd,
    filters.level,
    filters.formationType,
    filters.competitionLevel,
    filters.sort,
  ].filter(Boolean).length;
  const rowProps = (row: CatalogFormation): CatalogRowProps => ({
    row,
    selected: Boolean(row.skd && comparison.includes(row.skd.id)),
    compareFull: comparison.length >= MAX_COMPARISON_FORMATIONS,
    onCompare: compare,
  });

  return (
    <div className="public-workspace">
      <header className="mb-4">
        <p className="public-kicker font-mono">CPNS 2024</p>
        <h1 className="text-[26px] leading-tight font-bold sm:text-[34px]">Daftar formasi</h1>
      </header>
      <div>
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-3 sm:grid-cols-3 sm:gap-x-3">
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <CatalogOptionPicker
              mode="jobs"
              fieldClass={field}
              value={filters.job}
              onChange={(job) => apply({ ...filters, job, page: 1 })}
            />
          </div>
          <CatalogInstitutionPicker
            institutions={institutionOptions.data}
            level={filters.level}
            value={filters.institution}
            fieldClass={field}
            onChange={(institution) => apply({ ...filters, institution, page: 1 })}
          />
          <CatalogOptionPicker
            mode="education"
            fieldClass={field}
            value={filters.education}
            onChange={(education) => apply({ ...filters, education, page: 1 })}
          />
        </div>
        <details className="group mt-2 border-b border-border">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-primary [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal className="size-4" aria-hidden />
            Filter tambahan
            {advancedCount > 0 && <span className="tabular-nums">({advancedCount})</span>}
            <ChevronDown className="size-4 group-open:rotate-180" aria-hidden />
          </summary>
          <div className="grid grid-cols-2 gap-3 pb-3 sm:grid-cols-4">
            <label className="grid min-w-0 gap-1 text-xs font-semibold">
              Lingkup
              <select
                className={field}
                value={filters.level ?? ""}
                disabled={!data}
                onChange={(e) => {
                  const level = catalogLevel(e.target.value);
                  const selectedLevel = (institutionOptions.data ?? []).find(
                    ({ name }) => name === filters.institution,
                  )?.level;
                  apply({
                    ...filters,
                    level,
                    institution:
                      !level || !institutionOptions.data || selectedLevel === level
                        ? filters.institution
                        : undefined,
                    page: 1,
                  });
                }}
              >
                <option value="">Pusat dan daerah</option>
                <option value="pusat">Pusat</option>
                <option value="daerah">Daerah</option>
              </select>
            </label>
            <label className="col-span-full inline-flex min-h-10 items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={Boolean(filters.hasSkd)}
                disabled={!data}
                onChange={(event) => apply({ ...filters, hasSkd: event.target.checked, page: 1 })}
              />
              Ada hasil SKD
            </label>
            <label className="grid gap-1 text-xs font-semibold">
              Jenis formasi SKD
              <select
                className={field}
                value={filters.formationType ?? ""}
                disabled={!data}
                onChange={(e) => apply({ ...filters, formationType: e.target.value, page: 1 })}
              >
                <option value="">Semua jenis</option>
                {options.data?.formation_types.map(({ value }) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold">
              Ketetatan
              <select
                className={field}
                value={filters.competitionLevel ?? ""}
                disabled={!data}
                onChange={(e) =>
                  apply({
                    ...filters,
                    competitionLevel: catalogCompetition(e.target.value),
                    page: 1,
                  })
                }
              >
                <option value="">Semua tingkat</option>
                <option value="quiet">Sepi peminat</option>
                <option value="low">Rendah</option>
                <option value="medium">Sedang</option>
                <option value="high">Tinggi</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold">
              Urutkan
              <select
                className={field}
                value={filters.sort ?? ""}
                disabled={!data}
                onChange={(e) => apply({ ...filters, sort: catalogSort(e.target.value), page: 1 })}
              >
                <option value="">Default</option>
                <option value="competition_desc">Ketetatan tertinggi</option>
                <option value="competition_asc">Ketetatan terendah</option>
                <option value="cutoff_desc">Batas SKD tertinggi</option>
                <option value="quota_desc">Kuota terbesar</option>
                <option value="name_asc">Jabatan A-Z</option>
              </select>
            </label>
          </div>
        </details>
        {!preview && data && filters.query && (
          <button
            type="button"
            className="mt-2 inline-flex min-h-10 max-w-full items-center gap-2 text-sm text-muted-foreground hover:text-primary"
            onClick={() => apply({ ...filters, query: undefined, page: 1 })}
            aria-label={`Hapus pencarian ${filters.query}`}
          >
            <span className="truncate">{filters.query}</span>
            <X className="size-4 shrink-0" aria-hidden />
          </button>
        )}

        <div className="my-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <p role="status" className="flex min-h-5 items-center gap-2 text-muted-foreground">
            {(result.isPending || result.isFetching) && (
              <LoaderCircle
                className="size-4 shrink-0 text-primary motion-safe:animate-spin"
                aria-hidden
              />
            )}
            {result.isPending
              ? "Memuat katalog…"
              : refreshing
                ? "Memuat hasil…"
                : preview
                  ? `Pratinjau ${data.formations.length} dari ${number.format(data.catalogTotal)} formasi`
                  : data
                    ? `${number.format(data.pagination.total)} formasi`
                    : ""}
          </p>
          {preview && (
            <Link
              className="font-semibold text-primary hover:underline"
              to="/login"
              search={{ next: "/formasi" }}
            >
              Masuk untuk membuka katalog
            </Link>
          )}
          {!preview && data && changed && (
            <button
              type="button"
              className="inline-flex min-h-10 items-center gap-1.5 font-semibold text-primary hover:underline"
              onClick={() => apply({})}
            >
              <FilterX className="size-4" aria-hidden /> Reset filter
            </button>
          )}
        </div>
        {comparison.length > 0 && !preview && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span>
              {comparison.length} dari {MAX_COMPARISON_FORMATIONS} dipilih
            </span>
            {comparison.length > 1 && (
              <Link
                to="/formasi/banding"
                search={{ ids: serializeFormationIds(comparison) }}
                className={`${action} bg-primary text-primary-foreground`}
              >
                <Columns3 className="size-4" aria-hidden /> Bandingkan
              </Link>
            )}
            <button
              type="button"
              onClick={() => setComparison([])}
              className={`${action} border border-border`}
            >
              Kosongkan
            </button>
          </div>
        )}

        {result.isError && (
          <div role="alert" className="border-y border-border py-6 text-sm">
            Katalog belum dapat dimuat.{" "}
            <button
              type="button"
              className="font-semibold text-primary hover:underline"
              onClick={() => void result.refetch()}
            >
              Coba lagi
            </button>
          </div>
        )}
        {data && (
          <div
            aria-busy={refreshing}
            inert={result.isPlaceholderData}
            className={result.isPlaceholderData ? "opacity-60" : undefined}
          >
            {data.formations.length ? (
              <>
                <ul className="border-t border-border lg:hidden" aria-label="Daftar formasi">
                  {data.formations.map((row) => (
                    <CatalogMobileRow key={row.id} {...rowProps(row)} />
                  ))}
                </ul>
                <table className="hidden w-full table-fixed border-y border-border text-left lg:table">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="w-[25%] px-3 py-3">
                        Jabatan dan instansi
                      </th>
                      <th scope="col" className="w-[16%] px-3 py-3">
                        Pendidikan
                      </th>
                      <th scope="col" className="w-[7%] px-2 py-3 text-right">
                        Kuota
                      </th>
                      <th scope="col" className="w-[10%] px-2 py-3 text-right">
                        Lolos admin
                      </th>
                      <th scope="col" className="w-[10%] px-2 py-3">
                        Ketetatan
                      </th>
                      <th scope="col" className="w-[14%] px-3 py-3">
                        Kisaran gaji 2024
                      </th>
                      <th scope="col" className="w-[18%] px-3 py-3">
                        Hasil SKD
                      </th>
                    </tr>
                  </thead>
                  <tbody className="align-top">
                    {data.formations.map((row) => (
                      <CatalogRow key={row.id} {...rowProps(row)} />
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                <p>
                  {filters.hasSkd || filters.formationType
                    ? "Tidak ada formasi tertaut ke hasil SKD dengan filter ini."
                    : "Tidak ada formasi dengan filter ini."}
                </p>
                {(filters.hasSkd || filters.formationType) && (
                  <button
                    type="button"
                    className="mt-2 font-semibold text-primary hover:underline"
                    onClick={() =>
                      apply({ ...filters, hasSkd: false, formationType: undefined, page: 1 })
                    }
                  >
                    Tampilkan juga formasi tanpa hasil SKD
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {pagination && !preview && pagination.totalPages > 1 && (
          <nav aria-label="Halaman katalog" className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              className={`${action} border border-border`}
              aria-label="Halaman sebelumnya"
              disabled={pagination.page <= 1 || result.isPlaceholderData}
              onClick={() => apply({ ...filters, page: pagination.page - 1 })}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <span className="min-w-20 text-center text-sm tabular-nums">
              {pagination.page} / {pagination.totalPages}
            </span>
            <button
              type="button"
              className={`${action} border border-border`}
              aria-label="Halaman berikutnya"
              disabled={pagination.page >= pagination.totalPages || result.isPlaceholderData}
              onClick={() => apply({ ...filters, page: pagination.page + 1 })}
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
