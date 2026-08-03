import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "skd-source-pdfs";
const root = path.resolve(process.env.SKD_PDF_DIR || path.join(process.cwd(), "FILE SKD 2024"));
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

if (!url || !key) {
  throw new Error("SUPABASE URL dan service role/secret key wajib tersedia di .env.");
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function normalizePdfName(value) {
  return path
    .parse(value)
    .name.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^\d+[\s._-]*/, "")
    .replace(/[^a-z0-9]+/g, "");
}

async function ensureBucket() {
  const { data, error } = await supabase.storage.getBucket(BUCKET);
  if (data) return;
  if (error && !/not found/i.test(error.message)) throw error;

  const created = await supabase.storage.createBucket(BUCKET, {
    public: false,
    allowedMimeTypes: ["application/pdf"],
    fileSizeLimit: 50 * 1024 * 1024,
  });
  if (created.error) throw created.error;
}

async function main() {
  const entries = (await readdir(root, { withFileTypes: true })).filter(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"),
  );
  const { data: sources, error } = await supabase
    .from("skd_sources")
    .select("id, file_name")
    .order("created_at");
  if (error) throw error;
  if (!sources?.length) throw new Error("Belum ada sumber PDF di tabel skd_sources.");

  await ensureBucket();
  let uploaded = 0;

  for (const source of sources) {
    const exact = entries.find(
      (entry) => entry.name.toLowerCase() === source.file_name.toLowerCase(),
    );
    const normalizedMatches = entries.filter(
      (entry) => normalizePdfName(entry.name) === normalizePdfName(source.file_name),
    );
    const match = exact || (normalizedMatches.length === 1 ? normalizedMatches[0] : null);
    if (!match) {
      console.warn(`Lewati: file lokal untuk ${source.file_name} tidak ditemukan.`);
      continue;
    }

    const filePath = path.join(root, match.name);
    const info = await stat(filePath);
    const objectPath = `${source.id}/${source.file_name}`;
    console.log(`Upload ${match.name} (${(info.size / 1024 / 1024).toFixed(1)} MB)...`);

    const result = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, await readFile(filePath), {
        contentType: "application/pdf",
        cacheControl: "3600",
        upsert: true,
      });
    if (result.error) throw result.error;
    uploaded += 1;
    console.log(`Selesai: ${objectPath}`);
  }

  console.log(`Upload selesai. ${uploaded} dari ${sources.length} sumber tersedia di Storage.`);
}

await main();
