import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validateSupabaseEnv } from "./env";

/**
 * Portable Supabase client.
 * Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
 * We intentionally do NOT bind a strict `Database` generic here so that
 * schema evolution (adding/removing columns) doesn't break the app; the
 * shape is documented in `./types.ts` and used at the service boundary.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const env = validateSupabaseEnv(url, anonKey);

export const supabaseConfigError = env.error;
export const isSupabaseConfigured = env.ok;

export const supabase: SupabaseClient | null = env.ok
  ? createClient(env.url, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      supabaseConfigError ??
        "Supabase belum dikonfigurasi. Set VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY.",
    );
  }
  return supabase;
}
