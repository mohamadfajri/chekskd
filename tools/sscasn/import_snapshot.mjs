import { DatabaseSync } from "node:sqlite";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildSscasnCandidates } from "../../src/lib/sscasn.ts";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const institutionArgument = args.indexOf("--institution");
const scopeInstitution = institutionArgument >= 0 ? args[institutionArgument + 1]?.trim() : null;
if (institutionArgument >= 0 && (!scopeInstitution || scopeInstitution.startsWith("--")))
  throw new Error("Isi --institution dengan nama instansi yang persis seperti sumber SSCASN.");
if (scopeInstitution && scopeInstitution !== "Kejaksaan Agung")
  throw new Error(
    "Mode instansi saat ini khusus pilot Kejaksaan Agung; katalog gabungan tetap disiapkan tanpa --institution.",
  );
if (apply && !scopeInstitution && !args.includes("--allow-full-import"))
  throw new Error(
    "Impor penuh diblokir sampai kapasitas diperiksa. Gunakan --institution untuk pilot, atau --allow-full-import setelah memastikan ruang database cukup.",
  );
const scopeId = scopeInstitution
  ? createHash("sha256").update(scopeInstitution).digest("hex").slice(0, 8)
  : null;
const dirArgument = args.indexOf("--source");
const sourceDir = dirArgument >= 0 ? args[dirArgument + 1] : process.env.SSCASN_SOURCE_DIR;
if (!sourceDir) throw new Error("Isi --source dengan folder data snapshot Aesen.");
const root = path.resolve("data/staging/sscasn");
const audit = JSON.parse(await readFile(path.join(sourceDir, "audit.json"), "utf8"));
if (
  audit.integrity_check !== "ok" ||
  audit.rows !== audit.unique_ids ||
  audit.duplicate_ids !== 0
) {
  throw new Error("Audit sumber tidak memenuhi pemeriksaan integritas dan keunikan ID.");
}
const hash = createHash("sha256");
for await (const chunk of createReadStream(path.join(sourceDir, "formasi.jsonl")))
  hash.update(chunk);
if (hash.digest("hex") !== audit.jsonl_sha256) {
  throw new Error("Checksum JSONL tidak sesuai audit; snapshot sumber telah berubah.");
}
const db = new DatabaseSync(path.join(sourceDir, "aesen.sqlite"), { readOnly: true });
if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") {
  db.close();
  throw new Error("Database SQLite sumber tidak lolos pemeriksaan integritas.");
}
const raw = db
  .prepare(
    "SELECT formasi_id,ins_nm,jabatan_nm,lokasi_nm,pendidikan_nm,jumlah_formasi,jumlah_ms,gaji_min,gaji_max FROM formasi ORDER BY formasi_id",
  )
  .all();
if (
  raw.some(
    (r) =>
      !r.formasi_id ||
      !r.ins_nm ||
      !r.jabatan_nm ||
      r.lokasi_nm == null ||
      r.pendidikan_nm == null ||
      !Number.isInteger(r.jumlah_formasi) ||
      r.jumlah_formasi < 0 ||
      !Number.isInteger(r.jumlah_ms) ||
      r.jumlah_ms < 0 ||
      (r.gaji_min != null && (!Number.isFinite(r.gaji_min) || r.gaji_min < 0)) ||
      (r.gaji_max != null &&
        (!Number.isFinite(r.gaji_max) ||
          r.gaji_max < 0 ||
          (r.gaji_min != null && r.gaji_max < r.gaji_min))),
  )
) {
  db.close();
  throw new Error("Sumber memiliki ID/kolom wajib/angka yang tidak valid; impor dibatalkan.");
}
const snapshot = {
  id: `casn-2024-${audit.jsonl_sha256.slice(0, 16)}${scopeId ? `-${scopeId}` : ""}`,
  scope_institution: scopeInstitution,
  selection_year: 2024,
  source_url: audit.source,
  captured_at: audit.completed_at,
  checksum: audit.jsonl_sha256,
  row_count: raw.length,
  quota_total: raw.reduce((n, r) => n + r.jumlah_formasi, 0),
  passed_admin_total: raw.reduce((n, r) => n + r.jumlah_ms, 0),
  import_status: "ready",
};
if (
  snapshot.row_count !== audit.rows ||
  snapshot.quota_total !== audit.total_jumlah_formasi ||
  snapshot.passed_admin_total !== audit.total_jumlah_ms
) {
  throw new Error("Jumlah baris/kuota/pelamar SQLite tidak sesuai audit sumber.");
}
const selected = scopeInstitution ? raw.filter((r) => r.ins_nm === scopeInstitution) : raw;
if (!selected.length) {
  db.close();
  throw new Error("Instansi tidak ditemukan pada snapshot SSCASN. Nama harus sama dengan sumber.");
}
snapshot.row_count = selected.length;
snapshot.quota_total = selected.reduce((n, r) => n + r.jumlah_formasi, 0);
snapshot.passed_admin_total = selected.reduce((n, r) => n + r.jumlah_ms, 0);
const formations = selected.map((r) => ({
  snapshot_id: snapshot.id,
  source_id: r.formasi_id,
  institution: r.ins_nm,
  job: r.jabatan_nm,
  location: r.lokasi_nm,
  education: r.pendidikan_nm,
  education_options: [
    ...new Set(
      r.pendidikan_nm
        .split(/\s*\/\s*/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ],
  quota: r.jumlah_formasi,
  passed_admin: r.jumlah_ms,
  salary_min: r.gaji_min == null ? null : Math.round(r.gaji_min),
  salary_max: r.gaji_max == null ? null : Math.round(r.gaji_max),
}));
const institutions = db
  .prepare(
    "SELECT ins_nm institution, count(*) row_count, sum(jumlah_formasi) quota,sum(jumlah_ms) passed_admin FROM formasi GROUP BY ins_nm ORDER BY ins_nm",
  )
  .all()
  .filter((r) => !scopeInstitution || r.institution === scopeInstitution);
db.close();
await mkdir(root, { recursive: true });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
  {
    auth: { persistSession: false },
    global: {
      fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(45000) }),
    },
  },
);
const { data: pdf, error } = await sb
  .from("skd_formations")
  .select(
    "id,nama_instansi,jabatan,lokasi_formasi,pendidikan,jumlah_formasi,jenis_formasi,tahun,page_number,skd_batches!inner(status)",
  )
  .eq("kode_instansi", "4002")
  .eq("skd_batches.status", "published")
  .order("id");
if (error) throw new Error(`Tidak dapat membaca formasi PDF: ${error.code}`);
const pilot = formations.filter((r) => r.institution === "Kejaksaan Agung");
const review = pdf.map((r) => ({
  pdf: r,
  candidates: buildSscasnCandidates(r, pilot),
  match: null,
}));
if (!scopeInstitution)
  await writeFile(
    path.join(root, "preview.json"),
    JSON.stringify({
      snapshot,
      institutions,
      review,
      sqlite_path: path.join(sourceDir, "aesen.sqlite"),
    }),
  );
const report = {
  ...snapshot,
  pdf_formations: pdf.length,
  exact_candidates: review.filter((r) => r.candidates.filter((c) => c.exact).length === 1).length,
  ambiguous_exact: review.filter((r) => r.candidates.filter((c) => c.exact).length > 1).length,
  without_candidates: review.filter((r) => !r.candidates.length).length,
  applied: false,
};
const reportPath = path.join(root, scopeId ? `report-${scopeId}.json` : "report.json");
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (apply) {
  const check = await sb
    .from("sscasn_snapshots")
    .select("id,checksum,import_status")
    .eq("id", snapshot.id)
    .maybeSingle();
  if (check.error)
    throw new Error(
      "Tabel SSCASN belum tersedia. Terapkan migration 20261012090000_add_sscasn_catalog.sql terlebih dahulu.",
    );
  if (check.data?.import_status === "ready") {
    console.log("Snapshot ini sudah diimpor; tidak ditulis ulang.");
  } else {
    const start = await sb
      .from("sscasn_snapshots")
      .upsert({ ...snapshot, import_status: "importing" });
    if (start.error) throw new Error(`Snapshot: ${start.error.code}`);
    for (let i = 0; i < formations.length; i += 500) {
      const result = await sb
        .from("sscasn_formations")
        .upsert(formations.slice(i, i + 500), { onConflict: "snapshot_id,source_id" });
      if (result.error) throw new Error(`Import halaman ${i / 500 + 1}: ${result.error.code}`);
      if (i % 10000 === 0)
        console.log(`Diimpor ${Math.min(i + 500, formations.length)}/${formations.length}`);
    }
    const stat = await sb.from("sscasn_institutions").upsert(
      institutions.map((r) => ({ ...r, snapshot_id: snapshot.id })),
      { onConflict: "snapshot_id,institution" },
    );
    if (stat.error) throw new Error(`Ringkasan: ${stat.error.code}`);
    const count = await sb
      .from("sscasn_formations")
      .select("source_id", { head: true, count: "exact" })
      .eq("snapshot_id", snapshot.id);
    if (count.error || count.count !== snapshot.row_count)
      throw new Error("Jumlah baris database belum sesuai snapshot; import belum dipublikasikan.");
    const finish = await sb
      .from("sscasn_snapshots")
      .update({ import_status: "ready" })
      .eq("id", snapshot.id);
    if (finish.error) throw new Error(`Finalisasi: ${finish.error.code}`);
    console.log("Snapshot database siap. Pasangan formasi tetap memerlukan persetujuan admin.");
  }
  report.applied = true;
  await writeFile(reportPath, JSON.stringify(report, null, 2));
}
