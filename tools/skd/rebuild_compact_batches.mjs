import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";

const auditPath = path.resolve(
  process.argv[2] || "data/raw/skd-rebuild-audit-before.json",
);
const stagingDir = path.resolve("data/staging");
const baseUrl = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:4175";
const dryRun = process.env.DRY_RUN === "1";

function runImporter(csvPath, batchId, sourceId) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["tools/skd/import_staging_csv.mjs", csvPath],
      {
        cwd: process.cwd(),
        stdio: "inherit",
        env: {
          ...process.env,
          ADMIN_BASE_URL: baseUrl,
          REUSE_BATCH_ID: batchId,
          REUSE_SOURCE_ID: sourceId,
          SKIP_FINALIZE: "1",
        },
      },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Importer berhenti dengan exit code ${code}`)),
    );
  });
}

const audit = JSON.parse(await readFile(auditPath, "utf8"));
const sourcesByBatch = new Map(audit.sources.map((source) => [source.batch_id, source]));
const batchesByCode = new Map(
  audit.batches.map((batch) => [String(batch.institution_code), batch]),
);
const entries = (await readdir(stagingDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith("-v3-staging.csv"))
  .sort((left, right) => left.name.localeCompare(right.name));

if (entries.length !== audit.batches.length) {
  throw new Error(`Jumlah CSV ${entries.length} tidak sama dengan batch ${audit.batches.length}.`);
}

for (const [index, entry] of entries.entries()) {
  const csvPath = path.join(stagingDir, entry.name);
  const preview = Papa.parse(await readFile(csvPath, "utf8"), {
    header: true,
    preview: 1,
    skipEmptyLines: true,
  });
  if (preview.errors.length || !preview.data.length) {
    throw new Error(`CSV tidak valid: ${entry.name}`);
  }
  const code = String(preview.data[0].kode_instansi ?? "").trim();
  const batch = batchesByCode.get(code);
  const source = batch ? sourcesByBatch.get(batch.id) : null;
  if (!batch || !source) throw new Error(`Batch/source untuk kode ${code} tidak ditemukan.`);

  console.log(`\n[${index + 1}/${entries.length}] ${code} ${entry.name}`);
  if (!dryRun) await runImporter(csvPath, batch.id, source.id);
}

console.log(
  `\n${dryRun ? "Validasi" : "Reimport"} selesai untuk ${entries.length} batch.`,
);
