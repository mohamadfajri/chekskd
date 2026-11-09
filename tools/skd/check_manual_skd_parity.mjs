import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { getManualSkdTargets, simulateManualSkd } from "../../src/server/manualSkd.ts";

const sb = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
);
const [targets, origins] = await Promise.all([
  getManualSkdTargets(sb, { education: "S-1 ILMU HUKUM", query: "Analis Hukum" }),
  getManualSkdTargets(sb, { education: "S-1 HUKUM", query: "Jaksa" }),
]);
const target = targets.find((row) => row.institution === "Kejaksaan Agung");
assert(target, "Historical target missing");
const origin = origins.find((row) => row.id !== target.id && row.institution === "Kejaksaan Agung");
assert(origin, "Historical source missing");
const sample = await sb
  .from("skd_scores")
  .select("id,twk,tiu,tkp,total")
  .eq("formation_id", origin.id)
  .eq("quality_status", "verified")
  .eq("pendidikan", "S-1 HUKUM")
  .or("keterangan.eq.P,keterangan.like.P/L*")
  .order("total")
  .limit(1)
  .maybeSingle();
assert(sample.data && !sample.error);
const { id, ...score } = sample.data;
const historical = await sb.rpc("get_skd_rationalization_v6", {
  p_score_id: id,
  p_analysis_goal: "target",
  p_preference_flags: [],
  p_preferred_target_formation_id: target.id,
});
if (historical.error) throw new Error(`Historical engine: ${historical.error.code}`);
const expected = historical.data?.target_recommendations?.find(
  (row) => row.formation_id === target.id,
);
assert(expected, "Historical engine omitted target");
const actual = await simulateManualSkd(sb, target, score);
assert.equal(actual.rank, expected.simulated_rank);
assert.equal(actual.scoreGap, score.total - target.cutoff);
assert.equal(
  (await simulateManualSkd(sb, target, { twk: 0, tiu: 100, tkp: 185, total: 285 })).rank,
  null,
);
assert.equal(
  (await getManualSkdTargets(sb, { education: "S-1 HUKUM", query: "Pemerintah Kota Makassar" }))
    .length,
  0,
);
console.log(
  JSON.stringify({
    target: target.job,
    oldRank: expected.simulated_rank,
    manualRank: actual.rank,
    noSkdAndThresholdChecked: true,
  }),
);
