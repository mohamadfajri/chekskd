import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { installSkdAdminFunctions } from "./sumopod_runtime_sql.mjs";
import { transferSchema } from "./sumopod_transfer_schema.mjs";

const { PGlite } = await import(
  process.env.SKD_PGLITE_MODULE
    ? pathToFileURL(process.env.SKD_PGLITE_MODULE).href
    : "@electric-sql/pglite"
);
const batch = "00000000-0000-4000-8000-000000000001";

test("SumoPod verifies a staged batch then publishes stats only after review is complete", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(await transferSchema());
    await installSkdAdminFunctions(db);
    await installSkdAdminFunctions(db);
    await db.query(
      `insert into public.skd_batches
      (id,slug,institution_name,selection_year,parser_family,parser_version,status)
      values ($1,'test-batch','Test agency',2024,'test','3','review')`,
      [batch],
    );
    await db.query("insert into public.skd_sources (batch_id,file_name) values ($1,'test.pdf')", [
      batch,
    ]);
    await db.query(
      `insert into public.skd_formations
        (batch_id,source_id,formation_key,tahun,nama_instansi,jabatan,jenis_formasi,jumlah_formasi)
      select batch_id,id,'test-formation',2024,'Test agency','Analyst','UMUM',1
      from public.skd_sources where batch_id=$1`,
      [batch],
    );
    await db.query(
      `insert into public.skd_scores
        (batch_id,source_id,formation_id,no_peserta,nama,nama_normalized,
          twk,tiu,tkp,total,keterangan,source_page)
      select batch_id,source_id,id,'000000000000001','Test','test',100,100,180,380,'P/L',1
      from public.skd_formations where batch_id=$1`,
      [batch],
    );
    const publish = () => db.query("select * from public.publish_skd_batch($1)", [batch]);
    await assert.rejects(publish(), /verified/);
    const statuses = [];
    for (let pass = 0; pass < 5 && !statuses.includes("verified"); pass++) {
      const { rows } = await db.query("select * from public.bulk_verify_skd_batch_step($1, $2)", [
        batch,
        "test",
      ]);
      statuses.push(rows[0].batch_status);
    }
    assert.deepEqual(statuses, ["review", "review", "verified"]);
    assert.equal(
      (await db.query("select count(*)::int n from public.skd_formation_stats")).rows[0].n,
      0,
    );
    const { rows } = await publish();
    assert.equal(rows[0].participant_count, 1);
    assert.equal(rows[0].batch_status, "published");
    assert.deepEqual(
      (await db.query("select participant_count, cutoff_total from public.skd_formation_stats"))
        .rows,
      [{ participant_count: 1, cutoff_total: 380 }],
    );
  } finally {
    await db.close();
  }
});
