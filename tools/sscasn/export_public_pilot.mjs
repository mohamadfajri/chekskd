import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";

const [source] = process.argv.slice(2);
assert(source, "Usage: node tools/sscasn/export_public_pilot.mjs <aesen.sqlite>");

const scope = [
  { name: "Kejaksaan Agung", level: "pusat", count: 75 },
  { name: "Pemerintah Kota Makassar", level: "daerah", count: 123 },
  { name: "Pemerintah Provinsi Sulawesi Selatan", level: "daerah", count: 5 },
];
const db = new DatabaseSync(source, { readOnly: true });
try {
  const select = db.prepare(`
    SELECT formasi_id id, jabatan_nm job, lokasi_nm location, pendidikan_nm education,
           jumlah_formasi quota, gaji_min salaryMin, gaji_max salaryMax
    FROM formasi WHERE ins_nm = ? ORDER BY jabatan_nm, lokasi_nm, formasi_id
  `);
  const institutions = scope.map(({ name, level, count }) => {
    const rows = select.all(name).map((row) => {
      assert(typeof row.id === "string" && row.id && row.job);
      assert(Number.isSafeInteger(row.quota) && row.quota > 0);
      const { salaryMin: min, salaryMax: max } = row;
      const salary =
        Number.isSafeInteger(min) && Number.isSafeInteger(max) && min > 0 && max >= min;
      return {
        ...row,
        location: row.location ?? "",
        education: row.education ?? "",
        salaryMin: salary ? min : null,
        salaryMax: salary ? max : null,
      };
    });
    assert.equal(rows.length, count, name);
    return { name, level, rows };
  });
  const ids = institutions.flatMap(({ rows }) => rows.map(({ id }) => id));
  assert.equal(ids.length, new Set(ids).size);
  const output = new URL("../../src/server/formationCatalogPilot.json", import.meta.url);
  writeFileSync(output, JSON.stringify({ year: 2024, institutions }) + "\n");
  console.log(`Exported ${ids.length} catalog rows from ${institutions.length} institutions.`);
} finally {
  db.close();
}
