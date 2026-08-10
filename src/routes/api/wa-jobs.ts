import { createFileRoute } from "@tanstack/react-router";
import { buildRationalizationCaption, isRationalizationSnapshot } from "@/lib/rationalization";
import { getServerSupabase, jsonResponse } from "@/lib/supabase/server";

interface WorkerRequest {
  action?: "process_next" | "mark_delivered";
  worker_id?: string;
  session_id?: string;
}

interface ClaimedJob {
  job_id: string;
  session_id: string;
  score_id: string;
  token: string;
  sender: string;
  attempt: number;
  expires_at: string;
}

function requireHermes(request: Request): Response | null {
  const expected = process.env.HERMES_API_SECRET?.trim();
  if (!expected) {
    return jsonResponse({ success: false, message: "HERMES_API_SECRET belum dikonfigurasi." }, 503);
  }
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const supplied = request.headers.get("x-hermes-secret") ?? bearer;
  return supplied === expected
    ? null
    : jsonResponse({ success: false, message: "Kredensial Hermes tidak valid." }, 401);
}

function publicOrigin(request: Request): string {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured && /^https:\/\//i.test(configured)) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

async function failJob(
  sb: NonNullable<ReturnType<typeof getServerSupabase>["client"]>,
  jobId: string,
  message: string,
) {
  await sb.rpc("fail_skd_analysis_job", {
    p_job_id: jobId,
    p_error_message: message,
    p_retry_delay_seconds: 30,
  });
}

export const Route = createFileRoute("/api/wa-jobs")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const authError = requireHermes(request);
        if (authError) return authError;

        const body = (await request.json().catch(() => null)) as WorkerRequest | null;
        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) {
          return jsonResponse(
            { success: false, message: `Supabase belum siap: ${configError}` },
            503,
          );
        }

        if (body?.action === "mark_delivered") {
          if (!body.session_id || !/^[0-9a-f-]{36}$/i.test(body.session_id)) {
            return jsonResponse({ success: false, message: "session_id tidak valid." }, 400);
          }
          const { data, error } = await sb.rpc("mark_skd_result_delivered", {
            p_session_id: body.session_id,
          });
          if (error || data !== true) {
            return jsonResponse({ success: false, message: "Status kirim belum tersimpan." }, 409);
          }
          return jsonResponse({ success: true, delivered: true });
        }

        if (body?.action !== "process_next") {
          return jsonResponse({ success: false, message: "Action worker tidak valid." }, 400);
        }
        const workerId = body.worker_id?.trim().slice(0, 100);
        if (!workerId) {
          return jsonResponse({ success: false, message: "worker_id wajib diisi." }, 400);
        }

        const { data: claimed, error: claimError } = await sb.rpc("claim_next_skd_analysis_job", {
          p_worker_id: workerId,
        });
        if (claimError) {
          return jsonResponse({ success: false, message: "Antrean belum dapat diambil." }, 500);
        }
        if (!claimed) return jsonResponse({ success: true, job: null });

        const job = claimed as unknown as ClaimedJob;
        const { data: rationalization, error: rationalizationError } = await sb.rpc(
          "get_skd_rationalization",
          { p_score_id: job.score_id },
        );
        if (rationalizationError || !rationalization) {
          await failJob(
            sb,
            job.job_id,
            rationalizationError?.message ?? "rationalization_not_found",
          );
          return jsonResponse(
            { success: false, message: "Rasionalisasi belum dapat dihitung." },
            500,
          );
        }

        const { data: session, error: sessionError } = await sb
          .from("result_sessions")
          .select("lead_id")
          .eq("id", job.session_id)
          .single();
        if (sessionError) {
          await failJob(sb, job.job_id, sessionError.message);
          return jsonResponse({ success: false, message: "Sesi hasil tidak ditemukan." }, 500);
        }

        const { data: lead } = session.lead_id
          ? await sb
              .from("leads")
              .select("nama_panggilan, target_tahun, target_instansi, target_formasi, rencana")
              .eq("id", session.lead_id)
              .maybeSingle()
          : { data: null };
        const snapshot = {
          ...(rationalization as Record<string, unknown>),
          kind: "skd_rationalization",
          request: {
            nickname: lead?.nama_panggilan ?? null,
            target_year: lead?.target_tahun ?? null,
            target_institution: lead?.target_instansi ?? null,
            target_formation: lead?.target_formasi ?? null,
            plan: lead?.rencana ?? null,
          },
        };
        if (!isRationalizationSnapshot(snapshot)) {
          await failJob(sb, job.job_id, "invalid_rationalization_snapshot");
          return jsonResponse(
            { success: false, message: "Format rasionalisasi tidak valid." },
            500,
          );
        }

        const { data: completed, error: completeError } = await sb.rpc(
          "complete_skd_analysis_job",
          { p_job_id: job.job_id, p_snapshot: snapshot },
        );
        if (completeError) {
          await failJob(sb, job.job_id, completeError.message);
          return jsonResponse({ success: false, message: "Hasil belum dapat disimpan." }, 500);
        }

        return jsonResponse({
          success: true,
          job: {
            session_id: job.session_id,
            token: job.token,
            sender: job.sender,
            image_url: `${publicOrigin(request)}/api/result-card?token=${encodeURIComponent(job.token)}`,
            caption: buildRationalizationCaption(snapshot),
            completed,
          },
        });
      },
    },
  },
});
