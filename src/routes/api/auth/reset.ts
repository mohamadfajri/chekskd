import { createFileRoute } from "@tanstack/react-router";
import {
  buildVerificationWhatsappUrl,
  hashAccountPassword,
  hashSecretToken,
  normalizeAccountWhatsapp,
  randomAuthCode,
  randomSecretToken,
  validateAccountPassword,
} from "@/lib/auth/server";
import { getServerSupabase, jsonResponse } from "@/lib/supabase/server";

interface ResetBody {
  whatsapp?: string;
  new_password?: string;
}

export const Route = createFileRoute("/api/auth/reset")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const body = (await request.json().catch(() => null)) as ResetBody | null;
        const whatsapp = normalizeAccountWhatsapp(body?.whatsapp);
        if (!whatsapp) return jsonResponse({ message: "Nomor WhatsApp tidak valid." }, 400);
        const passwordError = validateAccountPassword(body?.new_password);
        if (passwordError) return jsonResponse({ message: passwordError }, 400);

        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) return jsonResponse({ message: `Supabase belum siap: ${configError}` }, 503);
        const recentThreshold = new Date(Date.now() - 60_000).toISOString();
        const { data: recent } = await sb
          .from("app_auth_challenges")
          .select("id")
          .eq("expected_whatsapp", whatsapp)
          .gte("created_at", recentThreshold)
          .limit(1)
          .maybeSingle();
        if (recent) {
          return jsonResponse(
            { message: "Tunggu satu menit sebelum membuat kode verifikasi baru." },
            429,
          );
        }

        const { data: user } = await sb
          .from("app_users")
          .select("id")
          .eq("whatsapp", whatsapp)
          .eq("status", "active")
          .not("whatsapp_verified_at", "is", null)
          .maybeSingle();
        if (!user) return jsonResponse({ message: "Akun WhatsApp tidak ditemukan." }, 404);

        const now = new Date().toISOString();
        await sb
          .from("app_auth_challenges")
          .update({ expires_at: now })
          .eq("user_id", user.id)
          .eq("purpose", "password_reset")
          .is("verified_at", null)
          .gt("expires_at", now);

        const code = randomAuthCode();
        const pollToken = randomSecretToken();
        const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
        const pendingPasswordHash = await hashAccountPassword(body!.new_password!);
        const { data: challenge, error } = await sb
          .from("app_auth_challenges")
          .insert({
            user_id: user.id,
            code,
            purpose: "password_reset",
            expected_whatsapp: whatsapp,
            poll_token_hash: hashSecretToken(pollToken),
            pending_password_hash: pendingPasswordHash,
            expires_at: expiresAt,
          })
          .select("id")
          .single();
        if (error || !challenge) {
          return jsonResponse({ message: "Pemulihan password belum dapat dimulai." }, 500);
        }
        return jsonResponse({
          challenge_id: challenge.id,
          poll_token: pollToken,
          code,
          whatsapp_url: buildVerificationWhatsappUrl(code),
          expires_at: expiresAt,
        });
      },
    },
  },
});
