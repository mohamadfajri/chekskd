import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScoreInput } from "../lib/analysis.ts";
import { getSkdDatabase } from "./skdPreview.ts";

interface SourceScore extends ScoreInput {
  id: string;
  formation_id: string;
  nama: string;
}

interface SourceFormation {
  jabatan: string;
  nama_instansi: string;
}

interface TargetFormation extends SourceFormation {
  id: string;
}

export type SkdSessionSource =
  | { status: "missing_score" | "unpublished" | "ineligible_target" | "missing_history" }
  | {
      status: "ready";
      score: SourceScore;
      formation: SourceFormation;
      target: TargetFormation | null;
    };

interface SumopodSourceRow extends SourceScore {
  source_job: string | null;
  source_institution: string | null;
  source_published: boolean;
  target_id: string | null;
  target_job: string | null;
  target_institution: string | null;
  target_eligible: boolean;
  target_published: boolean;
  target_has_history: boolean;
}

export async function readSumopodSkdSessionSource(
  scoreId: string,
  targetId: string | null,
): Promise<SkdSessionSource> {
  const {
    rows: [row],
  } = await getSkdDatabase().query<SumopodSourceRow>(
    `select s.id, s.formation_id, s.nama, s.twk, s.tiu, s.tkp, s.total,
      f.jabatan as source_job, f.nama_instansi as source_institution,
      (b.status = 'published' and f.quality_status = 'verified') is true as source_published,
      t.id as target_id, t.jabatan as target_job, t.nama_instansi as target_institution,
      (t.id <> s.formation_id and t.quality_status = 'verified'
        and upper(btrim(t.jenis_formasi)) = 'UMUM' and nullif(s.pendidikan, '') is not null
        and public.skd_education_matches(s.pendidikan, t.pendidikan_options)) is true as target_eligible,
      (tb.status = 'published') is true as target_published,
      (ts.attended_count > 0 and ts.passing_count >= 3 and ts.shortlisted_count >= 1
        and ts.shortlist_capacity > 0 and ts.cutoff_total is not null and ts.cutoff_tkp is not null
        and ts.cutoff_tiu is not null and ts.cutoff_twk is not null) is true as target_has_history
    from public.skd_scores s
    left join public.skd_batches b on b.id = s.batch_id
    left join public.skd_formations f on f.id = s.formation_id and f.batch_id = s.batch_id
    left join public.skd_formations t on t.id = $2::uuid
    left join public.skd_batches tb on tb.id = t.batch_id
    left join public.skd_formation_stats ts on ts.formation_id = t.id
    where s.id = $1::uuid and s.quality_status = 'verified'`,
    [scoreId, targetId],
  );
  if (!row) return { status: "missing_score" };
  if (!row.source_published || row.source_job === null || row.source_institution === null)
    return { status: "unpublished" };
  let target: TargetFormation | null = null;
  if (targetId) {
    if (
      !row.target_eligible ||
      row.target_id === null ||
      row.target_job === null ||
      row.target_institution === null
    )
      return { status: "ineligible_target" };
    if (!row.target_published || !row.target_has_history) return { status: "missing_history" };
    target = { id: row.target_id, jabatan: row.target_job, nama_instansi: row.target_institution };
  }
  return {
    status: "ready",
    score: {
      id: row.id,
      formation_id: row.formation_id,
      nama: row.nama,
      twk: row.twk,
      tiu: row.tiu,
      tkp: row.tkp,
      total: row.total,
    },
    formation: { jabatan: row.source_job, nama_instansi: row.source_institution },
    target,
  };
}

export async function readSupabaseSkdSessionSource(
  sb: SupabaseClient,
  scoreId: string,
  targetId: string | null,
): Promise<SkdSessionSource> {
  const { data: score, error: scoreError } = await sb
    .from("skd_scores")
    .select("id,batch_id,formation_id,nama,pendidikan,twk,tiu,tkp,total,quality_status")
    .eq("id", scoreId)
    .maybeSingle();
  if (scoreError) throw scoreError;
  if (!score || score.quality_status !== "verified") return { status: "missing_score" };
  const [batch, formation] = await Promise.all([
    sb.from("skd_batches").select("status").eq("id", score.batch_id).maybeSingle(),
    sb
      .from("skd_formations")
      .select("jabatan,nama_instansi,quality_status")
      .eq("id", score.formation_id)
      .maybeSingle(),
  ]);
  if (batch.error || formation.error) throw batch.error ?? formation.error;
  if (batch.data?.status !== "published" || formation.data?.quality_status !== "verified")
    return { status: "unpublished" };

  let target: TargetFormation | null = null;
  if (targetId) {
    const { data, error } = await sb
      .from("skd_formations")
      .select("id,batch_id,nama_instansi,jabatan,jenis_formasi,pendidikan_options,quality_status")
      .eq("id", targetId)
      .maybeSingle();
    if (error) throw error;
    if (
      !data ||
      data.id === score.formation_id ||
      data.quality_status !== "verified" ||
      data.jenis_formasi?.trim().toUpperCase() !== "UMUM" ||
      !score.pendidikan
    )
      return { status: "ineligible_target" };
    const match = await sb.rpc("skd_education_matches", {
      p_participant_education: score.pendidikan,
      p_accepted_educations: data.pendidikan_options ?? [],
    });
    if (match.error) throw match.error;
    if (match.data !== true) return { status: "ineligible_target" };
    const [targetBatch, targetStats] = await Promise.all([
      sb.from("skd_batches").select("status").eq("id", data.batch_id).maybeSingle(),
      sb
        .from("skd_formation_stats")
        .select(
          "attended_count,passing_count,shortlisted_count,shortlist_capacity,cutoff_total,cutoff_tkp,cutoff_tiu,cutoff_twk",
        )
        .eq("formation_id", data.id)
        .maybeSingle(),
    ]);
    if (targetBatch.error || targetStats.error) throw targetBatch.error ?? targetStats.error;
    const stats = targetStats.data;
    if (
      targetBatch.data?.status !== "published" ||
      !stats ||
      !(
        stats.attended_count > 0 &&
        stats.passing_count >= 3 &&
        stats.shortlisted_count >= 1 &&
        stats.shortlist_capacity > 0 &&
        stats.cutoff_total !== null &&
        stats.cutoff_tkp !== null &&
        stats.cutoff_tiu !== null &&
        stats.cutoff_twk !== null
      )
    )
      return { status: "missing_history" };
    target = { id: data.id, jabatan: data.jabatan, nama_instansi: data.nama_instansi };
  }
  return { status: "ready", score, formation: formation.data, target };
}
