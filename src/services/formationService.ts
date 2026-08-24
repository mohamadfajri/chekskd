export type FormationCompetitionLevel = "quiet" | "low" | "medium" | "high";
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

export interface FormationEducationFilterOption extends FormationFilterOption {
  aliases?: string[];
}

export interface FormationFilterOptions {
  institutions: FormationFilterOption[];
  formation_types: FormationFilterOption[];
  education_options: FormationEducationFilterOption[];
  education_total: number;
  years: number[];
}

export interface FormationExplorerResponse {
  access: "preview" | "full";
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

export class FormationAuthRequiredError extends Error {
  constructor(message = "Masuk untuk membuka data formasi lengkap.") {
    super(message);
    this.name = "FormationAuthRequiredError";
  }
}

export function isFormationAuthRequired(error: unknown): boolean {
  return error instanceof FormationAuthRequiredError;
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    (T & { message?: string; code?: string }) | null;
  if (response.status === 401 || body?.code === "AUTH_REQUIRED") {
    throw new FormationAuthRequiredError(body?.message);
  }
  if (!response.ok || !body) {
    throw new Error(body?.message ?? `Data formasi belum dapat dimuat (${response.status}).`);
  }
  return body;
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
  const query = new URLSearchParams({
    sort: params.sort ?? "competition_desc",
    page: String(params.page ?? 1),
    page_size: String(params.pageSize ?? 24),
  });
  if (params.query?.trim()) query.set("query", params.query.trim());
  if (params.institution?.trim()) query.set("institution", params.institution.trim());
  if (params.education?.trim()) query.set("education", params.education.trim());
  if (params.formationType?.trim()) query.set("formation_type", params.formationType.trim());
  if (params.competitionLevel) query.set("competition_level", params.competitionLevel);

  const response = await readResponse<FormationExplorerResponse>(
    await fetch(`/api/formations?${query.toString()}`),
  );
  if (!response || !Array.isArray(response.formations)) {
    throw new Error("Respons data formasi tidak valid.");
  }
  return response;
}

export async function getFormationFilterOptions(): Promise<FormationFilterOptions> {
  const response = await readResponse<FormationFilterOptions>(
    await fetch("/api/formation-filters"),
  );
  if (
    !Array.isArray(response.institutions) ||
    !Array.isArray(response.formation_types) ||
    !Array.isArray(response.education_options)
  ) {
    throw new Error("Respons pilihan filter tidak valid.");
  }
  return response;
}

export async function getPublicFormationDetail(
  formationId: string,
): Promise<PublicFormationDetail | null> {
  const response = await readResponse<{ formation: PublicFormationDetail | null }>(
    await fetch(`/api/formations/${encodeURIComponent(formationId)}`),
  );
  return response.formation;
}
