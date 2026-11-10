import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CATALOG_COMPETITION_BOUNDS,
  normalizeCatalogSearch,
  type CatalogFilters,
  type CatalogFormation,
  type CatalogResponse,
} from "../lib/formationCatalog.ts";
import { normalizeSscasnText, sscasnEducationKey } from "../lib/sscasn.ts";
import { canManuallyLinkSscasn, SSCASN_MANUAL_NOTE_PREFIX } from "../lib/sscasnReconciliation.ts";
import { approvedEducationLabels } from "./manualSkd.ts";
import { getSkdDatabase } from "./skdPreview.ts";
import { skdAdminUsesSumopod } from "./skdAdminStore.ts";
import {
  aesenCatalogEnabled,
  countAesenFormations,
  getAesenCategoryLabels,
  getAesenFormationsByIds,
  getAesenMetadata,
  listAesenFormations,
  type AesenFormation,
} from "./aesenCatalog.ts";
import pilot from "./formationCatalogPilot.json" with { type: "json" };

type PilotFormation = Omit<CatalogFormation, "institution" | "level" | "coverage" | "skd">;
const groups: {
  name: string;
  level: NonNullable<CatalogFormation["level"]>;
  rows: PilotFormation[];
}[] = pilot.institutions.map(({ name, level, rows }) => ({
  name,
  level: level === "daerah" ? "daerah" : "pusat",
  rows,
}));
const institutions = groups.map(({ name, level }) => ({ name, level }));
const formations = groups.flatMap(({ name, level, rows }) =>
  rows.map((row) => ({ ...row, institution: name, level })),
);
const preview = [0, 1].flatMap((index) =>
  groups.flatMap(({ name, level, rows }) =>
    rows[index] ? [{ ...rows[index], institution: name, level }] : [],
  ),
);

export const catalogYear = pilot.year;
const pilotById = new Map(formations.map((row) => [row.id, row]));
const PAGE_SIZE = 24;
const PREVIEW_SIZE = 6;

function contains(value: string, query: string) {
  const normalized = normalizeCatalogSearch(query);
  if (!normalized) return false;
  const haystack = normalizeCatalogSearch(value);
  return normalized.split(" ").every((word) => haystack.includes(word));
}

function filterPilot(
  filters: CatalogFilters,
  educationLabels: string[] = [],
  sourceIds?: string[],
) {
  const included = sourceIds && new Set(sourceIds);
  const education = filters.education ? [filters.education, ...educationLabels] : [];
  const bounds = filters.competitionLevel && CATALOG_COMPETITION_BOUNDS[filters.competitionLevel];
  const ratio = (row: (typeof formations)[number]) =>
    row.quota > 0 && row.passedAdmin != null ? row.passedAdmin / row.quota : null;
  const filtered = formations.filter(
    (row) =>
      (!included || included.has(row.id)) &&
      (!filters.level || row.level === filters.level) &&
      (!filters.institution || row.institution === filters.institution) &&
      (!bounds ||
        (row.quota > 0 &&
          row.passedAdmin != null &&
          row.passedAdmin > row.quota * bounds[0] &&
          (bounds[1] === null || row.passedAdmin <= row.quota * bounds[1]))) &&
      (!filters.query ||
        contains(`${row.job} ${row.institution} ${row.location}`, filters.query)) &&
      (!education.length ||
        row.education
          .split("/")
          .some((option) => education.some((label) => contains(option, label)))),
  );
  if (filters.sort === "quota_desc") filtered.sort((a, b) => b.quota - a.quota);
  if (filters.sort === "name_asc") filtered.sort((a, b) => a.job.localeCompare(b.job));
  if (filters.sort === "competition_asc" || filters.sort === "competition_desc") {
    const direction = filters.sort === "competition_asc" ? 1 : -1;
    filtered.sort((a, b) => {
      const left = ratio(a);
      const right = ratio(b);
      if (left === null) return right === null ? 0 : 1;
      if (right === null) return -1;
      return direction * (left - right) || a.id.localeCompare(b.id);
    });
  }
  return filtered;
}

export function browseFormationCatalog(
  filters: CatalogFilters,
  fullAccess: boolean,
  publishedInstitutions: ReadonlySet<string> | null,
): CatalogResponse {
  const matches = fullAccess
    ? filterPilot(filters, [], filters.hasSkd || filters.formationType ? [] : undefined)
    : preview;
  const pagination = planCatalogPage(
    matches.length,
    fullAccess ? filters.page : 1,
    fullAccess ? PAGE_SIZE : PREVIEW_SIZE,
  );

  return {
    access: fullAccess ? "full" : "preview",
    year: catalogYear,
    catalogTotal: formations.length,
    institutions,
    formations: matches
      .slice((pagination.page - 1) * pagination.pageSize, pagination.page * pagination.pageSize)
      .map((row) =>
        aesenToCatalog(
          row,
          row.level,
          publishedInstitutions ? publishedInstitutions.has(row.institution) : null,
        ),
      ),
    pagination,
  };
}

export function institutionLevel(name: string): CatalogFormation["level"] {
  const known = institutions.find((institution) => institution.name === name);
  if (known) return known.level;
  if (/^Pemerintah(?:\s|$)/i.test(name)) return "daerah";
  if (/^(?:Kementerian|Badan|Kejaksaan Agung|Otorita Ibu Kota Nusantara)(?:\s|$)/i.test(name))
    return "pusat";
  return null;
}

export async function publishedSkdInstitutions(sb: SupabaseClient, fromSumopod = false) {
  if (fromSumopod) {
    const { rows } = await getSkdDatabase().query<{ institution_name: string }>(
      `select distinct institution_name from public.skd_batches
      where status = 'published' and selection_year = $1`,
      [catalogYear],
    );
    return new Set(rows.map(({ institution_name }) => institution_name));
  }
  const { data, error } = await sb
    .from("skd_batches")
    .select("institution_name")
    .eq("status", "published")
    .eq("selection_year", catalogYear);
  if (error) throw new Error("Cakupan SKD belum dapat dibaca.");
  return new Set<string>(data.map((row) => row.institution_name));
}

function summarizeCoverage(names: Set<string>) {
  return {
    year: catalogYear,
    pusat: [...names].filter((name) => institutionLevel(name) === "pusat").length,
    daerah: [...names].filter((name) => institutionLevel(name) === "daerah").length,
    other: [...names].filter((name) => !institutionLevel(name)).length,
  };
}

export async function getSkdComparisonCoverage(sb: SupabaseClient, fromSumopod = false) {
  if (fromSumopod) {
    const { rows } = await getSkdDatabase().query<{ institution_name: string }>(
      `select distinct b.institution_name from public.skd_batches b
      where b.status = 'published' and b.selection_year = $1
      and exists (
        select 1 from public.skd_formation_stats st
        join public.skd_formations f on f.id = st.formation_id and f.batch_id = b.id
        where st.batch_id = b.id and f.tahun = $1 and f.quality_status = 'verified'
          and f.jenis_formasi ilike 'UMUM' and cardinality(f.pendidikan_options) > 0
          and st.attended_count > 0 and st.passing_count >= 3 and st.shortlisted_count >= 1
          and st.shortlist_capacity > 0 and st.cutoff_total is not null and st.cutoff_tkp is not null
          and st.cutoff_tiu is not null and st.cutoff_twk is not null
      )`,
      [catalogYear],
    );
    return summarizeCoverage(new Set(rows.map(({ institution_name }) => institution_name)));
  }
  const { data, error } = await sb
    .from("skd_batches")
    .select("institution_name,skd_formation_stats!inner(formation_id,skd_formations!inner(id))")
    .eq("status", "published")
    .eq("selection_year", catalogYear)
    .eq("skd_formation_stats.skd_formations.quality_status", "verified")
    .eq("skd_formation_stats.skd_formations.tahun", catalogYear)
    .ilike("skd_formation_stats.skd_formations.jenis_formasi", "UMUM")
    .not("skd_formation_stats.skd_formations.pendidikan_options", "eq", "{}")
    .gt("skd_formation_stats.attended_count", 0)
    .gte("skd_formation_stats.passing_count", 3)
    .gte("skd_formation_stats.shortlisted_count", 1)
    .gt("skd_formation_stats.shortlist_capacity", 0)
    .not("skd_formation_stats.cutoff_total", "is", null)
    .not("skd_formation_stats.cutoff_tkp", "is", null)
    .not("skd_formation_stats.cutoff_tiu", "is", null)
    .not("skd_formation_stats.cutoff_twk", "is", null)
    .limit(1, { referencedTable: "skd_formation_stats" });
  if (error) throw new Error("Cakupan simulasi belum dapat dibaca.");
  return summarizeCoverage(new Set<string>(data.map((row) => row.institution_name)));
}

const OFFICIAL_FIELDS =
  "formation_id,quota,participant_count,attended_count,passing_count,shortlisted_count,shortlist_capacity,cutoff_total,cutoff_tkp,cutoff_tiu,cutoff_twk,skd_formations!inner(nama_instansi,jabatan,jenis_formasi,pendidikan_options,lokasi_formasi,pendidikan,jumlah_formasi,page_number),skd_batches!inner(status)";
export interface OfficialCatalogRow {
  formation_id: string;
  quota: number;
  participant_count: number;
  attended_count: number;
  passing_count: number;
  shortlisted_count: number;
  shortlist_capacity: number;
  cutoff_total: number | null;
  cutoff_tkp: number | null;
  cutoff_tiu: number | null;
  cutoff_twk: number | null;
  skd_formations: {
    nama_instansi: string;
    jabatan: string;
    jenis_formasi: string | null;
    pendidikan_options: string[];
    lokasi_formasi: string | null;
    pendidikan: string | null;
    jumlah_formasi: number;
    page_number: number | null;
  };
}

function officialQuery(sb: SupabaseClient) {
  return sb
    .from("skd_formation_stats")
    .select(OFFICIAL_FIELDS)
    .eq("skd_batches.status", "published")
    .eq("skd_batches.selection_year", catalogYear)
    .eq("skd_formations.tahun", catalogYear)
    .eq("skd_formations.quality_status", "verified");
}

type Pair = { sourceId: string; formationId: string; manual?: boolean };
type CatalogSkd = NonNullable<CatalogFormation["skd"]>;
type LinkedSource = Pick<
  CatalogFormation,
  "institution" | "job" | "location" | "education" | "quota"
>;
type CatalogLink = {
  formation_id: string;
  source_id: string;
  notes: string | null;
  sscasn_formations: LinkedSource | LinkedSource[] | null;
};

export function uniqueCatalogPairs(pairs: Pair[]) {
  const bySource = new Map<string, number>();
  const byPdf = new Map<string, number>();
  for (const pair of pairs) {
    bySource.set(pair.sourceId, (bySource.get(pair.sourceId) ?? 0) + 1);
    byPdf.set(pair.formationId, (byPdf.get(pair.formationId) ?? 0) + 1);
  }
  return pairs.filter(
    (pair) => bySource.get(pair.sourceId) === 1 && byPdf.get(pair.formationId) === 1,
  );
}

export function officialCatalogSkd(row: OfficialCatalogRow): CatalogSkd {
  const pdf = row.skd_formations;
  return {
    id: row.formation_id,
    formationType: pdf.jenis_formasi,
    registered: row.participant_count,
    attended: row.attended_count,
    cutoff: row.cutoff_total,
    canSimulate:
      normalizeSscasnText(pdf.jenis_formasi) === "UMUM" &&
      Boolean(pdf.pendidikan_options?.length) &&
      row.attended_count > 0 &&
      row.passing_count >= 3 &&
      row.shortlisted_count >= 1 &&
      row.shortlist_capacity > 0 &&
      row.cutoff_total != null &&
      row.cutoff_tkp != null &&
      row.cutoff_tiu != null &&
      row.cutoff_twk != null,
  };
}

export function aesenToCatalog(
  row: AesenFormation,
  level: CatalogFormation["level"],
  published: boolean | null,
  skd?: CatalogSkd,
): CatalogFormation {
  return {
    ...row,
    level,
    coverage: skd
      ? "skd"
      : published === null
        ? "unknown"
        : published
          ? "institution_skd"
          : "no_skd",
    skd,
  };
}

function sameText(a: string | null, b: string | null) {
  return normalizeSscasnText(a) === normalizeSscasnText(b);
}

async function catalogLinks(
  sb: SupabaseClient,
  useAesen: boolean,
  scope: { rows?: AesenFormation[]; institution?: string },
  fromSumopod: boolean,
): Promise<Map<string, CatalogSkd>> {
  const scoped = scope.rows ? new Map(scope.rows.map((row) => [row.id, row])) : null;
  const ids = scoped ? [...scoped.keys()] : undefined;
  if (ids?.length === 0) return new Map();
  const pairs: Pair[] = [];
  const sources = new Map<string, AesenFormation>();
  const batchSize = 100;
  const useSumopodLinks = fromSumopod && skdAdminUsesSumopod();
  for (let offset = 0; ; offset += batchSize) {
    let data: CatalogLink[];
    if (useSumopodLinks) {
      const { rows } = await getSkdDatabase().query<CatalogLink>(
        `select m.formation_id,m.source_id,m.notes,
          jsonb_build_object('institution',a.institution,'job',a.job,'location',a.location,
            'education',a.education,'quota',a.quota) as sscasn_formations
        from public.sscasn_matches m
        join public.sscasn_formations a on a.snapshot_id=m.snapshot_id and a.source_id=m.source_id
        join public.sscasn_snapshots s on s.id=m.snapshot_id
        where m.review_status='approved' and s.import_status='ready' and s.selection_year=$1
          and ($2::text[] is null or m.source_id=any($2))
        order by m.formation_id limit $3 offset $4`,
        [catalogYear, ids ?? null, batchSize, offset],
      );
      data = rows;
    } else {
      let query = sb
        .from("sscasn_matches")
        .select(
          "formation_id,source_id,notes,sscasn_formations!inner(institution,job,location,education,quota,sscasn_snapshots!inner(selection_year,import_status))",
        )
        .eq("review_status", "approved")
        .eq("sscasn_formations.sscasn_snapshots.import_status", "ready")
        .eq("sscasn_formations.sscasn_snapshots.selection_year", catalogYear);
      if (ids) query = query.in("source_id", ids);
      const result = await query.order("formation_id").range(offset, offset + batchSize - 1);
      if (result.error) {
        if (result.error.code === "PGRST205" || result.error.code === "42P01") break;
        throw new Error("Pasangan formasi belum dapat dibaca.");
      }
      data = result.data as unknown as CatalogLink[];
    }
    const remote =
      scoped ??
      (useAesen
        ? new Map(
            (await getAesenFormationsByIds(data.map((m) => m.source_id))).map((r) => [r.id, r]),
          )
        : pilotById);
    for (const match of data) {
      const row = remote.get(match.source_id);
      const joined = match.sscasn_formations;
      const source = Array.isArray(joined) ? (joined.length === 1 ? joined[0] : null) : joined;
      if (
        row &&
        source &&
        (!scope.institution || row.institution === scope.institution) &&
        source.quota === row.quota &&
        sameText(source.institution, row.institution) &&
        sameText(source.job, row.job) &&
        sameText(source.location, row.location) &&
        sscasnEducationKey(source.education) === sscasnEducationKey(row.education)
      ) {
        pairs.push({
          sourceId: row.id,
          formationId: match.formation_id,
          manual: match.notes?.startsWith(SSCASN_MANUAL_NOTE_PREFIX),
        });
        sources.set(row.id, row);
      }
    }
    if (data.length < batchSize) break;
  }
  const unique = uniqueCatalogPairs(pairs);
  const manualCategories = useAesen
    ? await getAesenCategoryLabels(
        unique.filter(({ manual }) => manual).map(({ sourceId }) => sourceId),
      )
    : new Map<string, string>();
  const byFormation = new Map(unique.map((pair) => [pair.formationId, pair]));
  const official: OfficialCatalogRow[] = [];
  for (let offset = 0; offset < unique.length; offset += batchSize) {
    const formationIds = unique.slice(offset, offset + batchSize).map((pair) => pair.formationId);
    if (fromSumopod) {
      const { rows } = await getSkdDatabase().query<OfficialCatalogRow>(
        `select st.formation_id, st.quota, st.participant_count, st.attended_count,
          st.passing_count, st.shortlisted_count, st.shortlist_capacity, st.cutoff_total,
          st.cutoff_tkp, st.cutoff_tiu, st.cutoff_twk,
          jsonb_build_object('nama_instansi', f.nama_instansi, 'jabatan', f.jabatan,
            'jenis_formasi', f.jenis_formasi, 'pendidikan_options', f.pendidikan_options,
            'lokasi_formasi', f.lokasi_formasi, 'pendidikan', f.pendidikan,
            'jumlah_formasi', f.jumlah_formasi, 'page_number', f.page_number) as skd_formations
        from public.skd_formation_stats st
        join public.skd_formations f on f.id = st.formation_id
        join public.skd_batches b on b.id = st.batch_id and b.id = f.batch_id
        where b.status = 'published' and b.selection_year = $1 and f.tahun = $1
          and f.quality_status = 'verified' and st.formation_id = any($2::uuid[])`,
        [catalogYear, formationIds],
      );
      official.push(...rows);
      continue;
    }
    const { data, error } = await officialQuery(sb).in("formation_id", formationIds);
    if (error) throw new Error("Pasangan SKD belum dapat divalidasi.");
    official.push(...((data ?? []) as unknown as OfficialCatalogRow[]));
  }
  const verified = new Map<string, CatalogSkd>();
  for (const row of official) {
    const pair = byFormation.get(row.formation_id);
    const source = pair && sources.get(pair.sourceId);
    if (!pair || !source) continue;
    const pdf = row.skd_formations;
    const valid = pair.manual
      ? source.passedAdmin != null &&
        canManuallyLinkSscasn(
          {
            id: row.formation_id,
            institution: pdf.nama_instansi,
            job: pdf.jabatan,
            location: pdf.lokasi_formasi,
            education: pdf.pendidikan,
            category: pdf.jenis_formasi,
            page: pdf.page_number,
            quota: pdf.jumlah_formasi,
            statsQuota: row.quota,
            registered: row.participant_count,
            attended: row.attended_count,
          },
          { ...source, registered: source.passedAdmin, category: manualCategories.get(source.id) },
        )
      : sameText(source.institution, pdf.nama_instansi) && sameText(source.job, pdf.jabatan);
    if (!valid) continue;
    verified.set(pair.sourceId, officialCatalogSkd(row));
  }
  return verified;
}

export function planCatalogPage(total: number, requestedPage?: number, pageSize = PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Number.isSafeInteger(requestedPage)
    ? Math.min(totalPages, Math.max(1, requestedPage ?? 1))
    : 1;
  return { page, pageSize, total, totalPages };
}

export async function getUnifiedFormationCatalog(
  sb: SupabaseClient,
  requested: CatalogFilters,
  fullAccess: boolean,
  fromSumopod = false,
): Promise<CatalogResponse> {
  const filters = fullAccess ? requested : {};
  const useAesen = aesenCatalogEnabled();
  const [published, labels, aesen] = await Promise.all([
    publishedSkdInstitutions(sb, fromSumopod),
    filters.education ? approvedEducationLabels(sb, filters.education, fromSumopod) : [],
    useAesen ? getAesenMetadata() : null,
  ]);
  const publishedKeys = new Set([...published].map(normalizeSscasnText));
  const catalogInstitutions = aesen?.institutions ?? institutions;
  const levels = new Map(catalogInstitutions.map(({ name, level }) => [name, level]));
  const skdOnly = Boolean(filters.hasSkd || filters.formationType);
  const sortByCutoff = filters.sort === "cutoff_desc";
  const scopedLinks =
    skdOnly || sortByCutoff
      ? await catalogLinks(sb, useAesen, { institution: filters.institution }, fromSumopod)
      : null;
  const sourceIds =
    skdOnly && scopedLinks
      ? [...scopedLinks]
          .filter(
            ([, skd]) =>
              !filters.formationType || sameText(skd.formationType, filters.formationType),
          )
          .map(([id]) => id)
      : undefined;
  const cutoffOrder =
    sortByCutoff && scopedLinks
      ? [...scopedLinks]
          .filter(([, skd]) => skd.cutoff != null)
          .sort(([idA, a], [idB, b]) => (b.cutoff ?? 0) - (a.cutoff ?? 0) || idA.localeCompare(idB))
          .map(([id]) => id)
      : undefined;
  let rows: AesenFormation[];
  let pagination: CatalogResponse["pagination"];
  if (!fullAccess) {
    const fromAesen =
      aesen &&
      new Map(
        (await getAesenFormationsByIds(preview.map(({ id }) => id))).map((row) => [row.id, row]),
      );
    rows = fromAesen ? preview.flatMap(({ id }) => fromAesen.get(id) ?? []) : preview;
    pagination = planCatalogPage(rows.length, 1, PREVIEW_SIZE);
  } else if (useAesen) {
    pagination = planCatalogPage(
      await countAesenFormations(filters, labels, sourceIds),
      filters.page,
    );
    rows = await listAesenFormations(
      filters,
      labels,
      { sourceIds, cutoffOrder },
      (pagination.page - 1) * PAGE_SIZE,
      PAGE_SIZE,
    );
  } else {
    const pilotRows = filterPilot(filters, labels, sourceIds);
    if (cutoffOrder?.length) {
      const ranks = new Map(cutoffOrder.map((id, index) => [id, index]));
      pilotRows.sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
    }
    pagination = planCatalogPage(pilotRows.length, filters.page);
    rows = pilotRows.slice((pagination.page - 1) * PAGE_SIZE, pagination.page * PAGE_SIZE);
  }
  // Ordinary catalogue requests validate only links for the rows on this page.
  const [links, categories] = await Promise.all([
    scopedLinks ?? catalogLinks(sb, useAesen, { rows }, fromSumopod),
    useAesen ? getAesenCategoryLabels(rows.map(({ id }) => id)) : new Map<string, string>(),
  ]);
  return {
    access: fullAccess ? "full" : "preview",
    year: catalogYear,
    catalogTotal: aesen?.total ?? formations.length,
    institutions: catalogInstitutions,
    formations: rows.map((row) =>
      aesenToCatalog(
        { ...row, category: categories.get(row.id) },
        levels.get(row.institution) ?? null,
        publishedKeys.has(normalizeSscasnText(row.institution)),
        links.get(row.id),
      ),
    ),
    pagination,
  };
}
