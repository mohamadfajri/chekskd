/**
 * Minimal DB types for MVP. Regenerate with `supabase gen types typescript`
 * once the schema is provisioned on your Supabase project.
 */

export interface SkdFormation {
  id: string;
  source_id: string | null;
  tahun: number | null;
  kode_instansi: string | null;
  nama_instansi: string | null;
  kode_jabatan: string | null;
  jabatan: string | null;
  kode_lokasi: string | null;
  lokasi_formasi: string | null;
  jenis_formasi: string | null;
  pendidikan: string | null;
  jumlah_formasi: number | null;
  page_number: number | null;
  created_at: string;
}

export interface SkdScore {
  id: string;
  formation_id: string | null;
  no_peserta: string | null;
  nama: string;
  pendidikan: string | null;
  tahun_skd: number | null;
  twk: number | null;
  tiu: number | null;
  tkp: number | null;
  total: number | null;
  keterangan: string | null;
  nama_normalized: string | null;
  source_page: number | null;
  created_at: string;
}

export interface SkdScoreWithFormation extends SkdScore {
  skd_formations: SkdFormation | null;
}

export interface Lead {
  id: string;
  score_id: string | null;
  nama_panggilan: string;
  whatsapp: string;
  target_tahun: string | null;
  target_instansi: string | null;
  target_formasi: string | null;
  rencana: string | null;
  consent_whatsapp: boolean;
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
  created_at: string;
  expired_at: string | null;
  used_count: number;
}

export interface Database {
  public: {
    Tables: {
      skd_formations: {
        Row: SkdFormation;
        Insert: Partial<SkdFormation>;
        Update: Partial<SkdFormation>;
      };
      skd_scores: { Row: SkdScore; Insert: Partial<SkdScore>; Update: Partial<SkdScore> };
      leads: { Row: Lead; Insert: Partial<Lead>; Update: Partial<Lead> };
      result_sessions: {
        Row: ResultSession;
        Insert: Partial<ResultSession>;
        Update: Partial<ResultSession>;
      };
      pdf_sources: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      lead_events: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
    };
  };
}
