import pg from "pg";
import {
  isRationalizationSnapshot,
  type AnalysisGoal,
  type RationalizationSnapshot,
} from "../lib/rationalization.ts";
import { aesenConnection } from "./aesenConnection.ts";

let pool: pg.Pool | undefined;

export function isLocalSkdPreview(request: Request): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.VITE_SKD_LOCAL_PREVIEW === "true" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(new URL(request.url).hostname)
  );
}

export function useSumopodSkdReads(request: Request): boolean {
  return process.env.SKD_READ_BACKEND === "sumopod" || isLocalSkdPreview(request);
}

export function getSkdDatabase() {
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

export async function searchPreviewScores(
  args: [string | null, string | null, string | null, string | null, number],
) {
  const { rows } = await getSkdDatabase().query(
    "select * from public.search_public_skd_scores($1,$2,$3,$4,$5)",
    args,
  );
  return rows;
}

export async function getPreviewScore(id: string) {
  const { rows } = await getSkdDatabase().query(
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
  const { rows } = await getSkdDatabase().query(
    `select coalesce(sum(participant_count),0)::int as scores,
      coalesce(sum(formation_count),0)::int as formations
    from public.skd_batches where status='published'`,
  );
  return rows[0];
}

export async function searchPreviewTargets(scoreId: string, query: string) {
  const { rows } = await getSkdDatabase().query(
    "select public.search_skd_target_formations($1,$2,20) as value",
    [scoreId, query],
  );
  return Array.isArray(rows[0]?.value) ? rows[0].value : [];
}

type SkdFormationDocument = Record<string, unknown>;

export async function searchSumopodSkdFormations(
  args: [
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string,
    number,
    number,
  ],
) {
  const { rows } = await getSkdDatabase().query<{ value: SkdFormationDocument | null }>(
    "select api_private.search_public_skd_formations($1,$2,$3,$4,$5,$6,$7,$8) as value",
    args,
  );
  return rows[0]?.value ?? null;
}

export async function getSumopodSkdFormationDetail(formationId: string) {
  const { rows } = await getSkdDatabase().query<{ value: SkdFormationDocument | null }>(
    "select api_private.get_public_skd_formation_detail($1) as value",
    [formationId],
  );
  return rows[0]?.value ?? null;
}

export async function getSumopodSkdFormationFilters() {
  const { rows } = await getSkdDatabase().query<{ value: SkdFormationDocument | null }>(
    "select api_private.get_skd_formation_filter_options() as value",
  );
  return rows[0]?.value ?? null;
}

export async function getSumopodSkdSearchInstitutions(): Promise<string[]> {
  const { rows } = await getSkdDatabase().query<{ nama_instansi: string }>(
    `select distinct f.nama_instansi
     from public.skd_formations f
     join public.skd_batches b on b.id = f.batch_id and b.status = 'published'
     where f.quality_status = 'verified'
       and exists (
         select 1 from public.skd_scores s
         where s.formation_id = f.id and s.batch_id = b.id and s.quality_status = 'verified'
       )
     order by f.nama_instansi`,
  );
  return rows.map(({ nama_instansi }) => nama_instansi);
}

export async function getPreviewRationalization(
  scoreId: string,
  goal: AnalysisGoal,
  flags: string[],
  targetId: string | null,
): Promise<RationalizationSnapshot | null> {
  const { rows } = await getSkdDatabase().query(
    "select public.get_skd_rationalization_v6($1,$2,$3,$4) as value",
    [scoreId, goal, flags, targetId],
  );
  const snapshot = { ...rows[0]?.value, kind: "skd_rationalization" };
  if (!isRationalizationSnapshot(snapshot) || snapshot.score_id !== scoreId) return null;
  if (snapshot.analysis_goal !== goal) return null;
  const ids = [
    snapshot.formation_id,
    snapshot.target_simulation?.formation_id,
    ...(snapshot.target_recommendations ?? []).map(({ formation_id }) => formation_id),
  ].filter((id): id is string => typeof id === "string");
  const context = await getSkdDatabase().query(
    "select public.get_approved_sscasn_context($1::uuid[]) as value",
    [[...new Set(ids)]],
  );
  return { ...snapshot, sscasn_context: context.rows[0]?.value ?? {} };
}
