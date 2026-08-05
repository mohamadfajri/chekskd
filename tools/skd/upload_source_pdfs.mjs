import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "skd-source-pdfs";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const root = path.resolve(process.env.SKD_PDF_DIR || path.join(process.cwd(), "FILE SKD 2024"));
const partsRoot = path.resolve(
  process.env.SKD_PDF_PARTS_DIR || path.join(process.cwd(), "tmp", "storage-pdfs"),
);
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
    fileSizeLimit: 75 * 1024 * 1024,
  });
  if (created.error) throw created.error;
}

function findParts(entries, fileName) {
  const stem = path.parse(fileName).name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${stem}__part-(\\d+)-(\\d+)\\.pdf$`, "i");

  return entries
    .map((entry) => {
      const match = entry.name.match(pattern);
      return match
        ? { entry, firstPage: Number(match[1]), lastPage: Number(match[2]) }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.firstPage - right.firstPage);
}

async function remoteObjectMatches(folder, fileName, size) {
  const existing = await supabase.storage.from(BUCKET).list(folder, {
    limit: 100,
    search: fileName,
  });
  if (existing.error) throw existing.error;
  const exact = existing.data?.find((item) => item.name === fileName);
  return exact && Number(exact.metadata?.size) === size;
}

async function uploadFile(filePath, objectPath) {
  const result = await supabase.storage.from(BUCKET).upload(objectPath, await readFile(filePath), {
    contentType: "application/pdf",
    cacheControl: "3600",
    upsert: true,
  });
  if (result.error) throw result.error;
}

async function main() {
  const entries = (await readdir(root, { withFileTypes: true })).filter(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"),
  );
  const partEntries = await readdir(partsRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const { data: sources, error } = await supabase
    .from("skd_sources")
    .select("id, file_name, total_pages")
    .order("created_at");
  if (error) throw error;
  if (!sources?.length) throw new Error("Belum ada sumber PDF di tabel skd_sources.");

  await ensureBucket();
  let uploaded = 0;
  let skipped = 0;
  let availableSources = 0;

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
    let uploads = [{ filePath, fileName: source.file_name, info }];

    if (info.size > MAX_UPLOAD_BYTES) {
      const parts = findParts(partEntries, source.file_name);
      const lastPage = parts.at(-1)?.lastPage ?? 0;
      const contiguous = parts.every(
        (part, index) => part.firstPage === (index === 0 ? 1 : parts[index - 1].lastPage + 1),
      );
      if (!parts.length || !contiguous || lastPage !== source.total_pages) {
        console.warn(
          `Lewati: ${source.file_name} melebihi 50 MiB dan part PDF belum lengkap. ` +
            `Jalankan python tools/skd/split_pdf_for_storage.py "${filePath}".`,
        );
        continue;
      }
      uploads = await Promise.all(
        parts.map(async (part) => {
          const partPath = path.join(partsRoot, part.entry.name);
          return { filePath: partPath, fileName: part.entry.name, info: await stat(partPath) };
        }),
      );
      if (uploads.some((item) => item.info.size > MAX_UPLOAD_BYTES)) {
        throw new Error(`Part ${source.file_name} masih melebihi 50 MiB.`);
      }
    }

    for (const item of uploads) {
      const objectPath = `${source.id}/${item.fileName}`;
      if (await remoteObjectMatches(source.id, item.fileName, item.info.size)) {
        skipped += 1;
        console.log(`Sudah ada: ${objectPath}`);
        continue;
      }
      console.log(
        `Upload ${item.fileName} (${(item.info.size / 1024 / 1024).toFixed(1)} MiB)...`,
      );
      await uploadFile(item.filePath, objectPath);
      uploaded += 1;
      console.log(`Selesai: ${objectPath}`);
    }
    availableSources += 1;
  }

  console.log(
    `Upload selesai. ${uploaded} objek baru, ${skipped} sudah ada, ` +
      `${availableSources}/${sources.length} sumber tersedia.`,
  );
}

await main();
