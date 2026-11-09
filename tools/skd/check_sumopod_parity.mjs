import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { createServer } from "vite";
import { aesenConnection } from "../../src/server/aesenConnection.ts";
import { buildRationalizationCaption, isRationalizationSnapshot } from "../../src/lib/rationalization.ts";
import { extractResultToken } from "../../src/lib/analysis.ts";
import { tables } from "./sumopod_transfer_schema.mjs";
import { installSkdReadFunctions } from "./sumopod_runtime_sql.mjs";

const output = path.resolve("output/skd-transfer/parity-report.json");
const report = {
  checks: [], observations: [], temporaryFunctions: true, sentWhatsApp: false, productionChanged: false,
  compatibility: { searchNameOrdering: "C" },
};
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, canonical(child)]));
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value)
    ? value.replace(/\+00:00$/, "Z")
    : value;
}

function differences(a, b, at = "$", out = []) {
  if (out.length >= 12 || Object.is(a, b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      differences(a[key], b[key], `${at}.${key}`, out);
    }
  } else out.push(at);
  return out;
}

function compare(label, a, b) {
  const paths = differences(canonical(a), canonical(b));
  if (paths.length) throw new Error(`${label} berbeda pada ${paths.join(", ")}.`);
}

async function timed(fn) {
  const start = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - start) };
}

function pass(label, metrics = {}) {
  report.checks.push({ label, passed: true, ...metrics });
  console.log(`OK ${label}`);
}

async function sourceRpc(sb, name, args) {
  const { data, error } = await sb.rpc(name, args).abortSignal(AbortSignal.timeout(30_000));
  if (error) throw Object.assign(new Error(`RPC sumber ${name} gagal (${error.code || "tanpa kode"}).`), {
    rpcCode: error.code,
  });
  return data;
}

async function sourceTiming(sb, label, name, args) {
  const start = performance.now();
  try {
    return { value: await sourceRpc(sb, name, args), ms: Math.round(performance.now() - start) };
  } catch (error) {
    if (error.rpcCode !== "57014") throw error;
    const ms = Math.round(performance.now() - start);
    report.observations.push({ label, source: "statement timeout", supabaseMs: ms });
    console.log(`SKIP pembanding Supabase: ${label} (57014)`);
    return { timeout: true, ms };
  }
}

async function readParity(sb, db) {
  for (const [name] of tables) {
    const { count, error } = await sb.from(name)
      .select("*", { head: true, count: "exact" }).abortSignal(AbortSignal.timeout(30_000));
    if (error || count === null) throw new Error(`Hitung sumber ${name} gagal.`);
    const actual = (await db.query(`select count(*)::int as n from public.${name}`)).rows[0].n;
    assert.equal(actual, count, `Jumlah ${name}`);
  }
  pass("Jumlah 11 tabel sumber dan tujuan cocok");

  const search = async (label, [nama, number, institution, job], expected) => {
    const limit = 30;
    const source = await sourceTiming(sb, label, "search_public_skd_scores", {
      p_nama: nama, p_no_peserta: number, p_instansi: institution, p_formasi: job, p_limit: limit,
    });
    const target = await timed(async () => (await db.query(
      "select to_jsonb(s) as row from public.search_public_skd_scores($1,$2,$3,$4,$5) s",
      [nama, number, institution, job, limit],
    )).rows.map(({ row }) => row));
    if (!source.timeout) compare(label, source.value, target.value);
    if (expected !== undefined) assert.equal(target.value.length, expected, label);
    pass(label, { compared: !source.timeout, rows: target.value.length, supabaseMs: source.ms, sumopodMs: target.ms });
    return target.value;
  };

  const [known] = await search("Cari nama lengkap", ["fadila bijaksana", null, null, null], 1);
  await search("Cari awalan nama umum", ["muhammad", null, null, null], 30);
  await search("Cari bagian tengah nama", ["bijaksana", null, null, null]);
  await search("Cari nomor peserta", [null, known.no_peserta, null, null], 1);
  const filtered = await search("Cari nama dengan filter instansi dan jabatan",
    ["fadila", null, known.nama_instansi, known.jabatan]);
  assert(filtered.some(({ score_id }) => score_id === known.score_id));
  await search("Pencarian tanpa hasil", ["uji-migrasi-xzy-tidak-ada", null, null, null], 0);
  const hidden = (await db.query(`
    select s.no_peserta from public.skd_scores s join public.skd_batches b on b.id=s.batch_id
    where b.status='review'
      and not exists (select 1 from public.skd_scores other join public.skd_batches published
        on published.id=other.batch_id where published.status='published' and other.no_peserta=s.no_peserta)
    limit 1`
  )).rows[0];
  assert(hidden);
  await search("Nomor peserta batch review tidak muncul", [null, hidden.no_peserta, null, null], 0);

  const queryTarget = [known.score_id, "hukum", 10];
  const targetArgs = { p_score_id: queryTarget[0], p_query: queryTarget[1], p_limit: queryTarget[2] };
  const targetSource = await sourceTiming(sb, "Pencarian formasi tujuan", "search_skd_target_formations", targetArgs);
  const targetDest = await timed(async () => (await db.query(
    "select public.search_skd_target_formations($1,$2,$3) as value", queryTarget,
  )).rows[0].value);
  if (!targetSource.timeout) compare("Pencarian formasi tujuan", targetSource.value, targetDest.value);
  assert(Array.isArray(targetDest.value) && targetDest.value.length > 0, "Ada formasi tujuan");
  pass("Pencarian formasi tujuan", { compared: !targetSource.timeout, rows: targetDest.value.length, supabaseMs: targetSource.ms, sumopodMs: targetDest.ms });

  const analyze = async (label, id, goal, flags, preferred = null) => {
    const args = { p_score_id: id, p_analysis_goal: goal, p_preference_flags: flags, p_preferred_target_formation_id: preferred };
    const source = await sourceTiming(sb, label, "get_skd_rationalization_v6", args);
    const target = await timed(async () => (await db.query(
      "select public.get_skd_rationalization_v6($1,$2,$3,$4) as value", Object.values(args),
    )).rows[0].value);
    assert(isRationalizationSnapshot({ ...target.value, kind: "skd_rationalization" }), label);
    if (!source.timeout) {
      assert(source.value, label);
      const { generated_at: _sourceTime, ...sourceStable } = source.value;
      const { generated_at: _targetTime, ...targetStable } = target.value;
      compare(label, sourceStable, targetStable);
    }
    pass(label, { compared: !source.timeout, recommendations: target.value.target_recommendations?.length ?? 0, supabaseMs: source.ms, sumopodMs: target.ms });
    return target.value;
  };
  const snapshot = await analyze("Rasionalisasi: bidang sejenis", known.score_id, "related", []);
  await analyze("Rasionalisasi: peluang terbesar dan preferensi",
    known.score_id, "opportunity", ["low_competition", "large_quota"]);
  const preferred = targetDest.value[0].id;
  assert(preferred, "Formasi tujuan punya ID");
  const targeted = await analyze("Rasionalisasi: target prioritas", known.score_id, "target", ["strong_data"], preferred);
  assert.equal(targeted.analysis_goal, "target");
  for (const [code, label] of [["3010", "Kemendikbudristek"], ["3011", "Kemenkes"]]) {
    const row = (await db.query(`
      select s.id from public.skd_scores s join public.skd_batches b on b.id=s.batch_id
      join public.skd_formation_stats st on st.formation_id=s.formation_id
      join public.skd_formations f on f.id=s.formation_id
      where b.status='published' and b.institution_code=$1 and s.quality_status='verified'
        and s.total is not null and s.pendidikan is not null and upper(trim(f.jenis_formasi))='UMUM'
      limit 1`, [code])).rows[0];
    if (row) await analyze(`Rasionalisasi: sampel ${label}`, row.id, "related", []);
  }
  const absent = (await db.query(`
    select s.id from public.skd_scores s join public.skd_batches b on b.id=s.batch_id
    join public.skd_formation_stats st on st.formation_id=s.formation_id
    where b.status='published' and s.quality_status='verified' and s.keterangan='TH' limit 1`
  )).rows[0];
  if (absent) await analyze("Rasionalisasi: peserta tidak hadir", absent.id, "related", []);

  const approved = (await db.query(`
    select m.formation_id from public.sscasn_matches m
    join public.skd_formations f on f.id=m.formation_id join public.skd_batches b on b.id=f.batch_id
    where b.status='published' and m.review_status='approved' order by m.formation_id limit 20`
  )).rows.map(({ formation_id }) => formation_id);
  const usedIds = [snapshot.formation_id, snapshot.target_simulation?.formation_id,
    ...(snapshot.target_recommendations ?? []).map(({ formation_id }) => formation_id)].filter(Boolean);
  const contextIds = [...new Set([...usedIds, ...approved])];
  const sourceContext = await sourceRpc(sb, "get_approved_sscasn_context", { p_formation_ids: contextIds });
  const destContext = (await db.query("select public.get_approved_sscasn_context($1::uuid[]) as value",
    [contextIds])).rows[0].value;
  compare("Konteks SSCASN yang sudah disetujui", sourceContext, destContext);
  assert(Object.keys(destContext).length > 0);
  pass("Konteks SSCASN yang sudah disetujui", { linked: Object.keys(destContext).length });

  return {
    ...snapshot, kind: "skd_rationalization",
    request: { nickname: null, target_year: null, target_institution: null, target_formation: null, plan: null },
    sscasn_context: Object.fromEntries(Object.entries(destContext).filter(([id]) => usedIds.includes(id))),
  };
}

async function whatsappDryRun(snapshot) {
  assert(isRationalizationSnapshot(snapshot), "Snapshot memenuhi format kartu Hermes");
  const token = "RSKD-TEST2345";
  assert.equal(extractResultToken(`CEK ${token}`), token);
  const caption = buildRationalizationCaption(snapshot);
  assert(caption.length > 0);
  const vite = await createServer({
    configFile: false, appType: "custom", server: { middlewareMode: true, hmr: false, watch: null },
    resolve: { alias: { "@": path.resolve("src") } },
  });
  try {
    const card = await vite.ssrLoadModule("/src/server/result-card.ts");
    const font = path.resolve("server-assets/fonts/NotoSans.ttf");
    const png = Buffer.from(card.renderRationalizationCard(snapshot, font, token));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    assert(width === 1080 && height > 0 && png.length > 10_000);
    pass("Simulasi WhatsApp: format kode, caption, dan render kartu PNG", { width, height, bytes: png.length });
  } finally {
    await vite.close();
  }
}

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  const destination = process.env.SKD_DATABASE_URL;
  if (!url || !key || !destination) throw new Error("Env sumber atau tujuan belum lengkap.");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const db = new pg.Client({ ...aesenConnection(destination), query_timeout: 35_000 });
  let snapshot;
  try {
    await db.connect();
    const { rows: [{ ready }] } = await db.query(
      "select to_regclass('skd_transfer.manifest') is not null as ready",
    );
    assert(ready, "Tujuan harus database salinan SKD.");
    await db.query("begin");
    await db.query("set local lock_timeout = '5s'; set local statement_timeout = '30s'; set local time zone 'UTC'");
    await installSkdReadFunctions(db);
    snapshot = await readParity(sb, db);
  } finally {
    await db.query("rollback").catch(() => {});
    await db.end().catch(() => {});
  }
  await whatsappDryRun(snapshot);
}

try {
  await main();
  report.result = report.observations.length ? "passed_with_source_timeouts" : "passed";
} catch (error) {
  report.result = "failed";
  report.error = error.code && error.code !== "ERR_ASSERTION"
    ? `Pengujian gagal (kode ${error.code}).` : error instanceof Error ? error.message : "Pengujian gagal.";
  console.error(report.error);
  process.exitCode = 1;
}
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ ...report, checkedAt: new Date().toISOString() }, null, 2) + "\n");
console.log(`Laporan: ${output}`);
