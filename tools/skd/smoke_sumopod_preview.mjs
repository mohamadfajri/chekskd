import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getPreviewRationalization, searchPreviewTargets } from "../../src/server/skdPreview.ts";
import { createSkdPreviewSession } from "../../src/server/skdPreviewSession.ts";

const local = process.env.SKD_PREVIEW_TEST_URL ?? "http://127.0.0.1:8093";
const hostname = new URL(local).hostname;
assert(["127.0.0.1", "localhost", "[::1]"].includes(hostname), "Preview test harus localhost.");
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
assert(url && key && process.env.SKD_DATABASE_URL, "Koneksi smoke test belum lengkap.");
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const request = (path, options) => fetch(new URL(path, local), {
  ...options, signal: AbortSignal.timeout(20_000),
});
const [score] = await (await request("/api/skd-preview?type=search&nama=Fadila+Bijaksana")).json();
assert.equal(score?.total, 382);
const detail = await (await request(`/api/skd-preview?type=detail&id=${score.score_id}`)).json();
assert.equal(detail.id, score.score_id);
assert.equal(detail.total, score.total);
assert.equal((await request("/api/result-session", {
  method: "POST", headers: { "content-type": "application/json" }, body: "{}",
})).status, 401);
assert.equal((await request("/api/rationalization-targets")).status, 401);
console.log("OK pencarian dan detail SumoPod; endpoint sesi dan target tetap memerlukan login");

const targets = await searchPreviewTargets(score.score_id, "hukum");
assert(targets.length > 0);
const snapshot = await getPreviewRationalization(score.score_id, "opportunity", ["low_competition"], null);
assert.equal(snapshot?.version, 6);
assert.equal(snapshot?.participant.total, 382);
const target = await getPreviewRationalization(score.score_id, "target", [], targets[0].id);
assert.equal(target?.analysis_goal, "target");
console.log("OK mesin v6 SumoPod untuk peluang terbesar dan target");

const testSender = "6280000000000";
const otherSender = "6280000000001";
const test = await createSkdPreviewSession(sb, {
  ...snapshot,
  request: { nickname: "Uji migrasi", target_year: null, target_institution: null, target_formation: null, plan: null },
}, testSender);
const tokenQuery = `?token=${encodeURIComponent(test.token)}`;
try {
  const result = await request("/api/wa-result" + tokenQuery);
  assert.equal(result.status, 200);
  const payload = await result.json();
  assert.equal(payload.reply_type, "image");
  assert.equal(payload.contract_version, 2);
  const card = await request("/api/result-card" + tokenQuery);
  assert.equal(card.status, 200);
  assert.match(card.headers.get("content-type") ?? "", /^image\/png/);
  assert.equal(Buffer.from(await card.arrayBuffer()).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const remoteOrigin = process.env.SKD_PREVIEW_HERMES_ORIGIN;
  if (remoteOrigin) {
    const remote = new URL(remoteOrigin);
    assert.equal(remote.protocol, "https:");
    const remoteResult = await fetch(new URL("/api/wa-result" + tokenQuery, remote), {
      signal: AbortSignal.timeout(15_000), redirect: "error",
    });
    assert.equal(remoteResult.status, 200, "Endpoint Hermes publik belum bisa membaca kode uji.");
    const remotePayload = await remoteResult.json();
    assert.equal(remotePayload.reply_type, "image");
    assert.equal(remotePayload.contract_version, 2);
    const cardUrl = new URL(remotePayload.image_url);
    assert.equal(cardUrl.origin, remote.origin, "Origin kartu berbeda dari origin Hermes yang diuji.");
    assert.equal(cardUrl.pathname, "/api/result-card");
    assert.equal(cardUrl.searchParams.get("token"), test.token);
    const remoteCard = await fetch(cardUrl, { signal: AbortSignal.timeout(15_000), redirect: "error" });
    assert.equal(remoteCard.status, 200, "URL kartu dari endpoint Hermes belum tersedia.");
    assert.match(remoteCard.headers.get("content-type") ?? "", /^image\/png/);
    await remoteCard.arrayBuffer();
    console.log("OK endpoint publik Hermes membaca kode dan menampilkan kartu uji tanpa pengiriman WA");
  }
  const claim = async (sender) => {
    const { data, error } = await sb.rpc("claim_skd_result_session", {
      p_token: test.token, p_sender: sender, p_message_id: `preview-smoke-${randomUUID()}`,
    });
    assert(!error, `Simulasi claim gagal (${error?.code ?? "-"})`);
    return data;
  };
  assert.equal((await claim(otherSender)).outcome, "sender_conflict");
  const own = await claim(testSender);
  assert.equal(own.outcome, "ready");
  assert.equal(own.job_id, null);
  console.log("OK kode uji terbaca, kartu PNG valid, pengirim lain ditolak, tanpa antrean atau pesan WA");
} finally {
  const { data, error } = await sb.from("result_sessions").delete()
    .eq("token", test.token).eq("sender_wa_id", testSender).is("lead_id", null).select("id");
  assert(!error && data?.length === 1, "Sesi smoke test belum berhasil dibersihkan.");
  console.log("OK sesi uji sementara dihapus");
}
