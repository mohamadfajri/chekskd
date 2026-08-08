import { createFileRoute } from "@tanstack/react-router";
import { buildHermesCaption, extractResultToken, type AnalysisSnapshot } from "@/lib/analysis";
import { getServerSupabase, jsonResponse } from "@/lib/supabase/server";

interface HermesRequest {
  token?: string;
  sender?: string;
  message_id?: string;
}

interface HermesSessionRow {
  id: string;
  lead_id: string | null;
  token: string;
  analysis_text: string;
  analysis_snapshot: Record<string, unknown>;
  expired_at: string;
  used_count: number;
  sender_wa_id: string | null;
  last_inbound_message_id: string | null;
}

function normalizeSender(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/[^0-9]/g, "");
  return /^[0-9]{8,20}$/.test(digits) ? digits : null;
}

function cleanMessageId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result && result.length <= 200 ? result : null;
}

function requireHermes(request: Request): Response | null {
  const expected = process.env.HERMES_API_SECRET?.trim();
  if (!expected) {
    return jsonResponse({ success: false, message: "HERMES_API_SECRET belum dikonfigurasi." }, 503);
  }
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const supplied = request.headers.get("x-hermes-secret") ?? bearer;
  if (supplied !== expected) {
    return jsonResponse({ success: false, message: "Kredensial Hermes tidak valid." }, 401);
  }
  return null;
}

function publicOrigin(request: Request): string {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured && /^https:\/\//i.test(configured)) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

async function fetchSession(token: string) {
  const { client: sb, error: configError } = getServerSupabase();
  if (!sb)
    return {
      sb: null,
      session: null,
      response: jsonResponse(
        { success: false, message: `Supabase belum siap: ${configError}` },
        503,
      ),
    };

  const { data, error } = await sb
    .from("result_sessions")
    .select(
      "id, lead_id, token, analysis_text, analysis_snapshot, expired_at, used_count, sender_wa_id, last_inbound_message_id",
    )
    .eq("token", token)
    .maybeSingle();
  if (error) {
    return {
      sb,
      session: null,
      response: jsonResponse({ success: false, message: "Hasil belum dapat diambil." }, 500),
    };
  }
  if (!data) {
    return {
      sb,
      session: null,
      response: jsonResponse({ success: false, message: "Kode hasil tidak ditemukan." }, 404),
    };
  }
  if (new Date(data.expired_at).getTime() <= Date.now()) {
    return {
      sb,
      session: null,
      response: jsonResponse(
        { success: false, message: "Kode hasil sudah kedaluwarsa. Buat kode baru dari website." },
        410,
      ),
    };
  }
  return { sb, session: data, response: null };
}

function resultPayload(request: Request, session: HermesSessionRow) {
  const snapshot = session.analysis_snapshot as AnalysisSnapshot;
  if (snapshot?.version !== 1) {
    return jsonResponse({ success: false, message: "Snapshot analisis belum tersedia." }, 409);
  }
  const imageUrl = `${publicOrigin(request)}/api/result-card?token=${encodeURIComponent(session.token)}`;
  return jsonResponse({
    success: true,
    contract_version: 1,
    reply_type: "image",
    caption: buildHermesCaption(snapshot),
    image_url: imageUrl,
    fallback_message: session.analysis_text,
    expires_at: session.expired_at,
  });
}

export const Route = createFileRoute("/api/wa-result")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const token = extractResultToken(new URL(request.url).searchParams.get("token") ?? "");
        if (!token)
          return jsonResponse({ success: false, message: "Token hasil tidak valid." }, 400);
        const { session, response } = await fetchSession(token);
        return response ?? resultPayload(request, session as HermesSessionRow);
      },
      POST: async ({ request }: { request: Request }) => {
        const authError = requireHermes(request);
        if (authError) return authError;

        const body = (await request.json().catch(() => null)) as HermesRequest | null;
        const token = extractResultToken(body?.token ?? "");
        const sender = normalizeSender(body?.sender);
        const messageId = cleanMessageId(body?.message_id);
        if (!token || !sender || !messageId) {
          return jsonResponse(
            { success: false, message: "token, sender, dan message_id Hermes wajib diisi." },
            400,
          );
        }

        const { sb, session, response } = await fetchSession(token);
        if (response || !sb || !session) return response!;
        const hermesSession = session as HermesSessionRow;
        if (hermesSession.sender_wa_id && hermesSession.sender_wa_id !== sender) {
          return jsonResponse(
            { success: false, message: "Kode ini sudah digunakan oleh akun WhatsApp lain." },
            409,
          );
        }

        if (hermesSession.last_inbound_message_id !== messageId) {
          const { error: updateError } = await sb
            .from("result_sessions")
            .update({
              sender_wa_id: sender,
              last_inbound_message_id: messageId,
              used_count: Number(hermesSession.used_count ?? 0) + 1,
              card_rendered_at: new Date().toISOString(),
            })
            .eq("id", hermesSession.id);
          if (updateError) {
            return jsonResponse(
              { success: false, message: "Sesi Hermes belum dapat diperbarui." },
              500,
            );
          }
          if (hermesSession.lead_id) {
            await Promise.all([
              sb.from("leads").update({ whatsapp: sender }).eq("id", hermesSession.lead_id),
              sb.from("lead_events").insert({
                lead_id: hermesSession.lead_id,
                event_type: "result_card_requested",
                metadata: { message_id: messageId, provider: "hermes" },
              }),
            ]);
          }
          hermesSession.sender_wa_id = sender;
          hermesSession.last_inbound_message_id = messageId;
          hermesSession.used_count = Number(hermesSession.used_count ?? 0) + 1;
        }

        return resultPayload(request, hermesSession);
      },
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "authorization, content-type, x-hermes-secret",
          },
        }),
    },
  },
});
