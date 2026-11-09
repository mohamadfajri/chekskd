import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns3,
  FilterX,
  Plus,
  Search,
} from "lucide-react";
import {
  catalogCompetition,
  catalogCompetitionRatio,
  catalogLevel,
  catalogSort,
  type CatalogFilters,
  type CatalogFormation,
  type CatalogResponse,
} from "@/lib/formationCatalog";
import { MAX_COMPARISON_FORMATIONS, serializeFormationIds } from "@/lib/formationSelection";
import { getFormationFilterOptions } from "@/services/formationService";
import { CatalogInstitutionPicker } from "./CatalogInstitutionPicker";

const number = new Intl.NumberFormat("id-ID");
const salary = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});
const field =
  "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const action =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";

async function loadCatalog(filters: CatalogFilters, signal: AbortSignal): Promise<CatalogResponse> {
  const params = new URLSearchParams({ page: String(filters.page ?? 1) });
  for (const key of [
    "query",
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

function CatalogRow({
  row,
  selected,
  compareFull,
  onCompare,
}: {
  row: CatalogFormation;
  selected: boolean;
  compareFull: boolean;
  onCompare: (id: string) => void;
}) {
  const degrees = row.education
    .split("/")
    .map((value) => value.trim())
    .filter(Boolean);
  const ratio = catalogCompetitionRatio(row);
  const applicants = row.passedAdmin;
  return (
    <tr className="grid gap-2 border-b border-border px-3 py-4 last:border-b-0 sm:table-row sm:p-0">
      <td className="min-w-0 sm:px-3 sm:py-3">
        <p className="break-words font-bold leading-snug">{row.job}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {row.institution}
          {row.level ? (row.level === "pusat" ? " · Pusat" : " · Daerah") : ""}
          {row.category ? ` · ${row.category}` : ""}
        </p>
        {row.location && row.location !== row.institution && (
          <p className="mt-1 break-words text-xs text-muted-foreground">{row.location}</p>
        )}
      </td>
      <td className="min-w-0 text-xs leading-5 sm:px-3 sm:py-3">
        {degrees.length > 1 ? (
          <details>
            <summary className="cursor-pointer break-words font-medium">
              {degrees[0]} <span className="ml-1 text-primary">+{degrees.length - 1}</span>
            </summary>
            <ul className="mt-1 space-y-1 break-words text-muted-foreground">
              {[...new Set(degrees)].map((degree) => (
                <li key={degree}>{degree}</li>
              ))}
            </ul>
          </details>
        ) : (
          degrees[0] || "Tidak tercantum"
        )}
      </td>
      <td className="text-sm tabular-nums sm:px-2 sm:py-3 sm:text-right">
        <span className="mr-1 text-muted-foreground sm:hidden">Kuota</span>
        {number.format(row.quota)}
      </td>
      <td className="min-w-0 text-xs sm:px-2 sm:py-3 sm:text-right">
        <span className="mr-1 text-muted-foreground sm:hidden">Pelamar:</span>
        {applicants != null ? (
          <>
            <span className="font-semibold tabular-nums">{number.format(applicants)}</span>{" "}
            <span className="text-muted-foreground sm:mt-0.5 sm:block">Lolos administrasi</span>
          </>
        ) : (
          <span className="text-muted-foreground" aria-label="Jumlah pelamar tidak tersedia">
            -
          </span>
        )}
      </td>
      <td className="min-w-0 text-xs sm:px-2 sm:py-3">
        <span className="mr-1 text-muted-foreground sm:hidden">Ketetatan:</span>
        {ratio ? (
          <span className="font-semibold tabular-nums">{ratio}</span>
        ) : (
          <span className="text-muted-foreground" aria-label="Ketetatan tidak tersedia">
            -
          </span>
        )}
      </td>
      <td className="break-words text-xs tabular-nums sm:px-3 sm:py-3">
        <span className="mr-1 text-muted-foreground sm:hidden">Gaji tercantum:</span>
        {compensation(row)}
      </td>
      <td className="text-xs sm:px-3 sm:py-3">
        {coverage(row)}
        {row.skd && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link
              to="/formasi/$formationId"
              params={{ formationId: row.skd.id }}
              className="inline-flex min-h-7 items-center gap-1 font-semibold text-primary hover:underline"
            >
              Detail SKD <ArrowUpRight className="size-3" aria-hidden />
            </Link>
            {row.skd.canSimulate && (
              <Link
                to="/simulasi-skd"
                search={{ targetFormationId: row.skd.id }}
                className="inline-flex min-h-7 items-center font-semibold text-primary hover:underline"
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
              onClick={() => row.skd && onCompare(row.skd.id)}
              className="inline-flex size-8 items-center justify-center rounded-md border border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
            >
              {selected ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <Plus className="size-4" aria-hidden />
              )}
            </button>
          </div>
        )}
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
  const [query, setQuery] = useState(filters.query ?? "");
  const [education, setEducation] = useState(filters.education ?? "");
  const initialComparisonKey = serializeFormationIds(initialComparisonIds);
  const [comparison, setComparison] = useState(initialComparisonIds);
  useEffect(() => {
    setComparison(initialComparisonKey?.split(",") ?? []);
  }, [initialComparisonKey]);
  useEffect(() => setQuery(filters.query ?? ""), [filters.query]);
  useEffect(() => setEducation(filters.education ?? ""), [filters.education]);
  const result = useQuery({
    queryKey: ["formation-catalog", filters],
    queryFn: ({ signal }) => loadCatalog(filters, signal),
    placeholderData: (previous) => previous,
  });
  const data = result.data;
  const pagination = data?.pagination;
  const preview = data?.access === "preview";
  const options = useQuery({
    queryKey: ["formation-filter-options"],
    queryFn: getFormationFilterOptions,
    staleTime: 30 * 60_000,
  });

  function apply(next: CatalogFilters) {
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
    filters.education ||
    filters.institution ||
    filters.level ||
    filters.hasSkd ||
    filters.formationType ||
    filters.competitionLevel ||
    filters.sort,
  );

  return (
    <div className="public-workspace">
      <section className="formation-workspace-heading">
        <p className="public-kicker font-mono">CPNS 2024</p>
        <h1>Daftar formasi</h1>
      </section>
      <div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            apply({ ...filters, query, education, page: 1 });
          }}
          className="grid grid-cols-2 gap-3 border-y border-border py-4 xl:grid-cols-[1.3fr_1fr_0.8fr_0.6fr_auto]"
        >
          <label className="col-span-2 grid min-w-0 gap-1 text-xs font-semibold xl:col-span-1">
            Jabatan atau lokasi
            <input
              className={field}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={120}
            />
          </label>
          <CatalogInstitutionPicker
            institutions={data?.institutions}
            level={filters.level}
            value={filters.institution}
            fieldClass={field}
            onChange={(institution) =>
              apply({ ...filters, query, education, institution, page: 1 })
            }
          />
          <label className="grid min-w-0 gap-1 text-xs font-semibold">
            Pendidikan
            <input
              className={field}
              list="catalog-education"
              value={education}
              onChange={(e) => setEducation(e.target.value)}
              maxLength={120}
            />
            <datalist id="catalog-education">
              {options.data?.education_options.map(({ value, aliases }) => (
                <option key={value} value={value}>
                  {aliases?.join(" · ")}
                </option>
              ))}
            </datalist>
          </label>
          <label className="grid min-w-0 gap-1 text-xs font-semibold">
            Lingkup
            <select
              className={field}
              value={filters.level ?? ""}
              disabled={!data}
              onChange={(e) => {
                const level = catalogLevel(e.target.value);
                const selectedLevel = data?.institutions.find(
                  ({ name }) => name === filters.institution,
                )?.level;
                apply({
                  ...filters,
                  query,
                  education,
                  level,
                  institution: !level || selectedLevel === level ? filters.institution : undefined,
                  page: 1,
                });
              }}
            >
              <option value="">Pusat dan daerah</option>
              <option value="pusat">Pusat</option>
              <option value="daerah">Daerah</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              disabled={!data}
              className={`${action} bg-primary text-primary-foreground`}
            >
              <Search className="size-4" aria-hidden /> Cari
            </button>
            {!preview && changed && (
              <button
                type="button"
                title="Reset filter"
                aria-label="Reset filter"
                className={`${action} border border-border`}
                onClick={() => {
                  setQuery("");
                  setEducation("");
                  apply({});
                }}
              >
                <FilterX className="size-4" aria-hidden />
              </button>
            )}
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border py-3">
          <label className="inline-flex min-h-8 items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={Boolean(filters.hasSkd)}
              disabled={!data}
              onChange={(event) => apply({ ...filters, hasSkd: event.target.checked, page: 1 })}
            />
            Ada hasil SKD
          </label>
          <details
            open={
              filters.formationType || filters.competitionLevel || filters.sort ? true : undefined
            }
            className="w-full sm:w-auto"
          >
            <summary className="cursor-pointer text-sm font-semibold text-primary">
              Filter lanjutan
            </summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
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
                  onChange={(e) =>
                    apply({ ...filters, sort: catalogSort(e.target.value), page: 1 })
                  }
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
        </div>

        <div className="my-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <p aria-live="polite" className="text-muted-foreground">
            {result.isPending
              ? "Memuat katalog…"
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
          <div className="overflow-hidden rounded-lg border border-border bg-white">
            {data.formations.length ? (
              <table className="block w-full table-fixed text-left sm:table">
                <thead className="hidden bg-muted/50 text-xs text-muted-foreground sm:table-header-group">
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
                      Pelamar
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
                <tbody className="block align-top sm:table-row-group">
                  {data.formations.map((row) => (
                    <CatalogRow
                      key={row.id}
                      row={row}
                      selected={Boolean(row.skd && comparison.includes(row.skd.id))}
                      compareFull={comparison.length >= MAX_COMPARISON_FORMATIONS}
                      onCompare={compare}
                    />
                  ))}
                </tbody>
              </table>
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
