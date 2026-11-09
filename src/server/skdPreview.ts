import pg from "pg";
import {
  isRationalizationSnapshot,
  type AnalysisGoal,
  type RationalizationSnapshot,
} from "../lib/rationalization.ts";
import { aesenConnection } from "./aesenConnection.ts";

let pool: pg.Pool | undefined;

export function isLocalSkdPreview(request: Request): boolean {
  return process.env.NODE_ENV === "development" &&
    process.env.VITE_SKD_LOCAL_PREVIEW === "true" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(new URL(request.url).hostname);
}

function previewPool() {
  if (!pool) {
    const url = process.env.SKD_DATABASE_URL?.trim();
    if (!url) throw new Error("SKD_DATABASE_URL belum disetel.");
    pool = new pg.Pool({
      ...aesenConnection(url),
      max: 3,
      idleTimeoutMillis: 10_000,
      statement_timeout: 10_000,
      query_timeout: 12_000,
      allowExitOnIdle: true,
    });
    pool.on("error", () => console.error("skd_preview_pool_error"));
  }
  return pool;
}

export async function searchPreviewScores(args: [
  string | null, string | null, string | null, string | null, number,
]) {
  const { rows } = await previewPool().query(
    "select * from public.search_public_skd_scores($1,$2,$3,$4,$5)",
    args,
  );
  return rows;
}

export async function getPreviewScore(id: string) {
  const { rows } = await previewPool().query(
    `select s.id, s.no_peserta, s.nama, s.pendidikan, s.tahun_skd, s.twk, s.tiu, s.tkp,
      s.total, s.keterangan, s.formation_id, s.source_page, s.created_at, s.nama_normalized,
      jsonb_build_object(
        'id', f.id, 'nama_instansi', f.nama_instansi, 'jabatan', f.jabatan,
        'kode_instansi', f.kode_instansi, 'kode_jabatan', f.kode_jabatan, 'tahun', f.tahun,
        'lokasi_formasi', f.lokasi_formasi, 'jenis_formasi', f.jenis_formasi, 'pendidikan', f.pendidikan,
        'jumlah_formasi', f.jumlah_formasi, 'source_id', f.source_id, 'kode_lokasi', f.kode_lokasi,
        'page_number', f.page_number, 'created_at', f.created_at
      ) as skd_formations
    from public.skd_scores s
    join public.skd_batches b on b.id=s.batch_id and b.status='published'
    join public.skd_formations f on f.id=s.formation_id and f.batch_id=s.batch_id
      and f.quality_status='verified'
    where s.id=$1 and s.quality_status='verified'`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getPreviewStats() {
  const { rows } = await previewPool().query(
    `select coalesce(sum(participant_count),0)::int as scores,
      coalesce(sum(formation_count),0)::int as formations
    from public.skd_batches where status='published'`,
  );
  return rows[0];
}

export async function searchPreviewTargets(scoreId: string, query: string) {
  const { rows } = await previewPool().query(
    "select public.search_skd_target_formations($1,$2,20) as value",
    [scoreId, query],
  );
  return Array.isArray(rows[0]?.value) ? rows[0].value : [];
}

export async function getPreviewRationalization(
  scoreId: string,
  goal: AnalysisGoal,
  flags: string[],
  targetId: string | null,
): Promise<RationalizationSnapshot | null> {
  const { rows } = await previewPool().query(
    "select public.get_skd_rationalization_v6($1,$2,$3,$4) as value",
    [scoreId, goal, flags, targetId],
  );
  const snapshot = { ...rows[0]?.value, kind: "skd_rationalization" };
  if (!isRationalizationSnapshot(snapshot) || snapshot.score_id !== scoreId) return null;
  if (snapshot.analysis_goal !== goal) return null;
  const ids = [snapshot.formation_id, snapshot.target_simulation?.formation_id,
    ...(snapshot.target_recommendations ?? []).map(({ formation_id }) => formation_id)]
    .filter((id): id is string => typeof id === "string");
  const context = await previewPool().query(
    "select public.get_approved_sscasn_context($1::uuid[]) as value", [[...new Set(ids)]],
  );
  return { ...snapshot, sscasn_context: context.rows[0]?.value ?? {} };
}
