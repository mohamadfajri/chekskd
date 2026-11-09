import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { approvedSscasnSources } from "../lib/sscasnReconciliation.ts";
import { readSscasnAuditReviews } from "./sscasnAudit.ts";
import { withSscasnApprovalLock } from "./sscasnApproval.ts";
import {
  buildSscasnCandidates,
  normalizeSscasnText,
  type SscasnAdminData,
  type SscasnFormation,
  type SscasnMatch,
  type SscasnSnapshot,
  type SscasnReviewRow,
  type SscasnPdfFormation,
  type SscasnContext,
} from "../lib/sscasn";

const LOCAL_DIR = path.resolve(process.env.SSCASN_LOCAL_DIR || "data/staging/sscasn");
interface LocalPreview {
  snapshot: SscasnSnapshot;
  institutions: SscasnAdminData["institutions"];
  review: SscasnReviewRow[];
  sqlite_path: string;
}

async function localPreview(): Promise<LocalPreview> {
  if (process.env.NODE_ENV === "production")
    throw new Error("Snapshot SSCASN belum diimpor ke database.");
  try {
    return JSON.parse(await readFile(path.join(LOCAL_DIR, "preview.json"), "utf8"));
  } catch {
    throw new Error("Snapshot SSCASN belum tersedia. Jalankan importer snapshot terlebih dahulu.");
  }
}

function missingSchema(code: string | undefined): boolean {
  return code === "PGRST205" || code === "42P01";
}

async function readySnapshot(sb: SupabaseClient): Promise<SscasnSnapshot | null> {
  const { data, error } = await sb
    .from("sscasn_snapshots")
    .select("*")
    .eq("import_status", "ready")
    .or("scope_institution.is.null,scope_institution.eq.Kejaksaan Agung")
    .order("captured_at", { ascending: false })
    .order("row_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && !missingSchema(error.code)) throw new Error("Snapshot SSCASN tidak dapat dibaca.");
  return data as SscasnSnapshot | null;
}

async function localReviews(): Promise<Record<string, SscasnMatch>> {
  try {
    return JSON.parse(await readFile(path.join(LOCAL_DIR, "reviews.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("Catatan review lokal tidak dapat dibaca.");
  }
}

function canCompareSource(
  sourceId: string,
  formationId: string,
  match: SscasnMatch | undefined,
  used: ReadonlyMap<string, string>,
) {
  if (match?.review_status === "approved") return sourceId === match.source_id;
  return !used.has(sourceId) || used.get(sourceId) === formationId;
}

export async function getSscasnAdminData(
  sb: SupabaseClient,
  params: URLSearchParams,
): Promise<SscasnAdminData> {
  const snapshot = await readySnapshot(sb);
  const institution = (params.get("institution") ?? "").trim().slice(0, 200);
  const query = (params.get("query") ?? "")
    .trim()
    .slice(0, 100)
    .replace(/[%,()_\\]/g, " ");
  const page = Math.min(10000, Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1));
  if (!snapshot) {
    const preview = await localPreview();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(preview.sqlite_path, { readOnly: true });
    try {
      const conditions: string[] = [];
      const args: string[] = [];
      if (institution) {
        conditions.push("ins_nm=?");
        args.push(institution);
      }
      if (query) {
        conditions.push("(jabatan_nm LIKE ? OR lokasi_nm LIKE ? OR pendidikan_nm LIKE ?)");
        args.push(...Array(3).fill(`%${query}%`));
      }
      const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
      const total = Number(
        (db.prepare(`SELECT count(*) total FROM formasi${where}`).get(...args) as { total: number })
          .total,
      );
      const rows = db
        .prepare(
          `SELECT formasi_id source_id,ins_nm institution,jabatan_nm job,lokasi_nm location,pendidikan_nm education,jumlah_formasi quota,jumlah_ms passed_admin,gaji_min salary_min,gaji_max salary_max FROM formasi${where} ORDER BY ins_nm,jabatan_nm,formasi_id LIMIT 25 OFFSET ?`,
        )
        .all(...args, (page - 1) * 25) as unknown as SscasnFormation[];
      const reviews = await localReviews();
      const used = approvedSscasnSources(Object.values(reviews));
      return {
        mode: "local",
        snapshot: preview.snapshot,
        institutions: preview.institutions,
        formations: rows.map((row) => ({
          ...row,
          education_options: row.education.split(/\s*\/\s*/),
        })),
        pagination: { page, total, total_pages: Math.max(1, Math.ceil(total / 25)) },
        review: preview.review.map((row) => ({
          ...row,
          candidates: row.candidates.filter(({ formation }) =>
            canCompareSource(formation.source_id, row.pdf.id, reviews[row.pdf.id], used),
          ),
          match: reviews[row.pdf.id] ?? null,
        })),
      };
    } finally {
      db.close();
    }
  }
  let list = sb
    .from("sscasn_formations")
    .select("*", { count: "exact" })
    .eq("snapshot_id", snapshot.id);
  if (institution) list = list.eq("institution", institution);
  if (query)
    list = list.or(`job.ilike.%${query}%,location.ilike.%${query}%,education.ilike.%${query}%`);
  const [rows, institutions, pdf, source] = await Promise.all([
    list
      .order("institution")
      .order("job")
      .order("source_id")
      .range((page - 1) * 25, page * 25 - 1),
    sb
      .from("sscasn_institutions")
      .select("institution,row_count,quota,passed_admin")
      .eq("snapshot_id", snapshot.id)
      .order("institution")
      .limit(1000),
    sb
      .from("skd_formations")
      .select(
        "id,nama_instansi,jabatan,lokasi_formasi,pendidikan,jumlah_formasi,jenis_formasi,tahun,page_number,skd_batches!inner(status)",
      )
      .eq("kode_instansi", "4002")
      .eq("skd_batches.status", "published")
      .order("jabatan")
      .limit(1000),
    sb
      .from("sscasn_formations")
      .select("*")
      .eq("snapshot_id", snapshot.id)
      .eq("institution", "Kejaksaan Agung")
      .limit(1000),
  ]);
  if (rows.error || institutions.error || pdf.error || source.error)
    throw new Error("Data SSCASN belum dapat dimuat.");
  const ids = (pdf.data ?? []).map((row) => row.id);
  const [matches, stored] = await Promise.all([
    ids.length
      ? sb.from("sscasn_matches").select("*").in("formation_id", ids)
      : { data: [], error: null },
    readSscasnAuditReviews(sb),
  ]);
  if (matches.error) throw new Error("Review pencocokan tidak dapat dimuat.");
  const byFormation = new Map((matches.data ?? []).map((m) => [m.formation_id, m as SscasnMatch]));
  const used = approvedSscasnSources(stored);
  return {
    mode: "database",
    snapshot,
    institutions: institutions.data ?? [],
    formations: rows.data ?? [],
    pagination: {
      page,
      total: rows.count ?? 0,
      total_pages: Math.max(1, Math.ceil((rows.count ?? 0) / 25)),
    },
    review: (pdf.data ?? []).map((row) => ({
      pdf: row,
      candidates: buildSscasnCandidates(
        row,
        (source.data ?? []).filter(({ source_id }) =>
          canCompareSource(source_id, row.id, byFormation.get(row.id), used),
        ),
      ),
      match: byFormation.get(row.id) ?? null,
    })),
  };
}

let localWriteQueue = Promise.resolve();

export async function reviewSscasnMatch(
  sb: SupabaseClient,
  input: {
    formation_id: string;
    source_id: string;
    snapshot_id: string;
    review_status: "approved" | "rejected" | "pending";
    notes: string | null;
  },
): Promise<void> {
  const snapshot = await readySnapshot(sb);
  const local = !snapshot;
  const preview = local ? await localPreview() : null;
  const active = snapshot ?? preview!.snapshot;
  if (active.id !== input.snapshot_id)
    throw new Error("Snapshot berubah; muat ulang data sebelum menyimpan review.");
  let pdf: SscasnPdfFormation | null;
  let source: SscasnFormation | null;
  if (local) {
    pdf = preview!.review.find((row) => row.pdf.id === input.formation_id)?.pdf ?? null;
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(preview!.sqlite_path, { readOnly: true });
    try {
      source = db
        .prepare(
          "SELECT formasi_id source_id,ins_nm institution,jabatan_nm job,lokasi_nm location,pendidikan_nm education,jumlah_formasi quota,jumlah_ms passed_admin,gaji_min salary_min,gaji_max salary_max FROM formasi WHERE formasi_id=?",
        )
        .get(input.source_id) as unknown as SscasnFormation | null;
    } finally {
      db.close();
    }
  } else {
    const [a, b] = await Promise.all([
      sb.from("skd_formations").select("*").eq("id", input.formation_id).maybeSingle(),
      sb
        .from("sscasn_formations")
        .select("*")
        .eq("snapshot_id", active.id)
        .eq("source_id", input.source_id)
        .maybeSingle(),
    ]);
    if (a.error || b.error) throw new Error("Pasangan formasi tidak dapat diperiksa.");
    pdf = a.data;
    source = b.data;
  }
  if (!pdf || !source) throw new Error("Formasi sumber atau PDF tidak ditemukan.");
  if (
    pdf.tahun !== active.selection_year ||
    normalizeSscasnText(pdf.nama_instansi) !== normalizeSscasnText(source.institution) ||
    normalizeSscasnText(pdf.jabatan) !== normalizeSscasnText(source.job)
  ) {
    throw new Error("Pasangan harus memiliki tahun, instansi, dan jabatan yang sama.");
  }
  if (input.review_status === "approved" && !input.notes?.trim()) {
    const candidate = buildSscasnCandidates(pdf, [source])[0];
    if (!candidate?.exact)
      throw new Error("Isi catatan alasan sebelum menyetujui pasangan yang berbeda kolom.");
  }
  const match: SscasnMatch = { ...input, reviewed_at: new Date().toISOString() };
  function checkReserved(reviews: Awaited<ReturnType<typeof readSscasnAuditReviews>>) {
    const current = reviews.find((row) => row.formation_id === input.formation_id);
    if (current?.review_status === "approved" && current.source_id !== input.source_id) {
      throw new Error(
        "Formasi ini sudah punya pasangan. Periksa ulang pasangan lama sebelum menggantinya.",
      );
    }
    const owner = approvedSscasnSources(reviews).get(input.source_id);
    if (owner && owner !== input.formation_id)
      throw new Error("Sumber SSCASN ini sudah dipakai formasi PDF lain.");
  }
  if (local) {
    const save = localWriteQueue.then(async () => {
      const reviews = await localReviews();
      checkReserved(Object.values(reviews));
      reviews[input.formation_id] = match;
      const target = path.join(LOCAL_DIR, "reviews.json");
      const tmp = target + ".tmp";
      await writeFile(tmp, JSON.stringify(reviews, null, 2));
      await rename(tmp, target);
    });
    localWriteQueue = save.catch(() => undefined);
    await save;
  } else {
    const save = async () => {
      checkReserved(await readSscasnAuditReviews(sb));
      const result = await sb.from("sscasn_matches").upsert(match, { onConflict: "formation_id" });
      if (result.error)
        throw new Error(
          result.error.code === "23505"
            ? "Sumber SSCASN ini sudah dipakai formasi PDF lain."
            : "Review pencocokan belum tersimpan.",
        );
    };
    await (process.env.AESEN_DATABASE_URL ? withSscasnApprovalLock(save) : save());
  }
}

export async function getSscasnContext(
  sb: SupabaseClient,
  ids: string[],
): Promise<Record<string, SscasnContext>> {
  if (!ids.length) return {};
  const { data, error } = await sb.rpc("get_approved_sscasn_context", {
    p_formation_ids: [...new Set(ids)],
  });
  if (error) {
    if (!["PGRST202", "42883"].includes(error.code))
      console.error("sscasn_context_unavailable", error.code);
    return {};
  }
  return data && typeof data === "object" ? (data as Record<string, SscasnContext>) : {};
}
