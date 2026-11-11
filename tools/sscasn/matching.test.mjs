import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { buildSscasnCandidates } from "../../src/lib/sscasn.ts";
import {
  selectableSscasnPagePairs,
  SSCASN_MANUAL_BATCH_LIMIT,
} from "../../src/lib/sscasnReconciliation.ts";
import { reconcileCatalog } from "./reconcile_catalog.mjs";
import { saveSscasnExactPairs } from "../../src/server/sscasnApproval.ts";
import {
  attachZeroRecapEvidence,
  validateSscasnManualSelection,
} from "../../src/server/sscasnAudit.ts";

const pdf = {
  id: "pdf",
  nama_instansi: "Kejaksaan Agung",
  jabatan: "ANALIS HUKUM AHLI PERTAMA",
  lokasi_formasi: "Kejaksaan Agung",
  pendidikan: "S-1 HUKUM / S-1 ILMU HUKUM",
  jumlah_formasi: 5,
  jenis_formasi: "UMUM",
  tahun: 2024,
  page_number: 1,
};
const source = {
  source_id: "a",
  institution: "Kejaksaan Agung",
  job: pdf.jabatan,
  location: pdf.lokasi_formasi,
  education: "S-1 ILMU HUKUM / S-1 HUKUM",
  quota: 5,
  passed_admin: 34,
};
test("accepted education order does not change match; no score or status used", () => {
  const [candidate] = buildSscasnCandidates(pdf, [source]);
  assert.equal(candidate.exact, true);
  assert.equal(candidate.formation.passed_admin, 34);
  assert.equal("review_status" in candidate, false);
});
test("same family with a different accepted degree set is not exact", () => {
  const [candidate] = buildSscasnCandidates(pdf, [{ ...source, education: "S-1 HUKUM" }]);
  assert.equal(candidate.exact, false);
  assert.ok(candidate.differences.includes("Syarat pendidikan berbeda"));
});
test("different institution, year and job cannot supply candidates", () => {
  assert.deepEqual(buildSscasnCandidates({ ...pdf, tahun: 2026 }, [source]), []);
  assert.deepEqual(
    buildSscasnCandidates(pdf, [{ ...source, institution: "Kementerian Hukum" }]),
    [],
  );
  assert.deepEqual(buildSscasnCandidates(pdf, [{ ...source, job: "PENATA KELOLA HUKUM" }]), []);
});
test("different quotas remain review differences and duplicate candidates remain visible", () => {
  assert.equal(buildSscasnCandidates(pdf, [{ ...source, quota: 6 }])[0].exact, false);
  assert.equal(buildSscasnCandidates(pdf, [source, { ...source, source_id: "b" }]).length, 2);
});

const official = {
  id: "pdf",
  institution: "Kejaksaan Agung",
  job: "ANALIS HUKUM",
  location: "Jakarta",
  education: "S-1 HUKUM",
  category: "UMUM",
  page: 4,
  quota: 2,
  statsQuota: 2,
  registered: 5,
  attended: 4,
};
const aesen = { ...official, id: "aesen" };
const reconcile = (pdf, sources, existing = [], audit) =>
  reconcileCatalog(pdf, sources, existing, audit).map(({ status }) => status);

const candidate = (id, canApprove = true) => ({ row: { id }, canApprove });

test("selecting a page skips ambiguous, blocked, shared and already selected candidates", () => {
  const rows = [
    { id: "chosen", candidates: [candidate("original"), candidate("alternate")] },
    { id: "busy", candidates: [candidate("previous-page")] },
    { id: "ambiguous", candidates: [candidate("a"), candidate("b")] },
    { id: "shared-1", candidates: [candidate("a")] },
    { id: "shared-2", candidates: [candidate("same")] },
    { id: "shared-3", candidates: [candidate("same")] },
    { id: "blocked", candidates: [candidate("invalid", false)] },
    { id: "eligible", candidates: [candidate("valid"), candidate("invalid", false)] },
  ];
  const selected = { other: "previous-page", chosen: "original" };
  assert.deepEqual(selectableSscasnPagePairs(rows, selected), [
    { formationId: "eligible", sourceId: "valid" },
  ]);
  assert.deepEqual(selected, { other: "previous-page", chosen: "original" });
});

test("selecting a page stops at the existing approval limit across pages", () => {
  const selected = Object.fromEntries(
    Array.from({ length: SSCASN_MANUAL_BATCH_LIMIT - 1 }, (_, i) => [`old-${i}`, `source-${i}`]),
  );
  const rows = [
    { id: "first", candidates: [candidate("x")] },
    { id: "second", candidates: [candidate("y")] },
  ];
  assert.deepEqual(selectableSscasnPagePairs(rows, selected), [
    { formationId: "first", sourceId: "x" },
  ]);
  assert.deepEqual(selectableSscasnPagePairs(rows, { ...selected, first: "x" }), []);
});

test("bulk exact comparison checks registered totals, page, and quota", () => {
  assert.deepEqual(reconcile([official], [aesen]), ["ready"]);
  assert.deepEqual(reconcile([official], [{ ...aesen, registered: 4 }]), ["no_exact_candidate"]);
  assert.deepEqual(reconcile([{ ...official, page: null }], [aesen]), ["incomplete_evidence"]);
  assert.deepEqual(reconcile([{ ...official, statsQuota: 1 }], [aesen]), ["incomplete_evidence"]);
});

test("job prefixes and ambiguous sources remain for review", () => {
  const prefix = { ...official, id: "other", job: `123 - ${official.job}` };
  assert.deepEqual(reconcile([prefix], [aesen]), ["review_job_prefix"]);
  assert.deepEqual(reconcile([official, prefix], [aesen]), ["ambiguous", "ambiguous"]);
  assert.deepEqual(reconcile([official], [aesen, { ...aesen, id: "second" }]), ["ambiguous"]);
});

test("bulk does not replace manual reviews or reuse an approved source", () => {
  const rejected = { formation_id: official.id, source_id: aesen.id, review_status: "rejected" };
  const used = { ...rejected, formation_id: "other", review_status: "approved" };
  assert.deepEqual(reconcile([official], [aesen], [rejected]), ["existing_review"]);
  assert.deepEqual(reconcile([official], [aesen], [used]), ["source_in_use"]);
});

test("zero participants need PDF recap, current detail counts and category", () => {
  const empty = { ...official, registered: 0, attended: 0 };
  const source = {
    ...aesen,
    registered: 0,
    category: "UMUM",
    categorySource: "detail_api",
    verifiedRegistered: 0,
  };
  const recap = {
    audit_status: "exact_with_recap",
    pdf_page: official.page,
    pdf_job: official.job,
    pdf_category: official.category,
    location: official.location,
    education: official.education,
    quota: official.quota,
    pdf_participants: 0,
    pdf_present: 0,
    candidates: [{ source_id: source.id }],
  };
  assert.deepEqual(reconcile([empty], [source]), ["zero_recap_required"]);
  assert.deepEqual(reconcile([empty], [source], [], new Map([[official.id, recap]])), ["ready"]);
  assert.deepEqual(
    reconcile([empty], [source], [], new Map([[official.id, { ...recap, pdf_page: 8 }]])),
    ["zero_recap_required"],
  );
  assert.deepEqual(
    reconcile([{ ...empty, zeroRecapVerified: true }], [{ ...source, categorySource: "archive" }]),
    ["zero_detail_required"],
  );
  assert.deepEqual(
    reconcile([{ ...empty, zeroRecapVerified: true }], [{ ...source, verifiedRegistered: 1 }]),
    ["zero_detail_required"],
  );
});

test("verified category separates otherwise identical Umum and Papua zero pairs", () => {
  const umum = { ...official, registered: 0, attended: 0, zeroRecapVerified: true };
  const papua = { ...umum, id: "pdf-papua", category: "PUTRA/PUTRI PAPUA DAN PAPUA BARAT" };
  const source = {
    ...aesen,
    registered: 0,
    category: "UMUM",
    categorySource: "detail_api",
    verifiedRegistered: 0,
  };
  const other = { ...source, id: "aesen-papua", category: papua.category };
  const classified = reconcileCatalog([umum, papua], [source, other], []);
  assert.deepEqual(
    classified.map(({ status, candidateIds }) => [status, candidateIds]),
    [
      ["ready", [source.id]],
      ["ready", [other.id]],
    ],
  );
  assert.deepEqual(reconcile([umum], [other]), ["category_mismatch"]);
  assert.deepEqual(reconcile([umum, papua], [source, { ...other, category: null }]), [
    "ambiguous",
    "ambiguous",
  ]);
});

test("stored zero proof cannot be used for a different PDF, page or formation evidence", () => {
  const row = { ...official, registered: 0, attended: 0, pdfSourceId: "original" };
  const proof = {
    formation_id: row.id,
    source_id: "original",
    institution: row.institution,
    job: row.job,
    location: row.location,
    education: row.education,
    category: row.category,
    pdf_page: row.page,
    quota: row.quota,
  };
  assert.equal(attachZeroRecapEvidence([row], [proof])[0].zeroRecapVerified, true);
  for (const change of [{ source_id: "other" }, { pdf_page: 9 }, { category: "Disabilitas" }]) {
    assert.equal(
      attachZeroRecapEvidence([row], [{ ...proof, ...change }])[0].zeroRecapVerified,
      undefined,
    );
  }
});

test("manual selection accepts a proven prefix only, not conflicting evidence or reused pairs", () => {
  const source = { ...aesen, salary_min: null, salary_max: null };
  const prefix = { ...official, job: `123 - ${official.job}` };
  const audit = {
    rows: reconcileCatalog([prefix], [source], []),
    source: new Map([[source.id, source]]),
    existing: new Map(),
    usedSources: new Map(),
  };
  const pair = { formationId: prefix.id, sourceId: source.id };
  assert.equal(validateSscasnManualSelection(audit, [pair])[0].candidate.id, source.id);
  assert.throws(() => validateSscasnManualSelection(audit, [pair, pair]), /dipilih sekali/);
  assert.throws(
    () =>
      validateSscasnManualSelection({ ...audit, usedSources: new Map([[source.id, "other"]]) }, [
        pair,
      ]),
    /sudah dipakai/,
  );
  assert.throws(
    () =>
      validateSscasnManualSelection(
        { ...audit, existing: new Map([[prefix.id, { review_status: "pending" }]]) },
        [pair],
      ),
    /memiliki review/,
  );
  assert.throws(
    () =>
      validateSscasnManualSelection(
        { ...audit, source: new Map([[source.id, { ...source, location: "Berbeda" }]]) },
        [pair],
      ),
    /Bukti salah satu/,
  );
});

test("bulk writer inserts only exact pairs in one request without replacing previous reviews", async () => {
  const writes = [];
  const source = { ...aesen, salary_min: 5000000, salary_max: 7000000 };
  const sb = createClient("https://audit-test.example", "fake-key", {
    auth: { persistSession: false },
    global: {
      fetch: async (input, options) => {
        const table = new URL(input).pathname.split("/").at(-1);
        if (table === "sscasn_snapshots") return Response.json({ id: "ready" });
        if (table === "sscasn_formations")
          return Response.json([
            { ...source, source_id: source.id, passed_admin: source.registered },
          ]);
        if (table === "sscasn_matches") {
          assert.equal(options.method, "POST");
          assert.doesNotMatch(String(options.headers.get("Prefer")), /resolution/);
          writes.push(JSON.parse(options.body));
          return new Response(null, { status: 201 });
        }
        throw new Error("Unexpected request");
      },
    },
  });
  const snapshot = {
    source_url: "https://example.com",
    captured_at: new Date(0),
    checksum: "checksum",
  };
  const [ready] = reconcileCatalog([official], [source], []);
  const blocked = { ...ready, id: "blocked", status: "review_job_prefix" };
  assert.equal(
    await saveSscasnExactPairs(
      sb,
      snapshot,
      official.institution,
      [ready, blocked],
      new Map([[source.id, source]]),
      "test",
    ),
    1,
  );
  assert.equal(writes.length, 1);
  assert.deepEqual(
    writes[0].map(({ formation_id, source_id }) => [formation_id, source_id]),
    [[official.id, source.id]],
  );
  await assert.rejects(
    saveSscasnExactPairs(
      sb,
      snapshot,
      official.institution,
      [ready, { ...ready, id: "duplicate" }],
      new Map([[source.id, source]]),
      "test",
    ),
    /tidak unik/,
  );
  assert.equal(writes.length, 1);
});
