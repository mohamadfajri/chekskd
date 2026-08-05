import { createFileRoute } from "@tanstack/react-router";
import { getServerSupabase, jsonResponse, requireAdmin } from "@/lib/supabase/server";

const PDF_BUCKET = "skd-source-pdfs";
const SIGNED_URL_SECONDS = 10 * 60;

function storageObjectPath(sourceId: string, fileName: string): string {
  return `${sourceId}/${fileName}`;
}

function partRange(fileName: string, sourceFileName: string) {
  const stem = sourceFileName.replace(/\.pdf$/i, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = fileName.match(new RegExp(`^${stem}__part-(\\d+)-(\\d+)\\.pdf$`, "i"));
  return match ? { firstPage: Number(match[1]), lastPage: Number(match[2]) } : null;
}

export const Route = createFileRoute("/api/admin/skd-pdf")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const authError = requireAdmin(request);
        if (authError) return authError;

        const requestUrl = new URL(request.url);
        const sourceId = requestUrl.searchParams.get("sourceId")?.trim();
        if (!sourceId) return jsonResponse({ message: "sourceId wajib diisi." }, 400);
        const requestedPage = Number(requestUrl.searchParams.get("page") ?? "1");
        if (!Number.isInteger(requestedPage) || requestedPage < 1) {
          return jsonResponse({ message: "page harus berupa bilangan bulat positif." }, 400);
        }

        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) {
          return jsonResponse({ message: `Supabase server belum siap: ${configError}` }, 503);
        }

        const { data: source, error: sourceError } = await sb
          .from("skd_sources")
          .select("file_name")
          .eq("id", sourceId)
          .maybeSingle();
        if (sourceError) return jsonResponse({ message: sourceError.message }, 500);
        if (!source) return jsonResponse({ message: "Sumber PDF tidak ditemukan." }, 404);

        const { data: objects, error: listError } = await sb.storage
          .from(PDF_BUCKET)
          .list(sourceId, { limit: 100 });
        if (listError) return jsonResponse({ message: listError.message }, 500);

        const fullPdf = objects?.find((object) => object.name === source.file_name);
        const matchingPart = objects
          ?.map((object) => ({ object, range: partRange(object.name, source.file_name) }))
          .find(
            (item) =>
              item.range &&
              requestedPage >= item.range.firstPage &&
              requestedPage <= item.range.lastPage,
          );
        const selectedName = fullPdf?.name ?? matchingPart?.object.name;
        const localPage = matchingPart?.range
          ? requestedPage - matchingPart.range.firstPage + 1
          : requestedPage;
        if (!selectedName) {
          return jsonResponse(
            {
              message: `PDF ${source.file_name} belum tersedia di Supabase Storage. Jalankan npm run skd:upload-pdfs.`,
            },
            404,
          );
        }

        const objectPath = storageObjectPath(sourceId, selectedName);
        const { data, error } = await sb.storage
          .from(PDF_BUCKET)
          .createSignedUrl(objectPath, SIGNED_URL_SECONDS);
        if (error || !data?.signedUrl) {
          return jsonResponse(
            {
              message: `PDF ${source.file_name} belum tersedia di Supabase Storage. Jalankan npm run skd:upload-pdfs.`,
            },
            404,
          );
        }

        return new Response(null, {
          status: 302,
          headers: {
            location: `${data.signedUrl}#page=${localPage}&zoom=page-width`,
            "cache-control": "private, no-store",
          },
        });
      },
    },
  },
});
