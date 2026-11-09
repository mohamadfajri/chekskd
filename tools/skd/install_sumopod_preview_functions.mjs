import pg from "pg";
import { aesenConnection } from "../../src/server/aesenConnection.ts";
import { installSkdReadFunctions } from "./sumopod_runtime_sql.mjs";

async function main() {
  const url = process.env.SKD_DATABASE_URL;
  if (!url) throw new Error("SKD_DATABASE_URL belum disetel.");
  const client = new pg.Client({ ...aesenConnection(url), query_timeout: 20_000 });
  await client.connect();
  try {
    const { rows: [target] } = await client.query(
      "select to_regclass('skd_transfer.checkpoints') is not null as migrated",
    );
    if (!target.migrated) throw new Error("Tujuan bukan database hasil migrasi SKD.");
    const { rows: [state] } = await client.query(
      "select count(*)::int as tables, bool_and(expected=copied) as complete from skd_transfer.checkpoints",
    );
    if (state.tables !== 11 || !state.complete) throw new Error("Data migrasi belum lengkap.");
    await client.query("begin");
    await client.query("set local lock_timeout='5s'");
    await installSkdReadFunctions(client);
    await client.query("commit");
    console.log("Fungsi baca SKD terpasang di SumoPod. Hak akses PUBLIC tidak diberikan.");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.code ? `Instalasi fungsi gagal (${error.code}).` : error.message);
  process.exitCode = 1;
});
