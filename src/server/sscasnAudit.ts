import type { SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { normalizeSscasnText, sscasnEducationKey } from "../lib/sscasn.ts";
import {
  approvedSscasnSources,
  canManuallyLinkSscasn,
  SSCASN_MANUAL_BATCH_LIMIT,
  SSCASN_MANUAL_NOTE_MIN,
  reconcileCatalog,
  sscasnAuditDifferences,
  sscasnAuditJobKey,
  type AesenSscasnEvidence,
  type ExistingSscasnReview,
  type OfficialSscasnEvidence,
  type SscasnAuditFilter,
  type SscasnAuditResponse,
  type SscasnAuditRow,
  type SscasnManualSelection,
} from "../lib/sscasnReconciliation.ts";
import { aesenConnection } from "./aesenConnection.ts";
import { skdAdminUsesSumopod, sumopodSkdAdminRows } from "./skdAdminStore.ts";
import {
  saveSscasnExactPairs,
  saveSscasnManualPairs,
  sscasnAuditHash,
  withSscasnApprovalLock,
} from "./sscasnApproval.ts";

const YEAR = 2024;
const BATCH = 500;
const PAGE_SIZE = 25;
const CACHE_MS = 60_000;

interface StatsRow {
  formation_id: string;
  quota: number;
  participant_count: number;
  attended_count: number;
  skd_formations: {
    nama_instansi: string;
    jabatan: string;
    lokasi_formasi: string | null;
    pendidikan: string | null;
    jumlah_formasi: number;
    jenis_formasi: string | null;
    page_number: number | null;
    source_id: string;
  };
}

async function readPages<T>(
  query: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += BATCH) {
    const { data, error } = await query(start, start + BATCH - 1);
    if (error || !data) throw new Error(`${label} belum dapat dibaca.`);
    rows.push(...data);
    if (data.length < BATCH) return rows;
  }
}

export async function readSscasnAuditOfficial(
  sb: SupabaseClient,
  institution?: string,
): Promise<OfficialSscasnEvidence[]> {
  if (skdAdminUsesSumopod()) {
    return sumopodSkdAdminRows<OfficialSscasnEvidence>(
      `select f.id, f.nama_instansi as institution, f.jabatan as job,
        f.lokasi_formasi as location, f.pendidikan as education, f.jenis_formasi as category,
        f.page_number as page, f.jumlah_formasi as quota, st.quota as "statsQuota",
        st.participant_count as registered, st.attended_count as attended, f.source_id as "pdfSourceId"
      from public.skd_formation_stats st
      join public.skd_formations f on f.id = st.formation_id
      join public.skd_batches b on b.id = st.batch_id and b.id = f.batch_id
      where b.status = 'published' and b.selection_year = $1 and f.tahun = $1
        and f.quality_status = 'verified' and ($2::text is null or f.nama_instansi = $2)
      order by f.id`,
      [YEAR, institution ?? null],
    );
  }
  const rows = await readPages<StatsRow>((start, end) => {
    let query = sb
      .from("skd_formation_stats")
      .select(
        "formation_id,quota,participant_count,attended_count,skd_formations!inner(nama_instansi,jabatan,lokasi_formasi,pendidikan,jumlah_formasi,jenis_formasi,tahun,page_number,source_id),skd_batches!inner(status,selection_year)",
      )
      .eq("skd_formations.quality_status", "verified")
      .eq("skd_formations.tahun", YEAR)
      .eq("skd_batches.status", "published")
      .eq("skd_batches.selection_year", YEAR);
    if (institution) query = query.eq("skd_formations.nama_instansi", institution);
    return query
      .order("formation_id")
      .range(start, end)
      .overrideTypes<StatsRow[], { merge: false }>();
  }, "Formasi SKD");
  return rows.map((row) => ({
    id: row.formation_id,
    institution: row.skd_formations.nama_instansi,
    job: row.skd_formations.jabatan,
    location: row.skd_formations.lokasi_formasi,
    education: row.skd_formations.pendidikan,
    category: row.skd_formations.jenis_formasi,
    page: row.skd_formations.page_number,
    quota: row.skd_formations.jumlah_formasi,
    statsQuota: row.quota,
    registered: row.participant_count,
    attended: row.attended_count,
    pdfSourceId: row.skd_formations.source_id,
  }));
}

export function readSscasnAuditReviews(sb: SupabaseClient) {
  if (skdAdminUsesSumopod()) {
    return sumopodSkdAdminRows<ExistingSscasnReview>(
      "select formation_id, source_id, review_status from public.sscasn_matches order by formation_id",
    );
  }
  return readPages<ExistingSscasnReview>(
    (start, end) =>
      sb
        .from("sscasn_matches")
        .select("formation_id,source_id,review_status")
        .order("formation_id")
        .range(start, end)
        .overrideTypes<ExistingSscasnReview[], { merge: false }>(),
    "Review tersimpan",
  );
}

interface ZeroRecap {
  formation_id: string;
  source_id: string | null;
  institution: string;
  job: string;
  location: string;
  education: string;
  category: string;
  pdf_page: number;
  quota: number;
}

export function attachZeroRecapEvidence(official: OfficialSscasnEvidence[], recaps: ZeroRecap[]) {
  const byFormation = new Map(recaps.map((recap) => [recap.formation_id, recap]));
  const same = (left: string | null, right: string | null) =>
    normalizeSscasnText(left) === normalizeSscasnText(right);
  return official.map((row) => {
    const recap = byFormation.get(row.id);
    if (
      !recap ||
      row.registered !== 0 ||
      row.attended !== 0 ||
      !row.pdfSourceId ||
      recap.source_id !== row.pdfSourceId ||
      recap.pdf_page !== row.page ||
      recap.quota !== row.quota ||
      !same(recap.institution, row.institution) ||
      !same(recap.job, row.job) ||
      !same(recap.location, row.location) ||
      !same(recap.category, row.category) ||
      sscasnEducationKey(recap.education) !== sscasnEducationKey(row.education)
    )
      return row;
    return { ...row, zeroRecapVerified: true };
  });
}

export async function readAesenAuditCatalog(url: string, institutions: string[]) {
  const client = new pg.Client({ ...aesenConnection(url), query_timeout: 15_000 });
  try {
    await client.connect();
    const {
      rows: [snapshot],
    } = await client.query<{ source_url: string; captured_at: Date; checksum: string }>(
      "select source_url, captured_at, checksum from aesen.snapshot where selection_year = $1",
      [YEAR],
    );
    if (!snapshot) throw new Error("Snapshot Aesen 2024 tidak tersedia.");
    const {
      rows: [tables],
    } = await client.query<{ categories: boolean; recaps: boolean }>(
      "select to_regclass('aesen.formation_categories') is not null as categories, to_regclass('aesen.skd_zero_recaps') is not null as recaps",
    );
    const keys = [...new Set(institutions.map(normalizeSscasnText))];
    const { rows } = await client.query<AesenSscasnEvidence>(
      `select f.source_id as id, f.institution, f.job, f.location, f.education,
       f.quota, f.passed_admin as registered, f.salary_min, f.salary_max
       ${tables.categories ? ', c.category, c.evidence_source as "categorySource", c.verified_registered as "verifiedRegistered"' : ""}
       from aesen.formations f ${tables.categories ? "left join aesen.formation_categories c using(source_id)" : ""}
       where upper(regexp_replace(trim(f.institution), '\\s+', ' ', 'g')) = any($1::text[])`,
      [keys],
    );
    const zeroRecaps = tables.recaps
      ? (
          await client.query<ZeroRecap>(
            `select formation_id, (to_jsonb(r)->>'source_id') as source_id, institution, job, location, education,
       category, pdf_page, quota from aesen.skd_zero_recaps r
       where upper(regexp_replace(trim(institution), '\\s+', ' ', 'g')) = any($1::text[])`,
            [keys],
          )
        ).rows
      : [];
    return { snapshot, rows, zeroRecaps };
  } catch (error) {
    if (error instanceof Error && error.message === "Snapshot Aesen 2024 tidak tersedia.")
      throw error;
    throw new Error("Katalog Aesen belum dapat dibaca. Periksa koneksi SumoPod di server.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function listSscasnAuditInstitutions(sb: SupabaseClient): Promise<string[]> {
  if (skdAdminUsesSumopod()) {
    const rows = await sumopodSkdAdminRows<{ institution_name: string }>(
      `select distinct institution_name from public.skd_batches
      where status = 'published' and selection_year = $1`,
      [YEAR],
    );
    return rows
      .map(({ institution_name }) => institution_name)
      .sort((a, b) => a.localeCompare(b, "id"));
  }
  const { data, error } = await sb
    .from("skd_batches")
    .select("institution_name")
    .eq("status", "published")
    .eq("selection_year", YEAR);
  if (error) throw new Error("Daftar instansi SKD belum dapat dibaca.");
  return [...new Set<string>(data.map(({ institution_name }) => institution_name))].sort((a, b) =>
    a.localeCompare(b, "id"),
  );
}

function toPage(
  institution: string,
  audit: Awaited<ReturnType<typeof runAudit>>,
  filter: SscasnAuditFilter,
  requestedPage: number,
): SscasnAuditResponse {
  const isReview = ({ status }: SscasnAuditRow) =>
    status !== "ready" && status !== "already_approved";
  const ready = audit.rows.filter(({ status }) => status === "ready").length;
  const approved = audit.rows.filter(({ status }) => status === "already_approved").length;
  const filtered = audit.rows.filter(
    (row) => filter === "all" || (filter === "review" ? isReview(row) : row.status === filter),
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Number.isSafeInteger(requestedPage)
    ? Math.min(totalPages, Math.max(1, requestedPage))
    : 1;
  return {
    institution,
    summary: {
      total: audit.rows.length,
      ready,
      alreadyApproved: approved,
      review: audit.rows.length - ready - approved,
    },
    rows: filtered
      .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
      .map(({ candidateIds, ...pdf }) => {
        const stored = audit.existing.get(pdf.id);
        const ids = [...new Set([...(stored ? [stored.source_id] : []), ...candidateIds])];
        const candidates = ids.length
          ? ids.flatMap((id) => audit.source.get(id) ?? [])
          : (audit.byJob.get(sscasnAuditJobKey(pdf.job)) ?? []);
        const comparison = candidates
          .filter(({ id }) => !audit.usedSources.has(id) || audit.usedSources.get(id) === pdf.id)
          .map((row) => ({
            row,
            differences: sscasnAuditDifferences(pdf, row),
            canApprove:
              !stored &&
              (pdf.registered !== 0 || Boolean(row.category)) &&
              canManuallyLinkSscasn(pdf, row),
          }));
        if (!ids.length)
          comparison.sort(
            (a, b) =>
              a.differences.length - b.differences.length || a.row.id.localeCompare(b.row.id),
          );
        return { ...pdf, candidates: comparison.slice(0, 3) };
      }),
    pagination: { page, total: filtered.length, totalPages },
  };
}

async function loadAuditEvidence(sb: SupabaseClient, institution: string) {
  const url = process.env.AESEN_DATABASE_URL;
  if (!url)
    throw new Error(
      "Koneksi Aesen belum disetel. Isi AESEN_DATABASE_URL di server untuk menjalankan audit.",
    );
  const [official, catalog] = await Promise.all([
    readSscasnAuditOfficial(sb, institution),
    readAesenAuditCatalog(url, [institution]),
  ]);
  const byJob = new Map<string, AesenSscasnEvidence[]>();
  for (const row of catalog.rows) {
    const key = sscasnAuditJobKey(row.job);
    const group = byJob.get(key);
    if (group) group.push(row);
    else byJob.set(key, [row]);
  }
  return {
    official,
    catalog,
    source: new Map(catalog.rows.map((row) => [row.id, row])),
    byJob,
  };
}

const cache = new Map<string, { expiresAt: number; value: ReturnType<typeof loadAuditEvidence> }>();

function auditEvidence(sb: SupabaseClient, institution: string, refresh: boolean) {
  let entry = cache.get(institution);
  if (!entry || refresh || entry.expiresAt <= Date.now()) {
    const value = loadAuditEvidence(sb, institution);
    entry = { expiresAt: Date.now() + CACHE_MS, value };
    cache.delete(institution);
    cache.set(institution, entry);
    const oldest = cache.keys().next().value;
    if (cache.size > 6 && oldest) cache.delete(oldest);
    void value.catch(() => {
      if (cache.get(institution)?.value === value) cache.delete(institution);
    });
  }
  return entry.value;
}

function classifyAudit(
  evidence: Awaited<ReturnType<typeof loadAuditEvidence>>,
  existing: ExistingSscasnReview[],
) {
  return {
    ...evidence,
    rows: reconcileCatalog(
      attachZeroRecapEvidence(evidence.official, evidence.catalog.zeroRecaps),
      evidence.catalog.rows,
      existing,
    ).sort((a, b) => (a.page ?? Infinity) - (b.page ?? Infinity) || a.id.localeCompare(b.id)),
    existing: new Map(existing.map((row) => [row.formation_id, row])),
    usedSources: approvedSscasnSources(existing),
  };
}

async function runAudit(sb: SupabaseClient, institution: string, refresh: boolean) {
  const [evidence, existing] = await Promise.all([
    auditEvidence(sb, institution, refresh),
    readSscasnAuditReviews(sb),
  ]);
  return classifyAudit(evidence, existing);
}

export async function getSscasnAudit(
  sb: SupabaseClient,
  institution: string,
  filter: SscasnAuditFilter,
  page: number,
  refresh: boolean,
): Promise<SscasnAuditResponse> {
  return toPage(institution, await runAudit(sb, institution, refresh), filter, page);
}

export async function approveSscasnAudit(
  sb: SupabaseClient,
  institution: string,
): Promise<SscasnAuditResponse> {
  const newlyApproved = await withSscasnApprovalLock(async () => {
    const audit = await runAudit(sb, institution, true);
    if (!audit.rows.length)
      throw new Error("Belum ada formasi SKD terverifikasi untuk instansi ini.");
    const ready = audit.rows.filter(({ status }) => status === "ready");
    const code = sscasnAuditHash([
      audit.catalog.snapshot.checksum,
      ready.map((row) => [row, audit.source.get(row.candidateIds[0])]),
    ]).slice(0, 16);
    return saveSscasnExactPairs(sb, audit.catalog.snapshot, institution, ready, audit.source, code);
  });
  return { ...(await getSscasnAudit(sb, institution, "review", 1, false)), newlyApproved };
}

export function validateSscasnManualSelection(
  audit: Pick<Awaited<ReturnType<typeof runAudit>>, "rows" | "source" | "existing" | "usedSources">,
  selections: SscasnManualSelection[],
) {
  if (
    !selections.length ||
    selections.length > SSCASN_MANUAL_BATCH_LIMIT ||
    new Set(selections.map(({ formationId }) => formationId)).size !== selections.length ||
    new Set(selections.map(({ sourceId }) => sourceId)).size !== selections.length
  )
    throw new Error("Setiap formasi SKD dan baris Aesen hanya boleh dipilih sekali.");
  const byId = new Map(audit.rows.map((row) => [row.id, row]));
  return selections.map(({ formationId, sourceId }) => {
    const pdf = byId.get(formationId);
    const candidate = audit.source.get(sourceId);
    if (audit.existing.has(formationId) || audit.usedSources.has(sourceId)) {
      throw new Error(
        "Ada pasangan yang sudah dipakai atau memiliki review. Muat ulang hasil audit.",
      );
    }
    if (
      !pdf ||
      !candidate ||
      (pdf.registered === 0 && !candidate.category) ||
      !canManuallyLinkSscasn(pdf, candidate)
    ) {
      throw new Error(
        "Bukti salah satu pasangan tidak lengkap atau sudah berubah. Tidak ada pilihan yang disimpan.",
      );
    }
    return { pdf, candidate };
  });
}

export async function approveSelectedSscasnAudit(
  sb: SupabaseClient,
  institution: string,
  selections: SscasnManualSelection[],
  note: string,
  page: number,
): Promise<SscasnAuditResponse> {
  const evidenceNote = note.trim();
  if (evidenceNote.length < SSCASN_MANUAL_NOTE_MIN || evidenceNote.length > 700) {
    throw new Error("Isi catatan bukti yang menjelaskan pasangan sebelum menyetujui.");
  }
  return withSscasnApprovalLock(async () => {
    const audit = await runAudit(sb, institution, true);
    const pairs = validateSscasnManualSelection(audit, selections);
    const newlyApproved = await saveSscasnManualPairs(
      sb,
      audit.catalog.snapshot,
      institution,
      pairs,
      evidenceNote,
    );
    const saved = pairs.map(({ pdf, candidate }) => ({
      formation_id: pdf.id,
      source_id: candidate.id,
      review_status: "approved" as const,
    }));
    return {
      ...toPage(
        institution,
        classifyAudit(audit, [...audit.existing.values(), ...saved]),
        "review",
        page,
      ),
      newlyApproved,
    };
  });
}
