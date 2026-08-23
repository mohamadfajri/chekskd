import { createFileRoute } from "@tanstack/react-router";
import { normalizeAccountWhatsapp, requireHermesAuth } from "@/lib/auth/server";
import { getServerSupabase, jsonResponse } from "@/lib/supabase/server";

interface HermesVerifyBody {
  code?: string;
  sender?: string;
  message_id?: string;
}

interface VerifyResult {
  outcome?:
    "invalid" | "not_found" | "expired" | "sender_mismatch" | "duplicate_message" | "verified";
  purpose?: "signup" | "password_reset";
}

export const Route = createFileRoute("/api/auth/hermes-verify")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const authError = requireHermesAuth(request);
        if (authError) return authError;
        const body = (await request.json().catch(() => null)) as HermesVerifyBody | null;
        const code = body?.code?.trim().toUpperCase() ?? "";
        const sender = normalizeAccountWhatsapp(body?.sender);
        const messageId = body?.message_id?.trim() ?? "";
        if (!/^AUTH-[A-HJ-NP-Z2-9]{8}$/.test(code) || !sender || !messageId) {
          return jsonResponse({ success: false, message: "Pesan verifikasi tidak valid." }, 400);
        }

        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) return jsonResponse({ message: `Supabase belum siap: ${configError}` }, 503);
        const { data, error } = await sb.rpc("verify_app_auth_challenge", {
          p_code: code,
          p_sender: sender,
          p_message_id: messageId.slice(0, 200),
        });
        if (error)
          return jsonResponse({ success: false, message: "Verifikasi belum dapat diproses." }, 500);
        const result = (data ?? {}) as VerifyResult;

        if (result.outcome === "not_found") {
          return jsonResponse({ success: false, message: "Kode verifikasi tidak ditemukan." }, 404);
        }
        if (result.outcome === "expired") {
          return jsonResponse(
            { success: false, message: "Kode verifikasi sudah kedaluwarsa. Buat kode baru." },
            410,
          );
        }
        if (result.outcome === "sender_mismatch") {
          return jsonResponse(
            {
              success: false,
              message: "Nomor WhatsApp pengirim tidak sama dengan nomor yang didaftarkan.",
            },
            409,
          );
        }
        if (result.outcome === "duplicate_message") {
          return jsonResponse(
            { success: false, message: "Pesan ini sudah pernah digunakan." },
            409,
          );
        }
        if (result.outcome !== "verified") {
          return jsonResponse({ success: false, message: "Data verifikasi tidak valid." }, 400);
        }

        return jsonResponse({
          success: true,
          message:
            result.purpose === "password_reset"
              ? "Password AnalisaCPNS berhasil diperbarui. Kembali ke website untuk masuk."
              : "Akun AnalisaCPNS berhasil diverifikasi. Kembali ke website untuk melanjutkan.",
        });
      },
    },
  },
});
