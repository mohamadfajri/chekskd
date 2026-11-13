import pg from "pg";
import { createHash } from "node:crypto";
import {
  CATALOG_COMPETITION_BOUNDS,
  normalizeCatalogSearch,
  type CatalogFilters,
  type CatalogFormation,
  type CatalogResponse,
} from "../lib/formationCatalog.ts";
import { aesenConnection } from "./aesenConnection.ts";

export type AesenFormation = Pick<
  CatalogFormation,
  | "id"
  | "institution"
  | "job"
  | "location"
  | "education"
  | "category"
  | "quota"
  | "passedAdmin"
  | "salaryMin"
  | "salaryMax"
>;

type AesenMetadata = { total: number; institutions: CatalogResponse["institutions"] };
interface AesenSelection {
  sourceIds?: string[];
  cutoffOrder?: string[];
}
const FIELDS = `f.source_id as id, f.institution, f.job, f.location, f.education,
  f.quota, f.passed_admin as "passedAdmin", f.salary_min as "salaryMin", f.salary_max as "salaryMax"`;

let pool: pg.Pool | undefined;
let metadata: { expiresAt: number; data: Promise<AesenMetadata> } | undefined;
let educationKeys: { expiresAt: number; data: Promise<string[]> } | undefined;
let jobNames: { expiresAt: number; data: Promise<string[]> } | undefined;
const totals = new Map<string, { expiresAt: number; data: Promise<number> }>();

export function aesenCatalogEnabled(): boolean {
  return Boolean(process.env.AESEN_DATABASE_URL?.trim());
}

function catalogPool() {
  if (!pool) {
    const url = process.env.AESEN_DATABASE_URL;
    if (!url) throw new Error("Katalog Aesen belum dikonfigurasi.");
    pool = new pg.Pool({
      ...aesenConnection(url),
      max: 2,
      idleTimeoutMillis: 10_000,
      query_timeout: 7_000,
      allowExitOnIdle: true,
    });
    pool.on("error", () => console.error("aesen_catalog_pool_error"));
  }
  return pool;
}

export function getAesenMetadata(): Promise<AesenMetadata> {
  if (!metadata || metadata.expiresAt <= Date.now()) {
    const data = Promise.all([
      catalogPool().query<{ total: number }>(
        "select row_count as total from aesen.snapshot where selection_year = 2024",
      ),
      catalogPool().query<AesenMetadata["institutions"][number]>(
        "select name, level from aesen.institutions order by name",
      ),
    ]).then(([snapshot, institutions]) => {
      if (!snapshot.rows[0]) throw new Error("Snapshot Aesen belum tersedia.");
      return { total: snapshot.rows[0].total, institutions: institutions.rows };
    });
    metadata = { expiresAt: Date.now() + 5 * 60_000, data };
    void data.catch(() => {
      if (metadata?.data === data) metadata = undefined;
    });
  }
  return metadata.data;
}

export function getAesenEducationKeys(): Promise<string[]> {
  if (!educationKeys || educationKeys.expiresAt <= Date.now()) {
    const data = catalogPool()
      .query<{ key: string }>(
        `select distinct key from aesen.formations
        cross join lateral unnest(education_keys) as education(key)`,
      )
      .then(({ rows }) => rows.map(({ key }) => key));
    educationKeys = { expiresAt: Date.now() + 60 * 60_000, data };
    void data.catch(() => {
      if (educationKeys?.data === data) educationKeys = undefined;
    });
  }
  return educationKeys.data;
}

export async function getAesenFormationsByIds(ids: string[]): Promise<AesenFormation[]> {
  if (!ids.length) return [];
  const { rows } = await catalogPool().query<AesenFormation>(
    `select ${FIELDS} from aesen.formations f where f.source_id = any($1::text[])`,
    [ids],
  );
  return rows;
}

export function getAesenJobNames(): Promise<string[]> {
  if (!jobNames || jobNames.expiresAt <= Date.now()) {
    const data = catalogPool()
      .query<{ job: string }>(
        "select distinct job from aesen.formations where job <> '' order by job",
      )
      .then(({ rows }) => rows.map(({ job }) => job));
    jobNames = { expiresAt: Date.now() + 60 * 60_000, data };
    void data.catch(() => {
      if (jobNames?.data === data) jobNames = undefined;
    });
  }
  return jobNames.data;
}

export async function getFilteredAesenFormationsByIds(
  ids: string[],
  filters: CatalogFilters,
  labels: string[],
): Promise<AesenFormation[]> {
  if (!ids.length) return [];
  const { from, where, args } = aesenFilterQuery({ ...filters, sort: undefined }, labels, {
    sourceIds: ids,
  });
  const { rows } = await catalogPool().query<AesenFormation>(
    `select ${FIELDS} ${from}${where}`,
    args,
  );
  return rows;
}

export async function getAesenCategoryLabels(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  try {
    const { rows } = await catalogPool().query<{ source_id: string; category: string }>(
      "select source_id, category from aesen.formation_categories where source_id = any($1::text[])",
      [ids],
    );
    return new Map(rows.map(({ source_id, category }) => [source_id, category]));
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return new Map();
    throw error;
  }
}

export function aesenFilterQuery(
  filters: CatalogFilters,
  labels: string[],
  selection: AesenSelection = {},
) {
  const args: (string | string[] | number)[] = [];
  const conditions: string[] = [];
  const bind = (value: (typeof args)[number]) => `$${args.push(value)}`;
  if (filters.institution) conditions.push(`f.institution = ${bind(filters.institution)}`);
  if (filters.job) conditions.push(`f.job = ${bind(filters.job)}`);
  if (filters.level) conditions.push(`i.level = ${bind(filters.level)}`);
  if (selection.sourceIds)
    conditions.push(`f.source_id = any(${bind(selection.sourceIds)}::text[])`);
  if (filters.competitionLevel) {
    const [minimum, maximum] = CATALOG_COMPETITION_BOUNDS[filters.competitionLevel];
    conditions.push("f.quota > 0", `f.passed_admin > f.quota::bigint * ${minimum}`);
    if (maximum !== null) conditions.push(`f.passed_admin <= f.quota::bigint * ${maximum}`);
  }
  const words = new Set(
    normalizeCatalogSearch(filters.query ?? "")
      .split(" ")
      .filter(Boolean),
  );
  for (const word of words) conditions.push(`f.search_text like ${bind(`%${word}%`)}`);

  const education = normalizeCatalogSearch(filters.education ?? "");
  if (education) {
    const keys = [...new Set([education, ...labels.map(normalizeCatalogSearch).filter(Boolean)])];
    const exact = `f.education_keys && ${bind(keys)}::text[]`;
    const qualified = /^(?:s[123]|d(?:[1-4]|i{1,3}|iv))\b/.test(education);
    conditions.push(
      qualified
        ? exact
        : `(${exact} or (' ' || array_to_string(f.education_keys, ' / ') || ' ') like ${bind(`% ${education} %`)})`,
    );
  }

  const cutoff =
    filters.sort === "cutoff_desc" && selection.cutoffOrder?.length
      ? ` left join unnest(${bind(selection.cutoffOrder)}::text[]) with ordinality as ranked(source_id, position) on ranked.source_id = f.source_id`
      : "";
  const from = `from aesen.formations f${filters.level ? " join aesen.institutions i on i.name = f.institution" : ""}${cutoff}`;
  const where = conditions.length ? ` where ${conditions.join(" and ")}` : "";
  const byRatio = filters.sort === "competition_asc" || filters.sort === "competition_desc";
  const order = cutoff
    ? "ranked.position nulls last, f.institution, f.job, f.source_id"
    : byRatio
      ? `f.passed_admin::numeric / nullif(f.quota, 0) ${filters.sort === "competition_asc" ? "asc" : "desc"} nulls last, f.source_id`
      : filters.sort === "name_asc"
        ? "f.job, f.source_id"
        : filters.sort === "quota_desc"
          ? "f.quota desc, f.institution, f.job, f.source_id"
          : "f.institution, f.job, f.source_id";
  return { from, where, order, args };
}

export async function countAesenFormations(
  filters: CatalogFilters,
  labels: string[],
  sourceIds?: string[],
): Promise<number> {
  if (sourceIds?.length === 0) return 0;
  const { from, where, args } = aesenFilterQuery(filters, labels, { sourceIds });
  if (!where) return (await getAesenMetadata()).total;
  const sql = `select count(*)::int as count ${from}${where}`;
  const key = createHash("sha256")
    .update(JSON.stringify([sql, args]))
    .digest("hex");
  const existing = totals.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.data;
  if (existing) totals.delete(key);
  if (totals.size >= 128) {
    const oldest = totals.keys().next().value;
    if (oldest !== undefined) totals.delete(oldest);
  }
  const data = catalogPool()
    .query<{ count: number }>(sql, args)
    .then(({ rows }) => rows[0].count);
  totals.set(key, { expiresAt: Date.now() + 60_000, data });
  void data.catch(() => {
    if (totals.get(key)?.data === data) totals.delete(key);
  });
  return data;
}

export async function listAesenFormations(
  filters: CatalogFilters,
  labels: string[],
  selection: AesenSelection,
  offset: number,
  limit: number,
): Promise<AesenFormation[]> {
  if (!limit || selection.sourceIds?.length === 0) return [];
  const { from, where, order, args } = aesenFilterQuery(filters, labels, selection);
  const { rows } = await catalogPool().query<AesenFormation>(
    `select ${FIELDS} ${from}${where} order by ${order} limit $${args.length + 1} offset $${args.length + 2}`,
    [...args, limit, offset],
  );
  return rows;
}
