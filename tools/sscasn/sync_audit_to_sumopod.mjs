import assert from "node:assert/strict";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { aesenConnection } from "../../src/server/aesenConnection.ts";
import { withSscasnApprovalLock } from "../../src/server/sscasnApproval.ts";

const apply = process.argv.slice(2).includes("--apply");
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const destination = process.env.SKD_DATABASE_URL;
assert(url && key && destination, "Supabase or SumoPod configuration missing");
const sb = createClient(url, key, { auth: { persistSession: false } });
const db = new pg.Client({ ...aesenConnection(destination), query_timeout: 25_000 });
const tables = [
  ["sscasn_snapshots", ["id"]],
  ["sscasn_formations", ["snapshot_id", "source_id"]],
  ["sscasn_institutions", ["snapshot_id", "institution"]],
  ["sscasn_matches", ["formation_id"]],
];
const pageSize = 500;
const timestamps = new Set(["captured_at", "created_at", "reviewed_at"]);
const indexKey = (row, columns) => JSON.stringify(columns.map((name) => row[name]));
const fingerprint = (row) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(row)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, value]) => [
          name,
          timestamps.has(name) && typeof value === "string" ? value.replace(/Z$/, "+00:00") : value,
        ]),
    ),
  );

async function fromSupabase(table, columns) {
  const rows = [];
  for (let start = 0; ; start += pageSize) {
    let query = sb.from(table).select("*");
    for (const column of columns) query = query.order(column);
    const { data, error } = await query
      .range(start, start + pageSize - 1)
      .abortSignal(AbortSignal.timeout(20000));
    if (error) throw new Error(`Supabase ${table}: ${error.code}`);
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

try {
  await db.connect();
  const counts = await withSscasnApprovalLock(async () => {
    await db.query("begin");
    await db.query("set local time zone 'UTC'; set local lock_timeout = '5s'");
    const {
      rows: [marker],
    } = await db.query("select to_regclass('skd_transfer.checkpoints') is not null as migrated");
    assert(marker.migrated, "Target is not the SumoPod SKD database");
    if (apply)
      await db.query(
        `lock table ${tables.map(([name]) => `public.${name}`).join(", ")} in share row exclusive mode`,
      );
    const checked = [];
    for (const [table, columns] of tables) {
      const source = await fromSupabase(table, columns);
      const sourceIndex = new Map(source.map((row) => [indexKey(row, columns), fingerprint(row)]));
      const { rows: destinationRows } = await db.query(
        `select to_jsonb(t) as value from public.${table} t`,
      );
      const existing = new Set();
      for (const { value } of destinationRows) {
        const id = indexKey(value, columns);
        if (sourceIndex.get(id) !== fingerprint(value)) {
          throw new Error(
            `${table}: target has a conflicting or target-only row; nothing overwritten`,
          );
        }
        existing.add(id);
      }
      const missing = source.filter((row) => !existing.has(indexKey(row, columns)));
      if (apply) {
        for (let offset = 0; offset < missing.length; offset += pageSize) {
          const chunk = missing.slice(offset, offset + pageSize);
          const inserted = await db.query(
            `insert into public.${table} select * from jsonb_populate_recordset(null::public.${table},$1)`,
            [JSON.stringify(chunk)],
          );
          assert.equal(inserted.rowCount, chunk.length);
        }
        const { rows: confirmed } = await db.query(
          `select to_jsonb(t) as value from public.${table} t`,
        );
        assert.equal(confirmed.length, source.length);
        assert(
          confirmed.every(
            ({ value }) => sourceIndex.get(indexKey(value, columns)) === fingerprint(value),
          ),
        );
      }
      checked.push({
        table,
        source: source.length,
        existing: existing.size,
        missing: missing.length,
      });
    }
    await db.query(apply ? "commit" : "rollback");
    return checked;
  });
  console.log(JSON.stringify({ applied: apply, counts }));
} catch (error) {
  await db.query("rollback").catch(() => {});
  console.error("Audit sync stopped:", error.code ?? error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
