import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";
import pg from "pg";
import { aesenConnection } from "../../src/server/aesenConnection.ts";
import { transferSchema } from "./sumopod_transfer_schema.mjs";

const { PGlite } = await import(
  process.env.SKD_PGLITE_MODULE
    ? pathToFileURL(process.env.SKD_PGLITE_MODULE).href
    : "@electric-sql/pglite"
);
assert(
  process.env.SKD_DATABASE_URL && process.argv[2],
  "Database URL and archive directory required.",
);
const archiveDir = path.resolve(process.argv[2]);
const manifest = JSON.parse(await readFile(path.join(archiveDir, "manifest.json"), "utf8"));
assert(manifest.integrityVerified && manifest.table === "public.skd_scores");
const scratchRoot = await realpath(path.resolve("output/skd-transfer"));
const scratchDir = await realpath(await mkdtemp(path.join(scratchRoot, "score-restore-")));
assert.equal(path.dirname(scratchDir), scratchRoot);
assert(path.basename(scratchDir).startsWith("score-restore-"));
const source = new pg.Client({
  ...aesenConnection(process.env.SKD_DATABASE_URL),
  query_timeout: 30_000,
});
let restored;

try {
  restored = await PGlite.create(scratchDir);
  await restored.exec(await transferSchema());
  await restored.exec("set time zone 'UTC'");
  await source.connect();
  await source.query("begin isolation level repeatable read read only");
  const {
    rows: [marker],
  } = await source.query("select to_regclass('skd_transfer.checkpoints') is not null as migrated");
  assert(marker.migrated, "Unexpected database.");
  for (const table of ["skd_batches", "skd_sources", "skd_formations"]) {
    let previous = null;
    for (;;) {
      const { rows } = await source.query(
        `select id,to_jsonb(r)::text as document from public.${table} r
          where ($1::uuid is null or id>$1) order by id limit 2000`,
        [previous],
      );
      if (!rows.length) break;
      await restored.query(
        `insert into public.${table} select * from jsonb_populate_recordset(null::public.${table},$1::jsonb)`,
        ["[" + rows.map(({ document }) => document).join(",") + "]"],
      );
      previous = rows.at(-1).id;
      if (rows.length < 2000) break;
    }
  }
  await source.query("commit");

  const archive = path.join(archiveDir, "skd_scores.jsonl.gz");
  const archivedSha = createHash("sha256");
  const sourceDigest = createHash("sha256");
  let count = 0;
  let chunk = [];
  const flush = async () => {
    if (!chunk.length) return;
    await restored.query(
      "insert into public.skd_scores select * from jsonb_populate_recordset(null::public.skd_scores,$1::jsonb)",
      ["[" + chunk.join(",") + "]"],
    );
    count += chunk.length;
    chunk = [];
  };
  const input = createReadStream(archive).pipe(createGunzip());
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    archivedSha.update(line + "\n");
    sourceDigest.update(createHash("sha256").update(line).digest("hex"));
    chunk.push(line);
    if (chunk.length === 1000) await flush();
  }
  await flush();
  assert.equal(count, manifest.rowCount);
  assert.equal(archivedSha.digest("hex"), manifest.uncompressedSha256);
  const expectedFingerprint = sourceDigest.digest("hex");
  const {
    rows: [verification],
  } = await restored.query(
    `select count(*)::int as rows,
      encode(sha256(convert_to(string_agg(
        encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex'), '' order by s.id
      ),'UTF8')),'hex') as fingerprint
    from public.skd_scores s`,
  );
  assert.equal(verification.rows, manifest.rowCount);
  assert.equal(verification.fingerprint, expectedFingerprint);
  await writeFile(
    path.join(archiveDir, "restore-report.json"),
    JSON.stringify(
      {
        ...verification,
        archiveSha256: manifest.uncompressedSha256,
        checkedAt: new Date().toISOString(),
        foreignKeysAndChecksEnforced: true,
        restorationTested: true,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(JSON.stringify({ ...verification, restorationTested: true }));
} finally {
  try {
    await source.end();
    await restored?.close();
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}
