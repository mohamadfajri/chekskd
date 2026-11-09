import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { catalogCompetitionRatio } from "../../src/lib/formationCatalog.ts";
import { SSCASN_MANUAL_NOTE_PREFIX } from "../../src/lib/sscasnReconciliation.ts";
import {
  aesenToCatalog,
  browseFormationCatalog,
  getUnifiedFormationCatalog,
  institutionLevel,
  officialCatalogSkd,
  planCatalogPage,
  uniqueCatalogPairs,
} from "../../src/server/formationCatalog.ts";

const published = new Set(["Kejaksaan Agung"]);

test("ketetatan always rounds the Aesen administrative ratio to the nearest integer", () => {
  assert.equal(catalogCompetitionRatio({ quota: 5, passedAdmin: 34 }), "1:7");
  assert.equal(catalogCompetitionRatio({ quota: 5, passedAdmin: 31 }), "1:6");
  assert.equal(catalogCompetitionRatio({ quota: 4, passedAdmin: 6 }), "1:2");
  assert.equal(
    catalogCompetitionRatio({ quota: 4, passedAdmin: 100, skd: { attended: 5 } }),
    "1:25",
  );
  assert.equal(catalogCompetitionRatio({ quota: 0, passedAdmin: 4 }), null);
  assert.equal(catalogCompetitionRatio({ quota: 2 }), null);
  assert.equal(catalogCompetitionRatio({ quota: 2, passedAdmin: 0 }), "1:0");
  assert.equal(catalogCompetitionRatio({ quota: 1000, passedAdmin: 1 }), "1:0");
});

test("guest filters cannot enumerate the pilot", () => {
  const preview = browseFormationCatalog({}, false, published);
  assert.equal(preview.access, "preview");
  assert.equal(preview.formations.length, 6);
  assert.equal(preview.catalogTotal, 203);
  assert.deepEqual(
    new Set(preview.formations.map(({ level }) => level)),
    new Set(["pusat", "daerah"]),
  );
  assert.deepEqual(
    browseFormationCatalog({ query: "nonsense", page: 80, level: "daerah" }, false, published),
    preview,
  );
  assert(preview.formations.every((row) => !("cutoff_total" in row)));
  assert(preview.formations.every((row) => Number.isInteger(row.passedAdmin)));
});

test("signed-in pagination is disjoint and bounded to the filtered results", () => {
  const filters = { level: "daerah" };
  const first = browseFormationCatalog(filters, true, published);
  const second = browseFormationCatalog({ ...filters, page: 2 }, true, published);
  const last = browseFormationCatalog({ ...filters, page: 1e6 }, true, published);
  assert.equal(first.access, "full");
  assert.equal(first.pagination.total, 128);
  assert.equal(first.formations.length, 24);
  assert(
    first.formations.every(({ level, coverage }) => level === "daerah" && coverage === "no_skd"),
  );
  assert(second.formations.every((row) => !first.formations.some(({ id }) => row.id === id)));
  assert.equal(last.pagination.page, last.pagination.totalPages);
});

test("catalog search combines institution, job and education without asserting eligibility", () => {
  const results = browseFormationCatalog(
    { institution: "Kejaksaan Agung", query: "analis hukum", education: "s1 hukum" },
    true,
    published,
  );
  assert(results.formations.length > 0);
  assert(results.formations.every((row) => row.job.includes("ANALIS HUKUM")));
  assert(results.formations.every((row) => row.coverage === "institution_skd"));
  assert(results.formations.every((row) => row.salaryMin > 0 && row.salaryMax >= row.salaryMin));
});

test("empty and unavailable coverage are distinct", () => {
  const empty = browseFormationCatalog({ query: "ZZZ-UNKNOWN-TEST" }, true, published);
  assert.equal(empty.pagination.total, 0);
  assert.equal(empty.pagination.totalPages, 1);
  assert.deepEqual(empty.formations, []);
  const unknown = browseFormationCatalog({}, false, null);
  assert(unknown.formations.every((row) => row.coverage === "unknown"));
});

test("a confirmed pair adds SKD evidence without replacing any catalogue fields", () => {
  const pdf = {
    formation_id: "official",
    quota: 5,
    participant_count: 40,
    attended_count: 31,
    passing_count: 3,
    shortlisted_count: 3,
    shortlist_capacity: 15,
    cutoff_total: 384,
    cutoff_tkp: 180,
    cutoff_tiu: 109,
    cutoff_twk: 95,
    skd_formations: {
      nama_instansi: "Kejaksaan Agung",
      jabatan: "ANALIS HUKUM AHLI PERTAMA",
      jenis_formasi: "UMUM",
      pendidikan: "S-1 HUKUM",
      pendidikan_options: ["S-1 HUKUM"],
    },
  };
  const source = {
    id: "source",
    institution: "Kejaksaan Agung",
    job: "ANALIS HUKUM AHLI PERTAMA",
    location: "Kejaksaan Agung",
    education: "S-1 HUKUM",
    quota: 4,
    passedAdmin: 34,
    salaryMin: 8544850,
    salaryMax: 10534350,
  };
  const unlinked = aesenToCatalog(source, "pusat", true);
  const linked = aesenToCatalog(source, "pusat", true, officialCatalogSkd(pdf));
  assert.deepEqual(linked, { ...unlinked, coverage: "skd", skd: officialCatalogSkd(pdf) });
  assert.equal(linked.id, source.id);
  assert.equal(linked.skd.id, pdf.formation_id);
  assert.equal(linked.skd.registered, 40);
  assert.equal(linked.skd.attended, 31);
  assert.equal(linked.skd.canSimulate, true);
  assert.equal(officialCatalogSkd({ ...pdf, cutoff_tkp: null }).canSimulate, false);
});

test("a source or official ID used twice does not auto-link", () => {
  const pair = (sourceId, formationId) => ({ sourceId, formationId, status: "approved" });
  const valid = pair("a", "1");
  assert.deepEqual(
    uniqueCatalogPairs([valid, pair("b", "2"), pair("b", "3"), pair("c", "4"), pair("d", "4")]),
    [valid],
  );
});

test("SKD-only filter admits only approved links and keeps the Aesen row ID", async () => {
  const saved = process.env.AESEN_DATABASE_URL;
  delete process.env.AESEN_DATABASE_URL;
  const filters = { institution: "Kejaksaan Agung", query: "analis hukum", hasSkd: true };
  const [row] = browseFormationCatalog({ ...filters, hasSkd: false }, true, published).formations;
  let approved = false;
  let prefix = false;
  let manual = false;
  let locationMismatch = false;
  const sb = createClient("https://catalog-test.example", "fake-key", {
    auth: { persistSession: false },
    global: {
      fetch: async (input) => {
        const url = new URL(input);
        if (url.pathname.endsWith("/skd_batches"))
          return Response.json([{ institution_name: row.institution }]);
        if (url.pathname.endsWith("/sscasn_matches")) {
          assert.equal(url.searchParams.get("review_status"), "eq.approved");
          return Response.json(
            approved
              ? [
                  {
                    formation_id: "pdf-id",
                    source_id: row.id,
                    notes: manual ? `${SSCASN_MANUAL_NOTE_PREFIX}PDF halaman 1.` : null,
                    sscasn_formations: row,
                  },
                ]
              : [],
          );
        }
        if (url.pathname.endsWith("/skd_formation_stats")) {
          assert.equal(url.searchParams.get("skd_formations.quality_status"), "eq.verified");
          return Response.json([
            {
              formation_id: "pdf-id",
              quota: row.quota,
              participant_count: 34,
              attended_count: 30,
              cutoff_total: 384,
              skd_formations: {
                nama_instansi: row.institution,
                jabatan: prefix ? `123 - ${row.job}` : row.job,
                jenis_formasi: "UMUM",
                lokasi_formasi: locationMismatch ? "Lokasi lain" : row.location,
                pendidikan: row.education,
                jumlah_formasi: row.quota,
                page_number: 1,
              },
            },
          ]);
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      },
    },
  });
  try {
    assert.equal((await getUnifiedFormationCatalog(sb, filters, true)).pagination.total, 0);
    approved = true;
    const response = await getUnifiedFormationCatalog(
      sb,
      { ...filters, formationType: "UMUM" },
      true,
    );
    assert.equal(response.pagination.total, 1);
    assert.equal(response.formations[0].id, row.id);
    assert.equal(response.formations[0].salaryMin, row.salaryMin);
    assert.equal(response.formations[0].skd.id, "pdf-id");
    prefix = true;
    assert.equal((await getUnifiedFormationCatalog(sb, filters, true)).pagination.total, 0);
    manual = true;
    assert.equal((await getUnifiedFormationCatalog(sb, filters, true)).pagination.total, 1);
    locationMismatch = true;
    assert.equal((await getUnifiedFormationCatalog(sb, filters, true)).pagination.total, 0);
    assert.equal(
      (await getUnifiedFormationCatalog(sb, { ...filters, formationType: "KHUSUS" }, true))
        .pagination.total,
      0,
    );
  } finally {
    if (saved !== undefined) process.env.AESEN_DATABASE_URL = saved;
  }
});

test("pagination counts only catalogue rows and clamps requests", () => {
  assert.deepEqual(planCatalogPage(75, 99), { page: 4, pageSize: 24, total: 75, totalPages: 4 });
  assert.deepEqual(planCatalogPage(0, 9), { page: 1, pageSize: 24, total: 0, totalPages: 1 });
  assert.equal(institutionLevel("Pemerintah Kota Makassar"), "daerah");
  assert.equal(institutionLevel("Kejaksaan Agung"), "pusat");
  assert.equal(institutionLevel("Instansi belum diklasifikasi"), null);
});
