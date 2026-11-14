import { lolosPassingGrade, PASSING_GRADE } from "./analysis.ts";

export const MANUAL_SKD_MAX = { twk: 150, tiu: 175, tkp: 225 } as const;
export const MANUAL_SKD_FIELDS = ["twk", "tiu", "tkp"] as const;
export type ManualSkdField = (typeof MANUAL_SKD_FIELDS)[number];
export type ManualSkdScore = Record<ManualSkdField, number> & { total: number };

export interface ManualSkdTarget {
  id: string;
  institution: string;
  job: string;
  location: string | null;
  matchedEducation: string;
  quota: number;
  cutoff: number;
  shortlistCapacity: number;
}

export interface ManualSkdResult {
  target: ManualSkdTarget;
  score: ManualSkdScore;
  rank: number | null;
  ties: number | null;
  scoreGap: number;
  average: number | null;
  belowThreshold: ManualSkdField[];
}

export interface ManualSkdAnalysis {
  results: ManualSkdResult[];
  targetUnavailable: boolean;
}

export function manualSkdScore(input: Record<string, unknown>): ManualSkdScore | null {
  const { twk, tiu, tkp } = input;
  function valid(value: unknown, max: number): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
  }
  if (
    !valid(twk, MANUAL_SKD_MAX.twk) ||
    !valid(tiu, MANUAL_SKD_MAX.tiu) ||
    !valid(tkp, MANUAL_SKD_MAX.tkp)
  )
    return null;
  return { twk, tiu, tkp, total: twk + tiu + tkp };
}

export function belowManualSkdThreshold(score: ManualSkdScore): ManualSkdField[] {
  return lolosPassingGrade(score)
    ? []
    : MANUAL_SKD_FIELDS.filter((field) => score[field] < PASSING_GRADE[field]);
}

export const MANUAL_SKD_SORT = ["total", "tkp", "tiu", "twk"] as const;

// PostgREST equivalent of (total, tkp, tiu, twk) > the submitted score tuple.
export function manualSkdAheadFilter(score: ManualSkdScore): string {
  return MANUAL_SKD_SORT.map((field, index) => {
    const prior = MANUAL_SKD_SORT.slice(0, index).map(
      (previous) => `${previous}.eq.${score[previous]}`,
    );
    const higher = `${field}.gt.${score[field]}`;
    return prior.length ? `and(${[...prior, higher].join(",")})` : higher;
  }).join(",");
}
