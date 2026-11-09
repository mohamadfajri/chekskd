import { readFile } from "node:fs/promises";

const functions = [
  ["20260820181204_optimize_public_name_only_search.sql", ["api_private.search_public_skd_scores"]],
  ["20260820175507_route_public_search_through_private_function.sql", ["public.search_public_skd_scores"]],
  ["20260810073455_add_skd_rationalization_foundation.sql", ["public.get_skd_rationalization"]],
  ["20260810150545_add_top_recommendations.sql", ["public.skd_position_keywords"]],
  ["20260823090000_add_personalized_rationalization_v6.sql", [
    "public.skd_canonical_education", "public.skd_education_matches", "public.skd_position_families",
  ]],
  ["20260823124349_optimize_rationalization_v6_queries.sql", [
    "public.search_skd_target_formations", "public.get_skd_rationalization_v6",
  ]],
  ["20261012090000_add_sscasn_catalog.sql", ["public.get_approved_sscasn_context"]],
];

function functionDdl(sql, name) {
  const start = new RegExp(`create (?:or replace )?function ${name.replace(".", "\\.")}\\s*\\(`, "i").exec(sql);
  const end = start && sql.indexOf("\n$$;", start.index);
  if (!start || end < 0) throw new Error(`Definisi fungsi ${name} tidak ditemukan.`);
  return sql.slice(start.index, end + 4);
}

export async function installSkdReadFunctions(db) {
  await db.query("create schema if not exists api_private");
  await db.query("revoke all on schema api_private from public");
  for (const [file, names] of functions) {
    const sql = await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8");
    for (const name of names) {
      let ddl = functionDdl(sql, name);
      if (name === "api_private.search_public_skd_scores") {
        // Match the ordering verified against Supabase rather than the host's default locale.
        ddl = ddl.replace(/s\.nama_normalized,(\s+)s\.no_peserta(?=\s*(?:limit|;))/gi,
          's.nama_normalized collate pg_catalog."C",$1s.no_peserta collate pg_catalog."C"')
          .replace("security definer", "security invoker");
      }
      await db.query(ddl);
      await db.query(`revoke all on function ${name} from public`);
    }
  }
}
