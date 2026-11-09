import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";

const { PGlite } = await import(
  process.env.SKD_PGLITE_MODULE
    ? pathToFileURL(process.env.SKD_PGLITE_MODULE).href
    : "@electric-sql/pglite"
);
const migration = (file) => readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8");
const small = "00000000-0000-4000-8000-000000000001";
const large = "00000000-0000-4000-8000-000000000002";

test("optimized publication preserves stats and publishes a large verified batch atomically", async (t) => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema private;
      create table public.skd_batches(id uuid primary key, status text, published_at timestamptz,
        verified_at timestamptz, participant_count int, formation_count int, review_issue_count int);
      create table public.skd_formations(id uuid primary key, batch_id uuid references public.skd_batches,
        quality_status text, jumlah_formasi int);
      create table public.skd_scores(id uuid primary key, batch_id uuid references public.skd_batches,
        formation_id uuid references public.skd_formations, quality_status text, keterangan text,
        total int, tkp int, tiu int, twk int);
      create table public.skd_review_issues(batch_id uuid, status text);
      create index on public.skd_formations(batch_id);
      create index on public.skd_scores(batch_id);
      create index on public.skd_scores(formation_id);
      grant select, update on all tables in schema public to service_role;
      insert into public.skd_batches (id,status) values ('${small}','published'), ('${large}','verified');
      insert into public.skd_formations
        select md5('small-f-'||n)::uuid, '${small}', 'verified', n-1 from generate_series(1, 3) n;
      insert into public.skd_scores
        select md5('small-s-'||n)::uuid, '${small}', md5('small-f-2')::uuid,
          case when n=9 then 'needs_review' else 'verified' end,
          (array['P/L','P/L-1','P/L','P','TL','TH','TMS','DIS','P/L'])[n],
          (array[402,402,402,407,201,null,null,null,5])[n],
          (array[190,190,191,191,100,null,null,null,2])[n], 120, 92
        from generate_series(1, 9) n;
    `);
    const original = await migration("20260810073455_add_skd_rationalization_foundation.sql");
    await db.exec(original.split("create or replace function public.get_skd_rationalization")[0]);
    await db.exec(await migration("20260809080529_publish_skd_batch.sql"));
    const refresh = () => db.query("select private.refresh_skd_formation_stats($1)", [small]);
    const smallStats = async () => (await db.query(
      "select to_jsonb(s) - 'calculated_at' as stat from public.skd_formation_stats s where batch_id=$1 order by formation_id",
      [small],
    )).rows;
    await refresh();
    const previous = await smallStats();
    assert.equal(previous.length, 3);
    const occupied = previous.find(({ stat }) => stat.participant_count > 0).stat;
    assert.equal(occupied.cutoff_tie_count, 2);
    assert.equal(occupied.no_show_count, 3);

    await db.exec(await migration("20261109092000_optimize_skd_publication_stats.sql"));
    await refresh();
    assert.deepEqual(await smallStats(), previous);
    await db.query("select private.refresh_skd_formation_stats()");
    assert.deepEqual(await smallStats(), previous);
    const publish = () => db.query("select * from public.publish_skd_batch($1)", [large]);
    await db.exec("set role anon");
    await assert.rejects(publish(), { code: "42501" });
    await db.exec("reset role");

    await db.exec(`
      insert into public.skd_formations
        select md5('large-f-'||n)::uuid, '${large}', 'verified', 2 from generate_series(1,7934) n;
      insert into public.skd_scores
        select md5('large-s-'||n)::uuid, '${large}', md5('large-f-'||(1+n%7400))::uuid,
          'verified', case when n%10<3 then 'P/L' else 'TL' end, 350+n%101, 180, 120, 90
        from generate_series(1,68661) n;
      insert into public.skd_review_issues values ('${large}', 'open');
    `);
    await db.exec("set role service_role");
    await assert.rejects(publish(), /issue terbuka/);
    const readLarge = async () => (await db.query(
      "select count(*)::int as formations, coalesce(sum(participant_count),0)::int as participants from public.skd_formation_stats where batch_id=$1",
      [large],
    )).rows[0];
    assert.deepEqual(await readLarge(), { formations: 0, participants: 0 });
    await db.exec("reset role; delete from public.skd_review_issues; set role service_role");
    const start = performance.now();
    const result = (await publish()).rows[0];
    t.diagnostic(`Local synthetic publication: ${Math.round(performance.now() - start)} ms`);
    assert.equal(result.batch_status, "published");
    assert.equal(result.participant_count, 68661);
    assert.equal(result.formation_count, 7934);
    assert.deepEqual(await readLarge(), { formations: 7934, participants: 68661 });
    assert.deepEqual(await smallStats(), previous);
    assert.deepEqual((await publish()).rows[0], result);
  } finally {
    await db.close();
  }
});
