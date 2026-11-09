import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";

const { PGlite } = await import(
  process.env.SKD_PGLITE_MODULE
    ? pathToFileURL(process.env.SKD_PGLITE_MODULE).href
    : "@electric-sql/pglite"
);
const detach = await readFile(
  new URL("./cutover/detach_supabase_skd_foreign_keys.sql", import.meta.url),
  "utf8",
);

test("detaching old SKD links preserves score/target IDs and session/lead/queue links", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.skd_scores(id int primary key);
      create table public.skd_formations(id int primary key);
      create table public.leads(id int primary key,
        score_id int references public.skd_scores on delete set null,
        target_formation_id int references public.skd_formations on delete set null);
      create table public.result_sessions(id int primary key,
        lead_id int references public.leads on delete set null,
        score_id int references public.skd_scores on delete set null);
      create table public.skd_analysis_jobs(id int primary key,
        session_id int references public.result_sessions on delete cascade,
        score_id int not null references public.skd_scores on delete cascade);
      insert into public.skd_scores values (1);
      insert into public.skd_formations values (2);
      insert into public.leads values (1, 1, 2);
      insert into public.result_sessions values (2, 1, 1);
      insert into public.skd_analysis_jobs values (3, 2, 1);
    `);
    await db.exec(detach);
    await db.exec(detach);
    assert.equal(
      (await db.query("select public.skd_cross_database_ready() as ready")).rows[0].ready,
      true,
    );
    await db.exec("set role anon");
    await assert.rejects(db.query("select public.skd_cross_database_ready()"), { code: "42501" });
    await db.exec("reset role");
    await db.exec("truncate public.skd_scores, public.skd_formations");
    assert.deepEqual((await db.query("select * from public.leads")).rows, [
      { id: 1, score_id: 1, target_formation_id: 2 },
    ]);
    assert.deepEqual((await db.query("select * from public.result_sessions")).rows, [
      { id: 2, lead_id: 1, score_id: 1 },
    ]);
    assert.deepEqual((await db.query("select * from public.skd_analysis_jobs")).rows, [
      { id: 3, session_id: 2, score_id: 1 },
    ]);
    await db.exec("insert into public.leads values (4, 500, 501)");
    await assert.rejects(db.exec("insert into public.skd_analysis_jobs values (4, 999, 500)"), {
      code: "23503",
    });
  } finally {
    await db.close();
  }
});
