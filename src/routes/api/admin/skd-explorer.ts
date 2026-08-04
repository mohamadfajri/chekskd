import { createFileRoute } from "@tanstack/react-router";
import { getServerSupabase, jsonResponse, requireAdmin } from "@/lib/supabase/server";

const PAGE_SIZE_MAX = 100;
const FORMATION_CHUNK = 1000;
const QUALITY_STATUSES = new Set([
  "parsed",
  "auto_corrected",
  "needs_review",
  "verified",
  "rejected",
]);

function positiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function oneRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export const Route = createFileRoute("/api/admin/skd-explorer")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const authError = requireAdmin(request);
        if (authError) return authError;

        const url = new URL(request.url);
        const batchId = url.searchParams.get("batchId")?.trim();
        const mode = url.searchParams.get("mode") === "rows" ? "rows" : "overview";
        if (!batchId) return jsonResponse({ message: "batchId wajib diisi." }, 400);

        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) {
          return jsonResponse({ message: `Supabase server belum siap: ${configError}` }, 503);
        }

        if (mode === "overview") {
          const [batchResult, presentResult, absentResult, passingResult, reviewResult] =
            await Promise.all([
              sb
                .from("skd_batches")
                .select(
                  "id, institution_name, institution_code, selection_year, status, formation_count, participant_count, review_issue_count",
                )
                .eq("id", batchId)
                .maybeSingle(),
              sb
                .from("skd_scores")
                .select("id", { count: "exact", head: true })
                .eq("batch_id", batchId)
                .not("total", "is", null),
              sb
                .from("skd_scores")
                .select("id", { count: "exact", head: true })
                .eq("batch_id", batchId)
                .is("total", null),
              sb
                .from("skd_scores")
                .select("id", { count: "exact", head: true })
                .eq("batch_id", batchId)
                .gte("twk", 65)
                .gte("tiu", 80)
                .gte("tkp", 166),
              sb
                .from("skd_scores")
                .select("id", { count: "exact", head: true })
                .eq("batch_id", batchId)
                .eq("quality_status", "needs_review"),
            ]);

          const firstError = [
            batchResult.error,
            presentResult.error,
            absentResult.error,
            passingResult.error,
            reviewResult.error,
          ].find(Boolean);
          if (firstError) return jsonResponse({ message: firstError.message }, 500);
          if (!batchResult.data) return jsonResponse({ message: "Batch tidak ditemukan." }, 404);

          const formations = [];
          for (let from = 0; ; from += FORMATION_CHUNK) {
            const { data, error } = await sb
              .from("skd_formations")
              .select(
                "id, kode_jabatan, jabatan, lokasi_formasi, jenis_formasi, pendidikan, jumlah_formasi, quality_status",
              )
              .eq("batch_id", batchId)
              .order("jabatan", { ascending: true })
              .range(from, from + FORMATION_CHUNK - 1);
            if (error) return jsonResponse({ message: error.message }, 500);
            formations.push(...(data ?? []));
            if ((data?.length ?? 0) < FORMATION_CHUNK) break;
          }

          const seatCount = formations.reduce(
            (sum, formation) => sum + Number(formation.jumlah_formasi ?? 0),
            0,
          );
          const presentCount = presentResult.count ?? 0;

          return jsonResponse({
            summary: {
              ...batchResult.data,
              present_count: presentCount,
              absent_count: absentResult.count ?? 0,
              passing_count: passingResult.count ?? 0,
              needs_review_count: reviewResult.count ?? 0,
              seat_count: seatCount,
              competition_ratio: seatCount ? Number((presentCount / seatCount).toFixed(2)) : null,
            },
            formations,
          });
        }

        const page = positiveInt(url.searchParams.get("page"), 1, 100000);
        const pageSize = positiveInt(url.searchParams.get("pageSize"), 25, PAGE_SIZE_MAX);
        const search = url.searchParams.get("search")?.trim().slice(0, 100) ?? "";
        const formationId = url.searchParams.get("formationId")?.trim() ?? "";
        const attendance = url.searchParams.get("attendance") ?? "all";
        const passing = url.searchParams.get("passing") ?? "all";
        const quality = url.searchParams.get("quality") ?? "all";
        const sort = url.searchParams.get("sort") ?? "source_page";

        let query = sb
          .from("skd_scores")
          .select(
            "id, source_id, no_peserta, nama, pendidikan, twk, tiu, tkp, total, keterangan, source_page, quality_status, parser_confidence, skd_formations!inner(id, kode_jabatan, jabatan, lokasi_formasi, jenis_formasi, pendidikan, jumlah_formasi), skd_sources!inner(id, file_name)",
            { count: "exact" },
          )
          .eq("batch_id", batchId);

        if (search) {
          query = /^\d+$/.test(search)
            ? query.ilike("no_peserta", `%${search}%`)
            : query.ilike("nama", `%${search}%`);
        }
        if (formationId) query = query.eq("formation_id", formationId);
        if (attendance === "present") query = query.not("total", "is", null);
        if (attendance === "absent") query = query.is("total", null);
        if (passing === "pass") {
          query = query.gte("twk", 65).gte("tiu", 80).gte("tkp", 166);
        }
        if (passing === "fail") {
          query = query.not("total", "is", null).or("twk.lt.65,tiu.lt.80,tkp.lt.166");
        }
        if (QUALITY_STATUSES.has(quality)) query = query.eq("quality_status", quality);

        if (sort === "total_desc")
          query = query.order("total", { ascending: false, nullsFirst: false });
        else if (sort === "total_asc")
          query = query.order("total", { ascending: true, nullsFirst: false });
        else if (sort === "name") query = query.order("nama", { ascending: true });
        else
          query = query
            .order("source_page", { ascending: true })
            .order("nama", { ascending: true });

        const from = (page - 1) * pageSize;
        const { data, count, error } = await query.range(from, from + pageSize - 1);
        if (error) return jsonResponse({ message: error.message }, 500);

        const rows = (data ?? []).map((row) => {
          const formation = oneRelation(row.skd_formations);
          const source = oneRelation(row.skd_sources);
          return {
            id: row.id,
            source_id: row.source_id,
            no_peserta: row.no_peserta,
            nama: row.nama,
            pendidikan: row.pendidikan,
            twk: row.twk,
            tiu: row.tiu,
            tkp: row.tkp,
            total: row.total,
            keterangan: row.keterangan,
            source_page: row.source_page,
            quality_status: row.quality_status,
            parser_confidence: row.parser_confidence,
            formation_id: formation?.id ?? null,
            kode_jabatan: formation?.kode_jabatan ?? null,
            jabatan: formation?.jabatan ?? null,
            lokasi_formasi: formation?.lokasi_formasi ?? null,
            jenis_formasi: formation?.jenis_formasi ?? null,
            pendidikan_formasi: formation?.pendidikan ?? null,
            jumlah_formasi: formation?.jumlah_formasi ?? 0,
            source_file_name: source?.file_name ?? null,
          };
        });
        const total = count ?? 0;

        return jsonResponse({
          rows,
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
