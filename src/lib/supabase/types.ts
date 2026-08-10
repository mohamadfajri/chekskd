/** Minimal application-facing database types. */

export type BatchStatus = "draft" | "importing" | "review" | "verified" | "published" | "rejected";

export type QualityStatus = "parsed" | "auto_corrected" | "needs_review" | "verified" | "rejected";

export interface SkdBatch {
  id: string;
  slug: string;
  institution_code: string | null;
  institution_name: string;
  selection_year: number;
  parser_family: string;
  parser_version: string;
  status: BatchStatus;
  source_count: number;
  source_page_count: number;
  formation_count: number;
  participant_count: number;
  review_issue_count: number;
  quality_report: Record<string, unknown>;
  notes: string | null;
  verified_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkdSource {
  id: string;
  batch_id: string;
  sheet_row: number | null;
  file_name: string;
  drive_file_id: string | null;
  source_url: string | null;
  sha256: string | null;
  total_pages: number | null;
  document_type: "skd" | "integration" | "unknown";
  has_text_layer: boolean | null;
  created_at: string;
}

export interface SkdFormation {
  id: string;
  batch_id: string;
  source_id: string;
  formation_key: string;
  tahun: number;
  kode_instansi: string | null;
  nama_instansi: string;
  kode_jabatan: string | null;
  jabatan: string;
  kode_lokasi: string | null;
  lokasi_formasi: string | null;
  kode_jenis_formasi: string | null;
  jenis_formasi: string | null;
  pendidikan: string | null;
  pendidikan_options: string[];
  jumlah_formasi: number;
  page_number: number | null;
  quality_status: QualityStatus;
  parser_confidence: number | null;
  raw_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SkdScore {
  id: string;
  batch_id: string;
  source_id: string;
  formation_id: string;
  no_peserta: string;
  nama: string;
  nama_raw: string | null;
  nama_normalized: string;
  pendidikan: string | null;
  pendidikan_raw: string | null;
  tahun_skd: number | null;
  twk: number | null;
  tiu: number | null;
  tkp: number | null;
  total: number | null;
  keterangan: string;
  source_page: number;
  quality_status: QualityStatus;
  parser_confidence: number | null;
  raw_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SkdScoreWithFormation extends SkdScore {
  skd_formations: SkdFormation | null;
}

export interface SkdReviewIssue {
  id: string;
  batch_id: string;
  formation_id: string | null;
  score_id: string | null;
  field_name: string;
  issue_code: string;
  severity: "info" | "warning" | "error";
  raw_value: string | null;
  suggested_value: string | null;
  confidence: number | null;
  status: "open" | "resolved" | "ignored";
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  score_id: string | null;
  nama_panggilan: string | null;
  whatsapp: string | null;
  target_tahun: string | null;
  target_instansi: string | null;
  target_formasi: string | null;
  rencana: string | null;
  consent_whatsapp: boolean;
  consent_marketing: boolean;
  segment: string | null;
  created_at: string;
  last_contacted_at: string | null;
  opt_out_at: string | null;
}

export interface ResultSession {
  id: string;
  token: string;
  score_id: string | null;
  lead_id: string | null;
  nama_peserta: string | null;
  instansi: string | null;
  formasi: string | null;
  twk: number | null;
  tiu: number | null;
  tkp: number | null;
  total: number | null;
  zona: string | null;
  analysis_text: string;
  analysis_snapshot: Record<string, unknown>;
  rationalization_snapshot: Record<string, unknown>;
  status: "waiting" | "queued" | "processing" | "ready" | "delivered" | "failed" | "expired";
  created_at: string;
  updated_at: string;
  expired_at: string;
  used_count: number;
  sender_wa_id: string | null;
  last_inbound_message_id: string | null;
  delivered_at: string | null;
  card_rendered_at: string | null;
  queued_at: string | null;
  processing_started_at: string | null;
  ready_at: string | null;
  failed_at: string | null;
  failure_message: string | null;
}

export interface SkdAnalysisJob {
  id: string;
  session_id: string;
  score_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  attempts: number;
  available_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  worker_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
};

export interface Database {
  public: {
    Tables: {
      skd_batches: Table<SkdBatch>;
      skd_sources: Table<SkdSource>;
      skd_formations: Table<SkdFormation>;
      skd_scores: Table<SkdScore>;
      skd_review_issues: Table<SkdReviewIssue>;
      leads: Table<Lead>;
      result_sessions: Table<ResultSession>;
      skd_analysis_jobs: Table<SkdAnalysisJob>;
      lead_events: Table<Record<string, unknown>>;
    };
  };
}
