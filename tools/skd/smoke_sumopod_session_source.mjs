import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "vite";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
assert(url && key && process.env.SKD_DATABASE_URL, "Missing smoke-test configuration");
const sb = createClient(url, key, { auth: { persistSession: false } });
process.env.SKD_READ_BACKEND = "sumopod";
process.env.ASYNC_RATIONALIZATION_ENABLED = "true";
process.env.VITE_SKD_LOCAL_PREVIEW = "false";

const vite = await createServer({
  server: { host: "127.0.0.1", port: 8098, strictPort: true, hmr: false, watch: null },
});
const marker = `smoke-${randomUUID()}`;
const whatsapp = `620${String(randomInt(10_000_000_000)).padStart(10, "0")}`;
const cookie = randomBytes(32).toString("base64url");
let userId;

function checked({ data, error }, action) {
  assert(!error, `${action} failed (${error?.code ?? "unknown"})`);
  return data;
}

try {
  await vite.listen();
  const request = (path, options = {}) =>
    fetch("http://127.0.0.1:8098" + path, {
      ...options,
      headers: { cookie: `analisa_session=${cookie}`, ...options.headers },
      signal: AbortSignal.timeout(25_000),
    });
  const account = checked(
    await sb
      .from("app_users")
      .insert({
        whatsapp,
        whatsapp_verified_at: new Date().toISOString(),
        password_hash: "smoke-test-disabled:".padEnd(100, "x"),
      })
      .select("id")
      .single(),
    "Temporary account",
  );
  userId = account.id;
  checked(
    await sb.from("app_user_sessions").insert({
      user_id: userId,
      token_hash: createHash("sha256").update(cookie).digest("hex"),
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    }),
    "Temporary authentication session",
  );
  const search = await request("/api/skd-data?type=search&nama=Fadila+Bijaksana");
  assert.equal(search.headers.get("x-skd-backend"), "sumopod");
  const [score] = await search.json();
  assert.equal(score?.total, 382);
  const create = await request("/api/result-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      score_id: score.score_id,
      lead: {
        nama_panggilan: marker,
        target_tahun: "2026",
        rencana: "Uji internal",
        analysis_goal: "opportunity",
        consent_whatsapp: true,
        consent_marketing: false,
      },
    }),
  });
  assert.equal(create.status, 201, "Result session did not create a code");
  const { token, status } = await create.json();
  assert.equal(status, "waiting");
  const session = checked(
    await sb
      .from("result_sessions")
      .select("score_id,total,status,analysis_snapshot")
      .eq("token", token)
      .single(),
    "Read the temporary code",
  );
  assert.equal(session.score_id, score.score_id);
  assert.equal(session.total, 382);
  assert.equal(session.status, "waiting");
  assert.deepEqual(session.analysis_snapshot, {});
  console.log("OK authenticated result code is queued on demand, not rendered as a legacy card");
} finally {
  try {
    if (userId) {
      const leads = checked(
        await sb.from("leads").select("id").eq("whatsapp", whatsapp).eq("nama_panggilan", marker),
        "Find temporary leads",
      );
      const ids = leads.map(({ id }) => id);
      if (ids.length) {
        checked(
          await sb.from("result_sessions").delete().in("lead_id", ids),
          "Clean temporary codes",
        );
        checked(await sb.from("leads").delete().in("id", ids), "Clean temporary leads");
      }
      checked(await sb.from("app_users").delete().eq("id", userId), "Clean temporary account");
      console.log("OK temporary test data removed; no WhatsApp message sent");
    }
  } finally {
    await vite.close();
  }
}
