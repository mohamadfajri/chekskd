import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { tables, transferIndexes, transferSchema } from "./sumopod_transfer_schema.mjs";

const { PGlite } = await import(
  process.env.SKD_PGLITE_MODULE
    ? pathToFileURL(process.env.SKD_PGLITE_MODULE).href
    : "@electric-sql/pglite"
);
const { pg_trgm } = await import(
  process.env.SKD_PGLITE_MODULE
    ? new URL("./contrib/pg_trgm.js", pathToFileURL(process.env.SKD_PGLITE_MODULE)).href
    : "@electric-sql/pglite/contrib/pg_trgm"
);

test("transfer schema and indexes build successfully and index phase can resume", async () => {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  try {
    await db.exec(await transferSchema());
    await db.exec("create extension pg_trgm with schema public");
    const statements = await transferIndexes();
    const names = statements.map((statement) => /^create index if not exists (\w+)\s/.exec(statement)?.[1]);
    assert(names.length > 0 && names.every(Boolean));
    for (let pass = 0; pass < 2; pass++) {
      for (const statement of statements) await db.exec(statement);
    }
    const { rows: indexes } = await db.query(
      "select indexname from pg_indexes where schemaname='public' and indexname=any($1::text[])",
      [names],
    );
    assert.equal(indexes.length, names.length);
    const { rows: copiedTables } = await db.query(
      "select tablename from pg_tables where schemaname='public'",
    );
    assert.deepEqual(copiedTables.map(({ tablename }) => tablename).sort(), tables.map(([name]) => name).sort());
  } finally {
    await db.close();
  }
});
