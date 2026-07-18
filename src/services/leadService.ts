import { requireSupabase } from "@/lib/supabase/client";
import { buildAnalysisText, generateToken, type AnalysisContext } from "@/lib/analysis";
import type { Lead, ResultSession } from "@/lib/supabase/types";

export interface LeadFormInput {
  nama_panggilan: string;
  whatsapp: string;
  target_tahun: "2026" | "2027" | "Belum tahu";
  rencana: "Pakai nilai lama" | "Tes ulang" | "Belum yakin";
  target_instansi?: string;
  target_formasi?: string;
  consent_whatsapp: boolean;
}

export interface CreateSessionInput {
  score_id: string;
  score: AnalysisContext;
  lead: LeadFormInput;
}

export interface CreateSessionResult {
  token: string;
  session: ResultSession;
  lead: Lead;
}

export async function createLeadAndSession(
  input: CreateSessionInput,
): Promise<CreateSessionResult> {
  const sb = requireSupabase();

  // 1. Insert lead
  const { data: lead, error: leadErr } = await sb
    .from("leads")
    .insert({
      score_id: input.score_id,
      nama_panggilan: input.lead.nama_panggilan,
      whatsapp: input.lead.whatsapp,
      target_tahun: input.lead.target_tahun,
      target_instansi: input.lead.target_instansi ?? null,
      target_formasi: input.lead.target_formasi ?? null,
      rencana: input.lead.rencana,
      consent_whatsapp: input.lead.consent_whatsapp,
    })
    .select()
    .single();
  if (leadErr) throw leadErr;

  // 2. Build analysis text
  const ctx: AnalysisContext = {
    ...input.score,
    nama_panggilan: input.lead.nama_panggilan,
    rencana: input.lead.rencana,
  };
  const { text, zona } = buildAnalysisText(ctx);

  // 3. Generate unique token (retry on collision)
  let token = generateToken();
  for (let i = 0; i < 5; i++) {
    const { data: dup } = await sb
      .from("result_sessions")
      .select("id")
      .eq("token", token)
      .maybeSingle();
    if (!dup) break;
    token = generateToken();
  }

  // 4. Insert session
  const { data: session, error: sessErr } = await sb
    .from("result_sessions")
    .insert({
      token,
      score_id: input.score_id,
      lead_id: (lead as Lead).id,
      nama_peserta: ctx.nama_peserta,
      instansi: ctx.instansi,
      formasi: ctx.formasi,
      twk: ctx.twk,
      tiu: ctx.tiu,
      tkp: ctx.tkp,
      total: ctx.total,
      zona,
      analysis_text: text,
    })
    .select()
    .single();
  if (sessErr) throw sessErr;

  return { token, session: session as ResultSession, lead: lead as Lead };
}

export async function getSessionByToken(token: string): Promise<ResultSession | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("result_sessions")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  return data as ResultSession | null;
}
