import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { transferSchema } from "../skd/sumopod_transfer_schema.mjs";
import { saveSscasnManualPairs, saveSscasnVerifiedBulkPairs } from "../../src/server/sscasnApproval.ts";
import { SSCASN_MANUAL_NOTE_PREFIX } from "../../src/lib/sscasnReconciliation.ts";
import { skdAdminDatabase } from "../../src/server/skdAdminStore.ts";

const { PGlite } = await import(
  process.env.SKD_PGLITE_MODULE
    ? pathToFileURL(process.env.SKD_PGLITE_MODULE).href
    : "@electric-sql/pglite"
);

test("SumoPod persists 25 manually reviewed pairs atomically and rejects reuse", async (t) => {
  process.env.SKD_READ_BACKEND = "sumopod";
  process.env.SKD_ADMIN_BACKEND = "sumopod";
  process.env.SKD_DATABASE_URL = "postgresql://unused:unused@localhost/test";
  const db = await PGlite.create();
  const institution = "Kementerian Agama";
  try {
    await db.exec(await transferSchema());
    await db.query(
      `insert into public.skd_batches
         (slug,institution_name,selection_year,parser_family,parser_version,status)
       values ('kemenag-test',$1,2024,'test','3','published')`,
      [institution],
    );
    await db.exec(`
      insert into public.skd_sources (batch_id,file_name)
      select id,'test.pdf' from public.skd_batches;
      insert into public.skd_formations
         (batch_id,source_id,formation_key,tahun,nama_instansi,jabatan,jenis_formasi,jumlah_formasi)
      select b.id,s.id,'guru-'||n,2024,b.institution_name,'105 - GURU','UMUM',1
        from public.skd_batches b join public.skd_sources s on s.batch_id=b.id
        cross join generate_series(1,28) n;
    `);
    t.mock.method(skdAdminDatabase(), "connect", async () => ({
      query: async (sql, params) => {
        const result = await db.query(sql, params);
        return { ...result, rowCount: result.rows.length };
      },
      release() {},
    }));
    const formations = (await db.query("select id from public.skd_formations order by id")).rows;
    const pairs = formations.map(({ id }, i) => ({
      pdf: { id, page: i + 1 },
      candidate: {
        id: `aesen-${i}`, institution, job: "GURU", location: "KANWIL",
        education: "S-1 PENDIDIKAN / S-1 PENDIDIKAN GURU", quota: 1, registered: i,
        salary_min: 2000000, salary_max: 5000000,
      },
    }));
    const snapshot = {
      source_url: "https://example.test/sscasn",
      captured_at: new Date("2024-12-01T00:00:00Z"),
      checksum: "sscasn-test-checksum",
    };
    const approve = (rows) => saveSscasnManualPairs({}, snapshot, institution, rows, "Dibandingkan dengan PDF asli.");
    const count = async () => (await db.query("select count(*)::int as n from public.sscasn_matches")).rows[0].n;
    assert.equal(await approve(pairs.slice(0, 25)), 25);
    assert.equal(await count(), 25);
    await assert.rejects(approve([{ ...pairs[25], candidate: pairs[0].candidate }]), /sudah dipakai/);
    assert.equal(await count(), 25);
    await db.exec("alter table public.sscasn_matches add check (source_id <> 'aesen-26')");
    await assert.rejects(approve(pairs.slice(25, 27)), /belum tersimpan/);
    assert.equal(await count(), 25);
    const mirrors = (await db.query("select count(*)::int n from public.sscasn_snapshots")).rows[0].n;
    assert.equal(mirrors, 1);
    const prefix = { ...pairs[25], pdf: { ...pairs[25].pdf, status: "review_job_prefix" } };
    assert.equal(await saveSscasnVerifiedBulkPairs({}, snapshot, institution, [prefix], "test"), 1);
    const saved = (await db.query("select notes from public.sscasn_matches where source_id = 'aesen-25'")).rows[0];
    assert(saved.notes.startsWith(SSCASN_MANUAL_NOTE_PREFIX));
    assert.match(saved.notes, /Audit massal test/);
    const exception = {
      pdf: { ...pairs[27].pdf, status: "zero_recap_required", job: "GURU" },
      candidate: { ...pairs[27].candidate, registered: 0 },
    };
    assert.equal(await saveSscasnVerifiedBulkPairs({}, snapshot, institution, [exception], "test"), 1);
    const waived = (await db.query("select notes from public.sscasn_matches where source_id = 'aesen-27'")).rows[0];
    assert.match(waived.notes, /rekap nol dari PDF belum diverifikasi/);
    assert.match(waived.notes, /konfirmasi API detail tidak diwajibkan/);
  } finally {
    await db.close();
    await skdAdminDatabase().end();
  }
});
