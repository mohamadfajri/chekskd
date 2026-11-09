import { readFile } from "node:fs/promises";

const readFunctions = [
  ["20260820181204_optimize_public_name_only_search.sql", ["api_private.search_public_skd_scores"]],
  [
    "20260820175507_route_public_search_through_private_function.sql",
    ["public.search_public_skd_scores"],
  ],
  ["20260810073455_add_skd_rationalization_foundation.sql", ["public.get_skd_rationalization"]],
  ["20260810150545_add_top_recommendations.sql", ["public.skd_position_keywords"]],
  [
    "20260823090000_add_personalized_rationalization_v6.sql",
    [
      "public.skd_canonical_education",
      "public.skd_education_matches",
      "public.skd_position_families",
    ],
  ],
  [
    "20260823124349_optimize_rationalization_v6_queries.sql",
    ["public.search_skd_target_formations", "public.get_skd_rationalization_v6"],
  ],
  [
    "20260824011216_improve_formation_filter_options.sql",
    ["api_private.search_public_skd_formations"],
  ],
  [
    "20260821055416_add_public_formation_detail.sql",
    ["api_private.get_public_skd_formation_detail"],
  ],
  [
    "20260824103751_add_education_aliases_to_filter_options.sql",
    ["api_private.get_skd_formation_filter_options"],
  ],
  ["20261012090000_add_sscasn_catalog.sql", ["public.get_approved_sscasn_context"]],
];

const adminFunctions = [
  ["20260731000100_rebuild_skd_data_foundation.sql", ["private.set_updated_at"]],
  ["20261109092000_optimize_skd_publication_stats.sql", ["private.refresh_skd_formation_stats"]],
  [
    "20260810073455_add_skd_rationalization_foundation.sql",
    ["private.refresh_skd_formation_stats_after_publish"],
  ],
  ["20260804134220_bulk_verify_skd_batch.sql", ["public.bulk_verify_skd_batch"]],
  ["20261109091000_add_skd_bulk_verify_step.sql", ["public.bulk_verify_skd_batch_step"]],
  ["20260809080529_publish_skd_batch.sql", ["public.publish_skd_batch"]],
];

function functionDdl(sql, name) {
  const start = new RegExp(
    `create (?:or replace )?function ${name.replace(".", "\\.")}\\s*\\(`,
    "i",
  ).exec(sql);
  const end = start && sql.indexOf("\n$$;", start.index);
  if (!start || end < 0) throw new Error(`Definisi fungsi ${name} tidak ditemukan.`);
  return sql.slice(start.index, end + 4);
}

async function installFunctions(db, functions) {
  for (const [file, names] of functions) {
    const sql = await readFile(
      new URL(`../../supabase/migrations/${file}`, import.meta.url),
      "utf8",
    );
    for (const name of names) {
      let ddl = functionDdl(sql, name).replace(/^create function\b/i, "create or replace function");
      if (name === "api_private.search_public_skd_scores") {
        // Match the ordering verified against Supabase rather than the host's default locale.
        ddl = ddl.replace(
          /s\.nama_normalized,(\s+)s\.no_peserta(?=\s*(?:limit|;))/gi,
          's.nama_normalized collate pg_catalog."C",$1s.no_peserta collate pg_catalog."C"',
        );
      }
      if (name.startsWith("api_private.")) {
        ddl = ddl.replace("security definer", "security invoker");
      }
      await db.query(ddl);
      await db.query(`revoke all on function ${name} from public`);
    }
  }
}

export async function installSkdReadFunctions(db) {
  await db.query("create schema if not exists api_private");
  await db.query("revoke all on schema api_private from public");
  await installFunctions(db, readFunctions);
}

export async function installSkdAdminFunctions(db) {
  await db.query("create schema if not exists private");
  await db.query("revoke all on schema private from public");
  await installFunctions(db, adminFunctions);
  await db.query(
    "alter function public.bulk_verify_skd_batch(uuid, text) set statement_timeout = '45s'",
  );
  await db.query("alter function public.publish_skd_batch(uuid) set statement_timeout = '45s'");
  for (const table of ["skd_batches", "skd_formations", "skd_scores", "skd_review_issues"]) {
    await db.query(`create or replace trigger ${table}_set_updated_at
      before update on public.${table} for each row execute function private.set_updated_at()`);
  }
  await db.query(`create or replace trigger skd_batches_refresh_rationalization_stats
    after update of status on public.skd_batches for each row
    when (new.status = 'published' and old.status is distinct from new.status)
    execute function private.refresh_skd_formation_stats_after_publish()`);
}
