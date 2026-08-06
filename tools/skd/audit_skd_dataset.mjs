import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const outputPath = path.resolve(
  process.argv[2] || `data/raw/skd-rebuild-audit-${new Date().toISOString().slice(0, 10)}.json`,
);
const stagingDir = path.resolve("data/staging");
const pageSize = 1000;

if (!url || !key) throw new Error("Supabase URL dan service role/secret key wajib tersedia.");

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function canonical(values) {
  return `${values.map((value) => (value == null ? "" : String(value))).join("\u001f")}\n`;
}

async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) return rows;
  }
}

function summarizeRows(rows, fields) {
  const hash = createHash("sha256");
  const quality = {};
  const status = {};
  let twk = 0;
  let tiu = 0;
  let tkp = 0;
  let total = 0;

  for (const row of rows) {
    hash.update(canonical(fields.map((field) => row[field])));
    quality[row.quality_status ?? ""] = (quality[row.quality_status ?? ""] ?? 0) + 1;
    if ("keterangan" in row) {
      status[row.keterangan ?? ""] = (status[row.keterangan ?? ""] ?? 0) + 1;
      twk += row.twk ?? 0;
      tiu += row.tiu ?? 0;
      tkp += row.tkp ?? 0;
      total += row.total ?? 0;
    }
  }

  return {
    count: rows.length,
    sha256: hash.digest("hex"),
    quality,
    ...(Object.keys(status).length ? { status, sums: { twk, tiu, tkp, total } } : {}),
  };
}

async function main() {
  const { data: batches, error: batchError } = await supabase
    .from("skd_batches")
    .select("*")
    .order("institution_code");
  if (batchError) throw batchError;

  const { data: sources, error: sourceError } = await supabase
    .from("skd_sources")
    .select("*")
    .order("batch_id");
  if (sourceError) throw sourceError;

  const result = {
    generated_at: new Date().toISOString(),
    project_ref: new URL(url).hostname.split(".")[0],
    batches,
    sources,
    batch_audits: [],
    csv_files: [],
  };

  for (const batch of batches ?? []) {
    const formations = await fetchAll(() =>
      supabase
        .from("skd_formations")
        .select(
          "formation_key,tahun,kode_instansi,nama_instansi,kode_jabatan,jabatan,kode_lokasi,lokasi_formasi,kode_jenis_formasi,jenis_formasi,pendidikan,jumlah_formasi,page_number,quality_status,parser_confidence",
        )
        .eq("batch_id", batch.id)
        .order("formation_key"),
    );
    const scores = await fetchAll(() =>
      supabase
        .from("skd_scores")
        .select(
          "no_peserta,nama,nama_raw,nama_normalized,pendidikan,pendidikan_raw,tahun_skd,twk,tiu,tkp,total,keterangan,source_page,quality_status,parser_confidence",
        )
        .eq("batch_id", batch.id)
        .order("no_peserta"),
    );
    const issues = await fetchAll(() =>
      supabase
        .from("skd_review_issues")
        .select(
          "field_name,issue_code,severity,raw_value,suggested_value,confidence,status,resolution_note,resolved_at,skd_scores(no_peserta),skd_formations(formation_key)",
        )
        .eq("batch_id", batch.id)
        .order("created_at"),
    );
    const logicalScores = scores.map((row) => ({
      ...row,
      nama_raw: row.nama_raw ?? row.nama,
      pendidikan_raw: row.pendidikan_raw ?? row.pendidikan,
    }));

    result.batch_audits.push({
      batch_id: batch.id,
      institution_code: batch.institution_code,
      formations: summarizeRows(formations, [
        "formation_key",
        "tahun",
        "kode_instansi",
        "nama_instansi",
        "kode_jabatan",
        "jabatan",
        "kode_lokasi",
        "lokasi_formasi",
        "kode_jenis_formasi",
        "jenis_formasi",
        "pendidikan",
        "jumlah_formasi",
        "page_number",
        "quality_status",
        "parser_confidence",
      ]),
      scores: summarizeRows(logicalScores, [
        "no_peserta",
        "nama",
        "nama_raw",
        "nama_normalized",
        "pendidikan",
        "pendidikan_raw",
        "tahun_skd",
        "twk",
        "tiu",
        "tkp",
        "total",
        "keterangan",
        "source_page",
        "quality_status",
        "parser_confidence",
      ]),
      issues,
    });
    console.log(
      `${batch.institution_code}: ${formations.length} formasi, ${scores.length} peserta, ${issues.length} issue`,
    );
  }

  const csvEntries = (await readdir(stagingDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith("-v3-staging.csv"))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of csvEntries) {
    const content = await readFile(path.join(stagingDir, entry.name));
    result.csv_files.push({
      name: entry.name,
      bytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`Audit tersimpan: ${outputPath}`);
}

await main();
