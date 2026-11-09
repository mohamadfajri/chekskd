import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  getSkdComparisonCoverage,
  getUnifiedFormationCatalog,
} from "../../src/server/formationCatalog.ts";
import {
  approvedEducationLabels,
  getManualSkdTargets,
  simulateManualSkd,
} from "../../src/server/manualSkd.ts";
import {
  getSkdDatabase,
  getSumopodSkdFormationDetail,
  getSumopodSkdFormationFilters,
  searchPreviewScores,
  searchPreviewTargets,
  searchSumopodSkdFormations,
} from "../../src/server/skdPreview.ts";
import {
  readSumopodSkdSessionSource,
  readSupabaseSkdSessionSource,
} from "../../src/server/skdSessionSource.ts";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
assert(url && key && process.env.SKD_DATABASE_URL, "Missing comparison configuration");
const sb = createClient(url, key, { auth: { persistSession: false } });
const absent = "00000000-0000-4000-8000-000000000000";

async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args).abortSignal(AbortSignal.timeout(30_000));
  assert(!error, `Supabase ${name} failed (${error?.code ?? "unknown"})`);
  return data;
}

try {
  const [candidate] = await searchPreviewScores(["Fadila Bijaksana", null, null, null, 5]);
  assert(candidate?.score_id && candidate.total === 382, "Missing public comparison sample");
  const [target] = await searchPreviewTargets(candidate.score_id, "hukum");
  assert(target?.id, "Missing eligible target");
  for (const targetId of [null, target.id, candidate.formation_id, absent]) {
    const [source, sumopod] = await Promise.all([
      readSupabaseSkdSessionSource(sb, candidate.score_id, targetId),
      readSumopodSkdSessionSource(candidate.score_id, targetId),
    ]);
    assert.equal(sumopod.status, source.status);
    if (source.status === "ready" && sumopod.status === "ready") {
      assert.equal(sumopod.score.total, source.score.total);
      assert.equal(sumopod.score.formation_id, source.score.formation_id);
      assert.deepEqual(sumopod.target, source.target);
    }
  }
  assert.equal((await readSumopodSkdSessionSource(absent, null)).status, "missing_score");
  assert.equal((await readSumopodSkdSessionSource(candidate.score_id, target.id)).status, "ready");
  console.log("OK source and target validation, including invalid and missing IDs");

  const education = "S-1 ILMU HUKUM";
  assert.deepEqual(
    (await approvedEducationLabels(sb, education, true)).sort(),
    (await approvedEducationLabels(sb, education)).sort(),
  );
  const options = await getManualSkdTargets(sb, { education, query: "Analis Hukum" });
  const option = options.find((row) => row.institution === "Kejaksaan Agung");
  assert(option, "Missing reference target for manual simulation");
  const input = { education, targetId: option.id };
  const [manualSource] = await getManualSkdTargets(sb, input);
  const [manualTarget] = await getManualSkdTargets(sb, input, true);
  assert(manualSource && manualTarget, "Missing manual simulation target");
  assert.deepEqual(manualTarget, manualSource);
  const sample = { total: 382, twk: 95, tiu: 110, tkp: 177 };
  assert.deepEqual(
    await simulateManualSkd(sb, manualTarget, sample, true),
    await simulateManualSkd(sb, manualSource, sample),
  );
  assert.deepEqual(await getSkdComparisonCoverage(sb, true), await getSkdComparisonCoverage(sb));
  console.log("OK manual simulation ranking, education aliases and published coverage");

  const [newDetail, oldDetail, newFilters, oldFilters, newList, oldList] = await Promise.all([
    getSumopodSkdFormationDetail(target.id),
    rpc("get_public_skd_formation_detail", { p_formation_id: target.id }),
    getSumopodSkdFormationFilters(),
    rpc("get_skd_formation_filter_options"),
    searchSumopodSkdFormations([null, null, null, null, null, "competition_desc", 1, 6]),
    rpc("search_public_skd_formations", { p_page_size: 6 }),
  ]);
  assert.equal(newDetail?.id, target.id);
  assert.deepEqual(newDetail?.stats, oldDetail?.stats);
  assert.equal(newList?.formations?.length, 6);
  assert(newList?.pagination?.total > 0);
  assert.equal(newList.pagination.total, oldList?.pagination?.total);
  assert(newFilters?.education_options?.length > 0);
  assert.equal(newFilters.education_options.length, oldFilters?.education_options?.length);
  assert.deepEqual(newFilters?.years, oldFilters?.years);
  const [catalogSource, catalogSumopod] = await Promise.all([
    getUnifiedFormationCatalog(sb, {}, false),
    getUnifiedFormationCatalog(sb, {}, false, true),
  ]);
  assert.deepEqual(catalogSumopod, catalogSource);
  console.log("OK formation detail, filters, listing and Aesen catalog");
} finally {
  await getSkdDatabase().end();
}
