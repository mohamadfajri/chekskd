import { requireSupabase } from "@/lib/supabase/client";
import type { SkdScoreWithFormation } from "@/lib/supabase/types";

export interface SearchParams {
  nama: string;
  no_peserta?: string;
  instansi?: string;
  formasi?: string;
  limit?: number;
}

/**
 * Search peserta by nama (ilike) + optional filters.
 * MVP: pakai ilike. Nanti diganti pg_trgm/similarity di Codex.
 */
export async function searchSkdScores(params: SearchParams): Promise<SkdScoreWithFormation[]> {
  const sb = requireSupabase();
  const limit = params.limit ?? 30;

  let q = sb
    .from("skd_scores")
    .select(
      "id, no_peserta, nama, pendidikan, tahun_skd, twk, tiu, tkp, total, keterangan, formation_id, source_page, created_at, nama_normalized, skd_formations!inner(id, nama_instansi, jabatan, kode_instansi, kode_jabatan, tahun, lokasi_formasi, jenis_formasi, pendidikan, jumlah_formasi, source_id, kode_lokasi, page_number, created_at)",
    )
    .limit(limit);

  if (params.nama?.trim()) {
    q = q.ilike("nama", `%${params.nama.trim()}%`);
  }
  if (params.no_peserta?.trim()) {
    q = q.ilike("no_peserta", `%${params.no_peserta.trim()}%`);
  }
  if (params.instansi?.trim()) {
    q = q.ilike("skd_formations.nama_instansi", `%${params.instansi.trim()}%`);
  }
  if (params.formasi?.trim()) {
    q = q.ilike("skd_formations.jabatan", `%${params.formasi.trim()}%`);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as SkdScoreWithFormation[];
}

export async function getSkdScoreById(id: string): Promise<SkdScoreWithFormation | null> {
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
  const sb = requireSupabase();
  const [s, f] = await Promise.all([
    sb.from("skd_scores").select("id", { count: "exact", head: true }),
    sb.from("skd_formations").select("id", { count: "exact", head: true }),
  ]);
  return { scores: s.count ?? 0, formations: f.count ?? 0 };
}
