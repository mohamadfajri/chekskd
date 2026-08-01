import { createFileRoute } from "@tanstack/react-router";
import { buildAnalysisText, generateToken, type AnalysisContext } from "@/lib/analysis";
import { getServerSupabase, jsonResponse } from "@/lib/supabase/server";

interface LeadInput {
  nama_panggilan?: string;
  whatsapp?: string;
  target_tahun?: string;
  target_instansi?: string;
  target_formasi?: string;
  rencana?: string;
  consent_whatsapp?: boolean;
}

interface CreateBody {
  score_id?: string;
  lead?: LeadInput;
}

function clean(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  if (!result || result.length > maxLength) return null;
  return result;
}

function validWhatsApp(value: string): boolean {
  return /^(?:\+?62|0)8[0-9]{7,13}$/.test(value.replace(/[\s-]/g, ""));
}

export const Route = createFileRoute("/api/result-session")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const body = (await request.json().catch(() => null)) as CreateBody | null;
        const scoreId = clean(body?.score_id, 100);
        const leadInput = body?.lead;
        const namaPanggilan = clean(leadInput?.nama_panggilan, 80);
        const whatsapp = clean(leadInput?.whatsapp, 30);
        const targetTahun = clean(leadInput?.target_tahun, 30);
        const rencana = clean(leadInput?.rencana, 50);

        if (
          !scoreId ||
          !namaPanggilan ||
          !whatsapp ||
          !validWhatsApp(whatsapp) ||
          !targetTahun ||
          !rencana ||
          leadInput?.consent_whatsapp !== true
        ) {
          return jsonResponse(
            { message: "Data form belum lengkap atau nomor WhatsApp tidak valid." },
            400,
          );
        }

        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) {
          return jsonResponse({ message: `Supabase server belum siap: ${configError}` }, 503);
        }

        const { data: score, error: scoreError } = await sb
          .from("skd_scores")
          .select("id, batch_id, formation_id, nama, twk, tiu, tkp, total, quality_status")
          .eq("id", scoreId)
          .maybeSingle();
        if (scoreError) return jsonResponse({ message: scoreError.message }, 500);
        if (!score || score.quality_status !== "verified") {
          return jsonResponse({ message: "Data SKD tidak tersedia untuk dianalisis." }, 404);
        }

        const [{ data: batch }, { data: formation }] = await Promise.all([
          sb.from("skd_batches").select("status").eq("id", score.batch_id).maybeSingle(),
          sb
            .from("skd_formations")
            .select("jabatan, nama_instansi, quality_status")
            .eq("id", score.formation_id)
            .maybeSingle(),
        ]);
        if (batch?.status !== "published" || formation?.quality_status !== "verified") {
          return jsonResponse({ message: "Batch SKD belum dipublikasikan." }, 404);
        }

        const { data: lead, error: leadError } = await sb
          .from("leads")
          .insert({
            score_id: score.id,
            nama_panggilan: namaPanggilan,
            whatsapp: whatsapp.replace(/[\s-]/g, ""),
            target_tahun: targetTahun,
            target_instansi: clean(leadInput?.target_instansi, 160),
            target_formasi: clean(leadInput?.target_formasi, 200),
            rencana,
            consent_whatsapp: true,
          })
          .select("*")
          .single();
        if (leadError) return jsonResponse({ message: leadError.message }, 500);

        const context: AnalysisContext = {
          nama_panggilan: namaPanggilan,
          nama_peserta: score.nama,
          formasi: formation.jabatan,
          instansi: formation.nama_instansi,
          twk: score.twk,
          tiu: score.tiu,
          tkp: score.tkp,
          total: score.total,
          rencana,
        };
        const { text, zona } = buildAnalysisText(context);

        let token = generateToken();
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const { data: duplicate } = await sb
            .from("result_sessions")
            .select("id")
            .eq("token", token)
            .maybeSingle();
          if (!duplicate) break;
          token = generateToken();
        }

        const { data: session, error: sessionError } = await sb
          .from("result_sessions")
          .insert({
            token,
            score_id: score.id,
            lead_id: lead.id,
            nama_peserta: context.nama_peserta,
            instansi: context.instansi,
            formasi: context.formasi,
            twk: context.twk,
            tiu: context.tiu,
            tkp: context.tkp,
            total: context.total,
            zona,
            analysis_text: text,
          })
          .select("*")
          .single();
        if (sessionError) {
          await sb.from("leads").delete().eq("id", lead.id);
          return jsonResponse({ message: sessionError.message }, 500);
        }

        return jsonResponse({ token, session, lead }, 201);
      },
    },
  },
});
