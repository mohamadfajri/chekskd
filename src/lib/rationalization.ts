export type RationalizationVerdict =
  "strong" | "rational" | "borderline" | "less_rational" | "ineligible" | "unavailable";

export type TargetSimulationVerdict =
  "very_competitive" | "competitive" | "close" | "below" | "ineligible" | "unavailable";

export type RecommendationMode = "related" | "all";
export type RecommendationTier = "most_rational" | "competitive" | "ambitious" | "below";
export type RecommendationConfidence = "strong" | "moderate" | "limited";

export interface RationalizationTargetSimulation {
  formation_id: string;
  dataset_year: number;
  institution: string;
  position: string;
  location: string | null;
  formation_type: string;
  education_requirement: string | null;
  education_match: "exact";
  position_relation?: "same_position" | "related_position" | "cross_position";
  position_similarity?: number;
  is_mode_fallback?: boolean;
  is_preferred?: boolean;
  quota: number;
  participants: number;
  attended: number;
  passing_grade: number;
  eligible_pool?: number;
  shortlisted_historical?: number;
  shortlist_capacity: number;
  competition_ratio: number | null;
  minimum_total: number | null;
  median_total: number | null;
  maximum_total: number | null;
  simulated_rank: number | null;
  simulated_tied_count: number;
  score_gap_to_shortlist_cutoff: number | null;
  score_needed_to_historical_cutoff?: number;
  recommended_total?: number | null;
  score_needed_to_recommended_total?: number | null;
  eligible_percentile?: number | null;
  above_historical_cutoff: boolean;
  recommendation_score?: number;
  strategy?: string;
  reason?: string;
  risk_flags?: string[];
  cutoff: {
    total: number | null;
    tkp: number | null;
    tiu: number | null;
    twk: number | null;
  };
  verdict: {
    code: TargetSimulationVerdict;
    label: string;
  };
  recommendation_tier?: RecommendationTier;
  confidence?: {
    code: RecommendationConfidence;
    label: string;
  };
  data_quality: {
    basis: string;
    ranking_pool?: "passing_grade_only";
    capacity_consistent: boolean;
    stats_calculated_at: string;
  };
}

export interface RationalizationSnapshot {
  kind: "skd_rationalization";
  version: 1 | 2 | 3 | 4;
  generated_at: string;
  score_id: string;
  formation_id: string;
  dataset_year: number;
  participant: {
    name: string;
    participant_number: string;
    education: string | null;
    twk: number | null;
    tiu: number | null;
    tkp: number | null;
    total: number | null;
    official_status: string;
  };
  formation: {
    institution: string;
    position: string;
    location: string | null;
    formation_type: string | null;
    education_requirement: string | null;
    quota: number;
  };
  historical_position: {
    overall_rank: number | null;
    passing_rank: number | null;
    tied_count: number;
    top_percent: number | null;
    score_gap_to_shortlist_cutoff: number | null;
  };
  historical_stats: {
    participants: number;
    attended: number;
    passing_grade: number;
    shortlisted_for_skb: number;
    not_attended: number;
    shortlist_capacity: number;
    competition_ratio: number | null;
    minimum_total: number | null;
    median_total: number | null;
    p75_total: number | null;
    maximum_total: number | null;
    cutoff: {
      total: number | null;
      tkp: number | null;
      tiu: number | null;
      twk: number | null;
      tied_count: number;
    };
  };
  verdict: {
    code: RationalizationVerdict;
    label: string;
  };
  request?: {
    nickname: string | null;
    target_year: string | null;
    target_institution: string | null;
    target_formation: string | null;
    plan: string | null;
  };
  data_quality: {
    basis: string;
    capacity_consistent: boolean;
    stats_calculated_at: string;
  };
  target_simulation?: RationalizationTargetSimulation;
  score_profile?: {
    eligible_for_simulation: boolean;
    passing_thresholds: { twk: number; tiu: number; tkp: number };
    threshold_buffers: { twk: number | null; tiu: number | null; tkp: number | null };
    priority_subtest: "TWK" | "TIU" | "TKP" | null;
    minimum_recommended_total: number | null;
    minimum_score_increase: number | null;
  };
  methodology?: {
    model: string;
    ranking_pool: "passing_grade_only";
    excluded_statuses: string[];
    score_order: string[];
    uses_final_skb_result: boolean;
  };
  recommendation_mode?: RecommendationMode;
  recommendation_summary?: {
    mode: RecommendationMode;
    mode_label: string;
    returned_count: number;
    eligible_formations: number;
    eligible_institutions: number;
    related_formations: number;
    dataset_formations: number;
    dataset_institutions: number;
    education_match: "exact";
    formation_type: "UMUM";
    scope_note: string;
  };
  target_recommendations?: RationalizationTargetSimulation[];
}

export function isRationalizationSnapshot(value: unknown): value is RationalizationSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<RationalizationSnapshot>;
  return (
    snapshot.kind === "skd_rationalization" &&
    (snapshot.version === 1 ||
      snapshot.version === 2 ||
      snapshot.version === 3 ||
      snapshot.version === 4) &&
    typeof snapshot.participant?.name === "string" &&
    typeof snapshot.formation?.institution === "string" &&
    typeof snapshot.verdict?.code === "string"
  );
}

export function targetSimulationRecommendation(code: TargetSimulationVerdict): string {
  switch (code) {
    case "very_competitive":
      return "Dengan nilai yang sama, posisi simulasi berada dalam jumlah kuota historis target. Tetap periksa syarat terbaru saat formasi dibuka.";
    case "competitive":
      return "Dengan nilai yang sama, posisi simulasi berada dalam kapasitas peserta SKB historis target. Target ini layak dipertimbangkan.";
    case "close":
      return "Nilai berada dekat batas peserta SKB historis target. Kenaikan skor kecil dapat memperkuat posisi persaingan.";
    case "below":
      return "Nilai masih di bawah batas peserta SKB historis target. Bandingkan target lain atau prioritaskan kenaikan skor.";
    case "ineligible":
      return "Nilai historis belum memenuhi ambang batas SKD, sehingga simulasi target belum dapat dianggap kompetitif.";
    case "unavailable":
      return "Simulasi target belum dapat dihitung dari data yang tersedia.";
  }
}

export function rationalizationRecommendation(code: RationalizationVerdict): string {
  switch (code) {
    case "strong":
      return "Posisi historis berada dalam kuota formasi. Pertahankan skor dan tetap bandingkan kuota serta persaingan saat formasi baru dibuka.";
    case "rational":
      return "Posisi historis cukup kompetitif. Naikkan skor dan siapkan beberapa target sejenis agar pilihan tidak bergantung pada satu formasi.";
    case "borderline":
      return "Posisi historis masih dekat batas persaingan. Prioritaskan kenaikan skor dan pertimbangkan formasi sejenis dengan rasio lebih ringan.";
    case "less_rational":
      return "Nilai memenuhi ambang batas, tetapi belum masuk daftar historis peserta SKB. Fokus menaikkan skor sebelum menentukan target.";
    case "ineligible":
      return "Nilai historis belum memenuhi ambang batas. Perbaiki subtes yang tertinggal sebelum membandingkan pilihan formasi.";
    case "unavailable":
      return "Posisi belum dapat dihitung dari data ini. Periksa status kehadiran dan dokumen sumber sebelum memakai hasil sebagai acuan.";
  }
}

export function buildRationalizationCaption(snapshot: RationalizationSnapshot): string {
  const rank = snapshot.historical_position.overall_rank;
  const attended = snapshot.historical_stats.attended;
  const target = snapshot.target_simulation;
  const targetGap = target?.score_gap_to_shortlist_cutoff;
  const targetRank = target?.simulated_rank;
  const recommendations = snapshot.target_recommendations ?? [];
  if (recommendations.length) {
    const priority = snapshot.score_profile?.priority_subtest;
    return [
      `Hasil rasionalisasi SKD ${snapshot.participant.name} sudah siap.`,
      `${snapshot.verdict.label} | Total ${snapshot.participant.total ?? "-"}`,
      priority ? `Prioritas latihan: ${priority}, karena buffer terhadap PG paling tipis.` : null,
      ...recommendations.map((item, index) => {
        const relation = item.is_mode_fallback ? " | lintas jabatan" : "";
        const pool = item.eligible_pool ?? item.passing_grade;
        const targetScore = item.recommended_total ?? item.cutoff.total;
        const needed = item.score_needed_to_recommended_total;
        const targetText =
          targetScore === null
            ? "target nilai -"
            : needed && needed > 0
              ? `target ${targetScore} (+${needed})`
              : `target ${targetScore} (sudah terlampaui)`;
        const recommendationScore = item.recommendation_score
          ? ` | skor kecocokan ${item.recommendation_score}/100`
          : "";
        return `${index + 1}. ${item.strategy ?? item.verdict.label}: ${item.position} - ${item.institution} | posisi ${item.simulated_rank ?? "-"}/${pool} peserta lolos PG | ${targetText} | ${item.confidence?.label ?? "Data terbatas"}${recommendationScore}${relation}`;
      }),
      snapshot.recommendation_summary?.scope_note ?? null,
      `Model ${snapshot.methodology?.model ?? `historis-v${snapshot.version}`}; tidak memakai hasil akhir SKB dan bukan jaminan seleksi berikutnya.`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `Hasil rasionalisasi SKD ${snapshot.participant.name} sudah siap.`,
    `${snapshot.verdict.label} | Total ${snapshot.participant.total ?? "-"}`,
    rank ? `Posisi historis ${rank} dari ${attended} peserta hadir.` : null,
    target ? `Target: ${target.position} - ${target.institution}` : null,
    target
      ? `${target.verdict.label} | Posisi simulasi ${targetRank ?? "-"}/${target.attended} | Selisih ${
          targetGap === null ? "-" : targetGap > 0 ? `+${targetGap}` : targetGap
        }`
      : null,
    `Acuan data resmi SKD ${snapshot.dataset_year}; bukan jaminan hasil seleksi berikutnya.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function rationalizationMarketingSegment(snapshot: RationalizationSnapshot): string {
  if (snapshot.verdict.code === "ineligible") return "needs_passing_grade";
  const best = snapshot.target_recommendations?.[0] ?? snapshot.target_simulation;
  if (!best) return "analysis_limited";
  if (best.recommendation_tier === "most_rational" && (best.recommendation_score ?? 0) >= 80) {
    return "competitive_ready";
  }
  if (best.recommendation_tier === "competitive" || best.verdict.code === "competitive") {
    return "competitive_growth";
  }
  return "score_improvement";
}
