import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import { normalizeCatalogSearch } from "../../src/lib/formationCatalog.ts";
import { aesenConnection } from "../../src/server/aesenConnection.ts";

const SOURCE_COLUMNS = `formasi_id source_id, trim(ins_nm) institution, jabatan_nm job,
  lokasi_nm location, pendidikan_nm education, jumlah_formasi quota, jumlah_ms passed_admin,
  gaji_min salary_min, gaji_max salary_max`;
const INSERT = `insert into aesen.formations
  select * from jsonb_to_recordset($1::jsonb) as incoming (
    source_id text, institution text, job text, location text, education text,
    quota integer, passed_admin integer, salary_min double precision, salary_max double precision,
    search_text text, education_keys text[]
  )`;

async function main() {
  const source = process.argv[2];
  if (!source) throw new Error("Sertakan folder sumber yang berisi aesen.sqlite dan audit.json.");
  const audit = JSON.parse(await readFile(path.join(source, "audit.json"), "utf8"));
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path.join(source, "formasi.jsonl")))
    hash.update(chunk);
  if (audit.integrity_check !== "ok" || hash.digest("hex") !== audit.jsonl_sha256) {
    throw new Error("Audit atau checksum sumber tidak valid.");
  }

  const db = new DatabaseSync(path.join(source, "aesen.sqlite"), { readOnly: true });
  let client;
  let transactionOpen = false;
  try {
    const counts = db
      .prepare(
        `select count(*) rows, count(distinct formasi_id) ids,
      count(distinct trim(ins_nm)) institutions, sum(jumlah_formasi) quota,
      sum(jumlah_ms) passed_admin from formasi`,
      )
      .get();
    if (
      db.prepare("pragma integrity_check").get().integrity_check !== "ok" ||
      counts.rows !== audit.rows ||
      counts.ids !== audit.unique_ids ||
      counts.rows !== counts.ids ||
      counts.quota !== audit.total_jumlah_formasi ||
      counts.passed_admin !== audit.total_jumlah_ms
    )
      throw new Error("Isi SQLite tidak sesuai dengan audit sumber.");
    const institutions = db
      .prepare("select distinct trim(ins_nm) as name from formasi order by 1")
      .all()
      .map(({ name }) => ({ name, level: /^Pemerintah\s/i.test(name) ? "daerah" : "pusat" }));

    const url = process.env.AESEN_IMPORT_DATABASE_URL;
    if (!url) throw new Error("Set AESEN_IMPORT_DATABASE_URL sebelum menjalankan importer.");
    client = new pg.Client(aesenConnection(url));
    await client.connect();
    await client.query("begin");
    transactionOpen = true;
    await client.query("select pg_advisory_xact_lock(hashtext('cekskd:aesen:2024'))");
    await client.query(await readFile(new URL("./aesen_catalog.sql", import.meta.url), "utf8"));
    const snapshot = (await client.query("select checksum from aesen.snapshot")).rows[0];
    if (snapshot && snapshot.checksum !== audit.jsonl_sha256) {
      throw new Error("Snapshot lain sudah tersedia; importer tidak mengganti data yang ada.");
    }
    if (!snapshot) {
      await client.query(
        `insert into aesen.institutions
        select * from jsonb_to_recordset($1::jsonb) as incoming(name text, level text)`,
        [JSON.stringify(institutions)],
      );
      const sourcePage = db.prepare(`select ${SOURCE_COLUMNS} from formasi
        where formasi_id > ? order by formasi_id limit 750`);
      let lastId = "";
      let written = 0;
      for (;;) {
        const page = sourcePage.all(lastId);
        if (!page.length) break;
        const batch = page.map((row) => {
          if (!row.source_id || !row.institution || !row.job)
            throw new Error("Kolom wajib kosong.");
          return {
            ...row,
            search_text: normalizeCatalogSearch(
              `${row.job} ${row.institution} ${row.location} ${row.education}`,
            ),
            education_keys: [
              ...new Set(row.education.split("/").map(normalizeCatalogSearch).filter(Boolean)),
            ],
          };
        });
        written += (await client.query(INSERT, [JSON.stringify(batch)])).rowCount;
        lastId = page.at(-1).source_id;
        if (written % 15000 === 0) console.log(`Disalin ${written}/${counts.rows}`);
      }
    }
    const verify = (
      await client.query(`select count(*)::int rows,
      (select count(*)::int from aesen.institutions) institutions,
      sum(quota)::text quota, sum(passed_admin)::text passed_admin from aesen.formations`)
    ).rows[0];
    if (Object.keys(verify).some((key) => Number(verify[key]) !== counts[key])) {
      throw new Error("Hitungan PostgreSQL tidak sesuai dengan sumber; impor dibatalkan.");
    }
    if (!snapshot) {
      await client.query("insert into aesen.snapshot values (2024, $1, $2, $3, $4)", [
        audit.source,
        audit.completed_at,
        audit.jsonl_sha256,
        counts.rows,
      ]);
      await client.query("analyze aesen.formations; analyze aesen.institutions");
    }
    const size = (
      await client.query(
        "select pg_size_pretty(pg_total_relation_size('aesen.formations')) as size",
      )
    ).rows[0].size;
    await client.query("commit");
    transactionOpen = false;
    console.log(JSON.stringify({ ...verify, size, alreadyImported: Boolean(snapshot) }));
  } finally {
    db.close();
    if (client) {
      // Explicit rollback also works with transaction poolers.
      if (transactionOpen) await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  }
}

main().catch((error) => {
  console.error(error.code ? `Impor Aesen gagal (kode ${error.code}).` : error.message);
  process.exitCode = 1;
});
