import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";

const { PGlite } = await import(
  process.env.SKD_PGLITE_MODULE
    ? pathToFileURL(process.env.SKD_PGLITE_MODULE).href
    : "@electric-sql/pglite"
);

test("large review resumes in bounded steps and stays unpublished", async () => {
  const db = await PGlite.create();
  const batch = "00000000-0000-4000-8000-000000000001";
  const rejected = "00000000-0000-4000-8000-000000000002";
  const published = "00000000-0000-4000-8000-000000000003";
  const step = async (id = batch) =>
    (await db.query("select * from public.bulk_verify_skd_batch_step($1, $2)", [id, "Reviewed"])).rows[0];
  const status = async (id = batch) =>
    (await db.query("select status from public.skd_batches where id=$1", [id])).rows[0].status;
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create table public.skd_batches(id uuid primary key, status text, review_issue_count int, verified_at timestamptz);
      create table public.skd_scores(id integer primary key, batch_id uuid, quality_status text);
      create table public.skd_formations(id integer primary key, batch_id uuid, quality_status text);
      create table public.skd_review_issues(id integer primary key, batch_id uuid, status text, resolution_note text, resolved_at timestamptz);
      grant select, update on all tables in schema public to service_role;
      insert into public.skd_batches values ('${batch}', 'review', 1, null),
        ('${rejected}', 'review', 1, null), ('${published}', 'published', 0, now());
      insert into public.skd_scores select n, '${batch}', 'parsed' from generate_series(1, 1501) n;
      insert into public.skd_scores values (1502, '${rejected}', 'parsed'), (1503, '${rejected}', 'rejected');
      insert into public.skd_formations values (1, '${batch}', 'needs_review');
      insert into public.skd_review_issues values (1, '${batch}', 'open', null, null);
    `);
    await db.exec(await readFile(
      new URL("../../supabase/migrations/20261109091000_add_skd_bulk_verify_step.sql", import.meta.url),
      "utf8",
    ));
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(step(), { code: "42501" });
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    await assert.rejects(step(rejected), /masih memiliki data rejected/);
    assert.equal((await db.query("select quality_status from public.skd_scores where id=1502")).rows[0].quality_status, "parsed");
    await assert.rejects(step(published), /harus berstatus review/);
    assert.equal((await step()).scores_verified, 1500);
    assert.equal(await status(), "review");
    assert.equal((await step()).scores_verified, 1);
    assert.equal((await step()).formations_verified, 1);
    assert.equal((await step()).issues_resolved, 1);
    assert.equal(await status(), "review");
    assert.equal((await step()).batch_status, "verified");
    assert.equal(await status(), "verified");
    assert.deepEqual(await step(), {
      issues_resolved: 0, scores_verified: 0, formations_verified: 0, batch_status: "verified",
    });
  } finally {
    await db.close();
  }
});
