import { createFileRoute } from "@tanstack/react-router";
import { MIN_NAME_SEARCH_LENGTH, normalizeNameForSearch } from "@/lib/skdSearch";
import { jsonResponse } from "@/lib/supabase/server";
import { getPreviewScore, getPreviewStats, isLocalSkdPreview, searchPreviewScores } from "@/server/skdPreview";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/skd-preview")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        if (!isLocalSkdPreview(request)) return jsonResponse({ message: "Tidak ditemukan." }, 404);
        const query = new URL(request.url).searchParams;
        try {
          if (query.get("type") === "stats") return jsonResponse(await getPreviewStats());
          if (query.get("type") === "detail") {
            const id = query.get("id") ?? "";
            if (!UUID.test(id)) return jsonResponse({ message: "ID peserta tidak valid." }, 400);
            return jsonResponse(await getPreviewScore(id));
          }
          if (query.get("type") !== "search") return jsonResponse({ message: "Permintaan tidak valid." }, 400);
          const value = (key: string) => (query.get(key) ?? "").trim().slice(0, 120) || null;
          const name = normalizeNameForSearch(value("nama") ?? "");
          const number = value("no_peserta");
          if ((!name && !number) || (name && name.length < MIN_NAME_SEARCH_LENGTH)) {
            return jsonResponse({ message: "Isi nama atau nomor peserta yang valid." }, 400);
          }
          const limit = Math.max(1, Math.min(30, Math.trunc(Number(query.get("limit")) || 30)));
          return jsonResponse(await searchPreviewScores([name || null, number, value("instansi"), value("formasi"), limit]));
        } catch (error) {
          console.error("skd_preview_read_failed", (error as { code?: string })?.code ?? "unknown");
          return jsonResponse({ message: "Data SKD SumoPod belum dapat dibaca." }, 503);
        }
      },
    },
  },
});
