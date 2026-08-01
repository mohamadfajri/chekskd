import fs from "node:fs";
import Papa from "papaparse";

const inputPath = process.argv[2] ?? "data/staging/kemenhub-2024-v3-staging.csv";
const baseUrl = (process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:4175").replace(/\/$/, "");
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminPassword) throw new Error("ADMIN_PASSWORD wajib tersedia di environment.");
if (!fs.existsSync(inputPath)) throw new Error(`CSV tidak ditemukan: ${inputPath}`);

const parsed = Papa.parse(fs.readFileSync(inputPath, "utf8"), {
  header: true,
  skipEmptyLines: true,
});
if (parsed.errors.length) throw new Error(parsed.errors[0].message);

const rows = parsed.data;
if (!rows.length) throw new Error("CSV kosong.");

function integer(value) {
  if (value == null || String(value).trim() === "") return null;
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) ? parsedValue : null;
}

function slugPart(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function post(body) {
  const response = await fetch(`${baseUrl}/api/admin/skd-batches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, adminPassword }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.message ?? `HTTP ${response.status}`);
  return result;
}

const first = rows[0];
const slug = slugPart(
  `${first.kode_instansi || first.nama_instansi}-${first.tahun}-v${first.parser_version}`,
);
const created = await post({
  action: "create",
  batch: {
    slug,
    institutionCode: first.kode_instansi,
    institutionName: first.nama_instansi,
    selectionYear: integer(first.tahun),
    parserFamily: first.parser_family,
    parserVersion: first.parser_version,
    sourcePageCount: integer(first.source_total_pages),
  },
  source: {
    sheetRow: integer(first.source_sheet_row),
    fileName: first.source_pdf,
    driveFileId: first.source_drive_file_id,
    sourceUrl: first.source_url,
    totalPages: integer(first.source_total_pages),
    documentType: "skd",
    hasTextLayer: true,
  },
});

const formationRows = [...new Map(rows.map((row) => [row.formation_instance_id, row])).values()];
const participantRows = rows.filter(
  (row) => (row.record_type?.trim().toLowerCase() || "participant") === "participant",
);

let formations = 0;
let scores = 0;
let issues = 0;
for (const rowsChunk of chunk(formationRows, 300)) {
  const result = await post({
    action: "import_formations",
    batchId: created.batchId,
    sourceId: created.sourceId,
    rows: rowsChunk,
  });
  formations += result.formationsUpserted ?? 0;
  issues += result.issuesCreated ?? 0;
}

for (const rowsChunk of chunk(participantRows, 300)) {
  const result = await post({
    action: "import_scores",
    batchId: created.batchId,
    sourceId: created.sourceId,
    rows: rowsChunk,
  });
  scores += result.scoresUpserted ?? 0;
  issues += result.issuesCreated ?? 0;
  process.stdout.write(`\rStaging peserta: ${scores}/${participantRows.length}`);
}

const final = await post({
  action: "finalize",
  batchId: created.batchId,
  sourceId: created.sourceId,
});

process.stdout.write("\n");
console.log(
  JSON.stringify(
    {
      batchId: created.batchId,
      slug,
      formations,
      scores,
      issues,
      status: "review",
      final,
    },
    null,
    2,
  ),
);
