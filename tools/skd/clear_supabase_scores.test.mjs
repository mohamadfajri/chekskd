import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";

const { PGlite } = await import(
  process.env.SKD_PGLITE_MODULE
    ? pathToFileURL(process.env.SKD_PGLITE_MODULE).href
    : "@electric-sql/pglite"
);
const template = await readFile(
  new URL("./cutover/clear_supabase_scores.template.sql", import.meta.url),
  "utf8",
);

test("cleanup rolls back on a changed score or an unexpected foreign key", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      create table public.skd_formations(id int primary key);
      create table public.skd_scores(id int primary key, formation_id int references public.skd_formations, total int);
      create table public.skd_review_issues(id int primary key, score_id int references public.skd_scores on delete cascade);
      create table public.sscasn_matches(formation_id int references public.skd_formations);
      create table public.leads(score_id int);
      create table public.result_sessions(score_id int);
      create table public.skd_analysis_jobs(score_id int);
      create or replace function public.skd_cross_database_ready() returns boolean language sql as 'select true';
      insert into public.skd_formations values (1);
      insert into public.skd_scores values (5,1,380), (6,1,390);
      insert into public.skd_review_issues values (2,5);
      insert into public.sscasn_matches values (1);
      insert into public.leads values (5);
      insert into public.result_sessions values (5);
      insert into public.skd_analysis_jobs values (5);
    `);
    const {
      rows: [{ fingerprint }],
    } = await db.query(
      `select encode(sha256(convert_to(string_agg(
        encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex'), '' order by s.id
      ),'UTF8')),'hex') as fingerprint from public.skd_scores s`,
    );
    const statement = template
      .replace("__VERIFIED_SCORE_COUNT__", "2")
      .replace("__VERIFIED_SCORE_SHA256__", fingerprint);
    await db.exec("update public.skd_scores set total=381 where id=5");
    await assert.rejects(db.exec(statement), /fingerprint differs/);
    await db.exec("rollback");
    assert.equal((await db.query("select count(*)::int n from public.skd_scores")).rows[0].n, 2);
    await db.exec("update public.skd_scores set total=380 where id=5");
    await db.exec("create table public.other_links(score_id int references public.skd_scores)");
    await assert.rejects(db.exec(statement), /Unexpected score reference/);
    await db.exec("rollback");
    await db.exec("drop table public.other_links");
    const results = await db.exec(statement);
    assert.equal(Number(results.at(-1).rows[0].scores_remaining), 0);
    assert.deepEqual((await db.query("select * from public.skd_review_issues")).rows, [
      { id: 2, score_id: 5 },
    ]);
    for (const table of ["leads", "result_sessions", "skd_analysis_jobs"]) {
      assert.deepEqual((await db.query(`select * from public.${table}`)).rows, [{ score_id: 5 }]);
    }
    assert.deepEqual((await db.query("select * from public.sscasn_matches")).rows, [
      { formation_id: 1 },
    ]);
    assert.deepEqual((await db.query("select * from public.skd_formations")).rows, [{ id: 1 }]);
  } finally {
    await db.close();
  }
});
