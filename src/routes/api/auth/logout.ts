import { createFileRoute } from "@tanstack/react-router";
import { clearUserSessionResponse, currentSessionToken, hashSecretToken } from "@/lib/auth/server";
import { getServerSupabase } from "@/lib/supabase/server";

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { client: sb } = getServerSupabase();
        const token = currentSessionToken(request);
        if (sb && token) {
          await sb
            .from("app_user_sessions")
            .update({ revoked_at: new Date().toISOString() })
            .eq("token_hash", hashSecretToken(token));
        }
        return clearUserSessionResponse({ success: true });
      },
    },
  },
});
