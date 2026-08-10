import { createFileRoute } from "@tanstack/react-router";
import {
  buildAnalysisSnapshot,
  buildAnalysisText,
  generateToken,
  type AnalysisContext,
} from "@/lib/analysis";
import { getServerSupabase, jsonResponse } from "@/lib/supabase/server";

interface LeadInput {
  nama_panggilan?: string;
  target_tahun?: string;
  target_instansi?: string;
  target_formasi?: string;
  target_formation_id?: string;
  rencana?: string;
  consent_whatsapp?: boolean;
  consent_marketing?: boolean;
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

function cleanUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleaned)
    ? cleaned
    : null;
}

function normalizedEducation(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function asyncRationalizationEnabled(): boolean {
  return process.env.ASYNC_RATIONALIZATION_ENABLED?.trim().toLowerCase() === "true";
}

export const Route = createFileRoute("/api/result-session")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const body = (await request.json().catch(() => null)) as CreateBody | null;
        const scoreId = clean(body?.score_id, 100);
        const leadInput = body?.lead;
        const namaPanggilan = clean(leadInput?.nama_panggilan, 80);
        const targetTahun = clean(leadInput?.target_tahun, 30);
        const targetFormationId = cleanUuid(leadInput?.target_formation_id);
        const rencana = clean(leadInput?.rencana, 50);

        if (
          !scoreId ||
          !namaPanggilan ||
          !targetTahun ||
          !targetFormationId ||
          !rencana ||
          leadInput?.consent_whatsapp !== true
        ) {
          return jsonResponse(
            { message: "Data form belum lengkap atau persetujuan hasil belum diberikan." },
            400,
          );
        }

        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) {
          return jsonResponse({ message: `Supabase server belum siap: ${configError}` }, 503);
        }

        const { data: score, error: scoreError } = await sb
          .from("skd_scores")
          .select(
            "id, batch_id, formation_id, nama, pendidikan, twk, tiu, tkp, total, quality_status",
          )
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

        const { data: targetFormation, error: targetError } = await sb
          .from("skd_formations")
          .select(
            "id, batch_id, nama_instansi, jabatan, jenis_formasi, pendidikan_options, quality_status",
          )
          .eq("id", targetFormationId)
          .maybeSingle();
        if (targetError) return jsonResponse({ message: targetError.message }, 500);

        const participantEducation = score.pendidikan
          ? normalizedEducation(score.pendidikan)
          : null;
        const acceptedEducations = Array.isArray(targetFormation?.pendidikan_options)
          ? targetFormation.pendidikan_options.map((value: string) => normalizedEducation(value))
          : [];
        const targetIsValid =
          targetFormation &&
          targetFormation.id !== score.formation_id &&
          targetFormation.quality_status === "verified" &&
          normalizedEducation(targetFormation.jenis_formasi ?? "") === "UMUM" &&
          participantEducation !== null &&
          acceptedEducations.includes(participantEducation);
        if (!targetIsValid) {
          return jsonResponse(
            { message: "Target harus berupa formasi UMUM yang menerima pendidikan peserta." },
            400,
          );
        }

        const [{ data: targetBatch }, { data: targetStats }] = await Promise.all([
          sb.from("skd_batches").select("status").eq("id", targetFormation.batch_id).maybeSingle(),
          sb
            .from("skd_formation_stats")
            .select("formation_id")
            .eq("formation_id", targetFormation.id)
            .maybeSingle(),
        ]);
        if (targetBatch?.status !== "published" || !targetStats) {
          return jsonResponse({ message: "Data historis target belum siap dianalisis." }, 400);
        }

        const { data: lead, error: leadError } = await sb
          .from("leads")
          .insert({
            score_id: score.id,
            nama_panggilan: namaPanggilan,
            whatsapp: null,
            target_tahun: targetTahun,
            target_instansi: targetFormation.nama_instansi,
            target_formasi: targetFormation.jabatan,
            target_formation_id: targetFormation.id,
            rencana,
            consent_whatsapp: true,
            consent_marketing: leadInput?.consent_marketing === true,
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
          target_tahun: targetTahun,
          target_instansi: targetFormation.nama_instansi,
          target_formasi: targetFormation.jabatan,
          rencana,
        };
        const useQueue = asyncRationalizationEnabled();
        const legacyAnalysis = useQueue ? null : buildAnalysisText(context);
        const snapshot = useQueue ? {} : buildAnalysisSnapshot(context);

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
            zona: legacyAnalysis?.zona ?? "menunggu",
            analysis_text:
              legacyAnalysis?.text ??
              "Rasionalisasi akan diproses setelah kode dikirim melalui WhatsApp.",
            analysis_snapshot: snapshot,
            status: useQueue ? "waiting" : "ready",
            ready_at: useQueue ? null : new Date().toISOString(),
            expired_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          })
          .select("*")
          .single();
        if (sessionError) {
          await sb.from("leads").delete().eq("id", lead.id);
          return jsonResponse({ message: sessionError.message }, 500);
        }

        return jsonResponse(
          { token, expired_at: session.expired_at, status: useQueue ? "waiting" : "ready" },
          201,
        );
      },
    },
  },
});
