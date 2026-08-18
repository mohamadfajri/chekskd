import { createFileRoute } from "@tanstack/react-router";
import { getServerSupabase, jsonResponse, requireAdmin } from "@/lib/supabase/server";

interface MarketingInsights {
  generated_at: string;
  funnel: {
    leads: number;
    codes_created: number;
    requested_on_whatsapp: number;
    analyses_completed: number;
    results_delivered: number;
    marketing_ready: number;
    code_to_whatsapp_rate: number;
    delivery_rate: number;
  };
  segments: Record<string, number>;
  recommendation_modes: Record<string, number>;
  priority_subtests: Record<string, number>;
  top_recommended_institutions: Array<{ institution: string; mentions: number }>;
  recent_daily: Array<{
    date: string;
    codes_created: number;
    whatsapp_requests: number;
    delivered: number;
  }>;
}

interface AnalysisJobRow {
  status: "queued" | "processing" | "completed" | "failed";
  attempts: number;
  created_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

interface LeadEventRow {
  metadata: Record<string, unknown> | null;
}

function durationSeconds(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const duration = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]);
}

function metadataNumber(metadata: Record<string, unknown> | null, key: string): number | null {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function operationalInsights(
  jobs: AnalysisJobRow[],
  events: LeadEventRow[],
  phoneRows: Array<{ sender_wa_id: string | null }>,
) {
  const processingTimes = jobs
    .map((job) => durationSeconds(job.claimed_at, job.completed_at))
    .filter((value): value is number => value !== null);
  const queueTimes = jobs
    .map((job) => durationSeconds(job.created_at, job.claimed_at))
    .filter((value): value is number => value !== null);
  const phoneUsage = new Map<string, number>();
  for (const row of phoneRows) {
    const phone = row.sender_wa_id?.trim();
    if (phone) phoneUsage.set(phone, (phoneUsage.get(phone) ?? 0) + 1);
  }

  const failures = new Map<string, number>();
  for (const job of jobs) {
    if (job.status !== "failed") continue;
    const message = job.error_message?.trim() || "unknown_error";
    failures.set(message, (failures.get(message) ?? 0) + 1);
  }

  const observedEvents = events.filter(
    (event) => metadataNumber(event.metadata, "recommendation_count") !== null,
  );
  const qualitySignalEvents = observedEvents.filter(
    (event) => metadataNumber(event.metadata, "limited_confidence_count") !== null,
  );
  const recommendationCounts = observedEvents.map(
    (event) => metadataNumber(event.metadata, "recommendation_count") ?? 0,
  );

  return {
    operational: {
      jobs_observed: jobs.length,
      by_status: {
        queued: jobs.filter((job) => job.status === "queued").length,
        processing: jobs.filter((job) => job.status === "processing").length,
        completed: jobs.filter((job) => job.status === "completed").length,
        failed: jobs.filter((job) => job.status === "failed").length,
      },
      retried_jobs: jobs.filter((job) => job.attempts > 1).length,
      average_processing_seconds: processingTimes.length
        ? Math.round(
            processingTimes.reduce((total, value) => total + value, 0) / processingTimes.length,
          )
        : 0,
      median_processing_seconds: percentile(processingTimes, 0.5),
      p95_processing_seconds: percentile(processingTimes, 0.95),
      median_queue_seconds: percentile(queueTimes, 0.5),
      unique_whatsapp_users: phoneUsage.size,
      repeat_whatsapp_users: [...phoneUsage.values()].filter((count) => count > 1).length,
    },
    quality: {
      analyses_observed: observedEvents.length,
      quality_signals_observed: qualitySignalEvents.length,
      recommendations_empty: observedEvents.filter(
        (event) => metadataNumber(event.metadata, "recommendation_count") === 0,
      ).length,
      limited_confidence: qualitySignalEvents.filter(
        (event) => (metadataNumber(event.metadata, "limited_confidence_count") ?? 0) > 0,
      ).length,
      fallback_used: qualitySignalEvents.filter(
        (event) => (metadataNumber(event.metadata, "fallback_count") ?? 0) > 0,
      ).length,
      cross_position_used: qualitySignalEvents.filter(
        (event) => (metadataNumber(event.metadata, "cross_position_count") ?? 0) > 0,
      ).length,
      average_recommendation_count: recommendationCounts.length
        ? Number(
            (
              recommendationCounts.reduce((total, value) => total + value, 0) /
              recommendationCounts.length
            ).toFixed(1),
          )
        : 0,
    },
    top_failures: [...failures.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([message, count]) => ({ message, count })),
  };
}

function suggestedActions(
  insights: MarketingInsights,
  extra?: ReturnType<typeof operationalInsights>,
): string[] {
  const actions: string[] = [];
  const { funnel } = insights;

  if (funnel.codes_created > 0 && funnel.code_to_whatsapp_rate < 60) {
    actions.push(
      "Banyak kode belum dikirim ke WhatsApp; sederhanakan instruksi setelah kode dibuat.",
    );
  }
  if (funnel.requested_on_whatsapp > 0 && funnel.delivery_rate < 95) {
    actions.push("Periksa antrean Hermes karena sebagian permintaan belum sampai ke pengguna.");
  }
  if (funnel.marketing_ready > 0) {
    actions.push(
      `${funnel.marketing_ready} kontak siap menjadi audiens kampanye berdasarkan minat dan kebutuhan nilainya.`,
    );
  }
  if ((insights.segments.unclassified ?? 0) > 0) {
    actions.push(
      "Segmentasi akan terisi otomatis pada analisis v5 berikutnya; hasil lama masih belum terklasifikasi.",
    );
  }
  if ((extra?.operational.by_status.failed ?? 0) > 0) {
    actions.push(
      "Ada job analisis gagal pada sampel operasional terbaru; periksa pesan error teratas.",
    );
  }
  if ((extra?.quality.recommendations_empty ?? 0) > 0) {
    actions.push(
      "Ada analisis tanpa rekomendasi; prioritaskan penambahan data formasi yang relevan.",
    );
  }
  if ((extra?.quality.limited_confidence ?? 0) > 0) {
    actions.push(
      "Sebagian hasil masih memakai confidence terbatas; audit formasi sumber sebelum promosi.",
    );
  }

  return actions;
}

export const Route = createFileRoute("/api/admin/marketing-insights")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const authError = requireAdmin(request);
        if (authError) return authError;

        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) {
          return jsonResponse({ message: `Supabase server belum siap: ${configError}` }, 503);
        }

        const [insightRequest, jobsRequest, eventsRequest, phonesRequest] = await Promise.all([
          sb.rpc("get_skd_marketing_insights"),
          sb
            .from("skd_analysis_jobs")
            .select("status, attempts, created_at, claimed_at, completed_at, error_message")
            .order("created_at", { ascending: false })
            .limit(1000),
          sb
            .from("lead_events")
            .select("metadata")
            .eq("event_type", "rationalization_completed")
            .order("created_at", { ascending: false })
            .limit(1000),
          sb
            .from("result_sessions")
            .select("sender_wa_id")
            .not("sender_wa_id", "is", null)
            .order("created_at", { ascending: false })
            .limit(5000),
        ]);
        const { data, error } = insightRequest;
        const supportingError = jobsRequest.error ?? eventsRequest.error ?? phonesRequest.error;
        if (error || !data || supportingError) {
          return jsonResponse(
            {
              message:
                error?.message ??
                supportingError?.message ??
                "Insight marketing belum dapat dihitung.",
            },
            500,
          );
        }

        const insights = data as unknown as MarketingInsights;
        const extra = operationalInsights(
          (jobsRequest.data ?? []) as AnalysisJobRow[],
          (eventsRequest.data ?? []) as LeadEventRow[],
          phonesRequest.data ?? [],
        );
        return jsonResponse({
          ...insights,
          ...extra,
          suggested_actions: suggestedActions(insights, extra),
        });
      },
    },
  },
});
