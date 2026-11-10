import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import {
  normalizeSscasnText as norm,
  sscasnEducationKey,
  type SscasnFormation,
} from "../lib/sscasn.ts";
import {
  SSCASN_MANUAL_NOTE_PREFIX,
  type AesenSscasnEvidence,
  type SscasnAuditRow,
} from "../lib/sscasnReconciliation.ts";
import { aesenConnection } from "./aesenConnection.ts";
import { skdAdminTransaction, skdAdminUsesSumopod } from "./skdAdminStore.ts";

export interface AesenApprovalSnapshot {
  source_url: string;
  captured_at: Date;
  checksum: string;
}

const YEAR = 2024;
const BATCH = 500;

export function sscasnAuditHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function withSscasnApprovalLock<T>(work: () => Promise<T>): Promise<T> {
  const url = process.env.AESEN_DATABASE_URL;
  if (!url) throw new Error("Koneksi Aesen belum disetel untuk menyimpan pasangan.");
  const client = new pg.Client({ ...aesenConnection(url), query_timeout: 10_000 });
  let locked = false;
  let transaction = false;
  try {
    await client.connect();
    await client.query("begin");
    transaction = true;
    await client.query("set local lock_timeout = '6s'");
    await client.query("select pg_advisory_xact_lock(hashtext('cekskd:sscasn-approval'))");
    locked = true;
    return await work();
  } catch (error) {
    if (locked) throw error;
    throw new Error("Penguncian audit belum tersedia. Tunggu audit lain selesai lalu coba lagi.");
  } finally {
    if (transaction) await client.query("rollback").catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

const mirrorSalary = (value: number | null) => (value === null ? null : Math.round(value));

function sameMirror(selected: AesenSscasnEvidence[], rows: SscasnFormation[]) {
  const indexed = new Map(rows.map((row) => [row.source_id, row]));
  return selected.every((source) => {
    const row = indexed.get(source.id);
    return (
      row &&
      norm(row.institution) === norm(source.institution) &&
      norm(row.job) === norm(source.job) &&
      norm(row.location) === norm(source.location) &&
      sscasnEducationKey(row.education) === sscasnEducationKey(source.education) &&
      row.quota === source.quota &&
      row.passed_admin === source.registered &&
      row.salary_min === mirrorSalary(source.salary_min) &&
      row.salary_max === mirrorSalary(source.salary_max)
    );
  });
}

function mirrorId(snapshot: AesenApprovalSnapshot, selected: AesenSscasnEvidence[]) {
  const sourceHash = sscasnAuditHash(selected.map(({ id }) => id).sort()).slice(0, 16);
  return `casn-${YEAR}-${snapshot.checksum.slice(0, 16)}-match-${sourceHash}`;
}

function mirrorFormations(snapshotId: string, selected: AesenSscasnEvidence[]) {
  return selected.map((row) => ({
    snapshot_id: snapshotId,
    source_id: row.id,
    institution: row.institution,
    job: row.job,
    location: row.location,
    education: row.education,
    quota: row.quota,
    passed_admin: row.registered,
    education_options: [
      ...new Set(
        row.education
          .split("/")
          .map((part) => part.trim())
          .filter(Boolean),
      ),
    ],
    salary_min: mirrorSalary(row.salary_min),
    salary_max: mirrorSalary(row.salary_max),
  }));
}

async function matchingMirror(
  sb: SupabaseClient,
  snapshotId: string,
  selected: AesenSscasnEvidence[],
) {
  const rows: SscasnFormation[] = [];
  for (let offset = 0; ; offset += BATCH) {
    const { data, error } = await sb
      .from("sscasn_formations")
      .select("*")
      .eq("snapshot_id", snapshotId)
      .order("source_id")
      .range(offset, offset + BATCH - 1)
      .overrideTypes<SscasnFormation[], { merge: false }>();
    if (error) throw new Error("Salinan Aesen belum dapat dibaca.");
    rows.push(...data);
    if (data.length < BATCH) break;
  }
  return sameMirror(selected, rows);
}

async function ensureMirror(
  sb: SupabaseClient,
  snapshot: AesenApprovalSnapshot,
  institution: string,
  selected: AesenSscasnEvidence[],
) {
  const existing = await sb
    .from("sscasn_snapshots")
    .select("id")
    .eq("selection_year", YEAR)
    .eq("scope_institution", institution)
    .eq("checksum", snapshot.checksum)
    .eq("import_status", "ready")
    .order("row_count", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Error("Snapshot pilot belum dapat dibaca.");
  if (existing.data && (await matchingMirror(sb, existing.data.id, selected)))
    return existing.data.id;

  const snapshotId = mirrorId(snapshot, selected);
  const draft = await sb.from("sscasn_snapshots").upsert(
    {
      id: snapshotId,
      selection_year: YEAR,
      scope_institution: institution,
      ...snapshot,
      row_count: selected.length,
      quota_total: selected.reduce((sum, row) => sum + row.quota, 0),
      passed_admin_total: selected.reduce((sum, row) => sum + row.registered, 0),
      import_status: "importing",
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (draft.error) throw new Error("Snapshot salinan belum dapat disiapkan.");
  for (let offset = 0; offset < selected.length; offset += BATCH) {
    const rows = mirrorFormations(snapshotId, selected.slice(offset, offset + BATCH));
    const result = await sb
      .from("sscasn_formations")
      .upsert(rows, { onConflict: "snapshot_id,source_id", ignoreDuplicates: true });
    if (result.error) throw new Error("Salinan kandidat Aesen belum tersimpan.");
  }
  if (!(await matchingMirror(sb, snapshotId, selected)))
    throw new Error("Salinan Aesen tidak cocok; persetujuan dibatalkan.");
  const ready = await sb
    .from("sscasn_snapshots")
    .update({ import_status: "ready" })
    .eq("id", snapshotId)
    .eq("import_status", "importing");
  if (ready.error) throw new Error("Snapshot salinan belum dapat difinalisasi.");
  return snapshotId;
}

async function persistSumopodPairs(
  snapshot: AesenApprovalSnapshot,
  institution: string,
  pairs: Array<{ formationId: string; candidate: AesenSscasnEvidence; notes: string }>,
) {
  const selected = pairs.map(({ candidate }) => candidate);
  const ids = selected.map(({ id }) => id);
  return skdAdminTransaction(async (db) => {
    const matches = await db.query(
      `select 1 from public.sscasn_matches where formation_id = any($1::uuid[])
        or (source_id = any($2::text[]) and review_status = 'approved') limit 1`,
      [pairs.map(({ formationId }) => formationId), ids],
    );
    if (matches.rowCount) throw new Error("Ada pasangan yang sudah dipakai. Jalankan audit ulang.");
    const matchingRows = async (snapshotId: string) => {
      const { rows } = await db.query<{ value: SscasnFormation }>(
        `select to_jsonb(f) as value from public.sscasn_formations f
          where snapshot_id = $1 and source_id = any($2::text[])`,
        [snapshotId, ids],
      );
      return sameMirror(
        selected,
        rows.map(({ value }) => value),
      );
    };
    const {
      rows: [existing],
    } = await db.query<{ id: string }>(
      `select id from public.sscasn_snapshots
        where selection_year = $1 and scope_institution = $2 and checksum = $3 and import_status = 'ready'
        order by row_count desc, id limit 1`,
      [YEAR, institution, snapshot.checksum],
    );
    let snapshotId = existing?.id;
    if (!snapshotId || !(await matchingRows(snapshotId))) {
      snapshotId = mirrorId(snapshot, selected);
      await db.query(
        `insert into public.sscasn_snapshots
          (id,selection_year,scope_institution,source_url,captured_at,checksum,row_count,quota_total,passed_admin_total)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing`,
        [
          snapshotId,
          YEAR,
          institution,
          snapshot.source_url,
          snapshot.captured_at,
          snapshot.checksum,
          selected.length,
          selected.reduce((sum, row) => sum + row.quota, 0),
          selected.reduce((sum, row) => sum + row.registered, 0),
        ],
      );
      for (let offset = 0; offset < selected.length; offset += BATCH) {
        await db.query(
          `insert into public.sscasn_formations select * from jsonb_populate_recordset(null::public.sscasn_formations,$1)
            on conflict (snapshot_id,source_id) do nothing`,
          [JSON.stringify(mirrorFormations(snapshotId, selected.slice(offset, offset + BATCH)))],
        );
      }
      if (!(await matchingRows(snapshotId)))
        throw new Error("Salinan Aesen tidak cocok; persetujuan dibatalkan.");
      await db.query(
        "update public.sscasn_snapshots set import_status = 'ready' where id = $1 and import_status = 'importing'",
        [snapshotId],
      );
    }
    const reviewedAt = new Date().toISOString();
    await db.query(
      `insert into public.sscasn_matches
        select * from jsonb_populate_recordset(null::public.sscasn_matches,$1)`,
      [
        JSON.stringify(
          pairs.map(({ formationId, candidate, notes }) => ({
            formation_id: formationId,
            source_id: candidate.id,
            snapshot_id: snapshotId,
            review_status: "approved",
            reviewed_at: reviewedAt,
            notes,
          })),
        ),
      ],
    );
    return pairs.length;
  });
}

// Call only after a fresh reconciliation under the shared approval lock.
export async function saveSscasnExactPairs(
  sb: SupabaseClient,
  snapshot: AesenApprovalSnapshot,
  institution: string,
  rows: SscasnAuditRow[],
  source: ReadonlyMap<string, AesenSscasnEvidence>,
  auditCode: string,
) {
  const ready = rows.filter(({ status }) => status === "ready");
  if (!ready.length) return 0;
  const pairs = ready.map((row) => {
    const candidate = row.candidateIds.length === 1 && source.get(row.candidateIds[0]);
    if (
      !candidate ||
      norm(row.institution) !== norm(institution) ||
      norm(candidate.institution) !== norm(institution)
    ) {
      throw new Error("Ada pasangan di luar audit instansi; persetujuan dibatalkan.");
    }
    return {
      formationId: row.id,
      candidate,
      notes: `Audit exact ${auditCode}: instansi, jabatan, lokasi, pendidikan, kuota dan peserta terdaftar cocok; PDF halaman ${row.page}.${row.registered === 0 ? " Nol dan kategori terverifikasi dari rekap PDF serta API detail." : ""}`,
    };
  });
  return persistPairs(sb, snapshot, institution, pairs);
}

export async function saveSscasnManualPairs(
  sb: SupabaseClient,
  snapshot: AesenApprovalSnapshot,
  institution: string,
  pairs: Array<{ pdf: SscasnAuditRow; candidate: AesenSscasnEvidence }>,
  note: string,
) {
  return persistPairs(
    sb,
    snapshot,
    institution,
    pairs.map(({ pdf, candidate }) => ({
      formationId: pdf.id,
      candidate,
      notes: `${SSCASN_MANUAL_NOTE_PREFIX}PDF halaman ${pdf.page}. ${note}`,
    })),
  );
}

async function persistPairs(
  sb: SupabaseClient,
  snapshot: AesenApprovalSnapshot,
  institution: string,
  pairs: Array<{ formationId: string; candidate: AesenSscasnEvidence; notes: string }>,
) {
  const selected = pairs.map(({ candidate }) => candidate);
  if (
    new Set(selected.map(({ id }) => id)).size !== pairs.length ||
    new Set(pairs.map(({ formationId }) => formationId)).size !== pairs.length
  ) {
    throw new Error("Ada pasangan yang tidak unik; persetujuan dibatalkan.");
  }
  if (skdAdminUsesSumopod()) {
    try {
      return await persistSumopodPairs(snapshot, institution, pairs);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "23505")
        throw new Error("Ada pasangan yang sudah dipakai. Jalankan audit ulang.");
      if (!code) throw error;
      console.error("sscasn_approval_failed", code);
      throw new Error("Persetujuan pasangan belum tersimpan.");
    }
  }
  const snapshotId = await ensureMirror(sb, snapshot, institution, selected);
  const reviewedAt = new Date().toISOString();
  // A single insert cannot partially approve the batch or overwrite any manual review.
  const result = await sb.from("sscasn_matches").insert(
    pairs.map(({ formationId, candidate, notes }) => ({
      formation_id: formationId,
      source_id: candidate.id,
      snapshot_id: snapshotId,
      review_status: "approved",
      reviewed_at: reviewedAt,
      notes,
    })),
  );
  if (result.error)
    throw new Error(
      result.error.code === "23505"
        ? "Ada pasangan yang sudah dipakai. Jalankan audit ulang."
        : "Persetujuan pasangan belum tersimpan.",
    );
  return pairs.length;
}
