import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createServer } from "vite";
import { aesenConnection } from "../../src/server/aesenConnection.ts";

assert(process.env.SKD_DATABASE_URL && process.env.ADMIN_PASSWORD, "Missing smoke-test config");
process.env.SKD_ADMIN_BACKEND = "sumopod";
process.env.SKD_READ_BACKEND = "sumopod";
const db = new pg.Client({
  ...aesenConnection(process.env.SKD_DATABASE_URL),
  query_timeout: 20_000,
});
const vite = await createServer({
  server: { host: "127.0.0.1", port: 8099, strictPort: true, hmr: false, watch: null },
});
const slug = `admin-smoke-${randomUUID()}`;
let batchId;
let sourceId;

async function request(path, body, expected = 200) {
  const response = await fetch(`http://127.0.0.1:8099/api/admin/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "x-admin-password": process.env.ADMIN_PASSWORD, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25_000),
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${path} ${body?.action ?? ""}: ${data.message ?? ""}`);
  return data;
}

const batchPost = (action, fields = {}, status = 200) =>
  request("skd-batches", { action, batchId, sourceId, ...fields }, status);

try {
  await db.connect();
  const {
    rows: [marker],
  } = await db.query("select to_regclass('skd_transfer.checkpoints') is not null as migrated");
  assert(marker.migrated, "Unexpected database");
  await vite.listen();
  const noAuth = await fetch("http://127.0.0.1:8099/api/admin/skd-batches");
  assert.equal(noAuth.status, 401);
  ({ batchId, sourceId } = await batchPost(
    "create",
    {
      batch: {
        slug,
        institutionName: "Synthetic admin test",
        selectionYear: 2024,
        parserFamily: "test",
        parserVersion: "3.0",
      },
      source: { fileName: "synthetic-test.pdf", totalPages: 1, documentType: "skd" },
    },
    201,
  ));
  assert(batchId && sourceId);
  const formation = {
    formation_instance_id: "synthetic-formation",
    tahun: "2024",
    nama_instansi: "Synthetic admin test",
    jabatan: "Synthetic job",
    jenis_formasi: "UMUM",
    pendidikan_formasi: "S-1 HUKUM",
    jumlah_formasi: "1",
    source_page_formasi: "1",
    formation_quality_status: "needs_review",
  };
  await batchPost("import_formations", { sourceId: randomUUID(), rows: [formation] }, 409);
  await batchPost(
    "import_formations",
    {
      rows: [
        formation,
        { ...formation, formation_instance_id: "invalid", source_page_formasi: "0" },
      ],
    },
    400,
  );
  assert.equal((await request(`skd-explorer?batchId=${batchId}`)).formations.length, 0);
  assert.deepEqual(await batchPost("import_formations", { rows: [formation] }), {
    formationsUpserted: 1,
    issuesCreated: 1,
  });
  assert.deepEqual(await batchPost("import_formations", { rows: [formation] }), {
    formationsUpserted: 1,
    issuesCreated: 0,
  });
  const scores = ["380", "370", "360"].map((total, i) => ({
    ...formation,
    nama: `Synthetic person ${i + 1}`,
    no_peserta: `00000000000000${i + 1}`,
    pendidikan: "S-1 HUKUM",
    twk: String(Number(total) - 280),
    tiu: "100",
    tkp: "180",
    total,
    keterangan: i === 0 ? "P/L" : "P",
    source_page: "1",
    quality_status: "needs_review",
  }));
  assert.deepEqual(await batchPost("import_scores", { rows: scores }), {
    scoresUpserted: 3,
    issuesCreated: 3,
  });
  assert.deepEqual(await batchPost("finalize"), {
    formationCount: 1,
    participantCount: 3,
    reviewIssueCount: 4,
  });
  await batchPost("import_scores", { rows: scores }, 409);
  assert.equal((await request(`skd-review?batchId=${batchId}`)).issues.length, 4);
  const explorer = await request(
    `skd-explorer?batchId=${batchId}&mode=rows&passing=pass&sort=total_asc`,
  );
  assert.deepEqual(
    explorer.rows.map(({ total }) => total),
    [360, 370, 380],
  );
  assert.equal(explorer.pagination.total, 3);
  const statuses = [];
  for (let i = 0; i < 7 && !statuses.includes("verified"); i++) {
    const result = await request("skd-review", {
      action: "bulk_verify_step",
      batchId,
      confirmation: "VERIFY_ALL",
    });
    statuses.push(result.batchStatus);
  }
  assert.equal(statuses.at(-1), "verified");
  assert.equal((await request(`skd-review?batchId=${batchId}`)).issues.length, 0);
  assert.equal((await request(`skd-explorer?batchId=${batchId}`)).summary.present_count, 3);
  assert((await request("pdf-sources")).total > 0);
  assert((await request("education-aliases")).aliases.length > 0);
  const published = await request("published-data?mode=formations&pageSize=1");
  assert(!published.institutions.some(({ id }) => id === batchId));
  assert(published.formations.length > 0);

  // Publish and query on the same connection; the public site never sees the test batch.
  await db.query("begin");
  try {
    const {
      rows: [result],
    } = await db.query("select * from public.publish_skd_batch($1)", [batchId]);
    assert.equal(result.batch_status, "published");
    assert.equal(result.participant_count, 3);
    const {
      rows: [stat],
    } = await db.query(
      "select participant_count, cutoff_total from public.skd_formation_stats where batch_id = $1",
      [batchId],
    );
    assert.deepEqual(stat, { participant_count: 3, cutoff_total: 380 });
    const { rows } = await db.query(
      "select total from public.search_public_skd_scores($1,null,$2,null,10)",
      ["Synthetic person", "Synthetic admin test"],
    );
    assert.equal(rows.length, 3);
  } finally {
    await db.query("rollback");
  }
  assert(!(await request("published-data")).institutions.some(({ id }) => id === batchId));
  console.log(
    "OK admin auth, atomic import, retry, explorer, review, verify, publication and public search.",
  );
} finally {
  try {
    if (batchId) {
      await db.query("begin");
      try {
        const fixture = await db.query(
          "select id from public.skd_batches where id = $1 and slug = $2 and status <> 'published' for update",
          [batchId, slug],
        );
        assert.equal(fixture.rowCount, 1, "Synthetic cleanup scope could not be confirmed");
        for (const table of ["skd_review_issues", "skd_scores", "skd_formations", "skd_sources"]) {
          await db.query(`delete from public.${table} where batch_id = $1`, [batchId]);
        }
        await db.query("delete from public.skd_batches where id = $1 and slug = $2", [
          batchId,
          slug,
        ]);
        await db.query("commit");
        console.log("OK synthetic batch removed; no public data or WhatsApp messages changed.");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }
  } finally {
    await db.end();
    await vite.close();
  }
}
