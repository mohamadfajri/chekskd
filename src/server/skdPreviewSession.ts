import type { SupabaseClient } from "@supabase/supabase-js";
import { generateToken } from "../lib/analysis.ts";
import { buildRationalizationCaption, type RationalizationSnapshot } from "../lib/rationalization.ts";

export async function createSkdPreviewSession(
  sb: SupabaseClient,
  snapshot: RationalizationSnapshot,
  sender: string,
) {
  const expiredAt = new Date(Date.now() + 30 * 60_000).toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateToken();
    const { error } = await sb.from("result_sessions").insert({
      token,
      score_id: snapshot.score_id,
      lead_id: null,
      nama_peserta: snapshot.participant.name,
      instansi: snapshot.formation.institution,
      formasi: snapshot.formation.position,
      twk: snapshot.participant.twk,
      tiu: snapshot.participant.tiu,
      tkp: snapshot.participant.tkp,
      total: snapshot.participant.total,
      zona: snapshot.verdict.code,
      analysis_text: buildRationalizationCaption(snapshot),
      analysis_snapshot: {},
      rationalization_snapshot: snapshot,
      status: "ready",
      ready_at: new Date().toISOString(),
      expired_at: expiredAt,
      sender_wa_id: sender,
    });
    if (!error) return { token, expired_at: expiredAt, status: "ready" as const };
    if (error.code !== "23505") throw error;
  }
  throw new Error("Tidak dapat membuat kode preview yang unik.");
}
