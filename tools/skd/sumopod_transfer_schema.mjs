import { readFile } from "node:fs/promises";

const sql = (file) => readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8");
function section(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error("Bagian schema sumber tidak dikenali.");
  return text.slice(from, to);
}

export const tables = [
  ["skd_batches", ["id"], "Batch SKD"],
  ["skd_sources", ["id"], "Referensi PDF"],
  ["skd_formations", ["id"], "Formasi SKD"],
  ["skd_scores", ["id"], "Nilai peserta"],
  ["skd_review_issues", ["id"], "Isu review"],
  ["skd_formation_stats", ["formation_id"], "Statistik formasi"],
  ["skd_education_aliases", ["normalized_label"], "Alias pendidikan"],
  ["sscasn_snapshots", ["id"], "Riwayat katalog untuk audit"],
  ["sscasn_formations", ["snapshot_id", "source_id"], "Referensi pasangan SSCASN"],
  ["sscasn_institutions", ["snapshot_id", "institution"], "Instansi untuk audit"],
  ["sscasn_matches", ["formation_id"], "Hasil audit pasangan"],
];

export async function transferSchema() {
  const base = await sql("20260731000100_rebuild_skd_data_foundation.sql");
  const stats = await sql("20260810073455_add_skd_rationalization_foundation.sql");
  const education = await sql("20260823090000_add_personalized_rationalization_v6.sql");
  const match = await sql("20261012090000_add_sscasn_catalog.sql");
  return [
    section(base, "create table public.skd_batches", "create table public.leads"),
    await sql("20260804141309_allow_local_skd_sources.sql"),
    section(stats, "create table public.skd_formation_stats", "alter table public.skd_formation_stats enable"),
    section(education, "create table if not exists public.skd_education_aliases", "alter table public.skd_education_aliases enable"),
    section(match, "create table public.sscasn_snapshots", "create or replace function public.get_approved_sscasn_context"),
    ...tables.map(([table]) => `revoke all on table public.${table} from public;`),
  ].join("\n");
}

export async function transferIndexes() {
  const base = await sql("20260731000100_rebuild_skd_data_foundation.sql");
  const extra = await sql("20260731000200_harden_archive_and_indexes.sql");
  const search = await sql("20260820173434_optimize_public_skd_search.sql");
  const prefix = await sql("20260820180242_optimize_public_name_search_ranking.sql");
  const explorer = await sql("20260821042902_add_public_formation_explorer.sql");
  const rank = await sql("20260823124349_optimize_rationalization_v6_queries.sql");
  return [
    section(base, "create index skd_batches_status_idx", "create trigger skd_batches_set_updated_at"),
    ...extra.match(/create index skd_[^;]+;/g),
    section(search, "create index if not exists", "drop policy"),
    section(prefix, "create index if not exists", "create or replace function"),
    section(explorer, "create index if not exists", "create or replace function"),
    section(rank, "create index if not exists", "create or replace function"),
  ].join("\n").replace(/\b(?:extensions\.)?gin_trgm_ops\b/g, "public.gin_trgm_ops")
    .replace(/create index (?!if not exists\b)/g, "create index if not exists ")
    .split(";").map((item) => item.trim()).filter(Boolean);
}
