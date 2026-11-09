import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { normalizeSscasnText as norm } from "../../src/lib/sscasn.ts";
import { reconcileCatalog } from "../../src/lib/sscasnReconciliation.ts";
import {
  attachZeroRecapEvidence,
  readAesenAuditCatalog,
  readSscasnAuditOfficial,
  readSscasnAuditReviews,
} from "../../src/server/sscasnAudit.ts";
import {
  saveSscasnExactPairs,
  sscasnAuditHash,
  withSscasnApprovalLock,
} from "../../src/server/sscasnApproval.ts";

export { reconcileCatalog };

const YEAR = 2024;

async function main() {
  const { parseArgs } = await import("node:util");
  const { values: options } = parseArgs({
    options: {
      institution: { type: "string" },
      apply: { type: "boolean" },
      confirm: { type: "string" },
      audit: { type: "string" },
      pdf: { type: "string" },
      output: { type: "string", default: "data/staging/sscasn/reconcile-plan.json" },
    },
  });
  if (options.apply && (!options.institution || !/^[0-9a-f]{16}$/.test(options.confirm ?? ""))) {
    throw new Error("Persetujuan perlu --institution dan --confirm dengan kode audit terbaru.");
  }
  if ((options.audit || options.pdf) && (!options.audit || !options.pdf || !options.institution)) {
    throw new Error("Bukti rekap memerlukan --institution, --audit, dan --pdf.");
  }
  let audit;
  if (options.audit) {
    audit = JSON.parse(await readFile(options.audit, "utf8"));
    const checksum = createHash("sha256");
    for await (const chunk of createReadStream(options.pdf)) checksum.update(chunk);
    if (
      audit.mode !== "audit_only" ||
      audit.selection_year !== YEAR ||
      norm(audit.institution) !== norm(options.institution) ||
      checksum.digest("hex") !== audit.pdf_sha256 ||
      !Array.isArray(audit.rows) ||
      new Set(audit.rows.map((row) => row.formation_id)).size !== audit.rows.length
    ) {
      throw new Error("Laporan audit tidak sesuai dengan lingkup atau PDF sumber.");
    }
  }
  const aesenUrl = process.env.AESEN_DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!aesenUrl || !supabaseUrl || !supabaseKey)
    throw new Error("Konfigurasi server Aesen atau Supabase belum lengkap.");
  const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const run = () => reconcileAndReport(sb, aesenUrl, options, audit);
  await (options.apply ? withSscasnApprovalLock(run) : run());
}

async function reconcileAndReport(sb, aesenUrl, options, audit) {
  const [official, existing] = await Promise.all([
    readSscasnAuditOfficial(sb),
    readSscasnAuditReviews(sb),
  ]);
  const scope = options.institution
    ? official.filter((row) => norm(row.institution) === norm(options.institution))
    : official;
  if (!scope.length) throw new Error("Tidak ada formasi SKD terverifikasi pada lingkup ini.");
  const institutions = [...new Set(scope.map((row) => norm(row.institution)))];
  const {
    snapshot,
    rows: catalog,
    zeroRecaps,
  } = await readAesenAuditCatalog(aesenUrl, institutions);
  const rows = reconcileCatalog(
    attachZeroRecapEvidence(scope, zeroRecaps),
    catalog,
    existing,
    audit && new Map(audit.rows.map((row) => [row.formation_id, row])),
  );
  const bySource = new Map(catalog.map((row) => [row.id, row]));
  const ready = rows.filter((row) => row.status === "ready");
  const confirmation = sscasnAuditHash([
    snapshot.checksum,
    audit?.pdf_sha256,
    ready.map((row) => [row, bySource.get(row.candidateIds[0])]),
  ]).slice(0, 16);
  const totals = new Map();
  for (const row of rows) {
    if (!totals.has(row.institution))
      totals.set(row.institution, {
        institution: row.institution,
        total: 0,
        ready: 0,
        already_approved: 0,
        review: 0,
      });
    const entry = totals.get(row.institution);
    entry.total++;
    entry[row.status === "ready" || row.status === "already_approved" ? row.status : "review"]++;
  }
  const summary = [...totals.values()].sort((a, b) =>
    a.institution.localeCompare(b.institution, "id"),
  );
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(
    options.output,
    JSON.stringify({ year: YEAR, confirmation, summary, rows }, null, 2) + "\n",
  );
  console.table(summary);
  console.log(`Kode audit: ${confirmation}. Laporan: ${options.output}`);
  if (!options.apply) return;
  if (options.confirm !== confirmation || !ready.length || summary.length !== 1) {
    throw new Error(
      "Rencana berubah, tidak ada kandidat, atau lingkup bukan satu instansi. Tidak ada persetujuan disimpan.",
    );
  }
  const approved = await saveSscasnExactPairs(
    sb,
    snapshot,
    summary[0].institution,
    ready,
    bySource,
    confirmation,
  );
  console.log(`${approved} pasangan disetujui. Data SKD tidak ditulis.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.code ? `Pencocokan gagal (${error.code}).` : error.message);
    process.exitCode = 1;
  });
}
