import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse } from "@/lib/supabase/server";

const SESSION_COOKIE = "analisa_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const PASSWORD_N = 16_384;
const PASSWORD_R = 8;
const PASSWORD_P = 1;
const PASSWORD_BYTES = 64;
const AUTH_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_WHATSAPP_BOT_NUMBER = "6282265507384";

export interface AppUserPublic {
  id: string;
  whatsapp: string;
  whatsapp_verified_at: string;
  marketing_opt_in: boolean;
  marketing_opt_in_at: string | null;
  created_at: string;
  last_login_at: string | null;
}

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: string;
  last_seen_at: string;
}

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      PASSWORD_BYTES,
      { N: PASSWORD_N, r: PASSWORD_R, p: PASSWORD_P, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

export function normalizeAccountWhatsapp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  return /^62[0-9]{8,13}$/.test(digits) ? digits : null;
}

export function validateAccountPassword(value: unknown): string | null {
  if (typeof value !== "string") return "Password wajib diisi.";
  if (value.length < 8) return "Password minimal 8 karakter.";
  if (value.length > 128) return "Password maksimal 128 karakter.";
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return "Password harus memuat huruf dan angka.";
  }
  return null;
}

export async function hashAccountPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt);
  return [
    "scrypt",
    PASSWORD_N,
    PASSWORD_R,
    PASSWORD_P,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyAccountPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, nValue, rValue, pValue, saltValue, hashValue] = encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    Number(nValue) !== PASSWORD_N ||
    Number(rValue) !== PASSWORD_R ||
    Number(pValue) !== PASSWORD_P ||
    !saltValue ||
    !hashValue
  ) {
    return false;
  }
  try {
    const expected = Buffer.from(hashValue, "base64url");
    const actual = await scrypt(password, Buffer.from(saltValue, "base64url"));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function randomAuthCode(): string {
  const bytes = randomBytes(8);
  let value = "";
  for (const byte of bytes) value += AUTH_ALPHABET[byte % AUTH_ALPHABET.length];
  return `AUTH-${value}`;
}

export function randomSecretToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSecretToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeTokenEqual(rawToken: string, storedHash: string): boolean {
  const supplied = Buffer.from(hashSecretToken(rawToken));
  const expected = Buffer.from(storedHash);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function readCookie(request: Request, name: string): string {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function publicUser(row: Record<string, unknown>): AppUserPublic {
  return {
    id: String(row.id),
    whatsapp: String(row.whatsapp),
    whatsapp_verified_at: String(row.whatsapp_verified_at),
    marketing_opt_in: row.marketing_opt_in === true,
    marketing_opt_in_at:
      typeof row.marketing_opt_in_at === "string" ? row.marketing_opt_in_at : null,
    created_at: String(row.created_at),
    last_login_at: typeof row.last_login_at === "string" ? row.last_login_at : null,
  };
}

export async function getAuthenticatedUser(
  request: Request,
  sb: SupabaseClient,
): Promise<{ user: AppUserPublic; session: SessionRow } | null> {
  const rawToken = readCookie(request, SESSION_COOKIE);
  if (!rawToken) return null;

  const { data: session } = await sb
    .from("app_user_sessions")
    .select("id,user_id,expires_at,last_seen_at")
    .eq("token_hash", hashSecretToken(rawToken))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!session) return null;

  const { data: user } = await sb
    .from("app_users")
    .select(
      "id,whatsapp,whatsapp_verified_at,marketing_opt_in,marketing_opt_in_at,created_at,last_login_at,status",
    )
    .eq("id", session.user_id)
    .eq("status", "active")
    .not("whatsapp_verified_at", "is", null)
    .maybeSingle();
  if (!user) return null;

  const lastSeen = new Date(session.last_seen_at).getTime();
  if (Date.now() - lastSeen > 15 * 60 * 1000) {
    await sb
      .from("app_user_sessions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", session.id);
  }
  return { user: publicUser(user), session: session as SessionRow };
}

export async function createUserSessionResponse(
  sb: SupabaseClient,
  user: AppUserPublic | Record<string, unknown>,
  body: Record<string, unknown> = {},
): Promise<Response> {
  const rawToken = randomSecretToken();
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  const { error } = await sb.from("app_user_sessions").insert({
    user_id: String(user.id),
    token_hash: hashSecretToken(rawToken),
    expires_at: expiresAt,
  });
  if (error) return jsonResponse({ message: "Sesi login belum dapat dibuat." }, 500);

  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return new Response(
    JSON.stringify({ ...body, user: publicUser(user as Record<string, unknown>) }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": `${SESSION_COOKIE}=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`,
      },
    },
  );
}

export function clearUserSessionResponse(body: Record<string, unknown> = {}): Response {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    },
  });
}

export function currentSessionToken(request: Request): string {
  return readCookie(request, SESSION_COOKIE);
}

export function buildVerificationWhatsappUrl(code: string): string {
  const configured =
    process.env.WHATSAPP_BOT_NUMBER ??
    process.env.VITE_WHATSAPP_BOT_NUMBER ??
    DEFAULT_WHATSAPP_BOT_NUMBER;
  const number = normalizeAccountWhatsapp(configured) ?? DEFAULT_WHATSAPP_BOT_NUMBER;
  const message = `VERIFIKASI ANALISACPNS ${code}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export function requireHermesAuth(request: Request): Response | null {
  const expected = process.env.HERMES_API_SECRET?.trim();
  if (!expected) return jsonResponse({ message: "Integrasi Hermes belum dikonfigurasi." }, 503);
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const supplied = request.headers.get("x-hermes-secret") ?? bearer;
  if (supplied !== expected)
    return jsonResponse({ message: "Kredensial Hermes tidak valid." }, 401);
  return null;
}
