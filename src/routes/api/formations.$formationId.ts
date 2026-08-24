import { createFileRoute } from "@tanstack/react-router";
import { getAuthenticatedUser } from "@/lib/auth/server";
import { getServerSupabase, jsonResponse } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/formations/$formationId")({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { formationId: string } }) => {
        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) return jsonResponse({ message: `Supabase belum siap: ${configError}` }, 503);
        const auth = await getAuthenticatedUser(request, sb);
        if (!auth) {
          return jsonResponse({
            code: "AUTH_REQUIRED",
            message: "Masuk untuk membuka detail formasi.",
          });
        }

        const formationId = params.formationId.trim();
        if (!UUID_RE.test(formationId)) {
          return jsonResponse({ message: "ID formasi tidak valid." }, 400);
        }
        const { data, error } = await sb.rpc("get_public_skd_formation_detail", {
          p_formation_id: formationId,
        });
        if (error) return jsonResponse({ message: "Detail formasi belum dapat dimuat." }, 500);
        return jsonResponse({ formation: data ?? null });
      },
    },
  },
});
