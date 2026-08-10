export interface LeadFormInput {
  nama_panggilan: string;
  target_tahun: "2026" | "2027" | "Belum tahu";
  rencana: "Pakai nilai lama" | "Tes ulang" | "Belum yakin";
  target_instansi?: string;
  target_formasi?: string;
  target_formation_id?: string;
  consent_whatsapp: boolean;
  consent_marketing: boolean;
}

export interface RationalizationTargetOption {
  id: string;
  institution: string;
  position: string;
  location: string | null;
  formation_type: string;
  education_requirement: string | null;
  quota: number;
  attended: number;
  competition_ratio: number | null;
  cutoff_total: number | null;
  score_gap: number | null;
  above_historical_cutoff: boolean;
}

export interface CreateSessionInput {
  score_id: string;
  lead: LeadFormInput;
}

export interface CreateSessionResult {
  token: string;
  expired_at: string;
  status: "waiting" | "ready";
}

export async function createLeadAndSession(
  input: CreateSessionInput,
): Promise<CreateSessionResult> {
  const response = await fetch("/api/result-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ score_id: input.score_id, lead: input.lead }),
  });
  const body = (await response.json().catch(() => null)) as
    (CreateSessionResult & { message?: string }) | null;
  if (!response.ok || !body) {
    throw new Error(body?.message ?? `Gagal membuat kode hasil (${response.status}).`);
  }
  return body;
}

export async function searchRationalizationTargets(
  scoreId: string,
  query: string,
): Promise<RationalizationTargetOption[]> {
  const params = new URLSearchParams({ score_id: scoreId, q: query.trim() });
  const response = await fetch(`/api/rationalization-targets?${params.toString()}`);
  const body = (await response.json().catch(() => null)) as {
    items?: RationalizationTargetOption[];
    message?: string;
  } | null;
  if (!response.ok || !body) {
    throw new Error(body?.message ?? `Gagal mencari target (${response.status}).`);
  }
  return body.items ?? [];
}
