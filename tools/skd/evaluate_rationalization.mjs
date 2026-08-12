import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const STATUS_GROUPS = ["P/L", "P", "TL", "TH", "TMS", "DIS"];
const ABSENT_STATUSES = new Set(["TH", "TMS", "DIS"]);
const PASSING_THRESHOLDS = { twk: 65, tiu: 80, tkp: 166 };
const DEFAULT_SAMPLE_SIZE = 24;
const DEFAULT_MAX_FORMATION_ROWS = 25000;
const PAGE_SIZE = 1000;

function parseArgs(argv) {
  const options = {
    sampleSize: DEFAULT_SAMPLE_SIZE,
    maxFormationRows: DEFAULT_MAX_FORMATION_ROWS,
    output: null,
    failOnWarnings: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--sample-size") options.sampleSize = Number(argv[++index]);
    else if (argument === "--max-formation-rows") {
      options.maxFormationRows = Number(argv[++index]);
    } else if (argument === "--output") options.output = argv[++index];
    else if (argument === "--fail-on-warnings") options.failOnWarnings = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Argumen tidak dikenal: ${argument}`);
  }

  if (!Number.isInteger(options.sampleSize) || options.sampleSize < 1 || options.sampleSize > 120) {
    throw new Error("--sample-size harus bilangan bulat antara 1 dan 120.");
  }
  if (
    !Number.isInteger(options.maxFormationRows) ||
    options.maxFormationRows < 100 ||
    options.maxFormationRows > 50000
  ) {
    throw new Error("--max-formation-rows harus bilangan bulat antara 100 dan 50000.");
  }

  return options;
}

function printHelp() {
  console.log(`Evaluasi deterministik mesin rasionalisasi SKD v5.

Pemakaian:
  npm run skd:evaluate-rationalization
  npm run skd:evaluate-rationalization -- --sample-size 36

Opsi:
  --sample-size N             Jumlah maksimum sampel (default ${DEFAULT_SAMPLE_SIZE})
  --max-formation-rows N      Batas audit independen per formasi (default ${DEFAULT_MAX_FORMATION_ROWS})
  --output PATH               Prefix output tanpa ekstensi
  --fail-on-warnings          Exit code 1 juga untuk warning
`);
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

function createSupabaseClient() {
  if (!url || !key) {
    throw new Error("SUPABASE URL dan service role/secret key wajib tersedia di .env.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function statusGroup(status) {
  return status?.startsWith("P/L") ? "P/L" : status;
}

function isPassing(status) {
  return status === "P" || status?.startsWith("P/L");
}

function isShortlisted(status) {
  return status?.startsWith("P/L");
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function maskParticipantNumber(value) {
  const text = String(value ?? "");
  if (text.length <= 6) return "*".repeat(text.length);
  return `${text.slice(0, 3)}${"*".repeat(text.length - 6)}${text.slice(-3)}`;
}

function compareScoreTuple(left, right) {
  for (const field of ["total", "tkp", "tiu", "twk"]) {
    const difference = Number(right[field] ?? -1) - Number(left[field] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}

function sameScoreTuple(left, right) {
  return ["total", "tkp", "tiu", "twk"].every(
    (field) => Number(left[field]) === Number(right[field]),
  );
}

function percentileCont(sortedValues, fraction) {
  if (!sortedValues.length) return null;
  const position = (sortedValues.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
}

function approximatelyEqual(left, right, tolerance = 0.01) {
  if (left == null || right == null) return left == null && right == null;
  return Math.abs(Number(left) - Number(right)) <= tolerance;
}

function addIssue(target, severity, code, message, details = undefined) {
  target.push({ severity, code, message, ...(details ? { details } : {}) });
}

async function fetchPublishedBatches(supabase) {
  const { data, error } = await supabase
    .from("skd_batches")
    .select("id,institution_code,institution_name,selection_year,participant_count")
    .eq("status", "published")
    .order("institution_code", { ascending: true });
  if (error) throw new Error(`Gagal membaca batch published: ${error.message}`);
  return data ?? [];
}

async function fetchCandidate(supabase, batchId, group) {
  let query = supabase
    .from("skd_scores")
    .select(
      "id,batch_id,formation_id,no_peserta,pendidikan,twk,tiu,tkp,total,keterangan,source_page,quality_status",
    )
    .eq("batch_id", batchId)
    .eq("quality_status", "verified")
    .not("pendidikan", "is", null)
    .limit(1);

  query = group === "P/L" ? query.like("keterangan", "P/L%") : query.eq("keterangan", group);
  query = query.order("no_peserta", { ascending: true });

  const { data, error } = await query;
  if (error) throw new Error(`Gagal mengambil kandidat ${group}: ${error.message}`);
  return data?.[0] ?? null;
}

async function mapLimit(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function selectBalancedSamples(candidates, sampleSize) {
  const remaining = [...candidates];
  const selected = [];
  const batchCounts = new Map();
  const statusCounts = new Map(STATUS_GROUPS.map((group) => [group, 0]));

  while (selected.length < sampleSize && remaining.length) {
    remaining.sort((left, right) => {
      const batchDifference =
        (batchCounts.get(left.batch_id) ?? 0) - (batchCounts.get(right.batch_id) ?? 0);
      if (batchDifference !== 0) return batchDifference;

      const statusDifference =
        (statusCounts.get(left.status_group) ?? 0) - (statusCounts.get(right.status_group) ?? 0);
      if (statusDifference !== 0) return statusDifference;

      const batchOrder = String(
        left.batch.institution_code ?? left.batch.institution_name,
      ).localeCompare(String(right.batch.institution_code ?? right.batch.institution_name));
      if (batchOrder !== 0) return batchOrder;
      return STATUS_GROUPS.indexOf(left.status_group) - STATUS_GROUPS.indexOf(right.status_group);
    });

    const candidate = remaining.shift();
    selected.push(candidate);
    batchCounts.set(candidate.batch_id, (batchCounts.get(candidate.batch_id) ?? 0) + 1);
    statusCounts.set(candidate.status_group, (statusCounts.get(candidate.status_group) ?? 0) + 1);
  }
  return selected;
}

async function fetchFormationContext(supabase, formationIds) {
  if (!formationIds.length) return new Map();
  const { data, error } = await supabase
    .from("skd_formations")
    .select(
      "id,batch_id,nama_instansi,jabatan,lokasi_formasi,jenis_formasi,pendidikan,pendidikan_options,jumlah_formasi,quality_status",
    )
    .in("id", formationIds);
  if (error) throw new Error(`Gagal membaca konteks formasi: ${error.message}`);
  return new Map((data ?? []).map((row) => [row.id, row]));
}

async function fetchStoredStats(supabase, formationIds) {
  if (!formationIds.length) return new Map();
  const { data, error } = await supabase
    .from("skd_formation_stats")
    .select("*")
    .in("formation_id", formationIds);
  if (error) throw new Error(`Gagal membaca statistik formasi: ${error.message}`);
  return new Map((data ?? []).map((row) => [row.formation_id, row]));
}

async function fetchFormationScores(supabase, formationId, expectedCount, maxRows) {
  if (expectedCount > maxRows) {
    return {
      skipped: true,
      reason: `Formasi memiliki ${expectedCount} baris, melebihi batas ${maxRows}.`,
    };
  }

  const rows = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE - 1, maxRows - 1);
    const { data, error } = await supabase
      .from("skd_scores")
      .select("id,total,tkp,tiu,twk,keterangan,quality_status")
      .eq("formation_id", formationId)
      .eq("quality_status", "verified")
      .range(from, to);
    if (error) throw new Error(`Gagal membaca skor formasi ${formationId}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < to - from + 1) break;
  }
  return { skipped: false, rows };
}

function recomputeFormation(rows, quota) {
  const attended = rows.filter((row) => row.total != null);
  const passing = rows.filter((row) => isPassing(row.keterangan));
  const shortlisted = rows.filter((row) => isShortlisted(row.keterangan));
  const absent = rows.filter((row) => ABSENT_STATUSES.has(row.keterangan));
  const values = attended.map((row) => Number(row.total)).sort((left, right) => left - right);
  const cutoff = [...shortlisted].sort(compareScoreTuple)[shortlisted.length - 1] ?? null;
  const cutoffTieCount = cutoff
    ? shortlisted.filter((row) => sameScoreTuple(row, cutoff)).length
    : 0;
  const shortlistCapacity = quota * 3;

  return {
    participant_count: rows.length,
    attended_count: attended.length,
    passing_count: passing.length,
    shortlisted_count: shortlisted.length,
    no_show_count: absent.length,
    shortlist_capacity: shortlistCapacity,
    competition_ratio: quota > 0 ? Number((attended.length / quota).toFixed(2)) : null,
    minimum_total: values[0] ?? null,
    median_total: percentileCont(values, 0.5),
    p75_total: percentileCont(values, 0.75),
    maximum_total: values.at(-1) ?? null,
    cutoff_total: cutoff?.total ?? null,
    cutoff_tkp: cutoff?.tkp ?? null,
    cutoff_tiu: cutoff?.tiu ?? null,
    cutoff_twk: cutoff?.twk ?? null,
    cutoff_tie_count: cutoffTieCount,
    capacity_consistent: shortlisted.length <= shortlistCapacity + Math.max(cutoffTieCount - 1, 0),
  };
}

function expectedRank(rows, sample, passingOnly) {
  if (sample.total == null) return null;
  const pool = passingOnly ? rows.filter((row) => isPassing(row.keterangan)) : rows;
  return 1 + pool.filter((row) => compareScoreTuple(row, sample) < 0).length;
}

function expectedTieCount(rows, sample, passingOnly = false) {
  if (sample.total == null) return 0;
  const pool = passingOnly ? rows.filter((row) => isPassing(row.keterangan)) : rows;
  return pool.filter((row) => sameScoreTuple(row, sample)).length;
}

function expectedVerdict(status, passingRank, quota) {
  if (ABSENT_STATUSES.has(status)) return "unavailable";
  if (status === "TL") return "ineligible";
  if (status === "P") return "less_rational";
  if (isShortlisted(status) && passingRank <= quota) return "strong";
  if (isShortlisted(status) && passingRank <= quota * 2) return "rational";
  if (isShortlisted(status)) return "borderline";
  return "unavailable";
}

function compareStats(issues, actual, expected, prefix) {
  const exactFields = [
    "participant_count",
    "attended_count",
    "passing_count",
    "shortlisted_count",
    "no_show_count",
    "shortlist_capacity",
    "minimum_total",
    "maximum_total",
    "cutoff_total",
    "cutoff_tkp",
    "cutoff_tiu",
    "cutoff_twk",
    "cutoff_tie_count",
    "capacity_consistent",
  ];
  const decimalFields = ["competition_ratio", "median_total", "p75_total"];

  for (const field of exactFields) {
    if (actual?.[field] !== expected[field]) {
      addIssue(issues, "error", `${prefix}_${field}`, `${field} tidak konsisten.`, {
        rpc_or_table: actual?.[field] ?? null,
        recomputed: expected[field],
      });
    }
  }
  for (const field of decimalFields) {
    if (!approximatelyEqual(actual?.[field], expected[field])) {
      addIssue(issues, "error", `${prefix}_${field}`, `${field} tidak konsisten.`, {
        rpc_or_table: actual?.[field] ?? null,
        recomputed: expected[field],
      });
    }
  }
}

function snapshotStats(snapshot) {
  const stats = snapshot?.historical_stats;
  if (!stats) return null;
  return {
    participant_count: stats.participants,
    attended_count: stats.attended,
    passing_count: stats.passing_grade,
    shortlisted_count: stats.shortlisted_for_skb,
    no_show_count: stats.not_attended,
    shortlist_capacity: stats.shortlist_capacity,
    competition_ratio: stats.competition_ratio,
    minimum_total: stats.minimum_total,
    median_total: stats.median_total,
    p75_total: stats.p75_total,
    maximum_total: stats.maximum_total,
    cutoff_total: stats.cutoff?.total,
    cutoff_tkp: stats.cutoff?.tkp,
    cutoff_tiu: stats.cutoff?.tiu,
    cutoff_twk: stats.cutoff?.twk,
    cutoff_tie_count: stats.cutoff?.tied_count,
    capacity_consistent: snapshot.data_quality?.capacity_consistent,
  };
}

function validateSnapshotContract(sample, snapshot, formation, issues) {
  if (!snapshot || snapshot.version !== 5) {
    addIssue(issues, "error", "snapshot_contract", "RPC tidak mengembalikan snapshot v5.");
    return;
  }

  if (snapshot.score_id !== sample.id || snapshot.formation_id !== sample.formation_id) {
    addIssue(
      issues,
      "error",
      "snapshot_identity",
      "Identitas score/formasi pada snapshot berubah.",
    );
  }
  if (snapshot.participant?.official_status !== sample.keterangan) {
    addIssue(issues, "error", "official_status", "Status resmi snapshot berbeda dari sumber.");
  }
  if (snapshot.participant?.total !== sample.total) {
    addIssue(issues, "error", "total_score", "Total snapshot berbeda dari skor sumber.");
  }
  if (snapshot.formation?.institution !== formation?.nama_instansi) {
    addIssue(issues, "error", "institution", "Instansi snapshot berbeda dari formasi sumber.");
  }

  const eligible = isPassing(sample.keterangan);
  const scoreValues = [sample.twk, sample.tiu, sample.tkp, sample.total];
  if (ABSENT_STATUSES.has(sample.keterangan) && scoreValues.some((value) => value != null)) {
    addIssue(issues, "error", "absent_score_values", "Status tidak hadir memiliki nilai SKD.");
  }
  if (!ABSENT_STATUSES.has(sample.keterangan)) {
    if (scoreValues.some((value) => value == null)) {
      addIssue(
        issues,
        "error",
        "incomplete_score",
        "Peserta hadir memiliki komponen nilai kosong.",
      );
    } else if (sample.twk + sample.tiu + sample.tkp !== sample.total) {
      addIssue(issues, "error", "score_sum", "TWK + TIU + TKP tidak sama dengan total.");
    }
  }
  const meetsThresholds =
    sample.twk >= PASSING_THRESHOLDS.twk &&
    sample.tiu >= PASSING_THRESHOLDS.tiu &&
    sample.tkp >= PASSING_THRESHOLDS.tkp;
  if (eligible && !meetsThresholds) {
    addIssue(
      issues,
      "error",
      "passing_status",
      "Status lulus PG tetapi komponen nilai tidak memenuhi ambang.",
    );
  }
  if (sample.keterangan === "TL" && meetsThresholds) {
    addIssue(
      issues,
      "warning",
      "tl_meets_thresholds",
      "Status TL memenuhi ambang numerik; perlu cek aturan/keterangan sumber.",
    );
  }
  if (snapshot.score_profile?.eligible_for_simulation !== eligible) {
    addIssue(issues, "error", "eligibility", "Flag kelayakan simulasi tidak sesuai status resmi.");
  }
  if (
    !Object.entries(PASSING_THRESHOLDS).every(
      ([field, value]) => snapshot.score_profile?.passing_thresholds?.[field] === value,
    )
  ) {
    addIssue(
      issues,
      "error",
      "thresholds",
      "Passing grade pada snapshot tidak sesuai aturan mesin.",
    );
  }
  if (snapshot.methodology?.model !== "v5_guardrailed") {
    addIssue(issues, "error", "model_version", "Metodologi bukan v5_guardrailed.");
  }
  if (snapshot.methodology?.uses_final_skb_result !== false) {
    addIssue(
      issues,
      "error",
      "skb_usage",
      "Snapshot tidak menegaskan bahwa hasil akhir SKB dikecualikan.",
    );
  }
  if (
    JSON.stringify(snapshot.methodology?.score_order) !==
    JSON.stringify(["total", "tkp", "tiu", "twk"])
  ) {
    addIssue(issues, "error", "score_order", "Urutan tie-break tidak sesuai kontrak.");
  }
  const guardrails = snapshot.methodology?.quality_guardrails;
  if (
    guardrails?.minimum_passing_pool !== 3 ||
    guardrails?.minimum_historical_shortlist !== 1 ||
    guardrails?.maximum_limited_confidence !== 1 ||
    guardrails?.maximum_cross_position_fallback !== 1
  ) {
    addIssue(issues, "error", "quality_guardrails", "Guardrail kualitas v5 tidak lengkap.");
  }

  const recommendations = snapshot.target_recommendations ?? [];
  if (!eligible && recommendations.length > 0) {
    addIssue(
      issues,
      "error",
      "ineligible_recommendations",
      "Status non-PG menerima rekomendasi target.",
    );
  }
  if (eligible && recommendations.length === 0) {
    addIssue(
      issues,
      "warning",
      "empty_recommendations",
      "Peserta eligible tidak memperoleh rekomendasi.",
    );
  }
  if (recommendations.length > 3) {
    addIssue(
      issues,
      "error",
      "recommendation_limit",
      "RPC mengembalikan lebih dari tiga rekomendasi.",
    );
  }

  const ids = recommendations.map((item) => item.formation_id);
  if (new Set(ids).size !== ids.length) {
    addIssue(issues, "error", "duplicate_recommendation", "Ada formasi rekomendasi yang berulang.");
  }
  if (ids.includes(sample.formation_id)) {
    addIssue(issues, "error", "source_recommended", "Formasi sumber direkomendasikan kembali.");
  }
}

function expectedRecommendationTier(rank, quota, shortlistCapacity, scoreGap) {
  if (rank <= Math.max(quota, 1)) return "most_rational";
  if (rank <= Math.max(shortlistCapacity, 1)) return "competitive";
  if (scoreGap >= -10) return "ambitious";
  return "below";
}

function expectedConfidence(stats) {
  if (stats.capacity_consistent && stats.passing_count >= 30 && stats.shortlisted_count >= 3) {
    return "strong";
  }
  if (stats.capacity_consistent && stats.passing_count >= 10 && stats.shortlisted_count >= 1) {
    return "moderate";
  }
  return "limited";
}

function expectedRecommendationScore(tier, confidence, relation, competitionRatio, scoreGap) {
  const tierScore = { most_rational: 45, competitive: 35, ambitious: 22, below: 5 }[tier];
  const confidenceScore = { strong: 20, moderate: 12, limited: 4 }[confidence];
  const relationScore = { same_position: 15, related_position: 10, cross_position: 0 }[relation];
  const competitionScore =
    competitionRatio != null && competitionRatio <= 10
      ? 10
      : competitionRatio != null && competitionRatio <= 25
        ? 6
        : 2;
  const gapScore =
    scoreGap != null && scoreGap >= 10
      ? 10
      : scoreGap != null && scoreGap >= 0
        ? 7
        : scoreGap != null && scoreGap >= -10
          ? 3
          : 0;
  return Math.min(100, tierScore + confidenceScore + relationScore + competitionScore + gapScore);
}

function validateRecommendations(sample, snapshot, contexts, statsMap, scoreMap, issues) {
  const recommendations = snapshot?.target_recommendations ?? [];
  const limitedConfidenceIds = [];
  const crossPositionIds = [];
  const skippedRankIds = [];
  if (recommendations.filter((item) => item.confidence?.code === "limited").length > 1) {
    addIssue(
      issues,
      "error",
      "limited_confidence_limit",
      "Lebih dari satu target ber-confidence terbatas.",
    );
  }
  if (recommendations.filter((item) => item.is_mode_fallback).length > 1) {
    addIssue(issues, "error", "cross_position_limit", "Lebih dari satu fallback lintas jabatan.");
  }
  for (const item of recommendations) {
    const context = contexts.get(item.formation_id);
    const stats = statsMap.get(item.formation_id);
    if (!context || !stats) {
      addIssue(
        issues,
        "error",
        "target_missing",
        "Formasi/statistik rekomendasi tidak ditemukan.",
        {
          formation_id: item.formation_id,
        },
      );
      continue;
    }
    if (context.quality_status !== "verified") {
      addIssue(issues, "error", "target_unverified", "Formasi rekomendasi belum verified.");
    }
    if (
      normalize(context.jenis_formasi) !== "UMUM" ||
      item.formation_type?.trim().toUpperCase() !== "UMUM"
    ) {
      addIssue(issues, "error", "target_type", "Formasi rekomendasi bukan UMUM.");
    }
    const educationOptions = context.pendidikan_options ?? [];
    if (!educationOptions.some((option) => normalize(option) === normalize(sample.pendidikan))) {
      addIssue(
        issues,
        "error",
        "education_match",
        "Pendidikan peserta tidak cocok persis dengan target.",
        {
          formation_id: item.formation_id,
        },
      );
    }
    if (item.education_match !== "exact") {
      addIssue(issues, "error", "education_contract", "Label education_match bukan exact.");
    }
    if (item.eligible_pool !== stats.passing_count || item.passing_grade !== stats.passing_count) {
      addIssue(
        issues,
        "error",
        "target_pool",
        "Jumlah pool PG rekomendasi berbeda dari statistik.",
      );
    }
    if (stats.passing_count < 3 || stats.shortlisted_count < 1) {
      addIssue(
        issues,
        "error",
        "target_sample_too_thin",
        "Target tidak memenuhi sampel minimum v5.",
      );
    }
    if (item.cutoff?.total !== stats.cutoff_total) {
      addIssue(
        issues,
        "error",
        "target_cutoff",
        "Cutoff rekomendasi berbeda dari statistik formasi.",
      );
    }
    const expectedGap =
      sample.total == null || stats.cutoff_total == null ? null : sample.total - stats.cutoff_total;
    if (item.score_gap_to_shortlist_cutoff !== expectedGap) {
      addIssue(issues, "error", "target_gap", "Selisih skor rekomendasi salah.", {
        rpc: item.score_gap_to_shortlist_cutoff,
        recomputed: expectedGap,
      });
    }
    const expectedRecommended =
      stats.cutoff_total == null
        ? null
        : Math.min(
            550,
            stats.cutoff_total +
              (item.confidence?.code === "strong"
                ? 5
                : item.confidence?.code === "moderate"
                  ? 8
                  : 12),
          );
    if (item.recommended_total !== expectedRecommended) {
      addIssue(
        issues,
        "error",
        "recommended_total",
        "Target nilai rekomendasi tidak sesuai formula v5.",
      );
    }
    const expectedNeeded =
      expectedRecommended == null ? null : Math.max(0, expectedRecommended - sample.total);
    if (item.score_needed_to_recommended_total !== expectedNeeded) {
      addIssue(
        issues,
        "error",
        "recommended_score_gap",
        "Kebutuhan kenaikan skor rekomendasi tidak konsisten.",
      );
    }
    const expectedAboveCutoff = expectedGap == null ? null : expectedGap >= 0;
    if (item.above_historical_cutoff !== expectedAboveCutoff) {
      addIssue(issues, "error", "above_cutoff", "Flag posisi terhadap cutoff tidak konsisten.");
    }

    const formationScores = scoreMap.get(item.formation_id);
    if (!formationScores || formationScores.skipped) {
      skippedRankIds.push(item.formation_id);
    } else {
      const simulatedRank = expectedRank(formationScores.rows, sample, true);
      const simulatedTies = expectedTieCount(formationScores.rows, sample, true);
      const tier = expectedRecommendationTier(
        simulatedRank,
        Number(context.jumlah_formasi),
        Number(stats.shortlist_capacity),
        expectedGap,
      );
      const confidence = expectedConfidence(stats);
      const recommendationScore = expectedRecommendationScore(
        tier,
        confidence,
        item.position_relation,
        stats.competition_ratio,
        expectedGap,
      );
      const verdictByTier = {
        most_rational: "very_competitive",
        competitive: "competitive",
        ambitious: "close",
        below: "below",
      };

      if (item.simulated_rank !== simulatedRank) {
        addIssue(issues, "error", "simulated_rank", "Peringkat simulasi target tidak konsisten.", {
          rpc: item.simulated_rank,
          recomputed: simulatedRank,
        });
      }
      if (item.simulated_tied_count !== simulatedTies) {
        addIssue(issues, "error", "simulated_ties", "Jumlah tie simulasi target tidak konsisten.");
      }
      if (item.recommendation_tier !== tier || item.verdict?.code !== verdictByTier[tier]) {
        addIssue(issues, "error", "recommendation_tier", "Tier/verdict target tidak konsisten.");
      }
      if (item.confidence?.code !== confidence) {
        addIssue(
          issues,
          "error",
          "recommendation_confidence",
          "Confidence target tidak konsisten.",
        );
      }
      if (item.recommendation_score !== recommendationScore) {
        addIssue(
          issues,
          "error",
          "recommendation_score",
          "Skor kecocokan rekomendasi tidak sesuai formula v5.",
          { rpc: item.recommendation_score, recomputed: recommendationScore },
        );
      }
      const percentile = Number(
        ((simulatedRank * 100) / Math.max(stats.passing_count, 1)).toFixed(1),
      );
      if (!approximatelyEqual(item.eligible_percentile, percentile, 0.1)) {
        addIssue(issues, "error", "eligible_percentile", "Persentil pool PG tidak konsisten.");
      }
    }
    if (item.confidence?.code === "limited") {
      limitedConfidenceIds.push(item.formation_id);
    }
    if (item.is_mode_fallback) {
      crossPositionIds.push(item.formation_id);
    }
  }
  if (limitedConfidenceIds.length) {
    addIssue(
      issues,
      "warning",
      "limited_confidence",
      `${limitedConfidenceIds.length} rekomendasi memakai sampel historis terbatas.`,
      { formation_ids: limitedConfidenceIds },
    );
  }
  if (crossPositionIds.length) {
    addIssue(
      issues,
      "warning",
      "cross_position_fallback",
      `${crossPositionIds.length} rekomendasi memakai fallback lintas jabatan.`,
      { formation_ids: crossPositionIds },
    );
  }
  if (skippedRankIds.length) {
    addIssue(
      issues,
      "warning",
      "target_rank_audit_skipped",
      `${skippedRankIds.length} peringkat rekomendasi tidak dihitung ulang karena formasi terlalu besar.`,
      { formation_ids: skippedRankIds },
    );
  }
}

function summarizeIssues(results) {
  const summary = { samples: results.length, passed: 0, warnings: 0, errors: 0, skipped: 0 };
  for (const result of results) {
    const hasError = result.issues.some((issue) => issue.severity === "error");
    const hasWarning = result.issues.some((issue) => issue.severity === "warning");
    if (!hasError && !hasWarning) summary.passed += 1;
    summary.errors += result.issues.filter((issue) => issue.severity === "error").length;
    summary.warnings += result.issues.filter((issue) => issue.severity === "warning").length;
    if (result.independent_audit === "skipped") summary.skipped += 1;
  }
  return summary;
}

function markdownReport(report) {
  const lines = [
    "# Evaluasi Mesin Rasionalisasi SKD v5",
    "",
    `Dibuat: ${report.generated_at}`,
    `Project: \`${report.project_ref}\``,
    `Sampel: ${report.summary.samples} dari ${report.coverage.published_batches} batch published`,
    "",
    "## Ringkasan",
    "",
    `- Lolos tanpa catatan: ${report.summary.passed}`,
    `- Error: ${report.summary.errors}`,
    `- Warning: ${report.summary.warnings}`,
    `- Audit formasi dilewati: ${report.summary.skipped}`,
    "",
    "## Cakupan Status",
    "",
    "| Status | Sampel |",
    "| --- | ---: |",
    ...STATUS_GROUPS.map((group) => `| ${group} | ${report.coverage.statuses[group] ?? 0} |`),
    "",
    "## Hasil Sampel",
    "",
    "| Instansi | Status | Peserta | Halaman | Verdict | Error | Warning | Audit |",
    "| --- | --- | --- | ---: | --- | ---: | ---: | --- |",
    ...report.results.map((result) => {
      const errors = result.issues.filter((issue) => issue.severity === "error").length;
      const warnings = result.issues.filter((issue) => issue.severity === "warning").length;
      return `| ${result.institution.replaceAll("|", "\\|")} | ${result.status} | ${result.participant_number} | ${result.source_page} | ${result.verdict ?? "-"} | ${errors} | ${warnings} | ${result.independent_audit} |`;
    }),
    "",
  ];

  const findings = report.results.filter((result) => result.issues.length);
  if (findings.length) {
    lines.push("## Temuan", "");
    for (const result of findings) {
      lines.push(`### ${result.institution} / ${result.participant_number}`, "");
      for (const issue of result.issues) {
        lines.push(`- **${issue.severity.toUpperCase()} ${issue.code}:** ${issue.message}`);
      }
      lines.push("");
    }
  } else {
    lines.push("## Temuan", "", "Tidak ada pelanggaran kontrak atau ketidaksesuaian hitungan.", "");
  }

  lines.push(
    "## Batas Evaluasi",
    "",
    "- Evaluasi ini memeriksa konsistensi matematis dan kontrak data, bukan memprediksi kelulusan CPNS berikutnya.",
    "- Hasil akhir SKB sengaja tidak digunakan.",
    "- Formasi yang melampaui batas baris dicatat sebagai skipped agar query tetap ringan.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const supabase = createSupabaseClient();
  const batches = await fetchPublishedBatches(supabase);
  if (!batches.length) throw new Error("Tidak ada batch published untuk dievaluasi.");

  console.log(`Mengambil kandidat ringan dari ${batches.length} batch published...`);
  const requests = batches.flatMap((batch) => STATUS_GROUPS.map((group) => ({ batch, group })));
  const fetched = await mapLimit(requests, 6, async ({ batch, group }) => {
    const score = await fetchCandidate(supabase, batch.id, group);
    return score ? { ...score, status_group: group, batch } : null;
  });
  const samples = selectBalancedSamples(fetched.filter(Boolean), options.sampleSize);
  if (!samples.length)
    throw new Error("Tidak ada skor verified dengan pendidikan yang dapat diuji.");

  const sourceFormationIds = [...new Set(samples.map((sample) => sample.formation_id))];
  const [sourceContexts, sourceStats] = await Promise.all([
    fetchFormationContext(supabase, sourceFormationIds),
    fetchStoredStats(supabase, sourceFormationIds),
  ]);

  console.log(`Menjalankan RPC v5 dan audit independen untuk ${samples.length} sampel...`);
  const preliminary = await mapLimit(samples, 3, async (sample) => {
    const issues = [];
    const formation = sourceContexts.get(sample.formation_id);
    const storedStats = sourceStats.get(sample.formation_id);
    const expectedCount = storedStats?.participant_count ?? options.maxFormationRows + 1;

    const [{ data: snapshot, error: rpcError }, formationScores] = await Promise.all([
      supabase.rpc("get_skd_rationalization_v5", {
        p_score_id: sample.id,
        p_recommendation_mode: "related",
        p_preferred_target_formation_id: null,
      }),
      fetchFormationScores(supabase, sample.formation_id, expectedCount, options.maxFormationRows),
    ]);

    if (rpcError) {
      addIssue(issues, "error", "rpc_failed", `RPC v5 gagal: ${rpcError.message}`);
    } else {
      validateSnapshotContract(sample, snapshot, formation, issues);
    }

    let independentAudit = "completed";
    let recomputed = null;
    if (formationScores.skipped) {
      independentAudit = "skipped";
      addIssue(issues, "warning", "formation_too_large", formationScores.reason);
    } else if (!formation || !storedStats) {
      independentAudit = "skipped";
      addIssue(
        issues,
        "error",
        "source_context_missing",
        "Konteks/statistik formasi sumber hilang.",
      );
    } else {
      recomputed = recomputeFormation(formationScores.rows, Number(formation.jumlah_formasi));
      compareStats(issues, storedStats, recomputed, "stats_table");
      if (snapshot) compareStats(issues, snapshotStats(snapshot), recomputed, "snapshot_stats");

      if (snapshot) {
        const overallRank = expectedRank(formationScores.rows, sample, false);
        const passingRank = isPassing(sample.keterangan)
          ? expectedRank(formationScores.rows, sample, true)
          : null;
        const tiedCount = expectedTieCount(formationScores.rows, sample);
        if (snapshot.historical_position?.overall_rank !== overallRank) {
          addIssue(issues, "error", "overall_rank", "Peringkat keseluruhan tidak konsisten.", {
            rpc: snapshot.historical_position?.overall_rank,
            recomputed: overallRank,
          });
        }
        if (snapshot.historical_position?.passing_rank !== passingRank) {
          addIssue(issues, "error", "passing_rank", "Peringkat pool PG tidak konsisten.", {
            rpc: snapshot.historical_position?.passing_rank,
            recomputed: passingRank,
          });
        }
        if (snapshot.historical_position?.tied_count !== tiedCount) {
          addIssue(
            issues,
            "error",
            "tied_count",
            "Jumlah peserta dengan tuple nilai sama tidak konsisten.",
          );
        }
        const verdict = expectedVerdict(
          sample.keterangan,
          passingRank,
          Number(formation.jumlah_formasi),
        );
        if (snapshot.verdict?.code !== verdict) {
          addIssue(
            issues,
            "error",
            "verdict",
            "Verdict tidak sesuai status, peringkat, dan kuota.",
            {
              rpc: snapshot.verdict?.code,
              recomputed: verdict,
            },
          );
        }
      }
    }

    return { sample, snapshot, issues, independentAudit, recomputed };
  });

  const targetFormationIds = [
    ...new Set(
      preliminary.flatMap(({ snapshot }) =>
        (snapshot?.target_recommendations ?? []).map((item) => item.formation_id),
      ),
    ),
  ];
  const [targetContexts, targetStats] = await Promise.all([
    fetchFormationContext(supabase, targetFormationIds),
    fetchStoredStats(supabase, targetFormationIds),
  ]);
  const targetScoreEntries = await mapLimit(targetFormationIds, 4, async (formationId) => {
    const expectedCount =
      targetStats.get(formationId)?.participant_count ?? options.maxFormationRows + 1;
    return [
      formationId,
      await fetchFormationScores(supabase, formationId, expectedCount, options.maxFormationRows),
    ];
  });
  const targetScores = new Map(targetScoreEntries);

  const results = preliminary.map(({ sample, snapshot, issues, independentAudit, recomputed }) => {
    if (snapshot) {
      validateRecommendations(sample, snapshot, targetContexts, targetStats, targetScores, issues);
    }
    return {
      score_id: sample.id,
      formation_id: sample.formation_id,
      institution:
        sourceContexts.get(sample.formation_id)?.nama_instansi ?? sample.batch.institution_name,
      participant_number: maskParticipantNumber(sample.no_peserta),
      status: sample.keterangan,
      status_group: statusGroup(sample.keterangan),
      source_page: sample.source_page,
      scores: { twk: sample.twk, tiu: sample.tiu, tkp: sample.tkp, total: sample.total },
      verdict: snapshot?.verdict?.code ?? null,
      recommendations: (snapshot?.target_recommendations ?? []).map((item) => ({
        formation_id: item.formation_id,
        institution: item.institution,
        position: item.position,
        tier: item.recommendation_tier,
        confidence: item.confidence?.code,
        simulated_rank: item.simulated_rank,
        eligible_pool: item.eligible_pool,
        recommended_total: item.recommended_total,
      })),
      independent_audit: independentAudit,
      recomputed_stats: recomputed,
      issues,
    };
  });

  const timestamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "Z");
  const outputPrefix = path.resolve(
    options.output || path.join("output", `rationalization-evaluation-${timestamp}`),
  );
  const report = {
    generated_at: new Date().toISOString(),
    project_ref: new URL(url).hostname.split(".")[0],
    settings: {
      sample_size_requested: options.sampleSize,
      max_formation_rows: options.maxFormationRows,
      recommendation_mode: "related",
    },
    coverage: {
      published_batches: batches.length,
      sampled_batches: new Set(samples.map((sample) => sample.batch_id)).size,
      statuses: Object.fromEntries(
        STATUS_GROUPS.map((group) => [
          group,
          samples.filter((sample) => sample.status_group === group).length,
        ]),
      ),
    },
    summary: summarizeIssues(results),
    results,
  };

  await mkdir(path.dirname(outputPrefix), { recursive: true });
  await Promise.all([
    writeFile(`${outputPrefix}.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(`${outputPrefix}.md`, markdownReport(report), "utf8"),
  ]);

  console.log("");
  console.log(`Sampel : ${report.summary.samples}`);
  console.log(`Lolos  : ${report.summary.passed}`);
  console.log(`Error  : ${report.summary.errors}`);
  console.log(`Warning: ${report.summary.warnings}`);
  console.log(`Laporan: ${outputPrefix}.md`);

  if (report.summary.errors > 0 || (options.failOnWarnings && report.summary.warnings > 0)) {
    process.exitCode = 1;
  }
}

await main();
