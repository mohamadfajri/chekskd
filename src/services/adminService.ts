/**
 * CSV row shape expected by admin importer.
 * Columns: tahun, nama_instansi, kode_instansi, jabatan, kode_jabatan,
 * kode_lokasi, lokasi_formasi, jenis_formasi, pendidikan_formasi, pendidikan,
 * jumlah_formasi, no_peserta, nama, tahun_nilai_skd, twk, tiu, tkp, total,
 * keterangan, source_pdf, source_url, source_page
 */
export interface CsvRow {
  record_type?: string;
  parser_family?: string;
  parser_version?: string;
  formation_quality_status?: string;
  quality_status?: string;
  parser_confidence?: string;
  tahun?: string;
  nama_instansi?: string;
  kode_instansi?: string;
  jabatan?: string;
  kode_jabatan?: string;
  kode_lokasi?: string;
  lokasi_formasi?: string;
  kode_jenis_formasi?: string;
  jenis_formasi?: string;
  pendidikan_formasi?: string;
  pendidikan?: string;
  pendidikan_raw?: string;
  jumlah_formasi?: string;
  no_peserta?: string;
  nama?: string;
  nama_raw?: string;
  nama_normalized?: string;
  tahun_nilai_skd?: string;
  tahun_skd?: string;
  twk?: string;
  tiu?: string;
  tkp?: string;
  total?: string;
  keterangan?: string;
  source_pdf?: string;
  source_url?: string;
  source_page?: string;
  source_page_formasi?: string;
  source_sheet_row?: string;
  source_drive_file_id?: string;
  source_total_pages?: string;
  formation_instance_id?: string;
  validation_status?: string;
  validation_errors?: string;
}

export interface PdfSourceCsvRow {
  sheet_row?: string;
  section?: string;
  entity_name?: string;
  entity_type?: string;
  pdf_name?: string;
  drive_file_id?: string;
  drive_url?: string;
  tahun?: string;
  duplicate_count?: string;
  warnings?: string;
}

export interface PdfSourceValidationIssue {
  index: number;
  row: PdfSourceCsvRow;
  errors: string[];
}

export interface PdfSourceValidationResult {
  valid: PdfSourceCsvRow[];
  invalid: PdfSourceValidationIssue[];
}

export interface PdfSourceImportProgress {
  processed: number;
  sourcesInserted: number;
  errors: string[];
}

export interface PdfSourceStats {
  total: number;
  withUrl: number;
  withoutUrl: number;
  byYear: Record<string, number>;
}

function toInt(v: string | undefined | null): number | null {
  if (v == null || v === "") return null;
  const n = parseInt(String(v).replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

export interface RowValidationIssue {
  index: number; // 0-based index in original CSV
  row: CsvRow;
  errors: string[];
}

export interface ValidationResult {
  valid: CsvRow[];
  invalid: RowValidationIssue[];
}

function isIntInRange(v: string | undefined | null, min: number, max: number): boolean {
  if (v == null || String(v).trim() === "") return false;
  const n = Number(String(v).trim());
  return Number.isInteger(n) && n >= min && n <= max;
}

function formationKey(row: CsvRow): string {
  return row.formation_instance_id?.trim() || "";
}

/**
 * Validasi baris CSV:
 * - Wajib: nomor peserta, nama, tahun, instansi, dan jabatan
 * - TH/TMS/DIS boleh tidak memiliki nilai
 * - Baris hasil parser yang masih perlu review selalu ditolak
 * - Konsistensi: total = twk + tiu + tkp
 */
export function validateCsvRows(rows: CsvRow[]): ValidationResult {
  const valid: CsvRow[] = [];
  const invalid: RowValidationIssue[] = [];

  rows.forEach((row, index) => {
    const errors: string[] = [];
    const recordType = row.record_type?.trim().toLowerCase() || "participant";
    const formationOnly = recordType === "formation";
    const status = row.keterangan?.trim().toUpperCase() ?? "";
    const absent = ["TH", "TMS", "DIS"].includes(status);

    if (!row.parser_family?.trim()) errors.push("kolom 'parser_family' kosong");
    if (!row.parser_version?.trim() || !/^3(?:\.|$)/.test(row.parser_version.trim())) {
      errors.push("kolom 'parser_version' wajib versi 3");
    }
    if (!row.quality_status?.trim()) errors.push("kolom 'quality_status' kosong");
    if (!row.formation_instance_id?.trim()) errors.push("kolom 'formation_instance_id' kosong");

    if (!["participant", "formation"].includes(recordType)) {
      errors.push("kolom 'record_type' harus participant atau formation");
    }
    if (!formationOnly && !row.no_peserta?.trim()) errors.push("kolom 'no_peserta' kosong");
    if (!formationOnly && (!row.nama || String(row.nama).trim() === "")) {
      errors.push("kolom 'nama' kosong");
    }
    if (!isIntInRange(row.tahun, 2000, 2100))
      errors.push("kolom 'tahun' kosong / bukan tahun valid");
    if (!(row.nama_instansi?.trim() || row.kode_instansi?.trim()))
      errors.push("'nama_instansi' atau 'kode_instansi' wajib diisi");
    if (!(row.jabatan?.trim() || row.kode_jabatan?.trim()))
      errors.push("'jabatan' atau 'kode_jabatan' wajib diisi");
    if (row.quality_status?.trim().toLowerCase() === "rejected") {
      errors.push("baris parser berstatus rejected");
    }
    if (!formationOnly && !/^(P\/L|P|TL|TH|TMS|DIS)$/.test(status)) {
      errors.push("kolom 'keterangan' kosong / status tidak dikenal");
    }

    if (!formationOnly) {
      const numCols: Array<[keyof CsvRow, number, number]> = [
        ["twk", 0, 150],
        ["tiu", 0, 175],
        ["tkp", 0, 225],
        ["total", 0, 550],
      ];
      for (const [col, min, max] of numCols) {
        const v = row[col] as string | undefined;
        if (v == null || String(v).trim() === "") {
          if (!absent) errors.push(`kolom '${String(col)}' kosong`);
        } else if (!isIntInRange(v, min, max)) {
          errors.push(`kolom '${String(col)}' bukan angka valid (${min}-${max})`);
        }
      }

      const scoreValues = [row.twk, row.tiu, row.tkp, row.total];
      if (scoreValues.every((value) => value != null && String(value).trim() !== "")) {
        const [twk, tiu, tkp, total] = scoreValues.map(Number);
        if (twk + tiu + tkp !== total) {
          errors.push(`total (${total}) tidak sama dengan twk+tiu+tkp (${twk + tiu + tkp})`);
        }
      }
    }

    if (errors.length === 0) valid.push(row);
    else invalid.push({ index, row, errors });
  });

  return { valid, invalid };
}

export function validatePdfSourceRows(rows: PdfSourceCsvRow[]): PdfSourceValidationResult {
  const valid: PdfSourceCsvRow[] = [];
  const invalid: PdfSourceValidationIssue[] = [];

  rows.forEach((row, index) => {
    const errors: string[] = [];

    if (!isIntInRange(row.tahun, 2000, 2100)) {
      errors.push("kolom 'tahun' kosong / bukan tahun valid");
    }
    if (!row.entity_name?.trim()) errors.push("kolom 'entity_name' kosong");
    if (!row.pdf_name?.trim()) errors.push("kolom 'pdf_name' kosong");
    if (!row.drive_url?.trim()) errors.push("kolom 'drive_url' kosong");

    if (errors.length === 0) valid.push(row);
    else invalid.push({ index, row, errors });
  });

  return { valid, invalid };
}

async function readAdminJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  if (!response.ok) {
    throw new Error(body?.message ?? `Request gagal (${response.status}).`);
  }
  return body as T;
}

export async function getPdfSourceStats(adminPassword: string): Promise<PdfSourceStats> {
  const response = await fetch("/api/admin/pdf-sources", {
    method: "GET",
    headers: {
      "x-admin-password": adminPassword,
    },
  });
  return readAdminJson<PdfSourceStats>(response);
}

export interface SkdBatchSummary {
  id: string;
  slug: string;
  institution_code: string | null;
  institution_name: string;
  selection_year: number;
  parser_family: string;
  parser_version: string;
  status: "draft" | "importing" | "review" | "verified" | "published" | "rejected";
  source_count: number;
  source_page_count: number;
  formation_count: number;
  participant_count: number;
  review_issue_count: number;
  created_at: string;
  updated_at: string;
}

export async function validateAdminPassword(adminPassword: string): Promise<void> {
  const response = await fetch("/api/admin/skd-batches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "validate", adminPassword }),
  });
  await readAdminJson<{ valid: true }>(response);
}

export async function validateAdminSession(): Promise<void> {
  const response = await fetch("/api/admin/skd-batches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "validate" }),
  });
  await readAdminJson<{ valid: true }>(response);
}

export async function getSkdBatches(adminPassword: string): Promise<SkdBatchSummary[]> {
  const response = await fetch("/api/admin/skd-batches", {
    headers: { "x-admin-password": adminPassword },
  });
  const body = await readAdminJson<{ batches: SkdBatchSummary[] }>(response);
  return body.batches;
}

export type ResultSessionStatus =
  "waiting" | "queued" | "processing" | "ready" | "delivered" | "failed" | "expired";

export interface AdminResultSession {
  id: string;
  token: string;
  status: ResultSessionStatus;
  sender_wa_id: string | null;
  used_count: number;
  nama_peserta: string | null;
  instansi: string | null;
  formasi: string | null;
  twk: number | null;
  tiu: number | null;
  tkp: number | null;
  total: number | null;
  zona: string | null;
  created_at: string;
  updated_at: string;
  ready_at: string | null;
  delivered_at: string | null;
  failure_message: string | null;
  leads: {
    nama_panggilan: string | null;
    target_instansi: string | null;
    target_formasi: string | null;
    recommendation_mode: "related" | "all";
    consent_marketing: boolean;
  } | null;
}

export interface AdminResultSessionData {
  summary: {
    by_status: Record<ResultSessionStatus, number>;
    phone_bound: number;
    marketing_consented: number;
  };
  sessions: AdminResultSession[];
}

export async function getAdminResultSessions(
  adminPassword: string,
): Promise<AdminResultSessionData> {
  const response = await fetch("/api/admin/result-sessions", {
    headers: { "x-admin-password": adminPassword },
  });
  return readAdminJson<AdminResultSessionData>(response);
}

export interface AdminMarketingInsights {
  generated_at: string;
  funnel: {
    leads: number;
    codes_created: number;
    requested_on_whatsapp: number;
    analyses_completed: number;
    results_delivered: number;
    marketing_ready: number;
    code_to_whatsapp_rate: number;
    delivery_rate: number;
  };
  segments: Record<string, number>;
  recommendation_modes: Record<string, number>;
  priority_subtests: Record<string, number>;
  top_recommended_institutions: Array<{ institution: string; mentions: number }>;
  recent_daily: Array<{
    date: string;
    codes_created: number;
    whatsapp_requests: number;
    delivered: number;
  }>;
  operational: {
    jobs_observed: number;
    by_status: {
      queued: number;
      processing: number;
      completed: number;
      failed: number;
    };
    retried_jobs: number;
    average_processing_seconds: number;
    median_processing_seconds: number;
    p95_processing_seconds: number;
    median_queue_seconds: number;
    unique_whatsapp_users: number;
    repeat_whatsapp_users: number;
  };
  quality: {
    analyses_observed: number;
    quality_signals_observed: number;
    recommendations_empty: number;
    limited_confidence: number;
    fallback_used: number;
    cross_position_used: number;
    average_recommendation_count: number;
  };
  top_failures: Array<{ message: string; count: number }>;
  suggested_actions: string[];
}

export async function getAdminMarketingInsights(
  adminPassword: string,
): Promise<AdminMarketingInsights> {
  const response = await fetch("/api/admin/marketing-insights", {
    headers: { "x-admin-password": adminPassword },
  });
  return readAdminJson<AdminMarketingInsights>(response);
}

export interface PublishedInstitution {
  id: string;
  institution_code: string | null;
  institution_name: string;
  selection_year: number;
  source_count: number;
  source_page_count: number;
  formation_count: number;
  participant_count: number;
  published_at: string | null;
}

export interface PublishedFormation {
  id: string;
  batch_id: string;
  institution_name: string;
  kode_jabatan: string | null;
  jabatan: string;
  lokasi_formasi: string | null;
  jenis_formasi: string | null;
  pendidikan: string | null;
  jumlah_formasi: number;
  quality_status: string;
  stats: {
    quota: number;
    participant_count: number;
    attended_count: number;
    passing_count: number;
    competition_ratio: number | null;
    minimum_total: number | null;
    median_total: number | null;
    maximum_total: number | null;
    cutoff_total: number | null;
    capacity_consistent: boolean;
  } | null;
}

export interface PublishedDataOverview {
  summary: {
    institutions: number;
    sources: number;
    pages: number;
    formations: number;
    participants: number;
  };
  institutions: PublishedInstitution[];
}

export interface PublishedFormationData extends PublishedDataOverview {
  formations: PublishedFormation[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
}

export async function getPublishedDataOverview(
  adminPassword: string,
): Promise<PublishedDataOverview> {
  const response = await fetch("/api/admin/published-data", {
    headers: { "x-admin-password": adminPassword },
  });
  return readAdminJson<PublishedDataOverview>(response);
}

export async function getPublishedFormations(
  adminPassword: string,
  filters: { batchId?: string; search?: string; sort?: string; page?: number; pageSize?: number },
): Promise<PublishedFormationData> {
  const params = new URLSearchParams({
    mode: "formations",
    page: String(filters.page ?? 1),
    pageSize: String(filters.pageSize ?? 25),
  });
  if (filters.batchId) params.set("batchId", filters.batchId);
  if (filters.search) params.set("search", filters.search);
  if (filters.sort) params.set("sort", filters.sort);
  const response = await fetch(`/api/admin/published-data?${params.toString()}`, {
    headers: { "x-admin-password": adminPassword },
  });
  return readAdminJson<PublishedFormationData>(response);
}

export interface SkdReviewRow {
  id: string;
  field_name: string;
  issue_code: string;
  severity: "info" | "warning" | "error";
  raw_value: string | null;
  suggested_value: string | null;
  confidence: number | null;
  no_peserta: string | null;
  nama: string | null;
  nama_raw: string | null;
  pendidikan: string | null;
  pendidikan_raw: string | null;
  twk: number | null;
  tiu: number | null;
  tkp: number | null;
  total: number | null;
  keterangan: string | null;
  source_page: number | null;
  institution_name: string | null;
  formation_name: string | null;
  source_file_name: string | null;
  source_url: string | null;
  source_id: string | null;
}

export async function getSkdReviewRows(
  adminPassword: string,
  batchId: string,
): Promise<SkdReviewRow[]> {
  const response = await fetch(
    `/api/admin/skd-review?batchId=${encodeURIComponent(batchId)}&limit=200`,
    { headers: { "x-admin-password": adminPassword } },
  );
  const body = await readAdminJson<{ issues: SkdReviewRow[] }>(response);
  return body.issues;
}

export interface BulkVerifyResult {
  issuesResolved: number;
  scoresVerified: number;
  formationsVerified: number;
  batchStatus: "verified";
}

export async function bulkVerifySkdBatch(
  adminPassword: string,
  batchId: string,
  resolutionNote: string,
): Promise<BulkVerifyResult> {
  const response = await fetch("/api/admin/skd-review", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-password": adminPassword,
    },
    body: JSON.stringify({
      action: "bulk_verify",
      batchId,
      confirmation: "VERIFY_ALL",
      resolutionNote,
    }),
  });
  return readAdminJson<BulkVerifyResult>(response);
}

export interface PublishBatchResult {
  participantCount: number;
  formationCount: number;
  batchStatus: "published";
  publishedAt: string;
}

export async function publishSkdBatch(
  adminPassword: string,
  batchId: string,
): Promise<PublishBatchResult> {
  const response = await fetch("/api/admin/skd-batches", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-password": adminPassword,
    },
    body: JSON.stringify({
      action: "publish",
      batchId,
      confirmation: "PUBLISH_BATCH",
    }),
  });
  return readAdminJson<PublishBatchResult>(response);
}

export interface SkdExplorerFormation {
  id: string;
  kode_jabatan: string | null;
  jabatan: string;
  lokasi_formasi: string | null;
  jenis_formasi: string | null;
  pendidikan: string | null;
  jumlah_formasi: number;
  quality_status: string;
}

export interface SkdExplorerSummary {
  id: string;
  institution_name: string;
  institution_code: string | null;
  selection_year: number;
  status: SkdBatchSummary["status"];
  formation_count: number;
  participant_count: number;
  review_issue_count: number;
  present_count: number;
  absent_count: number;
  passing_count: number;
  needs_review_count: number;
  seat_count: number;
  competition_ratio: number | null;
}

export interface SkdExplorerOverview {
  summary: SkdExplorerSummary;
  formations: SkdExplorerFormation[];
}

export interface SkdExplorerRow {
  id: string;
  source_id: string;
  no_peserta: string;
  nama: string;
  pendidikan: string | null;
  twk: number | null;
  tiu: number | null;
  tkp: number | null;
  total: number | null;
  keterangan: string;
  source_page: number;
  quality_status: string;
  parser_confidence: number | null;
  formation_id: string | null;
  kode_jabatan: string | null;
  jabatan: string | null;
  lokasi_formasi: string | null;
  jenis_formasi: string | null;
  pendidikan_formasi: string | null;
  jumlah_formasi: number;
  source_file_name: string | null;
}

export interface SkdExplorerFilters {
  page: number;
  pageSize?: number;
  search?: string;
  formationId?: string;
  attendance?: "all" | "present" | "absent";
  passing?: "all" | "pass" | "fail";
  quality?: string;
  sort?: "source_page" | "total_desc" | "total_asc" | "name";
}

export interface SkdExplorerRowsResponse {
  rows: SkdExplorerRow[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
}

export async function getSkdExplorerOverview(
  adminPassword: string,
  batchId: string,
): Promise<SkdExplorerOverview> {
  const response = await fetch(
    `/api/admin/skd-explorer?mode=overview&batchId=${encodeURIComponent(batchId)}`,
    { headers: { "x-admin-password": adminPassword } },
  );
  return readAdminJson<SkdExplorerOverview>(response);
}

export async function getSkdExplorerRows(
  adminPassword: string,
  batchId: string,
  filters: SkdExplorerFilters,
): Promise<SkdExplorerRowsResponse> {
  const params = new URLSearchParams({
    mode: "rows",
    batchId,
    page: String(filters.page),
    pageSize: String(filters.pageSize ?? 25),
    attendance: filters.attendance ?? "all",
    passing: filters.passing ?? "all",
    quality: filters.quality ?? "all",
    sort: filters.sort ?? "source_page",
  });
  if (filters.search) params.set("search", filters.search);
  if (filters.formationId && filters.formationId !== "all") {
    params.set("formationId", filters.formationId);
  }

  const response = await fetch(`/api/admin/skd-explorer?${params.toString()}`, {
    headers: { "x-admin-password": adminPassword },
  });
  return readAdminJson<SkdExplorerRowsResponse>(response);
}

export interface ImportProgress {
  batchId?: string;
  processed: number;
  formationsCreated: number;
  scoresInserted: number;
  scoresSkippedExisting: number;
  issuesCreated: number;
  errors: string[];
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

async function postBatchAction<T>(adminPassword: string, body: Record<string, unknown>) {
  const response = await fetch("/api/admin/skd-batches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, adminPassword }),
  });
  return readAdminJson<T>(response);
}

function batchSlug(row: CsvRow): string {
  return [
    row.kode_instansi || row.nama_instansi || "instansi",
    row.tahun || "tahun",
    `v${row.parser_version}`,
  ]
    .join("-")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function importCsvRows(
  rows: CsvRow[],
  adminPassword: string,
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportProgress> {
  const progress: ImportProgress = {
    processed: 0,
    formationsCreated: 0,
    scoresInserted: 0,
    scoresSkippedExisting: 0,
    issuesCreated: 0,
    errors: [],
  };
  if (!rows.length) return progress;
  const first = rows[0];
  const participantRows = rows.filter(
    (row) => (row.record_type?.trim().toLowerCase() || "participant") === "participant",
  );
  const formationMap = new Map<string, CsvRow>();
  for (const row of rows) {
    const key = formationKey(row);
    if (!formationMap.has(key)) formationMap.set(key, row);
  }
  const created = await postBatchAction<{ batchId: string; sourceId: string }>(adminPassword, {
    action: "create",
    batch: {
      slug: batchSlug(first),
      institutionCode: first.kode_instansi,
      institutionName: first.nama_instansi,
      selectionYear: toInt(first.tahun),
      parserFamily: first.parser_family,
      parserVersion: first.parser_version,
      sourcePageCount: toInt(first.source_total_pages),
    },
    source: {
      sheetRow: toInt(first.source_sheet_row),
      fileName: first.source_pdf,
      driveFileId: first.source_drive_file_id,
      sourceUrl: first.source_url,
      totalPages: toInt(first.source_total_pages),
      documentType: "skd",
      hasTextLayer: true,
    },
  });
  progress.batchId = created.batchId;

  for (const slice of chunks([...formationMap.values()], 300)) {
    const result = await postBatchAction<{ formationsUpserted: number; issuesCreated: number }>(
      adminPassword,
      {
        action: "import_formations",
        batchId: created.batchId,
        sourceId: created.sourceId,
        rows: slice,
      },
    );
    progress.formationsCreated += result.formationsUpserted;
    progress.issuesCreated += result.issuesCreated;
    onProgress?.({ ...progress });
  }

  for (const slice of chunks(participantRows, 300)) {
    const result = await postBatchAction<{ scoresUpserted: number; issuesCreated: number }>(
      adminPassword,
      {
        action: "import_scores",
        batchId: created.batchId,
        sourceId: created.sourceId,
        rows: slice,
      },
    );
    progress.scoresInserted += result.scoresUpserted;
    progress.issuesCreated += result.issuesCreated;
    progress.processed += slice.length;
    onProgress?.({ ...progress });
  }

  await postBatchAction(adminPassword, {
    action: "finalize",
    batchId: created.batchId,
    sourceId: created.sourceId,
  });
  return progress;
}

export async function importPdfSourceRows(
  rows: PdfSourceCsvRow[],
  adminPassword: string,
  onProgress?: (p: PdfSourceImportProgress) => void,
): Promise<PdfSourceImportProgress> {
  const progress: PdfSourceImportProgress = { processed: 0, sourcesInserted: 0, errors: [] };
  const CHUNK = 200;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const response = await fetch("/api/admin/pdf-sources", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ adminPassword, rows: slice }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      progress.errors.push(`PDF sources chunk ${i}: ${body?.message ?? response.statusText}`);
    } else {
      const body = (await response.json()) as { sourcesInserted?: number };
      progress.sourcesInserted += body.sourcesInserted ?? 0;
    }

    progress.processed = Math.min(i + CHUNK, rows.length);
    onProgress?.({ ...progress });
  }

  return progress;
}
