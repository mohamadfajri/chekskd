import type { SupabaseClient } from "@supabase/supabase-js";
import { isRationalizationSnapshot, type AnalysisGoal } from "../lib/rationalization";
import { getPreviewRationalization, useSumopodSkdReads as readsSkdFromSumopod } from "./skdPreview";

export async function readSkdRationalization(
  sb: SupabaseClient,
  request: Request,
  scoreId: string,
  goal: AnalysisGoal,
  flags: string[],
  targetId: string | null,
) {
  if (readsSkdFromSumopod(request))
    return getPreviewRationalization(scoreId, goal, flags, targetId);

  const { data, error } = await sb.rpc("get_skd_rationalization_v6", {
    p_score_id: scoreId,
    p_analysis_goal: goal,
    p_preference_flags: flags,
    p_preferred_target_formation_id: targetId,
  });
  if (error) throw error;
  const snapshot = { ...data, kind: "skd_rationalization" };
  return isRationalizationSnapshot(snapshot) && snapshot.score_id === scoreId ? snapshot : null;
}
