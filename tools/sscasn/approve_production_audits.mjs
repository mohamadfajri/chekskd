import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const base = "https://chekskd.vercel.app/api/admin/sscasn";
const { values } = parseArgs({
  options: { apply: { type: "boolean" }, plan: { type: "string" } },
});
const planPath = values.plan ?? "data/staging/sscasn/production-bulk-plan.json";
const password = process.env.ADMIN_PASSWORD?.trim();
if (!password) throw new Error("ADMIN_PASSWORD belum tersedia.");

async function api(query, payload) {
  const response = await fetch(query ? `${base}?${new URLSearchParams(query)}` : base, {
    method: payload ? "POST" : "GET",
    headers: { "x-admin-password": password, "content-type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(payload ? 55_000 : 25_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.message ?? `HTTP ${response.status}`);
  return result;
}

const getPlan = (institution) => api({ mode: "audit-bulk-plan", institution });
const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
const save = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
await mkdir(path.dirname(planPath), { recursive: true });
if (!values.apply) {
  const { institutions } = await api({ mode: "audit-institutions" });
  const rows = new Array(institutions.length);
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < institutions.length) {
      const index = next++;
      const institution = institutions[index];
      try {
        let plan;
        try { plan = await getPlan(institution); }
        catch { plan = await getPlan(institution); }
        rows[index] = { institution, ...plan };
        if (plan.exact + plan.prefix > 0)
          console.log(`${institution}: ${plan.exact} persis, ${plan.prefix} awalan kode`);
      } catch (error) {
        rows[index] = { institution, error: error.message };
        console.log(`${institution}: gagal memuat rencana`);
      }
    }
  }));
  await save(planPath, { endpoint: base, plannedAt: new Date().toISOString(), rows });
  console.log(JSON.stringify({
    institutions: rows.length, exact: sum(rows, "exact"), prefix: sum(rows, "prefix"),
    held: sum(rows, "held"), errors: rows.filter(({ error }) => error).length, planPath,
  }));
} else {
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  if (plan.endpoint !== base || !Array.isArray(plan.rows)) throw new Error("File rencana tidak valid.");
  const attempted = plan.rows.filter((row) => /^[a-f0-9]{64}$/.test(row.fingerprint ?? "") && row.exact + row.prefix > 0);
  const reportPath = planPath.replace(/\.json$/, "") + "-applied.json";
  const results = [];
  for (const { institution, fingerprint, exact, prefix } of attempted) {
    try {
      const result = await api(null, { action: "approve-bulk-plan", institution, fingerprint });
      results.push({ institution, ...result });
      console.log(`${institution}: ${result.newlyApproved} disetujui`);
    } catch (error) {
      const current = await getPlan(institution).catch(() => null);
      results.push({
        institution, planned: exact + prefix, error: error.message,
        remaining: current ? current.exact + current.prefix : null,
      });
      console.log(`${institution}: perlu diperiksa ulang (${error.message})`);
    }
    await save(reportPath, { planPath, updatedAt: new Date().toISOString(), results });
  }
  console.log(JSON.stringify({
    institutions: attempted.length, newlyApproved: sum(results, "newlyApproved"),
    errors: results.filter(({ error }) => error).length, reportPath: attempted.length ? reportPath : null,
  }));
}
