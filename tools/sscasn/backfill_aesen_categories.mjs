import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import pg from "pg";
import { aesenConnection } from "../../src/server/aesenConnection.ts";
import { normalizeSscasnText as norm, sscasnEducationKey } from "../../src/lib/sscasn.ts";

const API = "https://api-sscasn.vercel.app/api/formasi";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BATCH = 1500;

function identityMatches(row, source) {
  return (
    row.source_id === source.formasi_id &&
    norm(row.institution) === norm(source.ins_nm) &&
    norm(row.job) === norm(source.jabatan_nm) &&
    norm(row.location) === norm(source.lokasi_nm) &&
    sscasnEducationKey(row.education) === sscasnEducationKey(source.pendidikan_nm) &&
    row.quota === Number(source.jumlah_formasi)
  );
}

function categoryRow(row, source, evidence) {
  const category = source.formasi_nm?.trim();
  const rawCode = String(source.jenis_formasi_id ?? "").trim();
  if (!category || !/^\d+(?:\.0+)?$/.test(rawCode) || !identityMatches(row, source)) return null;
  if (
    evidence === "detail_api" &&
    (source.jumlah_ms == null ||
      source.jumlah_ms === "" ||
      Number(source.jumlah_ms) !== row.passed_admin)
  )
    return null;
  return {
    source_id: row.source_id,
    category_code: rawCode.split(".")[0],
    category,
    evidence_source: evidence,
    verified_registered: evidence === "detail_api" ? row.passed_admin : null,
  };
}

async function store(client, rows) {
  if (!rows.length) return;
  await client.query(
    `insert into aesen.formation_categories
    (source_id, category_code, category, evidence_source, verified_registered)
    select * from jsonb_to_recordset($1::jsonb) as incoming (
      source_id text, category_code text, category text, evidence_source text, verified_registered integer
    ) on conflict (source_id) do update set category_code=excluded.category_code,
      category=excluded.category, evidence_source=excluded.evidence_source,
      verified_registered=excluded.verified_registered, checked_at=now()
    where excluded.evidence_source = 'detail_api' or aesen.formation_categories.evidence_source = 'archive'`,
    [JSON.stringify(rows)],
  );
}

async function seedArchive(client, archivePath) {
  const legacy = new DatabaseSync(archivePath, { readOnly: true });
  try {
    const lookup = legacy.prepare(`select formasi_id, ins_nm, jabatan_nm, lokasi_nm, pendidikan_nm,
      jumlah_formasi, formasi_nm, jenis_formasi_id from formasi where formasi_id=?`);
    let lastId = "";
    let seeded = 0;
    for (;;) {
      const { rows } = await client.query(
        `select f.source_id, institution, job, location, education, quota, passed_admin
        from aesen.formations f where f.source_id > $1 order by f.source_id limit $2`,
        [lastId, BATCH],
      );
      if (!rows.length) break;
      const matches = rows.flatMap((row) => {
        const source = lookup.get(row.source_id);
        return source ? (categoryRow(row, source, "archive") ?? []) : [];
      });
      await store(client, matches);
      seeded += matches.length;
      lastId = rows.at(-1).source_id;
    }
    console.log(`${seeded} kategori arsip cocok menurut ID dan kolom formasi.`);
  } finally {
    legacy.close();
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      archive: { type: "string" },
      "archive-only": { type: "boolean" },
      "verify-zero": { type: "string" },
      priority: { type: "string" },
      "detail-all": { type: "boolean" },
      "max-detail": { type: "string" },
      output: { type: "string", default: "data/staging/sscasn/category-backfill.json" },
    },
  });
  const url = process.env.AESEN_DATABASE_URL;
  if (!url) throw new Error("Isi AESEN_DATABASE_URL sebelum menjalankan backfill.");
  const limit = values["max-detail"] === undefined ? Infinity : Number(values["max-detail"]);
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 0))
    throw new Error("Nilai --max-detail tidak valid.");
  const priority = values.priority
    ? JSON.parse(await readFile(values.priority, "utf8")).priorityIds
    : [];
  if (!Array.isArray(priority) || priority.some((id) => typeof id !== "string" || !id))
    throw new Error("Daftar ID prioritas tidak valid.");
  const client = new pg.Client({ ...aesenConnection(url), query_timeout: 25_000 });
  try {
    await client.connect();
    await client.query(await readFile(new URL("./aesen_categories.sql", import.meta.url), "utf8"));
    if (values.archive) await seedArchive(client, values.archive);
    const zero = values["verify-zero"] ?? "";
    const { rows } = await client.query(
      `select f.source_id, institution, job, location, education, quota, passed_admin
      from aesen.formations f left join aesen.formation_categories c using(source_id)
      where ($1 = '' and (c.source_id is null or ($2 and c.evidence_source <> 'detail_api')
        or (f.source_id = any($3::text[]) and passed_admin = 0 and
          (c.evidence_source <> 'detail_api' or c.verified_registered is distinct from 0))))
         or ($1 <> '' and institution = $1 and passed_admin = 0 and c.verified_registered is null)
      order by (f.source_id = any($3::text[])) desc, f.source_id`,
      [zero, Boolean(values["detail-all"]), priority],
    );
    let attempted = 0;
    let stored = 0;
    const unresolved = [];
    let batch = [];
    let flush = Promise.resolve();
    let rateLimited = false;
    if (!values["archive-only"]) {
      console.log(`${rows.length} ID perlu API detail.`);
      const queue = rows.slice(0, limit);
      let cursor = 0;
      let nextStart = 0;
      let cooldown = 0;
      let throttles = 0;
      async function waitForSlot() {
        while (!rateLimited) {
          const wait = Math.max(nextStart, cooldown) - Date.now();
          if (wait > 0) await sleep(wait);
          else {
            nextStart = Date.now() + 500;
            return true;
          }
        }
        return false;
      }
      function flushBatch() {
        const pending = batch;
        batch = [];
        flush = flush.then(async () => {
          await store(client, pending);
          stored += pending.length;
        });
        return flush;
      }
      // A shared start rate lets network latency overlap without increasing load.
      async function worker() {
        while (!rateLimited && cursor < queue.length) {
          const row = queue[cursor++];
          let item;
          for (let attempt = 0; attempt < 3 && (await waitForSlot()); attempt++) {
            try {
              const result = await fetch(`${API}/${encodeURIComponent(row.source_id)}`, {
                signal: AbortSignal.timeout(15_000),
              });
              const json = await result.json().catch(() => null);
              if (result.status === 429 || Number(json?.code) === 429) {
                if (++throttles >= 3) rateLimited = true;
                const retry = Number(result.headers.get("retry-after"));
                cooldown = Math.max(
                  cooldown,
                  Date.now() +
                    Math.max(Number.isFinite(retry) ? retry * 1000 : 0, 30_000 * throttles),
                );
                continue;
              }
              if (!result.ok || !json?.data) {
                if (result.status >= 500 && attempt < 2) {
                  await sleep(1200 * (attempt + 1));
                  continue;
                }
                break;
              }
              item = categoryRow(row, json.data, "detail_api");
              break;
            } catch {
              if (attempt < 2) await sleep(1200 * (attempt + 1));
            }
          }
          attempted++;
          if (item) batch.push(item);
          else unresolved.push(row.source_id);
          if (batch.length >= 20) await flushBatch();
          if (attempted % 100 === 0)
            console.log(`Detail: ${attempted} dicoba, ${attempted - unresolved.length} cocok.`);
        }
      }
      await Promise.all(Array.from({ length: 3 }, worker));
      await flushBatch();
    }
    const {
      rows: [summary],
    } = await client.query(`select count(*)::int total, count(c.source_id)::int enriched,
      count(*) filter(where evidence_source = 'detail_api')::int detail_verified,
      count(*) filter(where evidence_source = 'archive')::int archive_verified
      from aesen.formations f left join aesen.formation_categories c using(source_id)`);
    const report = {
      ...summary,
      attempted,
      stored,
      unresolved,
      rateLimited,
      institution: zero || null,
    };
    await mkdir(path.dirname(values.output), { recursive: true });
    await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ ...report, unresolved: unresolved.length }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.code ? `Backfill gagal (${error.code}).` : error.message);
  process.exitCode = 1;
});
