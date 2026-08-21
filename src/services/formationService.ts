import { requireSupabase } from "@/lib/supabase/client";

export type FormationCompetitionLevel = "low" | "medium" | "high";
export type FormationDataConfidence = "high" | "medium" | "limited";
export type FormationSort =
  "competition_desc" | "competition_asc" | "cutoff_desc" | "quota_desc" | "name_asc";

export interface FormationExplorerParams {
  query?: string;
  institution?: string;
  education?: string;
  formationType?: string;
  competitionLevel?: FormationCompetitionLevel | "";
  sort?: FormationSort;
  page?: number;
  pageSize?: number;
}

export interface PublicFormation {
  id: string;
  kode_instansi: string | null;
  nama_instansi: string;
  kode_jabatan: string | null;
  jabatan: string;
  lokasi_formasi: string | null;
  jenis_formasi: string | null;
  pendidikan: string | null;
  selection_year: number;
  quota: number;
  participant_count: number;
  attended_count: number;
  passing_count: number;
  competition_ratio: number | null;
  minimum_total: number | null;
  median_total: number | null;
  p75_total: number | null;
  maximum_total: number | null;
  cutoff_total: number | null;
  capacity_consistent: boolean;
  calculated_at: string;
  data_confidence: FormationDataConfidence;
}

export interface FormationFilterOption {
  value: string;
  count: number;
}

export interface FormationExplorerResponse {
  formations: PublicFormation[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
  available_filters: {
    institutions: FormationFilterOption[];
    formation_types: FormationFilterOption[];
    years: number[];
  };
}

export interface FormationScoreBucket {
  from: number;
  to: number;
  count: number;
}

export interface PublicFormationDetail {
  id: string;
  kode_instansi: string | null;
  nama_instansi: string;
  kode_jabatan: string | null;
  jabatan: string;
  kode_lokasi: string | null;
  lokasi_formasi: string | null;
  jenis_formasi: string | null;
  pendidikan: string | null;
  pendidikan_options: string[] | null;
  selection_year: number;
  data_confidence: FormationDataConfidence;
  stats: {
    quota: number;
    shortlist_capacity: number;
    participant_count: number;
    attended_count: number;
    passing_count: number;
    shortlisted_count: number;
    no_show_count: number;
    competition_ratio: number | null;
    minimum_total: number | null;
    median_total: number | null;
    p75_total: number | null;
    maximum_total: number | null;
    cutoff_total: number | null;
    cutoff_twk: number | null;
    cutoff_tiu: number | null;
    cutoff_tkp: number | null;
    cutoff_tie_count: number;
    capacity_consistent: boolean;
    calculated_at: string;
  };
  source: {
    file_name: string | null;
    source_url: string | null;
    page_number: number | null;
    total_pages: number | null;
    document_type: string | null;
  };
  score_distribution: FormationScoreBucket[];
  status_counts: Record<string, number>;
}

export async function searchPublicFormations(
  params: FormationExplorerParams,
): Promise<FormationExplorerResponse> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("search_public_skd_formations", {
    p_query: params.query?.trim() || null,
    p_instansi: params.institution?.trim() || null,
    p_pendidikan: params.education?.trim() || null,
    p_jenis_formasi: params.formationType?.trim() || null,
    p_competition_level: params.competitionLevel || null,
    p_sort: params.sort ?? "competition_desc",
    p_page: params.page ?? 1,
    p_page_size: params.pageSize ?? 24,
  });
  if (error) throw error;

  const response = data as FormationExplorerResponse | null;
  if (!response || !Array.isArray(response.formations)) {
    throw new Error("Respons data formasi tidak valid.");
  }
  return response;
}

export async function getPublicFormationDetail(
  formationId: string,
): Promise<PublicFormationDetail | null> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("get_public_skd_formation_detail", {
    p_formation_id: formationId,
  });
  if (error) throw error;
  return (data as PublicFormationDetail | null) ?? null;
}
