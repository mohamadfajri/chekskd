export interface SupabaseEnvValidation {
  ok: boolean;
  url: string;
  anonKey: string;
  error: string | null;
}

interface SupabaseEnvNames {
  urlName?: string;
  anonKeyName?: string;
}

export function validateSupabaseEnv(
  rawUrl: string | undefined,
  rawAnonKey: string | undefined,
  names: SupabaseEnvNames = {},
): SupabaseEnvValidation {
  const urlName = names.urlName ?? "VITE_SUPABASE_URL";
  const anonKeyName = names.anonKeyName ?? "VITE_SUPABASE_ANON_KEY";
  const url = rawUrl?.trim() ?? "";
  const anonKey = rawAnonKey?.trim() ?? "";
  const example = "https://xxxx.supabase.co";

  if (!url && !anonKey) {
    return {
      ok: false,
      url,
      anonKey,
      error: `${urlName} dan ${anonKeyName} belum diisi. Isi ${urlName} dengan format ${example}.`,
    };
  }

  if (!url) {
    return {
      ok: false,
      url,
      anonKey,
      error: `${urlName} belum diisi. Format yang benar: ${example}.`,
    };
  }

  if (!anonKey) {
    return {
      ok: false,
      url,
      anonKey,
      error: `${anonKeyName} belum diisi.`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      url,
      anonKey,
      error: `${urlName} bukan URL valid. Format yang benar: ${example}.`,
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      url,
      anonKey,
      error: `${urlName} harus diawali https://. Format yang benar: ${example}.`,
    };
  }

  if (!/^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname)) {
    return {
      ok: false,
      url,
      anonKey,
      error: `${urlName} harus memakai host project Supabase, contoh ${example}.`,
    };
  }

  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    return {
      ok: false,
      url,
      anonKey,
      error: `${urlName} cukup isi origin project saja, contoh ${example}.`,
    };
  }

  return {
    ok: true,
    url: parsed.origin,
    anonKey,
    error: null,
  };
}
