import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { aesenConnection } from "../../src/server/aesenConnection.ts";
import { tables, transferIndexes, transferSchema } from "./sumopod_transfer_schema.mjs";

const { values } = parseArgs({
  options: { port: { type: "string", default: "8793" } },
});
const port = Number(values.port);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("Port monitor tidak valid.");
const output = path.resolve("output/skd-transfer");
const pageSize = 1000;
const ceiling = 1_500_000_000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const status = {
  state: "running",
  stage: "Menyiapkan koneksi",
  startedAt: new Date().toISOString(),
  updatedAt: null,
  bytes: null,
  batchCounts: null,
  tables: tables.map(([name, , label]) => ({ name, label, total: null, copied: 0 })),
};

async function update(stage, fields = {}) {
  Object.assign(status, fields, { stage, updatedAt: new Date().toISOString() });
  await writeFile(path.join(output, "status.json"), JSON.stringify(status, null, 2) + "\n");
}

async function transaction(client, fn) {
  await client.query("begin");
  try {
    await client.query("set local lock_timeout = '8s'");
    const result = await fn();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

async function sourceCall(label, operation) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const result = await operation(AbortSignal.timeout(30_000));
      if (!result.error) return result;
      if (attempt === 3 || ![0, 429, 500, 502, 503, 504].includes(result.status))
        throw new Error(`${label}: Supabase HTTP ${result.status}, kode ${result.error.code || "-"}.`);
    } catch (error) {
      if (attempt === 3 || (error instanceof Error && error.message.startsWith(label + ":"))) throw error;
    }
    await pause(1000 * 2 ** attempt);
  }
}

async function sourceManifest(sb) {
  const versions = await sourceCall("Status batch sumber", (signal) => sb.from("skd_batches")
    .select("id,status,updated_at,participant_count,formation_count,review_issue_count").order("id").abortSignal(signal));
  const totals = {};
  for (const [name] of tables) {
    const { count } = await sourceCall(name, (signal) => sb.from(name)
      .select("*", { count: "exact", head: true }).abortSignal(signal));
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Jumlah sumber ${name} belum terbaca.`);
    totals[name] = count;
  }
  if (!totals.skd_batches || !totals.skd_scores) throw new Error("Sumber SKD kosong.");
  return { totals, hash: toHash([versions.data, totals]) };
}

async function initialize(target, manifest) {
  return transaction(target, async () => {
    await target.query("select pg_advisory_xact_lock(hashtext('cekskd:skd-transfer'))");
    const check = (await target.query(`
      select to_regclass('skd_transfer.manifest') is not null as initialized,
        (select count(*)::int from pg_tables where schemaname='public') as public_tables`
    )).rows[0];
    if (!check.initialized) {
      if (check.public_tables) throw new Error("Database tujuan tidak kosong dan bukan salinan yang dibuat migrator ini.");
      await target.query(await transferSchema());
      await target.query(`
        create schema skd_transfer;
        revoke all on schema skd_transfer from public;
        create table skd_transfer.manifest (singleton boolean primary key check (singleton), fingerprint text not null);
        create table skd_transfer.checkpoints (
          table_name text primary key, expected integer not null, copied integer not null default 0, cursor_key text
        )`);
      await target.query("insert into skd_transfer.manifest values (true,$1)", [manifest.hash]);
      for (const [name] of tables) {
        await target.query("insert into skd_transfer.checkpoints(table_name, expected) values ($1,$2)",
          [name, manifest.totals[name]]);
      }
    } else {
      const previous = (await target.query("select fingerprint from skd_transfer.manifest")).rows[0];
      if (previous?.fingerprint !== manifest.hash)
        throw new Error("Data sumber berubah sejak salinan dimulai. Salinan lama tidak dialihkan ke produksi.");
    }
    return (await target.query("select * from skd_transfer.checkpoints")).rows;
  });
}

async function measure(target) {
  const { rows: [{ bytes }] } = await target.query(
    "select pg_database_size(current_database())::int as bytes",
  );
  status.bytes = bytes;
  if (bytes >= ceiling) throw new Error("Pemakaian tujuan mendekati 1,5 GB. Salinan dijeda untuk cek kapasitas.");
}

async function run() {
  const source = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  const destination = process.env.SKD_DATABASE_URL;
  if (!source || !secret || !destination) throw new Error("Koneksi Supabase atau SKD_DATABASE_URL belum tersedia.");
  const sb = createClient(source, secret, { auth: { persistSession: false } });
  const connection = aesenConnection(destination);
  if (process.env.AESEN_DATABASE_URL &&
      connection.database === aesenConnection(process.env.AESEN_DATABASE_URL).database)
    throw new Error("Tujuan tidak boleh menggunakan database Aesen.");
  const target = new pg.Client({ ...connection, query_timeout: 180_000 });
  await target.connect();
  try {
    await update("Menghitung data sumber");
    const manifest = await sourceManifest(sb);
    const checkpoints = new Map((await initialize(target, manifest)).map((row) => [row.table_name, row]));
    for (const progress of status.tables) {
      const entry = checkpoints.get(progress.name);
      progress.total = entry.expected;
      progress.copied = entry.copied;
    }
    await measure(target);
    for (const [name, keys, label] of tables) {
      const entry = checkpoints.get(name);
      const progress = status.tables.find((row) => row.name === name);
      await update(`Menyalin ${label.toLowerCase()}`);
      const columnRows = (await target.query(
        "select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position",
        [name],
      )).rows;
      const columns = columnRows.map(({ column_name }) => column_name);
      const known = new Set(columns);
      let pages = 0;
      while (entry.copied < entry.expected) {
        const { data } = await sourceCall(name, (signal) => {
          let query = sb.from(name).select("*");
          for (const key of keys) query = query.order(key, { ascending: true });
          if (keys.length === 1 && entry.cursor_key !== null) query = query.gt(keys[0], entry.cursor_key);
          if (keys.length > 1) query = query.range(entry.copied, entry.copied + pageSize - 1);
          return query.limit(pageSize).abortSignal(signal);
        });
        if (!data?.length || entry.copied + data.length > entry.expected)
          throw new Error(`Jumlah halaman sumber ${name} berubah. Salinan tidak dialihkan ke produksi.`);
        if (data.some((row) => Object.keys(row).length !== columns.length || Object.keys(row).some((key) => !known.has(key))))
          throw new Error(`Kolom sumber ${name} berbeda dari schema tujuan.`);
        const next = entry.copied + data.length;
        const cursor = keys.length === 1 ? data.at(-1)[keys[0]] : null;
        await transaction(target, async () => {
          const claimed = await target.query(
            "update skd_transfer.checkpoints set copied=$1,cursor_key=$2 where table_name=$3 and copied=$4",
            [next, cursor, name, entry.copied],
          );
          if (claimed.rowCount !== 1) throw new Error("Progres berubah; migrator lain mungkin aktif.");
          const inserted = await target.query(
            `insert into public.${name} select * from jsonb_populate_recordset(null::public.${name}, $1::jsonb)`,
            [JSON.stringify(data)],
          );
          if (inserted.rowCount !== data.length) throw new Error(`Jumlah baris tujuan ${name} tidak cocok.`);
        });
        entry.copied = next;
        entry.cursor_key = cursor;
        progress.copied = next;
        if (++pages % 20 === 0) await measure(target);
        await update(`Menyalin ${label.toLowerCase()}`);
      }
      if (name === "skd_batches") {
        status.batchCounts = (await target.query(`
          select status, count(*)::int as batches, sum(participant_count)::int as participants,
            sum(formation_count)::int as formations
          from public.skd_batches group by status order by status
        `)).rows;
      }
    }
    await update("Membangun indeks tujuan");
    await target.query("create extension if not exists pg_trgm with schema public");
    for (const statement of await transferIndexes()) {
      const name = /index if not exists (\w+)/.exec(statement)?.[1];
      await update(`Membangun indeks: ${name ?? "SKD"}`);
      await transaction(target, async () => {
        await target.query("set local statement_timeout = '120s'");
        await target.query(statement);
      });
      await measure(target);
    }
    await update("Mencocokkan jumlah sumber dan tujuan");
    for (const [name] of tables) {
      const { rows: [{ count }] } = await target.query(`select count(*)::int as count from public.${name}`);
      if (count !== manifest.totals[name]) throw new Error(`Jumlah akhir ${name} tidak cocok.`);
      await target.query(`analyze public.${name}`);
    }
    if ((await sourceManifest(sb)).hash !== manifest.hash)
      throw new Error("Batch atau jumlah baris di sumber berubah selama penyalinan. Perlu sinkronisasi sebelum uji.");
    await measure(target);
    await update("Salinan lengkap. Menunggu uji aplikasi.", { state: "complete" });
  } finally {
    await target.end().catch(() => {});
  }
}

await mkdir(output, { recursive: true });
const html = await readFile(new URL("./skd_transfer_progress.html", import.meta.url), "utf8");
const server = createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "GET" && request.url === "/status.json") {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(status));
  } else if (request.method === "GET" && request.url === "/") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(html);
  } else {
    response.writeHead(404).end();
  }
});
await new Promise((resolve, reject) => server.once("error", reject).listen(port, "127.0.0.1", resolve));
console.log(`Monitor siap: http://127.0.0.1:${port}/`);
try {
  await run();
  console.log("Salinan SKD selesai; Supabase tetap aktif.");
} catch (error) {
  const message = error.code
    ? `Migrasi terhenti saat tahap "${status.stage}" (kode ${error.code}). Data sumber tidak diubah.`
    : (error instanceof Error && error.message.match(/^(Koneksi|Data sumber|Jumlah|Sumber SKD|Status batch sumber|Database tujuan|Progres|Pemakaian|Batch atau|Kolom sumber|skd_|sscasn_)/)
      ? error.message : "Migrasi terhenti. Data sumber tidak diubah.");
  await update(message, { state: "stopped" });
  console.error(message);
}
