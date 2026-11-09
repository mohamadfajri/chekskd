import { createFileRoute } from "@tanstack/react-router";
import { MIN_NAME_SEARCH_LENGTH, normalizeNameForSearch } from "@/lib/skdSearch";
import { getPublicServerSupabase, jsonResponse } from "@/lib/supabase/server";
import { getPreviewScore, getPreviewStats, searchPreviewScores, useSumopodSkdReads } from "@/server/skdPreview";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/skd-data")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const query = new URL(request.url).searchParams;
        const sumopod = useSumopodSkdReads(request);
        const sb = sumopod ? null : getPublicServerSupabase();
        if (!sumopod && !sb) return jsonResponse({ message: "Data SKD belum dikonfigurasi." }, 503);
        const respond = (body: unknown) => {
          const response = jsonResponse(body);
          response.headers.set("x-skd-backend", sumopod ? "sumopod" : "supabase");
          return response;
        };
        try {
          if (query.get("type") === "stats") {
            if (sumopod) return respond(await getPreviewStats());
            const { data, error } = await sb!.from("skd_batches")
              .select("participant_count,formation_count").eq("status", "published");
            if (error) throw error;
            return respond((data ?? []).reduce((total, row) => ({
              scores: total.scores + Number(row.participant_count ?? 0),
              formations: total.formations + Number(row.formation_count ?? 0),
            }), { scores: 0, formations: 0 }));
          }
          if (query.get("type") === "detail") {
            const id = query.get("id") ?? "";
            if (!UUID.test(id)) return jsonResponse({ message: "ID peserta tidak valid." }, 400);
            if (sumopod) return respond(await getPreviewScore(id));
            const { data, error } = await sb!.from("skd_scores")
              .select("id,no_peserta,nama,pendidikan,tahun_skd,twk,tiu,tkp,total,keterangan,formation_id,source_page,created_at,nama_normalized,skd_formations(id,nama_instansi,jabatan,kode_instansi,kode_jabatan,tahun,lokasi_formasi,jenis_formasi,pendidikan,jumlah_formasi,source_id,kode_lokasi,page_number,created_at)")
              .eq("id", id).maybeSingle();
            if (error) throw error;
            return respond(data);
          }
          if (query.get("type") !== "search") return jsonResponse({ message: "Permintaan tidak valid." }, 400);
          const value = (key: string) => (query.get(key) ?? "").trim().slice(0, 120) || null;
          const name = normalizeNameForSearch(value("nama") ?? "");
          const number = value("no_peserta");
          if ((!name && !number) || (name && name.length < MIN_NAME_SEARCH_LENGTH)) {
            return jsonResponse({ message: "Isi nama atau nomor peserta yang valid." }, 400);
          }
          const limit = Math.max(1, Math.min(30, Math.trunc(Number(query.get("limit")) || 30)));
          const institution = value("instansi");
          const job = value("formasi");
          if (sumopod) return respond(await searchPreviewScores([name || null, number, institution, job, limit]));
          const { data, error } = await sb!.rpc("search_public_skd_scores", {
            p_nama: name || null, p_no_peserta: number,
            p_instansi: institution, p_formasi: job, p_limit: limit,
          });
          if (error) throw error;
          return respond(data ?? []);
        } catch (error) {
          const code = (error as { code?: string })?.code;
          console.error("skd_read_failed", sumopod ? "sumopod" : "supabase", code ?? "unknown");
          return jsonResponse({
            message: code === "57014"
              ? "Pencarian terlalu luas. Tambahkan filter instansi atau gunakan nomor peserta."
              : "Data SKD belum dapat dibaca.",
          }, 503);
        }
      },
    },
  },
});
