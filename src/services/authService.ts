export interface AuthUser {
  id: string;
  whatsapp: string;
  whatsapp_verified_at: string;
  marketing_opt_in: boolean;
  marketing_opt_in_at: string | null;
  created_at: string;
  last_login_at: string | null;
}

export interface AuthChallenge {
  challenge_id: string;
  poll_token: string;
  code: string;
  whatsapp_url: string;
  expires_at: string;
}

interface AuthResponse {
  status: string;
  user: AuthUser;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(body.message || "Permintaan belum dapat diproses.");
  return body;
}

export async function registerAccount(input: {
  whatsapp: string;
  password: string;
  marketing_opt_in: boolean;
}): Promise<AuthChallenge> {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<AuthChallenge>(response);
}

export async function requestPasswordReset(input: {
  whatsapp: string;
  new_password: string;
}): Promise<AuthChallenge> {
  const response = await fetch("/api/auth/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<AuthChallenge>(response);
}

export async function pollAuthChallenge(challenge: AuthChallenge): Promise<{
  status: "pending" | "verified";
  user?: AuthUser;
}> {
  const params = new URLSearchParams({
    id: challenge.challenge_id,
    token: challenge.poll_token,
  });
  const response = await fetch(`/api/auth/challenge?${params.toString()}`);
  return readJson(response);
}

export async function loginAccount(input: {
  whatsapp: string;
  password: string;
}): Promise<AuthResponse> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<AuthResponse>(response);
}

export async function logoutAccount(): Promise<void> {
  const response = await fetch("/api/auth/logout", { method: "POST" });
  await readJson(response);
}

export async function getCurrentAccount(): Promise<AuthUser | null> {
  const response = await fetch("/api/auth/me");
  const body = await readJson<{ user: AuthUser | null }>(response);
  return body.user;
}

export async function updateAccount(input: {
  marketing_opt_in?: boolean;
  current_password?: string;
  new_password?: string;
}): Promise<AuthUser> {
  const response = await fetch("/api/auth/me", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await readJson<{ user: AuthUser }>(response);
  return body.user;
}

export async function deleteAccount(password: string): Promise<void> {
  const response = await fetch("/api/auth/me", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  await readJson(response);
}

export function maskAccountWhatsapp(value: string): string {
  if (value.length < 8) return value;
  return `+${value.slice(0, 4)} ${value.slice(4, 7)}****${value.slice(-3)}`;
}
