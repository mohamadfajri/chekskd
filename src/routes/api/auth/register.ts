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

interface RegisterBody {
  whatsapp?: string;
  password?: string;
  marketing_opt_in?: boolean;
}

export const Route = createFileRoute("/api/auth/register")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const body = (await request.json().catch(() => null)) as RegisterBody | null;
        const whatsapp = normalizeAccountWhatsapp(body?.whatsapp);
        if (!whatsapp) {
          return jsonResponse({ message: "Nomor WhatsApp Indonesia tidak valid." }, 400);
        }
        const passwordError = validateAccountPassword(body?.password);
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

        const { data: existing, error: existingError } = await sb
          .from("app_users")
          .select("id,whatsapp_verified_at")
          .eq("whatsapp", whatsapp)
          .maybeSingle();
        if (existingError) return jsonResponse({ message: "Akun belum dapat diperiksa." }, 500);
        if (existing?.whatsapp_verified_at) {
          return jsonResponse(
            { message: "Nomor ini sudah terdaftar. Silakan masuk menggunakan password." },
            409,
          );
        }

        const passwordHash = await hashAccountPassword(body!.password!);
        const now = new Date().toISOString();
        const marketingOptIn = body?.marketing_opt_in === true;
        let userId = existing?.id as string | undefined;

        if (userId) {
          const { error } = await sb
            .from("app_users")
            .update({
              password_hash: passwordHash,
              marketing_opt_in: marketingOptIn,
              marketing_opt_in_at: marketingOptIn ? now : null,
              marketing_opt_out_at: null,
              status: "active",
            })
            .eq("id", userId);
          if (error) return jsonResponse({ message: "Pendaftaran belum dapat diperbarui." }, 500);
        } else {
          const { data: inserted, error } = await sb
            .from("app_users")
            .insert({
              whatsapp,
              password_hash: passwordHash,
              marketing_opt_in: marketingOptIn,
              marketing_opt_in_at: marketingOptIn ? now : null,
            })
            .select("id")
            .single();
          if (error || !inserted) {
            return jsonResponse({ message: "Akun belum dapat dibuat." }, 500);
          }
          userId = inserted.id;
        }

        await sb
          .from("app_auth_challenges")
          .update({ expires_at: now })
          .eq("user_id", userId)
          .is("verified_at", null)
          .gt("expires_at", now);

        const code = randomAuthCode();
        const pollToken = randomSecretToken();
        const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
        const { data: challenge, error: challengeError } = await sb
          .from("app_auth_challenges")
          .insert({
            user_id: userId,
            code,
            purpose: "signup",
            expected_whatsapp: whatsapp,
            poll_token_hash: hashSecretToken(pollToken),
            expires_at: expiresAt,
          })
          .select("id")
          .single();
        if (challengeError || !challenge) {
          return jsonResponse({ message: "Kode verifikasi belum dapat dibuat." }, 500);
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
