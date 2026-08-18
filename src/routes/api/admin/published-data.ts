import { createFileRoute } from "@tanstack/react-router";
import { getServerSupabase, jsonResponse, requireAdmin } from "@/lib/supabase/server";

const PAGE_SIZE = 25;

function positiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function oneRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export const Route = createFileRoute("/api/admin/published-data")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const authError = requireAdmin(request);
        if (authError) return authError;

        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) {
          return jsonResponse({ message: `Supabase server belum siap: ${configError}` }, 503);
        }

        const url = new URL(request.url);
        const mode = url.searchParams.get("mode") === "formations" ? "formations" : "overview";
        const { data: batches, error: batchError } = await sb
          .from("skd_batches")
          .select(
            "id, institution_code, institution_name, selection_year, source_count, source_page_count, formation_count, participant_count, published_at",
          )
          .eq("status", "published")
          .order("institution_name", { ascending: true });
        if (batchError) return jsonResponse({ message: batchError.message }, 500);

        const institutions = batches ?? [];
        const summary = institutions.reduce(
          (total, batch) => ({
            institutions: total.institutions + 1,
            sources: total.sources + batch.source_count,
            pages: total.pages + batch.source_page_count,
            formations: total.formations + batch.formation_count,
            participants: total.participants + batch.participant_count,
          }),
          { institutions: 0, sources: 0, pages: 0, formations: 0, participants: 0 },
        );

        if (mode === "overview") return jsonResponse({ summary, institutions });

        const publishedIds = institutions.map((batch) => batch.id);
        if (!publishedIds.length) {
          return jsonResponse({
            summary,
            institutions,
            formations: [],
            pagination: { page: 1, page_size: PAGE_SIZE, total: 0, total_pages: 1 },
          });
        }

        const batchId = url.searchParams.get("batchId")?.trim() ?? "";
        if (batchId && !publishedIds.includes(batchId)) {
          return jsonResponse({ message: "Instansi published tidak ditemukan." }, 404);
        }
        const page = positiveInt(url.searchParams.get("page"), 1, 100000);
        const pageSize = positiveInt(url.searchParams.get("pageSize"), PAGE_SIZE, 100);
        const search = (url.searchParams.get("search") ?? "")
          .trim()
          .slice(0, 100)
          .replace(/[(),]/g, " ");
        const sort = url.searchParams.get("sort") ?? "participants_desc";

        let query = sb
          .from("skd_formations")
          .select(
            "id, batch_id, kode_jabatan, jabatan, lokasi_formasi, jenis_formasi, pendidikan, jumlah_formasi, quality_status, skd_formation_stats(quota, participant_count, attended_count, passing_count, competition_ratio, minimum_total, median_total, maximum_total, cutoff_total, capacity_consistent)",
            { count: "exact" },
          )
          .in("batch_id", batchId ? [batchId] : publishedIds);

        if (search) {
          query = query.or(
            `jabatan.ilike.%${search}%,lokasi_formasi.ilike.%${search}%,pendidikan.ilike.%${search}%`,
          );
        }
        if (sort === "quota_desc") query = query.order("jumlah_formasi", { ascending: false });
        else if (sort === "name") query = query.order("jabatan", { ascending: true });
        else query = query.order("jumlah_formasi", { ascending: false });

        const from = (page - 1) * pageSize;
        const { data, count, error } = await query.range(from, from + pageSize - 1);
        if (error) return jsonResponse({ message: error.message }, 500);

        const institutionByBatch = new Map(
          institutions.map((batch) => [batch.id, batch.institution_name]),
        );
        const formations = (data ?? []).map((formation) => ({
          ...formation,
          institution_name: institutionByBatch.get(formation.batch_id) ?? "-",
          stats: oneRelation(formation.skd_formation_stats),
          skd_formation_stats: undefined,
        }));
        const total = count ?? 0;

        return jsonResponse({
          summary,
          institutions,
          formations,
          pagination: {
            page,
            page_size: pageSize,
            total,
            total_pages: Math.max(1, Math.ceil(total / pageSize)),
          },
        });
      },
    },
  },
});
