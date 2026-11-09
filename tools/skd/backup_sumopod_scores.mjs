import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import pg from "pg";
import { aesenConnection } from "../../src/server/aesenConnection.ts";

assert(process.env.SKD_DATABASE_URL, "SKD_DATABASE_URL belum disetel.");
const db = new pg.Client({
  ...aesenConnection(process.env.SKD_DATABASE_URL),
  query_timeout: 30_000,
});
const startedAt = new Date().toISOString();
const directory = path.resolve("output/skd-transfer/backups", startedAt.replaceAll(":", "-"));
const archive = path.join(directory, "skd_scores.jsonl.gz");
const digest = createHash("sha256");
let count = 0;

try {
  await db.connect();
  await db.query("begin isolation level repeatable read read only");
  const {
    rows: [marker],
  } = await db.query("select to_regclass('skd_transfer.checkpoints') is not null as migrated");
  assert(marker.migrated, "Tujuan bukan database SKD SumoPod.");
  const {
    rows: [{ expected }],
  } = await db.query("select count(*)::int as expected from public.skd_scores");
  assert(expected > 0, "Tabel skor kosong.");
  await mkdir(directory, { recursive: true });
  async function* lines() {
    let after = null;
    for (;;) {
      const { rows } = await db.query(
        `select s.id, to_jsonb(s)::text as document from public.skd_scores s
        where ($1::uuid is null or s.id > $1) order by s.id limit 5000`,
        [after],
      );
      if (!rows.length) break;
      for (const row of rows) {
        const line = row.document + "\n";
        digest.update(line);
        yield line;
      }
      count += rows.length;
      after = rows.at(-1).id;
      if (rows.length < 5000) break;
    }
  }
  await pipeline(
    Readable.from(lines()),
    createGzip(),
    createWriteStream(archive, { flags: "wx", mode: 0o600 }),
  );
  assert.equal(count, expected);
  const sha256 = digest.digest("hex");
  await db.query("commit");
  const verification = createHash("sha256");
  const stream = createReadStream(archive).pipe(createGunzip());
  let verifiedCount = 0;
  let previousId = "";
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    const row = JSON.parse(line);
    assert(typeof row.id === "string" && row.id > previousId && row.batch_id && row.formation_id);
    previousId = row.id;
    verification.update(line + "\n");
    verifiedCount++;
  }
  assert.equal(verifiedCount, expected);
  assert.equal(verification.digest("hex"), sha256);
  await writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(
      {
        table: "public.skd_scores",
        format: "gzip JSON Lines",
        startedAt,
        rowCount: verifiedCount,
        uncompressedSha256: sha256,
        integrityVerified: true,
        restorationTested: false,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(JSON.stringify({ archive, rows: verifiedCount, integrityVerified: true }));
} catch (error) {
  await db.query("rollback").catch(() => {});
  console.error("Backup belum terverifikasi:", error.code ?? error.name);
  process.exitCode = 1;
} finally {
  await db.end();
}
