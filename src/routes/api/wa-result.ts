import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { validateSupabaseEnv } from "@/lib/supabase/env";

/**
 * GET /api/wa-result?token=RSKD-XXXXX
 *
 * MVP endpoint untuk Hermes/bot WhatsApp.
 * Nanti bisa dipindah ke Supabase Edge Function / backend Node.
 *
 * Response:
 *  { "success": true,  "message": "<analysis_text>" }
 *  { "success": false, "message": "Kode hasil tidak ditemukan. ..." }
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}

function getServerSupabase() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  const env = validateSupabaseEnv(url, key, {
    urlName: "SUPABASE_URL atau VITE_SUPABASE_URL",
    anonKeyName: "SUPABASE_PUBLISHABLE_KEY atau VITE_SUPABASE_ANON_KEY",
  });
  if (!env.ok) return { client: null, error: env.error };

  return {
    client: createClient(env.url, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    error: null,
  };
}

export const Route = createFileRoute("/api/wa-result")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = (url.searchParams.get("token") ?? "").trim();

        if (!token) {
          return jsonResponse({ success: false, message: "Parameter token wajib diisi." }, 400);
        }

        const { client: sb, error: configError } = getServerSupabase();

        if (!sb) {
          return jsonResponse(
            {
              success: false,
              message: `Supabase belum siap: ${configError ?? "konfigurasi server belum lengkap."}`,
            },
            503,
          );
        }

        const { data, error } = await sb
          .from("result_sessions")
          .select("analysis_text")
          .eq("token", token)
          .maybeSingle();

        if (error) {
          return jsonResponse(
            {
              success: false,
              message: "Terjadi kesalahan saat mengambil data. Coba beberapa saat lagi.",
            },
            500,
          );
        }
        if (!data) {
          return jsonResponse({
            success: false,
            message: "Kode hasil tidak ditemukan. Silakan cek ulang kode dari website cpnsguru.id.",
          });
        }

        return jsonResponse({
          success: true,
          message: (data as { analysis_text: string }).analysis_text,
        });
      },
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, OPTIONS",
            "access-control-allow-headers": "content-type",
          },
        }),
    },
  },
});
