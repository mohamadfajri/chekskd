import { requireSupabase } from "@/lib/supabase/client";
import type { SkdScoreWithFormation } from "@/lib/supabase/types";
import { MIN_NAME_SEARCH_LENGTH, normalizeNameForSearch } from "@/lib/skdSearch";

export const useLocalSkdPreview = import.meta.env.DEV && import.meta.env.VITE_SKD_LOCAL_PREVIEW === "true";

async function previewRead<T>(params: Record<string, string>): Promise<T> {
  const response = await fetch(`/api/skd-preview?${new URLSearchParams(params)}`);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message ?? "Data SKD SumoPod belum tersedia.");
  return body as T;
}

export interface SearchParams {
  nama: string;
  no_peserta?: string;
  instansi?: string;
  formasi?: string;
  limit?: number;
}

interface PublicSkdSearchRow {
  score_id: string;
  no_peserta: string;
  nama: string;
  pendidikan: string | null;
  tahun_skd: number | null;
  twk: number | null;
  tiu: number | null;
  tkp: number | null;
  total: number | null;
  keterangan: string;
  formation_id: string;
  source_page: number;
  score_created_at: string;
  nama_normalized: string;
  formation_source_id: string;
  nama_instansi: string;
  jabatan: string;
  kode_instansi: string | null;
  kode_jabatan: string | null;
  tahun: number;
  lokasi_formasi: string | null;
  jenis_formasi: string | null;
  pendidikan_formasi: string | null;
  jumlah_formasi: number;
  kode_lokasi: string | null;
  page_number: number | null;
  formation_created_at: string;
}

export async function searchSkdScores(params: SearchParams): Promise<SkdScoreWithFormation[]> {
  const limit = params.limit ?? 30;

  const normalizedName = normalizeNameForSearch(params.nama ?? "");
  if (normalizedName && normalizedName.length < MIN_NAME_SEARCH_LENGTH) {
    throw new Error(`Nama peserta minimal ${MIN_NAME_SEARCH_LENGTH} karakter.`);
  }

  const args = {
    p_nama: normalizedName || null,
    p_no_peserta: params.no_peserta?.trim() || null,
    p_instansi: params.instansi?.trim() || null,
    p_formasi: params.formasi?.trim() || null,
    p_limit: limit,
  };
  let data: unknown;
  if (useLocalSkdPreview) {
    data = await previewRead<PublicSkdSearchRow[]>({
      type: "search", nama: normalizedName, no_peserta: args.p_no_peserta ?? "",
      instansi: args.p_instansi ?? "", formasi: args.p_formasi ?? "", limit: String(limit),
    });
  } else {
    const result = await requireSupabase().rpc("search_public_skd_scores", args);
    if (result.error) throw result.error;
    data = result.data;
  }

  return ((data ?? []) as PublicSkdSearchRow[]).map(
    (row) =>
      ({
        id: row.score_id,
        no_peserta: row.no_peserta,
        nama: row.nama,
        pendidikan: row.pendidikan,
        tahun_skd: row.tahun_skd,
        twk: row.twk,
        tiu: row.tiu,
        tkp: row.tkp,
        total: row.total,
        keterangan: row.keterangan,
        formation_id: row.formation_id,
        source_page: row.source_page,
        created_at: row.score_created_at,
        nama_normalized: row.nama_normalized,
        skd_formations: {
          id: row.formation_id,
          source_id: row.formation_source_id,
          nama_instansi: row.nama_instansi,
          jabatan: row.jabatan,
          kode_instansi: row.kode_instansi,
          kode_jabatan: row.kode_jabatan,
          tahun: row.tahun,
          lokasi_formasi: row.lokasi_formasi,
          jenis_formasi: row.jenis_formasi,
          pendidikan: row.pendidikan_formasi,
          jumlah_formasi: row.jumlah_formasi,
          kode_lokasi: row.kode_lokasi,
          page_number: row.page_number,
          created_at: row.formation_created_at,
        },
      }) as unknown as SkdScoreWithFormation,
  );
}

export async function getSkdScoreById(id: string): Promise<SkdScoreWithFormation | null> {
  if (useLocalSkdPreview) return previewRead({ type: "detail", id });
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("skd_scores")
    .select(
      "id, no_peserta, nama, pendidikan, tahun_skd, twk, tiu, tkp, total, keterangan, formation_id, source_page, created_at, nama_normalized, skd_formations(id, nama_instansi, jabatan, kode_instansi, kode_jabatan, tahun, lokasi_formasi, jenis_formasi, pendidikan, jumlah_formasi, source_id, kode_lokasi, page_number, created_at)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as SkdScoreWithFormation | null;
}

export async function countStats(): Promise<{ scores: number; formations: number }> {
  if (useLocalSkdPreview) return previewRead({ type: "stats" });
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("skd_batches")
    .select("participant_count, formation_count")
    .eq("status", "published");
  if (error) throw error;
  return (data ?? []).reduce(
    (totals, batch) => ({
      scores: totals.scores + Number(batch.participant_count ?? 0),
      formations: totals.formations + Number(batch.formation_count ?? 0),
    }),
    { scores: 0, formations: 0 },
  );
}
