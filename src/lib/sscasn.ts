export interface SscasnFormation {
  source_id: string;
  institution: string;
  job: string;
  location: string;
  education: string;
  education_options: string[];
  quota: number;
  passed_admin: number;
  salary_min: number | null;
  salary_max: number | null;
}

export interface SscasnSnapshot {
  id: string;
  selection_year: number;
  source_url: string;
  captured_at: string;
  checksum: string;
  scope_institution?: string | null;
  row_count: number;
  quota_total: number;
  passed_admin_total: number;
  import_status: "importing" | "ready";
}

export interface SscasnPdfFormation {
  id: string;
  nama_instansi: string;
  jabatan: string;
  lokasi_formasi: string | null;
  pendidikan: string | null;
  jumlah_formasi: number;
  jenis_formasi: string | null;
  tahun: number;
  page_number: number | null;
}

export interface SscasnMatch {
  formation_id: string;
  snapshot_id: string;
  source_id: string;
  review_status: "pending" | "approved" | "rejected";
  notes: string | null;
  reviewed_at: string | null;
}

export interface SscasnCandidate {
  formation: SscasnFormation;
  exact: boolean;
  differences: string[];
}

export interface SscasnReviewRow {
  pdf: SscasnPdfFormation;
  candidates: SscasnCandidate[];
  match: SscasnMatch | null;
}

export interface SscasnAdminData {
  mode: "database" | "local";
  snapshot: SscasnSnapshot;
  institutions: Array<{
    institution: string;
    row_count: number;
    quota: number;
    passed_admin: number;
  }>;
  formations: SscasnFormation[];
  pagination: { page: number; total: number; total_pages: number };
  review: SscasnReviewRow[];
}

export interface SscasnContext {
  snapshot_id: string;
  selection_year: number;
  source_url: string;
  captured_at: string;
  passed_admin: number;
  quota: number;
  administrative_ratio: number | null;
  salary_min: number | null;
  salary_max: number | null;
}

export function normalizeSscasnText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

export function sscasnEducationKey(value: string | null | undefined): string {
  // Compare the accepted set; sharing a requirement does not make degrees equivalent.
  return [
    ...new Set(
      (value ?? "")
        .split(/\s*\/\s*/)
        .map(normalizeSscasnText)
        .filter(Boolean),
    ),
  ]
    .sort()
    .join(" / ");
}

export function buildSscasnCandidates(
  pdf: SscasnPdfFormation,
  source: SscasnFormation[],
): SscasnCandidate[] {
  if (pdf.tahun !== 2024) return [];
  const candidates = source
    .filter(
      (row) =>
        normalizeSscasnText(row.institution) === normalizeSscasnText(pdf.nama_instansi) &&
        normalizeSscasnText(row.job) === normalizeSscasnText(pdf.jabatan),
    )
    .map((formation) => {
      const differences: string[] = [];
      if (normalizeSscasnText(formation.location) !== normalizeSscasnText(pdf.lokasi_formasi)) {
        differences.push("Lokasi berbeda");
      }
      if (sscasnEducationKey(formation.education) !== sscasnEducationKey(pdf.pendidikan)) {
        differences.push("Syarat pendidikan berbeda");
      }
      if (formation.quota !== pdf.jumlah_formasi) differences.push("Kuota berbeda");
      return { formation, exact: differences.length === 0, differences };
    })
    .sort(
      (a, b) =>
        a.differences.length - b.differences.length ||
        a.formation.source_id.localeCompare(b.formation.source_id),
    );
  return candidates.slice(0, 5);
}
