import { createFileRoute } from "@tanstack/react-router";
import { open, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { getServerSupabase, jsonResponse, requireAdmin } from "@/lib/supabase/server";

function normalizePdfName(value: string): string {
  return path
    .parse(value)
    .name.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^\d+[\s._-]*/, "")
    .replace(/[^a-z0-9]+/g, "");
}

async function findLocalPdf(root: string, sourceName: string): Promise<string | null> {
  const entries = (await readdir(root, { withFileTypes: true })).filter(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"),
  );
  const exact = entries.find((entry) => entry.name.toLowerCase() === sourceName.toLowerCase());
  if (exact) return path.join(root, exact.name);

  const normalizedSource = normalizePdfName(sourceName);
  const normalized = entries.filter((entry) => normalizePdfName(entry.name) === normalizedSource);
  return normalized.length === 1 ? path.join(root, normalized[0].name) : null;
}

function pdfHeaders(fileName: string, size: number): HeadersInit {
  return {
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "content-length": String(size),
    "content-type": "application/pdf",
  };
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
        const { data: source, error } = await sb
          .from("skd_sources")
          .select("file_name")
          .eq("id", sourceId)
          .maybeSingle();
        if (error) return jsonResponse({ message: error.message }, 500);
        if (!source) return jsonResponse({ message: "Sumber PDF tidak ditemukan." }, 404);

        const root = path.resolve(
          process.env.SKD_PDF_DIR ?? path.join(process.cwd(), "FILE SKD 2024"),
        );
        let filePath: string | null = null;
        try {
          filePath = await findLocalPdf(root, source.file_name);
        } catch {
          return jsonResponse({ message: `Folder PDF offline tidak ditemukan: ${root}` }, 404);
        }
        if (!filePath) {
          return jsonResponse(
            { message: `PDF offline tidak ditemukan untuk ${source.file_name}.` },
            404,
          );
        }

        const info = await stat(filePath);
        const range = request.headers.get("range");
        if (!range) {
          const contents = await readFile(filePath);
          return new Response(new Uint8Array(contents), {
            status: 200,
            headers: pdfHeaders(path.basename(filePath), info.size),
          });
        }

        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!match) {
          return new Response(null, {
            status: 416,
            headers: { "content-range": `bytes */${info.size}` },
          });
        }
        const start = Number(match[1]);
        const end = Math.min(match[2] ? Number(match[2]) : info.size - 1, info.size - 1);
        if (start > end || start >= info.size) {
          return new Response(null, {
            status: 416,
            headers: { "content-range": `bytes */${info.size}` },
          });
        }

        const length = end - start + 1;
        const handle = await open(filePath, "r");
        try {
          const buffer = Buffer.alloc(length);
          await handle.read(buffer, 0, length, start);
          return new Response(new Uint8Array(buffer), {
            status: 206,
            headers: {
              ...pdfHeaders(path.basename(filePath), length),
              "content-range": `bytes ${start}-${end}/${info.size}`,
            },
          });
        } finally {
          await handle.close();
        }
      },
    },
  },
});
