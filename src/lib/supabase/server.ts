import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "node:crypto";
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

const ADMIN_SESSION_COOKIE = "skd_admin_session";
const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

function signAdminSession(expiresAt: string, secret: string): string {
  return createHmac("sha256", secret).update(expiresAt).digest("base64url");
}

function readCookie(request: Request, name: string): string {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function hasValidAdminSession(request: Request, secret: string): boolean {
  const session = readCookie(request, ADMIN_SESSION_COOKIE);
  const [expiresAt, signature] = session.split(".");
  if (!expiresAt || !signature || Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;

  const expected = Buffer.from(signAdminSession(expiresAt, secret));
  const supplied = Buffer.from(signature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function createAdminSessionResponse(): Response {
  const secret = process.env.ADMIN_PASSWORD ?? "";
  if (!secret) {
    return jsonResponse({ message: "ADMIN_PASSWORD belum dikonfigurasi di server." }, 503);
  }

  const expiresAt = String(Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS);
  const token = `${expiresAt}.${signAdminSession(expiresAt, secret)}`;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return new Response(JSON.stringify({ valid: true }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_SECONDS}${secure}`,
    },
  });
}

export function requireAdmin(request: Request, body?: AdminRequestBody | null): Response | null {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected) {
    return jsonResponse({ message: "ADMIN_PASSWORD belum dikonfigurasi di server." }, 503);
  }

  const supplied = body?.adminPassword ?? request.headers.get("x-admin-password") ?? "";
  if (supplied !== expected && !hasValidAdminSession(request, expected)) {
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
