import { createFileRoute } from "@tanstack/react-router";
import {
  buildAnalysisSnapshot,
  buildAnalysisText,
  generateToken,
  type AnalysisContext,
} from "@/lib/analysis";
import { getAuthenticatedUser } from "@/lib/auth/server";
import { getServerSupabase, jsonResponse } from "@/lib/supabase/server";
import {
  getPreviewRationalization,
  isLocalSkdPreview,
  useSumopodSkdReads as readsSkdFromSumopod,
} from "@/server/skdPreview";
import { createSkdPreviewSession } from "@/server/skdPreviewSession";
import {
  readSumopodSkdSessionSource,
  readSupabaseSkdSessionSource,
  type SkdSessionSource,
} from "@/server/skdSessionSource";

interface LeadInput {
  nama_panggilan?: string;
  target_tahun?: string;
  target_instansi?: string;
  target_formasi?: string;
  target_formation_id?: string;
  analysis_goal?: "opportunity" | "related" | "target";
  preference_flags?: string[];
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

function asyncRationalizationEnabled(): boolean {
  return process.env.ASYNC_RATIONALIZATION_ENABLED?.trim().toLowerCase() === "true";
}

export const Route = createFileRoute("/api/result-session")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) {
          return jsonResponse({ message: `Supabase server belum siap: ${configError}` }, 503);
        }
        const auth = await getAuthenticatedUser(request, sb);
        if (!auth) {
          return jsonResponse(
            {
              code: "AUTH_REQUIRED",
              message: "Masuk dengan nomor WhatsApp terverifikasi untuk membuat kode hasil.",
            },
            401,
          );
        }

        const body = (await request.json().catch(() => null)) as CreateBody | null;
        const scoreId = cleanUuid(body?.score_id);
        const leadInput = body?.lead;
        const namaPanggilan = clean(leadInput?.nama_panggilan, 80);
        const targetTahun = clean(leadInput?.target_tahun, 30);
        const rawTargetFormationId: unknown = leadInput?.target_formation_id;
        const targetFormationId = cleanUuid(leadInput?.target_formation_id);
        const analysisGoal =
          leadInput?.analysis_goal === "opportunity" || leadInput?.analysis_goal === "target"
            ? leadInput.analysis_goal
            : "related";
        const recommendationMode = analysisGoal === "opportunity" ? "all" : "related";
        const allowedPreferences = new Set(["low_competition", "large_quota", "strong_data"]);
        const preferenceFlags = Array.from(
          new Set(
            (Array.isArray(leadInput?.preference_flags) ? leadInput.preference_flags : []).filter(
              (value): value is string =>
                typeof value === "string" && allowedPreferences.has(value),
            ),
          ),
        );
        const rencana = clean(leadInput?.rencana, 50);

        if (
          rawTargetFormationId != null &&
          (typeof rawTargetFormationId !== "string" ||
            (rawTargetFormationId.trim() && !targetFormationId))
        ) {
          return jsonResponse({ message: "ID target formasi tidak valid." }, 400);
        }
        if (preferenceFlags.length > 2) {
          return jsonResponse({ message: "Pilih maksimal dua prioritas tambahan." }, 400);
        }
        if (analysisGoal === "target" && !targetFormationId) {
          return jsonResponse(
            { message: "Pilih instansi atau jabatan target terlebih dahulu." },
            400,
          );
        }

        if (
          !scoreId ||
          !namaPanggilan ||
          !targetTahun ||
          !rencana ||
          leadInput?.consent_whatsapp !== true
        ) {
          return jsonResponse(
            { message: "Data form belum lengkap atau persetujuan hasil belum diberikan." },
            400,
          );
        }

        const localPreview = isLocalSkdPreview(request);
        let source: SkdSessionSource;
        try {
          // Local parity testing still compares SumoPod results against the original score.
          source =
            readsSkdFromSumopod(request) && !localPreview
              ? await readSumopodSkdSessionSource(scoreId, targetFormationId)
              : await readSupabaseSkdSessionSource(sb, scoreId, targetFormationId);
        } catch (error) {
          console.error(
            "skd_session_source_failed",
            (error as { code?: string })?.code ?? "unknown",
          );
          return jsonResponse({ message: "Data SKD belum dapat diperiksa. Coba lagi." }, 503);
        }
        if (source.status !== "ready") {
          const errors = {
            missing_score: [404, "Data SKD tidak tersedia untuk dianalisis."],
            unpublished: [404, "Batch SKD belum dipublikasikan."],
            ineligible_target: [
              400,
              "Target harus berupa formasi UMUM dengan pendidikan yang cocok persis atau memiliki alias terverifikasi.",
            ],
            missing_history: [400, "Data historis target belum siap dianalisis."],
          } as const;
          const [status, message] = errors[source.status];
          return jsonResponse({ message }, status);
        }
        const { score, formation, target: targetFormation } = source;

        if (localPreview) {
          try {
            const snapshot = await getPreviewRationalization(
              score.id,
              analysisGoal,
              preferenceFlags,
              targetFormationId,
            );
            if (
              !snapshot ||
              snapshot.formation_id !== score.formation_id ||
              snapshot.participant.name !== score.nama ||
              snapshot.participant.twk !== score.twk ||
              snapshot.participant.tiu !== score.tiu ||
              snapshot.participant.tkp !== score.tkp ||
              snapshot.participant.total !== score.total
            ) {
              return jsonResponse(
                { message: "Data peserta di SumoPod belum cocok dengan sumber." },
                409,
              );
            }
            const session = await createSkdPreviewSession(
              sb,
              {
                ...snapshot,
                request: {
                  nickname: namaPanggilan,
                  target_year: targetTahun,
                  target_institution: targetFormation?.nama_instansi ?? null,
                  target_formation: targetFormation?.jabatan ?? null,
                  plan: rencana,
                },
              },
              auth.user.whatsapp,
            );
            return jsonResponse(session, 201);
          } catch (error) {
            console.error(
              "skd_preview_session_failed",
              (error as { code?: string })?.code ?? "unknown",
            );
            return jsonResponse({ message: "Kode uji SumoPod belum dapat dibuat." }, 503);
          }
        }

        const { data: lead, error: leadError } = await sb
          .from("leads")
          .insert({
            score_id: score.id,
            nama_panggilan: namaPanggilan,
            whatsapp: auth.user.whatsapp,
            target_tahun: targetTahun,
            target_instansi: targetFormation?.nama_instansi ?? null,
            target_formasi: targetFormation?.jabatan ?? null,
            target_formation_id: targetFormation?.id ?? null,
            recommendation_mode: recommendationMode,
            analysis_goal: analysisGoal,
            preference_flags: preferenceFlags,
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
          target_instansi: targetFormation?.nama_instansi ?? "Rekomendasi otomatis",
          target_formasi:
            targetFormation?.jabatan ??
            (analysisGoal === "related" ? "Bidang sejenis" : "Peluang terbesar"),
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

        await sb.from("lead_events").insert({
          lead_id: lead.id,
          event_type: "result_code_created",
          metadata: {
            session_id: session.id,
            recommendation_mode: recommendationMode,
            analysis_goal: analysisGoal,
            preference_flags: preferenceFlags,
            has_preferred_target: Boolean(targetFormation?.id),
            target_year: targetTahun,
          },
        });

        return jsonResponse(
          { token, expired_at: session.expired_at, status: useQueue ? "waiting" : "ready" },
          201,
        );
      },
    },
  },
});
