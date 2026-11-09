import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";

const { PGlite } = await import(
  process.env.SSCASN_PGLITE_MODULE
    ? pathToFileURL(process.env.SSCASN_PGLITE_MODULE).href
    : "@electric-sql/pglite"
);

const formationId = "00000000-0000-4000-8000-000000000001";
const otherFormationId = "00000000-0000-4000-8000-000000000002";
const batchId = "00000000-0000-4000-8000-000000000003";
const migration = await readFile(
  "supabase/migrations/20261012090000_add_sscasn_catalog.sql",
  "utf8",
);

const preflight = await readFile("tools/sscasn/preflight.sql", "utf8");

test("SSCASN migration and backend-only context", async (t) => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create table public.skd_batches(id uuid primary key, status text not null);
      create table public.skd_formations(
        id uuid primary key, batch_id uuid references public.skd_batches(id),
        nama_instansi text, jabatan text, tahun integer, quality_status text
      );
      grant select on public.skd_batches, public.skd_formations to service_role;
      insert into public.skd_batches values ('${batchId}', 'published');
      insert into public.skd_formations values
        ('${formationId}', '${batchId}', 'Kejaksaan Agung', 'ANALIS HUKUM AHLI PERTAMA', 2024, 'verified'),
        ('${otherFormationId}', '${batchId}', 'Kejaksaan Agung', 'ANALIS HUKUM AHLI PERTAMA', 2024, 'verified');
    `);
    const beforeMigration = await db.exec(preflight);
    assert.equal(beforeMigration[2].rows[0].snapshot_table, null);
    assert.equal(beforeMigration[2].rows[0].backend_can_read_formations, true);
    await db.exec(migration);
    const afterMigration = await db.exec(preflight);
    assert(afterMigration[2].rows[0].snapshot_table);
    assert(Number(afterMigration[0].rows[0].database_bytes) > 0);
    await db.exec(`
      insert into public.sscasn_snapshots
        (id,selection_year,source_url,captured_at,checksum,row_count,quota_total,passed_admin_total,import_status)
        values ('test-snapshot',2024,'https://example.test/source',now(),'test-checksum',1,2,7,'ready');
      insert into public.sscasn_formations
        (snapshot_id,source_id,institution,job,location,education,education_options,quota,passed_admin,salary_min,salary_max)
        values ('test-snapshot','source-1','KEJAKSAAN  AGUNG','Analis Hukum Ahli Pertama',
          'Kejaksaan Agung','S-1 HUKUM',array['S-1 HUKUM'],2,7,6000000,9000000);
      insert into public.sscasn_matches (formation_id,snapshot_id,source_id)
        values ('${formationId}','test-snapshot','source-1');
    `);
    const asRole = async (role, action) => {
      assert(["anon", "authenticated", "service_role"].includes(role));
      await db.exec(`set role ${role}`);
      try {
        return await action();
      } finally {
        await db.exec("reset role");
      }
    };
    const context = () =>
      asRole(
        "service_role",
        async () =>
          (
            await db.query("select public.get_approved_sscasn_context($1::uuid[]) as context", [
              [formationId],
            ])
          ).rows[0].context,
      );

    await t.test("all catalog tables use RLS; function does not elevate privileges", async () => {
      const tables = await db.query(
        "select relname,relrowsecurity from pg_class where relname=any($1::text[])",
        [["sscasn_snapshots", "sscasn_formations", "sscasn_institutions", "sscasn_matches"]],
      );
      assert.equal(tables.rows.length, 4);
      assert(tables.rows.every((row) => row.relrowsecurity));
      const fn = await db.query(
        "select prosecdef from pg_proc where oid='public.get_approved_sscasn_context(uuid[])'::regprocedure",
      );
      assert.equal(fn.rows[0].prosecdef, false);
    });
    await t.test(
      "anonymous and authenticated callers cannot read catalog or call context",
      async () => {
        for (const role of ["anon", "authenticated"]) {
          await asRole(role, async () => {
            for (const table of [
              "sscasn_snapshots",
              "sscasn_formations",
              "sscasn_institutions",
              "sscasn_matches",
            ])
              await assert.rejects(() => db.query(`select * from public.${table}`), {
                code: "42501",
              });
            await assert.rejects(
              () => db.query("select public.get_approved_sscasn_context('{}'::uuid[])"),
              { code: "42501" },
            );
          });
        }
      },
    );
    await t.test("pending and rejected mappings provide no public context", async () => {
      assert.deepEqual(await context(), {});
      await db.exec("update public.sscasn_matches set review_status='rejected'");
      assert.deepEqual(await context(), {});
    });
    await t.test("approval requires review timestamp and a unique source", async () => {
      await assert.rejects(
        () => db.query("update public.sscasn_matches set review_status='approved'"),
        { code: "23514" },
      );
      await db.exec("update public.sscasn_matches set review_status='approved',reviewed_at=now()");
      await assert.rejects(
        () =>
          db.query(
            "insert into public.sscasn_matches (formation_id,snapshot_id,source_id,review_status,reviewed_at) values ($1,'test-snapshot','source-1','approved',now())",
            [otherFormationId],
          ),
        { code: "23505" },
      );
    });
    await t.test(
      "approved published verified mapping provides administrative context",
      async () => {
        const result = await context();
        assert.equal(result[formationId].passed_admin, 7);
        assert.equal(result[formationId].quota, 2);
        assert.equal(result[formationId].administrative_ratio, 3.5);
        assert.equal(result[formationId].salary_min, 6000000);
        assert.equal(result[formationId].selection_year, 2024);
      },
    );
    await t.test(
      "unready snapshots and unpublished or unverified PDFs cannot enrich results",
      async () => {
        await db.exec("update public.sscasn_snapshots set import_status='importing'");
        assert.deepEqual(await context(), {});
        await db.exec(
          "update public.sscasn_snapshots set import_status='ready'; update public.skd_batches set status='review'",
        );
        assert.deepEqual(await context(), {});
        await db.exec(
          "update public.skd_batches set status='published'; update public.skd_formations set quality_status='needs_review'",
        );
        assert.deepEqual(await context(), {});
        await db.exec("update public.skd_formations set quality_status='verified'");
      },
    );
    await t.test("changed institution, year or job invalidates approved context", async () => {
      await db.exec("update public.skd_formations set tahun=2025");
      assert.deepEqual(await context(), {});
      await db.exec("update public.skd_formations set tahun=2024,nama_instansi='Instansi lain'");
      assert.deepEqual(await context(), {});
      await db.exec(
        "update public.skd_formations set nama_instansi='Kejaksaan Agung',jabatan='Jabatan lain'",
      );
      assert.deepEqual(await context(), {});
    });
    await t.test(
      "quota, administrative counts and salary range reject invalid values",
      async () => {
        for (const assignment of [
          "quota=-1",
          "passed_admin=-1",
          "salary_max=1000",
          "salary_min=null,salary_max=-1",
        ])
          await assert.rejects(
            () => db.query(`update public.sscasn_formations set ${assignment}`),
            { code: "23514" },
          );
      },
    );
  } finally {
    await db.close();
  }
});
