import type { FormationCompetitionLevel, FormationSort } from "../services/formationService";

export type CatalogLevel = "pusat" | "daerah";
export type CatalogCoverage = "skd" | "institution_skd" | "no_skd" | "unknown";

export const CATALOG_COMPETITION_BOUNDS = {
  quiet: [0, 1],
  low: [1, 10],
  medium: [10, 30],
  high: [30, null],
} as const satisfies Record<FormationCompetitionLevel, readonly [number, number | null]>;

export interface CatalogFilters {
  query?: string;
  institution?: string;
  education?: string;
  level?: CatalogLevel;
  page?: number;
  hasSkd?: boolean;
  formationType?: string;
  competitionLevel?: FormationCompetitionLevel;
  sort?: FormationSort;
}

export interface CatalogFormation {
  id: string;
  institution: string;
  level: CatalogLevel | null;
  job: string;
  location: string;
  education: string;
  category?: string;
  quota: number;
  passedAdmin?: number;
  salaryMin: number | null;
  salaryMax: number | null;
  coverage: CatalogCoverage;
  skd?: {
    id: string;
    formationType: string | null;
    registered: number;
    attended: number;
    cutoff: number | null;
    canSimulate: boolean;
  };
}

export interface CatalogResponse {
  access: "preview" | "full";
  year: number;
  catalogTotal: number;
  institutions: { name: string; level: CatalogLevel | null }[];
  formations: CatalogFormation[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export type CatalogPageResponse = Omit<CatalogResponse, "institutions">;

export interface CatalogEducationOption {
  value: string;
  label: string;
}

export function catalogEducationLabel(value: string): string {
  return value.toUpperCase().replace(/^([SD])\s*-?\s*([1-4]|I{1,3}|IV)\b/, "$1-$2");
}

export function catalogEducationOptions(
  keys: readonly string[],
  query: string,
  limit = 20,
): CatalogEducationOption[] {
  const normalized = normalizeCatalogSearch(query);
  const words = normalized.split(" ").filter(Boolean);
  const rank = (key: string) => {
    if (key === normalized) return 0;
    if (key.replace(/^(?:s[123]|d[1-4]|di{1,3}|div) /, "") === normalized) return 1;
    if (key.startsWith(normalized + " ")) return 2;
    if (key.split(" ").includes(normalized)) return 3;
    return 4;
  };
  return [...new Set(keys)]
    .filter((key) => words.every((word) => key.split(" ").some((part) => part.startsWith(word))))
    .map((key) => ({ key, rank: rank(key) }))
    .sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key, "id"))
    .filter(({ key }) => key.length <= 160)
    .slice(0, limit)
    .map(({ key }) => ({
      value: key,
      label: catalogEducationLabel(key),
    }));
}

const ratioNumber = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

export function catalogCompetitionRatio(
  row: Pick<CatalogFormation, "quota" | "passedAdmin">,
): string | null {
  const count = row.passedAdmin;
  if (
    count == null ||
    !Number.isFinite(count) ||
    count < 0 ||
    !Number.isFinite(row.quota) ||
    row.quota <= 0
  )
    return null;
  return `1:${ratioNumber.format(count / row.quota)}`;
}

export function normalizeCatalogSearch(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\b([sd])\s+(1|2|3|iii|iv)\b/g, "$1$2");
}

export function catalogText(value: unknown, max = 120): string | undefined {
  return typeof value === "string" ? value.trim().slice(0, max) || undefined : undefined;
}

export function catalogLevel(value: unknown): CatalogLevel | undefined {
  return value === "pusat" || value === "daerah" ? value : undefined;
}

export function catalogCompetition(value: unknown): FormationCompetitionLevel | undefined {
  return value === "quiet" || value === "low" || value === "medium" || value === "high"
    ? value
    : undefined;
}

export function catalogSort(value: unknown): FormationSort | undefined {
  return value === "competition_desc" ||
    value === "competition_asc" ||
    value === "cutoff_desc" ||
    value === "quota_desc" ||
    value === "name_asc"
    ? value
    : undefined;
}
