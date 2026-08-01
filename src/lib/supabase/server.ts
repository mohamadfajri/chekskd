import { createClient } from "@supabase/supabase-js";
import { validateSupabaseEnv } from "./env";

export interface AdminRequestBody {
  adminPassword?: string;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function requireAdmin(request: Request, body?: AdminRequestBody | null): Response | null {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected) {
    return jsonResponse({ message: "ADMIN_PASSWORD belum dikonfigurasi di server." }, 503);
  }

  const supplied = body?.adminPassword ?? request.headers.get("x-admin-password") ?? "";
  if (!supplied || supplied !== expected) {
    return jsonResponse({ message: "Password admin tidak valid." }, 401);
  }

  return null;
}

export function getServerSupabase() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  const env = validateSupabaseEnv(url, key, {
    urlName: "SUPABASE_URL atau VITE_SUPABASE_URL",
    anonKeyName: "SUPABASE_SERVICE_ROLE_KEY atau SUPABASE_SECRET_KEY",
  });

  if (!env.ok) return { client: null, error: env.error };
  return {
    client: createClient(env.url, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    error: null,
  };
}

export function requireServerSupabase() {
  const result = getServerSupabase();
  if (!result.client) {
    throw new Error(result.error ?? "Supabase server belum dikonfigurasi.");
  }
  return result.client;
}
