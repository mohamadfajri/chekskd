export type RationalizationVerdict =
  "strong" | "rational" | "borderline" | "less_rational" | "ineligible" | "unavailable";

export interface RationalizationSnapshot {
  kind: "skd_rationalization";
  version: 1;
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
}

export function isRationalizationSnapshot(value: unknown): value is RationalizationSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<RationalizationSnapshot>;
  return (
    snapshot.kind === "skd_rationalization" &&
    snapshot.version === 1 &&
    typeof snapshot.participant?.name === "string" &&
    typeof snapshot.formation?.institution === "string" &&
    typeof snapshot.verdict?.code === "string"
  );
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
  return [
    `Hasil rasionalisasi SKD ${snapshot.participant.name} sudah siap.`,
    `${snapshot.verdict.label} | Total ${snapshot.participant.total ?? "-"}`,
    rank ? `Posisi historis ${rank} dari ${attended} peserta hadir.` : null,
    `Acuan data resmi SKD ${snapshot.dataset_year}; bukan jaminan hasil seleksi berikutnya.`,
  ]
    .filter(Boolean)
    .join("\n");
}
