export interface LeadFormInput {
  nama_panggilan: string;
  target_tahun: "2026" | "2027" | "Belum tahu";
  rencana: "Pakai nilai lama" | "Tes ulang" | "Belum yakin";
  target_instansi?: string;
  target_formasi?: string;
  consent_whatsapp: boolean;
  consent_marketing: boolean;
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
