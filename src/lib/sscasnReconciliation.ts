import { normalizeSscasnText as norm, sscasnEducationKey } from "./sscasn.ts";

interface Evidence {
  id: string;
  institution: string;
  job: string;
  location: string | null;
  education: string | null;
  quota: number;
  registered: number;
}

export interface OfficialSscasnEvidence extends Evidence {
  category: string | null;
  page: number | null;
  statsQuota: number;
  attended: number;
  pdfSourceId?: string;
  zeroRecapVerified?: boolean;
}

export interface AesenSscasnEvidence extends Evidence {
  location: string;
  education: string;
  salary_min: number | null;
  salary_max: number | null;
  category?: string | null;
  categorySource?: "archive" | "detail_api" | null;
  verifiedRegistered?: number | null;
}

export interface ExistingSscasnReview {
  formation_id: string;
  source_id: string;
  review_status: "approved" | "pending" | "rejected";
}

interface AuditRecap {
  audit_status: string;
  pdf_page: number;
  pdf_job: string;
  pdf_category: string;
  location: string;
  education: string;
  quota: number;
  pdf_participants: number;
  pdf_present: number;
  candidates: { source_id: string }[];
}

export const SSCASN_AUDIT_LABELS = {
  ready: "Cocok, belum disetujui",
  already_approved: "Disetujui",
  existing_review: "Sudah ada review",
  incomplete_evidence: "Bukti belum lengkap",
  zero_recap_required: "Nol peserta belum diverifikasi dari PDF",
  zero_detail_required: "Nol lolos administrasi belum diverifikasi dari API detail",
  category_mismatch: "Kategori formasi berbeda",
  no_exact_candidate: "Tidak ada pasangan tepat",
  ambiguous: "Pasangan tidak unik",
  audit_mismatch: "Rekap PDF berbeda",
  source_in_use: "Kandidat sudah dipakai",
  review_job_prefix: "Awalan kode jabatan berbeda",
} as const;

export type SscasnAuditStatus = keyof typeof SSCASN_AUDIT_LABELS;
export type SscasnAuditFilter = "all" | "ready" | "review" | "already_approved";
export const SSCASN_MANUAL_NOTE_PREFIX = "Review manual SSCASN: ";
export const SSCASN_MANUAL_BATCH_LIMIT = 25;
export const SSCASN_MANUAL_NOTE_MIN = 10;

export interface SscasnManualSelection {
  formationId: string;
  sourceId: string;
}
export type SscasnAuditRow = OfficialSscasnEvidence & {
  status: SscasnAuditStatus;
  candidateIds: string[];
};
export interface SscasnAuditResponse {
  institution: string;
  newlyApproved?: number;
  summary: { total: number; ready: number; alreadyApproved: number; review: number };
  rows: Array<
    Omit<SscasnAuditRow, "candidateIds"> & {
      candidates: Array<{ row: AesenSscasnEvidence; differences: string[]; canApprove: boolean }>;
    }
  >;
  pagination: { page: number; total: number; totalPages: number };
}

export function approvedSscasnSources(reviews: ExistingSscasnReview[]) {
  return new Map(
    reviews
      .filter(({ review_status }) => review_status === "approved")
      .map(({ source_id, formation_id }) => [source_id, formation_id]),
  );
}

export const sscasnAuditJobKey = (value: string) => norm(value).replace(/^\d+ - /, "");
const categoryKey = (value?: string | null) => norm(value).replace(/\s*\/\s*/g, "/");

export function sscasnAuditEvidenceKey({ institution, job, location, education, quota, registered }: Evidence) {
  return JSON.stringify([
    norm(institution),
    sscasnAuditJobKey(job),
    norm(location),
    sscasnEducationKey(education),
    quota,
    registered,
  ]);
}

function groupByKey<T extends Evidence>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const id = sscasnAuditEvidenceKey(row);
    const group = grouped.get(id);
    if (group) group.push(row);
    else grouped.set(id, [row]);
  }
  return grouped;
}

function hasCompleteEvidence(row: OfficialSscasnEvidence) {
  return (
    row.page !== null &&
    Number.isSafeInteger(row.page) &&
    row.page > 0 &&
    Boolean(
      norm(row.institution) &&
      norm(row.category) &&
      norm(row.job) &&
      norm(row.location) &&
      sscasnEducationKey(row.education),
    ) &&
    Number.isSafeInteger(row.quota) &&
    row.quota > 0 &&
    row.quota === row.statsQuota &&
    Number.isSafeInteger(row.registered) &&
    row.registered >= 0 &&
    Number.isSafeInteger(row.attended) &&
    row.attended >= 0 &&
    row.attended <= row.registered
  );
}

export function canManuallyLinkSscasn(
  pdf: OfficialSscasnEvidence,
  source: Evidence & { category?: string | null },
) {
  return (
    hasCompleteEvidence(pdf) &&
    (!source.category || categoryKey(pdf.category) === categoryKey(source.category)) &&
    (norm(pdf.job) === norm(source.job) || sscasnAuditJobKey(pdf.job) === norm(source.job)) &&
    sscasnAuditEvidenceKey(pdf) === sscasnAuditEvidenceKey(source)
  );
}

function auditMatches(
  proof: AuditRecap | undefined,
  row: OfficialSscasnEvidence,
  candidate: AesenSscasnEvidence | null,
) {
  return (
    proof &&
    candidate &&
    ["exact_with_recap", "prefix_with_recap"].includes(proof.audit_status) &&
    proof.pdf_page === row.page &&
    norm(proof.pdf_job) === norm(row.job) &&
    norm(proof.pdf_category) === norm(row.category) &&
    norm(proof.location) === norm(row.location) &&
    sscasnEducationKey(proof.education) === sscasnEducationKey(row.education) &&
    proof.quota === row.quota &&
    proof.pdf_participants === row.registered &&
    proof.pdf_present === row.attended &&
    proof.candidates.length === 1 &&
    proof.candidates[0].source_id === candidate.id
  );
}

export function reconcileCatalog(
  official: OfficialSscasnEvidence[],
  source: AesenSscasnEvidence[],
  existing: ExistingSscasnReview[],
  audited?: ReadonlyMap<string, AuditRecap>,
): SscasnAuditRow[] {
  const aesen = groupByKey(source);
  const pdf = groupByKey(official);
  const byFormation = new Map(existing.map((row) => [row.formation_id, row]));
  const usedSources = new Set(
    existing.filter((row) => row.review_status === "approved").map((row) => row.source_id),
  );
  return official.map((row) => {
    const signature = sscasnAuditEvidenceKey(row);
    const group = aesen.get(signature) ?? [];
    const category = categoryKey(row.category);
    const candidates = group.filter(
      (candidate) => !candidate.category || categoryKey(candidate.category) === category,
    );
    const match = byFormation.get(row.id);
    const candidate = candidates.length === 1 ? candidates[0] : null;
    const hasRecap = auditMatches(audited?.get(row.id), row, candidate);
    const peers = (pdf.get(signature) ?? []).filter(
      (peer) => !candidate?.category || !peer.category || categoryKey(peer.category) === category,
    );
    let status: SscasnAuditStatus;
    if (match) status = match.review_status === "approved" ? "already_approved" : "existing_review";
    else if (!hasCompleteEvidence(row)) status = "incomplete_evidence";
    else if (!group.length) status = "no_exact_candidate";
    else if (!candidates.length) status = "category_mismatch";
    else if (!candidate || peers.length !== 1 || (!candidate.category && group.length > 1))
      status = "ambiguous";
    else if (row.registered === 0 && !hasRecap && !row.zeroRecapVerified)
      status = "zero_recap_required";
    else if (
      row.registered === 0 &&
      (!candidate.category ||
        candidate.categorySource !== "detail_api" ||
        candidate.verifiedRegistered !== 0)
    )
      status = "zero_detail_required";
    else if (audited && !hasRecap) status = "audit_mismatch";
    else if (usedSources.has(candidate.id)) status = "source_in_use";
    else if (norm(candidate.job) !== norm(row.job)) status = "review_job_prefix";
    else status = "ready";
    return { ...row, status, candidateIds: candidates.map(({ id }) => id).sort() };
  });
}

export function sscasnAuditDifferences(
  pdf: Evidence & { category?: string | null },
  aesen: Evidence & { category?: string | null },
): string[] {
  return [
    [norm(pdf.institution) === norm(aesen.institution), "Instansi"],
    [norm(pdf.job) === norm(aesen.job), "Jabatan"],
    [norm(pdf.location) === norm(aesen.location), "Lokasi"],
    [sscasnEducationKey(pdf.education) === sscasnEducationKey(aesen.education), "Pendidikan"],
    [pdf.quota === aesen.quota, "Kuota"],
    [pdf.registered === aesen.registered, "Jumlah peserta"],
    [!aesen.category || categoryKey(pdf.category) === categoryKey(aesen.category), "Kategori"],
  ].flatMap(([same, label]) => (same ? [] : [String(label)]));
}
