import pg, { type PoolClient, type QueryResultRow } from "pg";
import { aesenConnection } from "./aesenConnection.ts";

export function skdAdminUsesSumopod() {
  return process.env.SKD_ADMIN_BACKEND === "sumopod" && process.env.SKD_READ_BACKEND === "sumopod";
}

let pool: pg.Pool | undefined;
export function skdAdminDatabase() {
  const url = process.env.SKD_DATABASE_URL?.trim();
  if (!url) throw new Error("SKD_DATABASE_URL belum disetel.");
  if (!pool) {
    pool = new pg.Pool({
      ...aesenConnection(url),
      max: 2,
      idleTimeoutMillis: 10_000,
      statement_timeout: 45_000,
      query_timeout: 50_000,
      allowExitOnIdle: true,
    });
    pool.on("error", () => console.error("skd_admin_pool_error"));
  }
  return pool;
}

export class SkdAdminConflict extends Error {}

export function skdAdminError(error: unknown): { message: string; status: number } {
  if (error instanceof SkdAdminConflict) return { message: error.message, status: 409 };
  const code = (error as { code?: string } | null)?.code;
  if (code === "57014" || code === "55P03") {
    return { message: "Database sibuk. Coba lagi tanpa mengimpor ulang batch.", status: 504 };
  }
  if (code === "22P02") return { message: "ID atau format data tidak valid.", status: 400 };
  if (code === "23505") return { message: "Data yang sama sudah tersimpan.", status: 409 };
  if (code === "23514" || code === "23502" || code === "23503") {
    return {
      message: "Isi impor tidak memenuhi syarat database. Periksa sumber dan nilai baris.",
      status: 400,
    };
  }
  if (code === "P0001" && error instanceof Error) return { message: error.message, status: 400 };
  console.error("skd_admin_query_failed", code ?? "unknown");
  return { message: "Data SKD belum dapat diproses.", status: 503 };
}

export async function skdAdminTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await skdAdminDatabase().connect();
  let damaged = false;
  try {
    await client.query("begin");
    await client.query("set local lock_timeout = '5s'");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {
      damaged = true;
    });
    throw error;
  } finally {
    client.release(damaged);
  }
}

const importTables = {
  skd_formations: {
    columns: [
      "batch_id",
      "source_id",
      "formation_key",
      "tahun",
      "kode_instansi",
      "nama_instansi",
      "kode_jabatan",
      "jabatan",
      "kode_lokasi",
      "lokasi_formasi",
      "kode_jenis_formasi",
      "jenis_formasi",
      "pendidikan",
      "pendidikan_options",
      "jumlah_formasi",
      "page_number",
      "quality_status",
      "parser_confidence",
      "raw_payload",
    ],
    unique: ["batch_id", "formation_key"],
    key: "formation_key",
  },
  skd_scores: {
    columns: [
      "batch_id",
      "source_id",
      "formation_id",
      "no_peserta",
      "nama",
      "nama_raw",
      "nama_normalized",
      "pendidikan",
      "pendidikan_raw",
      "tahun_skd",
      "twk",
      "tiu",
      "tkp",
      "total",
      "keterangan",
      "source_page",
      "quality_status",
      "parser_confidence",
      "raw_payload",
    ],
    unique: ["batch_id", "no_peserta"],
    key: "no_peserta",
  },
} as const;

type ImportedRow = { id: string; item_key: string; quality_status: string };
type IssuePayload = {
  batch_id?: string;
  formation_id?: string;
  score_id?: string;
  field_name: string;
  issue_code: string;
  severity: string;
  raw_value: string | null;
  confidence: number | null;
};

export async function writeSumopodSkdImport(
  table: keyof typeof importTables,
  batchId: string,
  sourceId: string,
  payload: readonly object[],
  issuesFor: (items: ImportedRow[]) => IssuePayload[],
) {
  const { columns, unique, key } = importTables[table];
  const fields = columns.join(", ");
  const updates = columns
    .filter((column) => !(unique as readonly string[]).includes(column))
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");
  return skdAdminTransaction(async (db) => {
    const state = await db.query(
      `select b.id from public.skd_batches b
       join public.skd_sources s on s.batch_id = b.id and s.id = $2
       where b.id = $1 and b.status = 'importing' and s.document_type = 'skd' for update of b`,
      [batchId, sourceId],
    );
    if (!state.rowCount)
      throw new SkdAdminConflict("Batch tidak sedang diimpor atau sumber PDF tidak cocok.");
    const { rows } = await db.query<ImportedRow>(
      `insert into public.${table} (${fields})
       select ${fields} from jsonb_populate_recordset(null::public.${table}, $1::jsonb)
       on conflict (${unique.join(", ")}) do update set ${updates}
       returning id, ${key} as item_key, quality_status`,
      [JSON.stringify(payload)],
    );
    const issues = issuesFor(rows);
    const result = await db.query(
      `insert into public.skd_review_issues
       (batch_id, formation_id, score_id, field_name, issue_code, severity, raw_value, confidence)
       select $2, i.formation_id, i.score_id, i.field_name, i.issue_code, i.severity, i.raw_value, i.confidence
       from jsonb_populate_recordset(null::public.skd_review_issues, $1::jsonb) i
       where not exists (
         select 1 from public.skd_review_issues old where old.batch_id = $2
         and old.formation_id is not distinct from i.formation_id
         and old.score_id is not distinct from i.score_id
         and old.issue_code = i.issue_code and old.status = 'open'
       )`,
      [JSON.stringify(issues), batchId],
    );
    return { upserted: rows.length, issuesCreated: result.rowCount ?? 0 };
  });
}

export async function sumopodSkdAdminRows<T extends QueryResultRow>(
  sql: string,
  params?: unknown[],
) {
  return (await skdAdminDatabase().query<T>(sql, params)).rows;
}
