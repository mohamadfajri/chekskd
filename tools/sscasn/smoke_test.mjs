import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

const base = process.env.SSCASN_TEST_URL || "http://127.0.0.1:8091";
if (!process.env.ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD belum tersedia.");
const headers = { "x-admin-password": process.env.ADMIN_PASSWORD };
const endpoint = `${base}/api/admin/sscasn`;
async function get(params = "") {
  const response = await fetch(endpoint + params, { headers, signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, 200);
  return response.json();
}

assert.equal((await fetch(endpoint)).status, 401);
const all = await get();
const scopedPilot = all.snapshot.scope_institution === "Kejaksaan Agung";
assert.equal(all.pagination.total, scopedPilot ? 75 : 111921);
assert.equal(all.institutions.length, scopedPilot ? 1 : 544);
assert.equal(all.formations.length, 25);
assert.equal(all.review.length, 75);
const kejaksaan = await get("?institution=Kejaksaan%20Agung");
assert.equal(kejaksaan.pagination.total, 75);
assert(kejaksaan.formations.every((row) => row.institution === "Kejaksaan Agung"));
const second = await get("?institution=Kejaksaan%20Agung&page=2");
assert(
  !second.formations.some((row) =>
    kejaksaan.formations.some((first) => first.source_id === row.source_id),
  ),
);
const education = await get("?institution=Kejaksaan%20Agung&query=HUKUM");
assert(education.formations.length > 0);
assert(
  education.formations.every((row) => /HUKUM/i.test(`${row.job} ${row.location} ${row.education}`)),
);
assert.equal((await get("?query=THIS_FORMATION_DOES_NOT_EXIST_991827")).pagination.total, 0);
assert.equal(
  (
    await fetch(endpoint, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: "{}",
    })
  ).status,
  400,
);

if (process.argv.includes("--local-review")) {
  assert.equal(all.mode, "local", "Smoke review hanya boleh dilakukan di staging lokal.");
  const target = path.resolve("data/staging/sscasn/reviews.json");
  let original = null;
  try {
    original = await readFile(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const row = all.review.find((item) => item.candidates.some((candidate) => candidate.exact));
  const source = row.candidates.find((candidate) => candidate.exact).formation;
  const save = (status, overrides = {}) =>
    fetch(endpoint, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        formation_id: row.pdf.id,
        snapshot_id: all.snapshot.id,
        source_id: source.source_id,
        review_status: status,
        notes: "Automated local smoke test",
        ...overrides,
      }),
    });
  try {
    assert.equal((await save("approved")).status, 200);
    assert.equal(
      (await get()).review.find((item) => item.pdf.id === row.pdf.id).match.review_status,
      "approved",
    );
    assert.equal((await save("approved", { snapshot_id: "wrong-snapshot" })).status, 409);
    const sibling = all.review.find(
      (item) => item.pdf.id !== row.pdf.id && item.pdf.jabatan === row.pdf.jabatan,
    );
    assert(sibling, "Pilot perlu dua kelompok PDF dengan jabatan sama untuk tes keunikan.");
    const duplicate = await save("approved", { formation_id: sibling.pdf.id });
    assert.equal(duplicate.status, 409);
    assert.match((await duplicate.json()).message, /sudah dipakai/);
    const missingNote = await save("approved", { formation_id: sibling.pdf.id, notes: "" });
    assert.equal(missingNote.status, 409);
    assert.match((await missingNote.json()).message, /catatan/);
    assert.equal((await save("rejected")).status, 200);
    assert.equal(
      (await get()).review.find((item) => item.pdf.id === row.pdf.id).match.review_status,
      "rejected",
    );
    assert.equal((await save("pending")).status, 200);
  } finally {
    if (original) await writeFile(target, original);
    else
      await unlink(target).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
  }
}

if (process.argv.includes("--browser-auth")) {
  const login = await fetch(`${base}/api/admin/skd-batches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "validate", adminPassword: process.env.ADMIN_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0].split("=");
  const directory = path.resolve("data/staging/sscasn");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "browser-auth.json"),
    JSON.stringify({
      cookies: [
        {
          name: cookie[0],
          value: cookie.slice(1).join("="),
          domain: new URL(base).hostname,
          path: "/api/admin",
          httpOnly: true,
          secure: new URL(base).protocol === "https:",
          sameSite: "Strict",
          expires: Math.floor(Date.now() / 1000) + 3600,
        },
      ],
      origins: [],
    }),
  );
}
console.log(
  JSON.stringify({
    ok: true,
    mode: all.mode,
    formations: all.pagination.total,
    exact_candidates: all.review.filter(
      (row) => row.candidates.filter((candidate) => candidate.exact).length === 1,
    ).length,
    checks:
      "auth, pagination, institution, education, empty results, invalid input, optional local review",
  }),
);
