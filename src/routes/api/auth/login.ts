import { createFileRoute } from "@tanstack/react-router";
import {
  createUserSessionResponse,
  normalizeAccountWhatsapp,
  verifyAccountPassword,
} from "@/lib/auth/server";
import { getServerSupabase, jsonResponse } from "@/lib/supabase/server";

interface LoginBody {
  whatsapp?: string;
  password?: string;
}

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const body = (await request.json().catch(() => null)) as LoginBody | null;
        const whatsapp = normalizeAccountWhatsapp(body?.whatsapp);
        if (!whatsapp || typeof body?.password !== "string") {
          return jsonResponse({ message: "Nomor WhatsApp atau password tidak valid." }, 400);
        }

        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) return jsonResponse({ message: `Supabase belum siap: ${configError}` }, 503);
        const { data: user } = await sb
          .from("app_users")
          .select("*")
          .eq("whatsapp", whatsapp)
          .maybeSingle();
        if (!user) {
          return jsonResponse({ message: "Nomor WhatsApp atau password salah." }, 401);
        }
        if (user.status !== "active")
          return jsonResponse({ message: "Akun sedang dinonaktifkan." }, 403);
        if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
          return jsonResponse(
            { message: "Login dikunci sementara. Coba kembali 15 menit lagi." },
            429,
          );
        }

        const passwordValid = await verifyAccountPassword(body.password, user.password_hash);
        if (!passwordValid) {
          const failedCount = Math.min(20, Number(user.failed_login_count ?? 0) + 1);
          await sb
            .from("app_users")
            .update({
              failed_login_count: failedCount,
              locked_until:
                failedCount >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null,
            })
            .eq("id", user.id);
          return jsonResponse({ message: "Nomor WhatsApp atau password salah." }, 401);
        }
        if (!user.whatsapp_verified_at) {
          return jsonResponse(
            { message: "Akun belum diverifikasi. Pilih Daftar untuk membuat kode baru." },
            403,
          );
        }

        const now = new Date().toISOString();
        await sb
          .from("app_users")
          .update({ failed_login_count: 0, locked_until: null, last_login_at: now })
          .eq("id", user.id);
        user.last_login_at = now;
        return createUserSessionResponse(sb, user, { status: "authenticated" });
      },
    },
  },
});
