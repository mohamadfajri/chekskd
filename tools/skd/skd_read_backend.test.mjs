import assert from "node:assert/strict";
import test from "node:test";
import { isLocalSkdPreview, useSumopodSkdReads } from "../../src/server/skdPreview.ts";

test("production needs an explicit server flag and local preview stays on loopback", () => {
  const keys = ["NODE_ENV", "SKD_READ_BACKEND", "VITE_SKD_LOCAL_PREVIEW"];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const local = new Request("http://127.0.0.1:8093/api/skd-data");
  const publicSite = new Request("https://chekskd.vercel.app/api/skd-data");
  try {
    process.env.NODE_ENV = "production";
    process.env.VITE_SKD_LOCAL_PREVIEW = "true";
    delete process.env.SKD_READ_BACKEND;
    assert.equal(isLocalSkdPreview(local), false);
    assert.equal(useSumopodSkdReads(publicSite), false);

    process.env.SKD_READ_BACKEND = "sumopod";
    assert.equal(useSumopodSkdReads(publicSite), true);
    assert.equal(isLocalSkdPreview(publicSite), false);

    process.env.SKD_READ_BACKEND = "supabase";
    assert.equal(useSumopodSkdReads(publicSite), false);
    process.env.NODE_ENV = "development";
    assert.equal(useSumopodSkdReads(local), true);
    assert.equal(useSumopodSkdReads(publicSite), false);
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});
