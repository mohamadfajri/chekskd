import { requireSupabase } from "@/lib/supabase/client";

/**
 * CSV row shape expected by admin importer.
 * Columns: tahun, nama_instansi, kode_instansi, jabatan, kode_jabatan,
 * lokasi_formasi, jenis_formasi, pendidikan, jumlah_formasi,
 * no_peserta, nama, tahun_skd, twk, tiu, tkp, total, keterangan,
 * source_pdf, source_page
 */
export interface CsvRow {
  tahun?: string;
  nama_instansi?: string;
  kode_instansi?: string;
  jabatan?: string;
  kode_jabatan?: string;
  lokasi_formasi?: string;
  jenis_formasi?: string;
  pendidikan?: string;
  jumlah_formasi?: string;
  no_peserta?: string;
  nama?: string;
  tahun_skd?: string;
  twk?: string;
  tiu?: string;
  tkp?: string;
  total?: string;
  keterangan?: string;
  source_pdf?: string;
  source_page?: string;
}

function toInt(v: string | undefined | null): number | null {
  if (v == null || v === "") return null;
  const n = parseInt(String(v).replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

export interface RowValidationIssue {
  index: number; // 0-based index in original CSV
  row: CsvRow;
  errors: string[];
}

export interface ValidationResult {
  valid: CsvRow[];
  invalid: RowValidationIssue[];
}

function isIntInRange(v: string | undefined | null, min: number, max: number): boolean {
  if (v == null || String(v).trim() === "") return false;
  const n = Number(String(v).trim());
  return Number.isInteger(n) && n >= min && n <= max;
}

/**
 * Validasi baris CSV:
 * - Wajib: nama, tahun, (nama_instansi atau kode_instansi), (jabatan atau kode_jabatan)
 * - Numerik: twk, tiu, tkp, total harus integer dalam rentang wajar
 * - Konsistensi: total = twk + tiu + tkp (jika ketiganya ada)
 */
export function validateCsvRows(rows: CsvRow[]): ValidationResult {
  const valid: CsvRow[] = [];
  const invalid: RowValidationIssue[] = [];

  rows.forEach((row, index) => {
    const errors: string[] = [];

    if (!row.nama || String(row.nama).trim() === "") errors.push("kolom 'nama' kosong");
    if (!isIntInRange(row.tahun, 2000, 2100))
      errors.push("kolom 'tahun' kosong / bukan tahun valid");
    if (!(row.nama_instansi?.trim() || row.kode_instansi?.trim()))
      errors.push("'nama_instansi' atau 'kode_instansi' wajib diisi");
    if (!(row.jabatan?.trim() || row.kode_jabatan?.trim()))
      errors.push("'jabatan' atau 'kode_jabatan' wajib diisi");

    const numCols: Array<[keyof CsvRow, number, number]> = [
      ["twk", 0, 200],
      ["tiu", 0, 200],
      ["tkp", 0, 250],
      ["total", 0, 700],
    ];
    for (const [col, min, max] of numCols) {
      const v = row[col] as string | undefined;
      if (v == null || String(v).trim() === "") {
        errors.push(`kolom '${String(col)}' kosong`);
      } else if (!isIntInRange(v, min, max)) {
        errors.push(`kolom '${String(col)}' bukan angka valid (${min}-${max})`);
      }
    }

    const twk = Number(row.twk),
      tiu = Number(row.tiu),
      tkp = Number(row.tkp),
      total = Number(row.total);
    if ([twk, tiu, tkp, total].every((n) => Number.isFinite(n))) {
      if (twk + tiu + tkp !== total) {
        errors.push(`total (${total}) tidak sama dengan twk+tiu+tkp (${twk + tiu + tkp})`);
      }
    }

    if (errors.length === 0) valid.push(row);
    else invalid.push({ index, row, errors });
  });

  return { valid, invalid };
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ImportProgress {
  processed: number;
  formationsCreated: number;
  scoresInserted: number;
  errors: string[];
}

/**
 * Import CSV rows: group by formation key (kode_jabatan|kode_instansi|tahun),
 * upsert formation, then bulk-insert scores.
 */
export async function importCsvRows(
  rows: CsvRow[],
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportProgress> {
  const sb = requireSupabase();
  const progress: ImportProgress = {
    processed: 0,
    formationsCreated: 0,
    scoresInserted: 0,
    errors: [],
  };

  // Group formations
  const formationMap = new Map<string, CsvRow>();
  for (const row of rows) {
    const key = [
      row.tahun ?? "",
      row.kode_instansi ?? row.nama_instansi ?? "",
      row.kode_jabatan ?? row.jabatan ?? "",
      row.lokasi_formasi ?? "",
    ].join("|");
    if (!formationMap.has(key)) formationMap.set(key, row);
  }

  // Insert formations (chunked)
  const formationIdByKey = new Map<string, string>();
  const formationEntries = Array.from(formationMap.entries());
  const CHUNK = 200;
  for (let i = 0; i < formationEntries.length; i += CHUNK) {
    const slice = formationEntries.slice(i, i + CHUNK);
    const payload = slice.map(([, row]) => ({
      tahun: toInt(row.tahun),
      kode_instansi: row.kode_instansi ?? null,
      nama_instansi: row.nama_instansi ?? null,
      kode_jabatan: row.kode_jabatan ?? null,
      jabatan: row.jabatan ?? null,
      lokasi_formasi: row.lokasi_formasi ?? null,
      jenis_formasi: row.jenis_formasi ?? null,
      pendidikan: row.pendidikan ?? null,
      jumlah_formasi: toInt(row.jumlah_formasi),
    }));
    const { data, error } = await sb.from("skd_formations").insert(payload).select("id");
    if (error) {
      progress.errors.push(`Formations chunk ${i}: ${error.message}`);
      continue;
    }
    const ids = (data ?? []) as { id: string }[];
    slice.forEach(([k], idx) => {
      if (ids[idx]) formationIdByKey.set(k, ids[idx].id);
    });
    progress.formationsCreated += ids.length;
    onProgress?.({ ...progress });
  }

  // Insert scores
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const payload = slice
      .filter((r) => r.nama)
      .map((r) => {
        const key = [
          r.tahun ?? "",
          r.kode_instansi ?? r.nama_instansi ?? "",
          r.kode_jabatan ?? r.jabatan ?? "",
          r.lokasi_formasi ?? "",
        ].join("|");
        return {
          formation_id: formationIdByKey.get(key) ?? null,
          no_peserta: r.no_peserta ?? null,
          nama: r.nama!,
          pendidikan: r.pendidikan ?? null,
          tahun_skd: toInt(r.tahun_skd) ?? toInt(r.tahun),
          twk: toInt(r.twk),
          tiu: toInt(r.tiu),
          tkp: toInt(r.tkp),
          total: toInt(r.total),
          keterangan: r.keterangan ?? null,
          nama_normalized: normalize(r.nama!),
          source_page: toInt(r.source_page),
        };
      });
    if (payload.length === 0) continue;
    const { error } = await sb.from("skd_scores").insert(payload);
    if (error) {
      progress.errors.push(`Scores chunk ${i}: ${error.message}`);
    } else {
      progress.scoresInserted += payload.length;
    }
    progress.processed = Math.min(i + CHUNK, rows.length);
    onProgress?.({ ...progress });
  }

  return progress;
}
