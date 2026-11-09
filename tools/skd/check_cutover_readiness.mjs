import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { aesenConnection } from "../../src/server/aesenConnection.ts";
import { tables } from "./sumopod_transfer_schema.mjs";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const targetUrl = process.env.SKD_DATABASE_URL;
if (!url || !key || !targetUrl) throw new Error("Koneksi sumber dan tujuan belum lengkap.");
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const db = new pg.Client({ ...aesenConnection(targetUrl), query_timeout: 30_000 });
const batchFields = "id,status,updated_at,participant_count,formation_count,review_issue_count";

async function countSource(table, filter = (query) => query) {
  const { count, error } = await filter(sb.from(table).select("*", { count: "exact", head: true }))
    .abortSignal(AbortSignal.timeout(30_000));
  if (error || count == null) throw new Error(`Jumlah ${table} belum bisa dibaca (${error?.code ?? "-"}).`);
  return count;
}

const compared = [];
let batchChanges;
await db.connect();
try {
  await db.query("begin read only");
  const { rows: [marker] } = await db.query(
    "select to_regclass('skd_transfer.checkpoints') is not null as migrated",
  );
  if (!marker.migrated) throw new Error("Tujuan bukan database salinan SKD.");
  for (const [name] of tables) {
    const source = await countSource(name);
    const { rows: [{ count: destination }] } = await db.query(`select count(*)::int as count from public.${name}`);
    compared.push({ table: name, source, destination, matches: source === destination });
  }
  const { data, error } = await sb.from("skd_batches").select(batchFields).order("id")
    .abortSignal(AbortSignal.timeout(30_000));
  if (error) throw new Error(`Status batch belum dapat dibandingkan (${error.code}).`);
  const { rows } = await db.query(`select to_jsonb(b) as batch from (select ${batchFields}
    from public.skd_batches) b order by b.id`);
  const fingerprint = (batch) => JSON.stringify([
    batch.status, batch.updated_at.replace(/\+00:00$/, "Z"), batch.participant_count,
    batch.formation_count, batch.review_issue_count,
  ]);
  const sourceBatches = new Map(data.map((batch) => [batch.id, fingerprint(batch)]));
  const targetBatches = new Map(rows.map(({ batch }) => [batch.id, fingerprint(batch)]));
  batchChanges = [...new Set([...sourceBatches.keys(), ...targetBatches.keys()])]
    .filter((id) => sourceBatches.get(id) !== targetBatches.get(id)).length;
} finally {
  await db.query("rollback").catch(() => {});
  await db.end().catch(() => {});
}

const now = new Date().toISOString();
const sourceDependencies = {
  leadsLinkedToScores: await countSource("leads", (q) => q.not("score_id", "is", null)),
  sessionsLinkedToScores: await countSource("result_sessions", (q) => q.not("score_id", "is", null)),
  waitingOrActiveCodes: await countSource("result_sessions",
    (q) => q.gt("expired_at", now).in("status", ["waiting", "queued", "processing", "ready"])),
  queuedOrProcessingJobs: await countSource("skd_analysis_jobs", (q) => q.in("status", ["queued", "processing"])),
};
const report = {
  checkedAt: now,
  scope: "Read-only count and batch status comparison; not a data backup or authorization to delete.",
  compared,
  batchChanges,
  sourceDependencies,
  readyForDeletion: false,
  reason: "Production search, administration and WhatsApp queue still depend on Supabase SKD.",
};
const directory = path.resolve("output/skd-transfer");
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, "cutover-preflight.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({
  matchingTables: compared.filter((row) => row.matches).length,
  totalTables: compared.length, batchChanges, sourceDependencies, readyForDeletion: false,
}));
