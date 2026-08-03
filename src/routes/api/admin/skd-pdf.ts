import { createFileRoute } from "@tanstack/react-router";
import { getServerSupabase, jsonResponse, requireAdmin } from "@/lib/supabase/server";

const PDF_BUCKET = "skd-source-pdfs";
const SIGNED_URL_SECONDS = 10 * 60;

function storageObjectPath(sourceId: string, fileName: string): string {
  return `${sourceId}/${fileName}`;
}

export const Route = createFileRoute("/api/admin/skd-pdf")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const authError = requireAdmin(request);
        if (authError) return authError;

        const sourceId = new URL(request.url).searchParams.get("sourceId")?.trim();
        if (!sourceId) return jsonResponse({ message: "sourceId wajib diisi." }, 400);

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

        const objectPath = storageObjectPath(sourceId, source.file_name);
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
            location: data.signedUrl,
            "cache-control": "private, no-store",
          },
        });
      },
    },
  },
});
