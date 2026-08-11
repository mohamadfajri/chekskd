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

function suggestedActions(insights: MarketingInsights): string[] {
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
      "Segmentasi akan terisi otomatis pada analisis v4 berikutnya; hasil lama masih belum terklasifikasi.",
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

        const { data, error } = await sb.rpc("get_skd_marketing_insights");
        if (error || !data) {
          return jsonResponse(
            { message: error?.message ?? "Insight marketing belum dapat dihitung." },
            500,
          );
        }

        const insights = data as unknown as MarketingInsights;
        return jsonResponse({
          ...insights,
          suggested_actions: suggestedActions(insights),
        });
      },
    },
  },
});
