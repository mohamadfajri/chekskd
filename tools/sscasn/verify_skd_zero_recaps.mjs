import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { sscasnAuditEvidenceKey } from "../../src/lib/sscasnReconciliation.ts";
import { aesenConnection } from "../../src/server/aesenConnection.ts";
import { readAesenAuditCatalog, readSscasnAuditOfficial } from "../../src/server/sscasnAudit.ts";

async function saveProof(url, entries) {
  const client = new pg.Client({ ...aesenConnection(url), query_timeout: 25_000 });
  try {
    await client.connect();
    await client.query(await readFile(new URL("./aesen_categories.sql", import.meta.url), "utf8"));
    await client.query(
      `insert into aesen.skd_zero_recaps
       (formation_id, source_id, institution, job, location, education, category, pdf_page, quota, pdf_sha256)
       select * from jsonb_to_recordset($1::jsonb) as incoming (
         formation_id uuid, source_id uuid, institution text, job text, location text, education text,
         category text, pdf_page integer, quota integer, pdf_sha256 text
       ) on conflict (formation_id) do update set source_id=excluded.source_id, institution=excluded.institution,
         job=excluded.job, location=excluded.location, education=excluded.education, category=excluded.category,
         pdf_page=excluded.pdf_page, quota=excluded.quota, pdf_sha256=excluded.pdf_sha256, checked_at=now()`,
      [JSON.stringify(entries)],
    );
  } finally {
    await client.end();
  }
}

export async function verifyZeroRecaps({
  institution, pdfRoot, pdf, apply, output,
}) {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  const aesenUrl = process.env.AESEN_DATABASE_URL;
  if (!url || !key || (apply && !aesenUrl))
    throw new Error("Konfigurasi Supabase atau SumoPod belum lengkap.");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const official = await readSscasnAuditOfficial(sb, institution);
  const zeros = official.filter((row) => row.registered === 0);
  if (!zeros.length) throw new Error("Tidak ada baris nol SKD terbit untuk diperiksa.");
  const sourceIds = [...new Set(zeros.map((row) => row.pdfSourceId).filter(Boolean))];
  const sources = new Map();
  for (let i = 0; i < sourceIds.length; i += 100) {
    const { data, error } = await sb
      .from("skd_sources")
      .select("id,file_name,sha256,total_pages,document_type,skd_batches!inner(status,selection_year,institution_name)")
      .eq("skd_batches.status", "published")
      .eq("skd_batches.selection_year", 2024)
      .in("id", sourceIds.slice(i, i + 100));
    if (error) throw new Error("Metadata PDF terbit belum dapat dibaca.");
    for (const row of data) sources.set(row.id, row);
  }
  const files = new Map();
  function addFile(name, file) {
    files.set(name, files.has(name) ? null : file);
  }
  if (pdf) addFile(path.basename(pdf), path.resolve(pdf));
  else {
    for (const entry of await readdir(pdfRoot, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && /\.pdf$/i.test(entry.name))
        addFile(entry.name, path.resolve(entry.parentPath, entry.name));
    }
  }

  const pages = new Map();
  const pageKey = (row) => `${row.pdfSourceId}:${row.page}`;
  for (const row of official) pages.set(pageKey(row), (pages.get(pageKey(row)) ?? 0) + 1);
  const perInstitution = new Map();
  const grouped = new Map();
  const unresolved = [];
  const verified = [];
  const entries = [];
  function mark(row, reason) {
    const summary = perInstitution.get(row.institution);
    if (reason) {
      summary.unresolved++;
      unresolved.push({ id: row.id, institution: row.institution, page: row.page, reason });
    } else summary.verified++;
  }
  for (const row of zeros) {
    if (!perInstitution.has(row.institution))
      perInstitution.set(row.institution, { institution: row.institution, checked: 0, verified: 0, unresolved: 0 });
    perInstitution.get(row.institution).checked++;
    const source = sources.get(row.pdfSourceId);
    const file = source && files.get(source.file_name);
    if (
      !source || !file || source.document_type !== "skd" ||
      !/hasil[-_ ]+skd/i.test(source.file_name) || /skb|integrasi|duplikat/i.test(source.file_name) ||
      source.skd_batches.institution_name !== row.institution
    ) {
      mark(row, "PDF SKD terbit tidak tersedia secara unik");
      continue;
    }
    if (row.attended !== 0 || row.quota !== row.statsQuota || row.quota < 1 ||
        !Number.isSafeInteger(row.page) || pages.get(pageKey(row)) !== 1) {
      mark(row, "Angka statistik atau rujukan halaman terbit tidak konsisten");
      continue;
    }
    if (!grouped.has(source.id)) grouped.set(source.id, { sourceId: source.id, pdf: file, rows: [] });
    grouped.get(source.id).rows.push(row);
  }
  if (grouped.size) {
    const result = spawnSync("python", [fileURLToPath(new URL("./read_skd_zero_recaps.py", import.meta.url))], {
      input: JSON.stringify([...grouped.values()]),
      encoding: "utf8",
      env: { ...process.env, PYTHONUTF8: "1" },
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0)
      throw new Error(result.stderr?.trim() || "Parser PDF SKD gagal dijalankan.");
    const results = new Map(JSON.parse(result.stdout).map((proof) => [proof.sourceId, proof]));
    for (const [id, { rows }] of grouped) {
      const proof = results.get(id);
      const source = sources.get(id);
      const verifiedIds = new Set(proof?.verified);
      const reasons = new Map(proof?.unresolved?.map(({ id, reason }) => [id, reason]));
      for (const row of rows) {
        if (!proof || proof.error || proof.pages !== source.total_pages ||
            (source.sha256 && proof.pdfSha256 !== source.sha256.toLowerCase())) {
          mark(row, "PDF gagal dibaca atau halaman/checksum sumber berbeda");
        } else if (!verifiedIds.has(row.id)) {
          mark(row, reasons.get(row.id) ?? "Rekap PDF belum terverifikasi");
        } else {
          mark(row);
          verified.push(row);
          entries.push({
            formation_id: row.id, source_id: id, institution: row.institution, job: row.job,
            location: row.location, education: row.education, category: row.category,
            pdf_page: row.page, quota: row.quota, pdf_sha256: proof.pdfSha256,
          });
        }
      }
    }
  }

  const priorityIds = [];
  if (aesenUrl && verified.length) {
    const signatures = new Set(verified.map(sscasnAuditEvidenceKey));
    const institutions = [...new Set(verified.map(({ institution }) => institution))];
    const { rows } = await readAesenAuditCatalog(aesenUrl, institutions);
    for (const row of rows) {
      if (row.registered === 0 && signatures.has(sscasnAuditEvidenceKey(row)) &&
          (row.categorySource !== "detail_api" || row.verifiedRegistered !== 0)) priorityIds.push(row.id);
    }
  }
  const applied = Boolean(apply && entries.length);
  if (applied) await saveProof(aesenUrl, entries);
  const report = {
    checked: zeros.length, verified: entries.length, unresolved: unresolved.length,
    applied, institutions: [...perInstitution.values()].sort((a, b) => a.institution.localeCompare(b.institution, "id")),
    priorityIds, unresolvedRows: unresolved,
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, priorityIds: priorityIds.length, unresolvedRows: undefined }));
}

export function runZeroRecapVerification(institution) {
  const { values } = parseArgs({
    options: {
      institution: { type: "string", default: institution },
      "pdf-root": { type: "string", default: "FILE SKD 2024" },
      pdf: { type: "string" },
      apply: { type: "boolean" },
      output: {
        type: "string",
        default: `data/staging/sscasn/${institution ? "zero-recap-bkn" : "zero-recap-all-2024"}.json`,
      },
    },
  });
  return verifyZeroRecaps({ ...values, pdfRoot: values["pdf-root"] }).catch((error) => {
    console.error(error.code ? `Audit rekap gagal (${error.code}).` : error.message);
    process.exitCode = 1;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runZeroRecapVerification();
