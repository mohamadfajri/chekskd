import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { aesenConnection } from "../../src/server/aesenConnection.ts";
import {
  aesenFilterQuery,
  countAesenFormations,
  getAesenMetadata,
  getFilteredAesenFormationsByIds,
  listAesenFormations,
} from "../../src/server/aesenCatalog.ts";
import { getUnifiedFormationCatalog } from "../../src/server/formationCatalog.ts";
import {
  attachZeroRecapEvidence,
  getSscasnAudit,
  listSscasnAuditInstitutions,
  readAesenAuditCatalog,
  readSscasnAuditOfficial,
  readSscasnAuditReviews,
} from "../../src/server/sscasnAudit.ts";
import { reconcileCatalog } from "../../src/lib/sscasnReconciliation.ts";
import { catalogEducationOptions } from "../../src/lib/formationCatalog.ts";

test("catalogue suggestions find Aesen degrees without merging degree levels or unreviewed majors", () => {
  const keys = ["s1 hukum", "s1 ilmu hukum", "s2 hukum", "s1 hukum islam", "s1 teknik sipil"];
  assert.deepEqual(
    catalogEducationOptions(keys, "hukum").map(({ value }) => value),
    ["s1 hukum", "s2 hukum", "s1 hukum islam", "s1 ilmu hukum"],
  );
  assert.deepEqual(catalogEducationOptions(keys, "S-2 Hu"), [
    { value: "s2 hukum", label: "S-2 HUKUM" },
  ]);
  assert.deepEqual(catalogEducationOptions(keys, "kedokteran"), []);
});

test("education suggestions do not truncate browsing or search results", () => {
  const keys = Array.from(
    { length: 150 },
    (_, index) => `s1 ilmu hukum ${String(index).padStart(3, "0")}`,
  );
  assert.equal(catalogEducationOptions(keys, "").length, 150);
  const results = catalogEducationOptions(keys, "hukum");
  assert.equal(results.length, 150);
  assert.equal(results.at(-1)?.label, "S-1 ILMU HUKUM 149");
});

test("Aesen connection always verifies TLS, even if the URL requests otherwise", () => {
  const config = aesenConnection(
    "postgresql://test:encoded%40pass@db.example:6432/catalog?sslmode=disable",
  );
  assert.equal(config.password, "encoded@pass");
  assert.equal(config.port, 6432);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.throws(() => aesenConnection("https://db.example/catalog"));
});

test("filter values stay bound and qualified education uses exact keys and reviewed aliases", () => {
  const filter = aesenFilterQuery(
    {
      query: "Analis% Hukum",
      education: "S-1 Hukum",
      institution: "Instansi 'uji'",
      level: "daerah",
    },
    ["S-1 Ilmu Hukum"],
    { sourceIds: ["source-id"] },
  );
  assert.match(filter.from, /join aesen\.institutions/);
  assert.match(filter.where, /f\.education_keys && \$6::text\[\]/);
  assert.doesNotMatch(filter.where, /Analis|Instansi|source-id|array_to_string/);
  assert.deepEqual(filter.args, [
    "Instansi 'uji'",
    "daerah",
    ["source-id"],
    "%analis%",
    "%hukum%",
    ["s1 hukum", "s1 ilmu hukum"],
  ]);
});

test("free-text education can explore a subject without assigning SKD eligibility", () => {
  const filter = aesenFilterQuery({ education: "Hukum" }, []);
  assert.match(filter.where, /array_to_string/);
  assert.deepEqual(filter.args, [["hukum"], "% hukum %"]);
});

test("Aesen competition filtering and ordering use passed applicants per quota", () => {
  const quiet = aesenFilterQuery({ competitionLevel: "quiet", sort: "competition_desc" }, []);
  assert.match(quiet.where, /f\.quota > 0/);
  assert.match(quiet.where, /f\.passed_admin > f\.quota::bigint \* 0/);
  assert.match(quiet.where, /f\.passed_admin <= f\.quota::bigint \* 1/);
  assert.match(quiet.order, /passed_admin::numeric \/ nullif\(f\.quota, 0\) desc nulls last/);
});

test("page and sort reuse the same total; narrowing SKD candidates applies catalogue filters", async (t) => {
  const oldUrl = process.env.AESEN_DATABASE_URL;
  process.env.AESEN_DATABASE_URL ||= "postgresql://mock:mock@localhost:5432/catalog";
  t.after(() => {
    if (oldUrl === undefined) delete process.env.AESEN_DATABASE_URL;
    else process.env.AESEN_DATABASE_URL = oldUrl;
  });
  const sql = t.mock.method(pg.Pool.prototype, "query", async (statement, args) => {
    if (statement.startsWith("select count")) return { rows: [{ count: 48 }] };
    assert.match(statement, /f\.institution = \$1/);
    assert.match(statement, /f\.source_id = any\(\$2::text\[\]\)/);
    assert.match(statement, /f\.education_keys && \$3::text\[\]/);
    assert.deepEqual(args, ["Instansi uji", ["allowed-id"], ["s1 hukum"]]);
    return { rows: [{ id: "allowed-id" }] };
  });
  const filters = { institution: "Instansi uji", education: "S-1 Hukum" };
  assert.deepEqual(
    await Promise.all([
      countAesenFormations(filters, []),
      countAesenFormations({ ...filters, page: 2, sort: "name_asc" }, []),
    ]),
    [48, 48],
  );
  assert.equal(sql.mock.callCount(), 1);
  await countAesenFormations({ ...filters, education: "S-2 Hukum" }, []);
  assert.equal(sql.mock.callCount(), 2);
  assert.deepEqual(await getFilteredAesenFormationsByIds(["allowed-id"], filters, []), [
    { id: "allowed-id" },
  ]);
  assert.equal(sql.mock.callCount(), 3);
});

test(
  "live Aesen snapshot, salary, filters and pagination",
  { skip: !process.env.AESEN_DATABASE_URL },
  async () => {
    const meta = await getAesenMetadata();
    assert.equal(meta.total, 111921);
    assert.equal(meta.institutions.length, 544);
    assert(meta.institutions.some((row) => row.level === "daerah"));
    const filters = { institution: "Kejaksaan Agung", query: "arsiparis ahli", level: "pusat" };
    const count = await countAesenFormations(filters, []);
    assert(count > 2);
    const first = await listAesenFormations(filters, [], {}, 0, 2);
    const next = await listAesenFormations(filters, [], {}, 2, 2);
    const ranked = await listAesenFormations(
      { ...filters, sort: "cutoff_desc" },
      [],
      { cutoffOrder: [next[0].id, first[0].id] },
      0,
      2,
    );
    assert.deepEqual(
      ranked.map(({ id }) => id),
      [next[0].id, first[0].id],
    );
    assert(
      first.every(
        (row) =>
          row.institution === filters.institution &&
          row.salaryMin > 0 &&
          row.salaryMax >= row.salaryMin,
      ),
    );
    assert(next.every((row) => !first.some((item) => item.id === row.id)));
    const city = { institution: "Pemerintah Kota Makassar", level: "daerah" };
    assert.equal(await countAesenFormations(city, []), 123);
    assert.equal(await countAesenFormations({ ...city, level: "pusat" }, []), 0);
    const kemenag = { institution: "Kementerian Agama" };
    assert.equal(await countAesenFormations(kemenag, []), 3709);
    assert.equal(await countAesenFormations({ ...kemenag, competitionLevel: "quiet" }, []), 425);
  },
);

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

test(
  "admin audit keeps CLI classifications, compares fields, and paginates by status",
  {
    skip: !process.env.AESEN_DATABASE_URL || !supabaseUrl || !supabaseKey,
  },
  async () => {
    const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
    const institution = "Badan Kepegawaian Negara";
    const [institutions, official, catalog, existing] = await Promise.all([
      listSscasnAuditInstitutions(sb),
      readSscasnAuditOfficial(sb, institution),
      readAesenAuditCatalog(process.env.AESEN_DATABASE_URL, [institution]),
      readSscasnAuditReviews(sb),
    ]);
    assert(institutions.includes(institution));
    const expected = reconcileCatalog(
      attachZeroRecapEvidence(official, catalog.zeroRecaps),
      catalog.rows,
      existing,
    );
    const first = await getSscasnAudit(sb, institution, "ready", 1, true);
    assert.equal(first.summary.total, expected.length);
    assert.equal(first.summary.ready, expected.filter((row) => row.status === "ready").length);
    assert.equal(first.rows.length, Math.min(first.summary.ready, 25));
    assert.equal(
      first.summary.alreadyApproved,
      expected.filter((row) => row.status === "already_approved").length,
    );
    assert(
      first.rows.every(
        (row) => row.status === "ready" && row.candidates[0]?.differences.length === 0,
      ),
    );
    const review = await getSscasnAudit(sb, institution, "review", 9999, false);
    assert.equal(review.pagination.page, review.pagination.totalPages);
    assert(review.rows.every((row) => row.status !== "ready" && row.status !== "already_approved"));
    const kejaksaan = await getSscasnAudit(sb, "Kejaksaan Agung", "already_approved", 1, true);
    assert.equal(kejaksaan.summary.alreadyApproved, 65);
    const remaining = await getSscasnAudit(sb, "Kejaksaan Agung", "review", 1, false);
    const reserved = new Set(
      existing.filter((row) => row.review_status === "approved").map((row) => row.source_id),
    );
    assert.equal(remaining.pagination.total, 10);
    assert(
      remaining.rows.every(
        (row) =>
          row.status !== "already_approved" &&
          row.candidates.every(({ row: candidate }) => !reserved.has(candidate.id)),
      ),
    );
  },
);

test(
  "unified catalogue keeps guest limits, regional data and verified SKD separate",
  { skip: !process.env.AESEN_DATABASE_URL || !supabaseUrl || !supabaseKey },
  async () => {
    const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
    const guest = await getUnifiedFormationCatalog(sb, { page: 1000, institution: "Bogus" }, false);
    assert.equal(guest.access, "preview");
    assert.equal(guest.pagination.page, 1);
    assert.equal(guest.formations.length, 6);
    assert.equal(guest.catalogTotal, 111921);
    assert.equal(guest.institutions.length, 544);
    assert(guest.formations.every((row) => Number.isInteger(row.passedAdmin)));
    const regional = { institution: "Pemerintah Kota Makassar", level: "daerah" };
    const page1 = await getUnifiedFormationCatalog(sb, regional, true);
    const page2 = await getUnifiedFormationCatalog(sb, { ...regional, page: 2 }, true);
    assert.equal(page1.access, "full");
    assert.equal(page1.pagination.total, 123);
    assert.equal(page1.formations.length, 24);
    assert.equal(page2.formations.length, 24);
    assert(page2.formations.every((row) => !page1.formations.some((item) => item.id === row.id)));
    const skd = await getUnifiedFormationCatalog(sb, { hasSkd: true }, true);
    assert(
      skd.formations.every(
        (row) => row.coverage === "skd" && row.skd.registered >= row.skd.attended,
      ),
    );
    const kejaksaan = await getUnifiedFormationCatalog(
      sb,
      { institution: "Kejaksaan Agung" },
      true,
    );
    assert.equal(kejaksaan.pagination.total, 75);
    assert(
      kejaksaan.formations.every((row) => row.salaryMin > 0 && row.salaryMax >= row.salaryMin),
    );
    const kemenag = {
      institution: "Kementerian Agama",
      competitionLevel: "quiet",
      sort: "competition_desc",
    };
    const quiet = await getUnifiedFormationCatalog(sb, kemenag, true);
    assert.equal(quiet.pagination.total, 425);
    const aesenRows = quiet.formations;
    assert(aesenRows.length > 0);
    assert(
      aesenRows.every(
        (row) =>
          row.institution === kemenag.institution &&
          row.passedAdmin > 0 &&
          row.passedAdmin <= row.quota,
      ),
    );
    const ratios = aesenRows.map((row) => row.passedAdmin / row.quota);
    assert.deepEqual(
      ratios,
      [...ratios].sort((a, b) => b - a),
    );
  },
);
