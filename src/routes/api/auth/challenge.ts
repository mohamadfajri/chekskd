import { createFileRoute } from "@tanstack/react-router";
import { createUserSessionResponse, safeTokenEqual } from "@/lib/auth/server";
import { getServerSupabase, jsonResponse } from "@/lib/supabase/server";

export const Route = createFileRoute("/api/auth/challenge")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        const challengeId = url.searchParams.get("id")?.trim() ?? "";
        const pollToken = url.searchParams.get("token")?.trim() ?? "";
        if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !pollToken) {
          return jsonResponse({ message: "Data verifikasi tidak valid." }, 400);
        }

        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) return jsonResponse({ message: `Supabase belum siap: ${configError}` }, 503);

        const { data: challenge, error } = await sb
          .from("app_auth_challenges")
          .select("id,user_id,poll_token_hash,expires_at,verified_at,purpose")
          .eq("id", challengeId)
          .maybeSingle();
        if (error || !challenge || !safeTokenEqual(pollToken, challenge.poll_token_hash)) {
          return jsonResponse({ message: "Sesi verifikasi tidak ditemukan." }, 404);
        }
        if (new Date(challenge.expires_at).getTime() <= Date.now()) {
          return jsonResponse({ status: "expired", message: "Kode verifikasi kedaluwarsa." }, 410);
        }
        if (!challenge.verified_at) return jsonResponse({ status: "pending" });

        const { data: user } = await sb
          .from("app_users")
          .select(
            "id,whatsapp,whatsapp_verified_at,marketing_opt_in,marketing_opt_in_at,created_at,last_login_at,status",
          )
          .eq("id", challenge.user_id)
          .eq("status", "active")
          .not("whatsapp_verified_at", "is", null)
          .maybeSingle();
        if (!user) return jsonResponse({ message: "Akun terverifikasi belum tersedia." }, 409);

        const now = new Date().toISOString();
        await Promise.all([
          sb.from("app_auth_challenges").update({ consumed_at: now }).eq("id", challenge.id),
          sb.from("app_users").update({ last_login_at: now }).eq("id", user.id),
        ]);
        user.last_login_at = now;
        return createUserSessionResponse(sb, user, {
          status: "verified",
          purpose: challenge.purpose,
        });
      },
    },
  },
});
