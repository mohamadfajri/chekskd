import assert from "node:assert/strict";
import test from "node:test";
import {
  belowManualSkdThreshold,
  manualSkdAheadFilter,
  manualSkdScore,
} from "../../src/lib/manualSkd.ts";

test("uses the component sum and rejects missing, fractional and out-of-range input", () => {
  assert.deepEqual(manualSkdScore({ twk: 85, tiu: 100, tkp: 185, total: 999 }), {
    twk: 85,
    tiu: 100,
    tkp: 185,
    total: 370,
  });
  for (const invalid of [{ twk: "85" }, { tiu: -1 }, { tkp: 226 }, { twk: 85.5 }]) {
    assert.equal(manualSkdScore({ twk: 85, tiu: 100, tkp: 185, ...invalid }), null);
  }
});

test("threshold checks are independent of total", () => {
  assert.deepEqual(belowManualSkdThreshold(manualSkdScore({ twk: 64, tiu: 175, tkp: 225 })), [
    "twk",
  ]);
  assert.deepEqual(belowManualSkdThreshold(manualSkdScore({ twk: 65, tiu: 80, tkp: 166 })), []);
});

test("higher rank compares total, TKP, TIU, then TWK", () => {
  const score = manualSkdScore({ twk: 85, tiu: 100, tkp: 185 });
  assert.equal(
    manualSkdAheadFilter(score),
    "total.gt.370,and(total.eq.370,tkp.gt.185),and(total.eq.370,tkp.eq.185,tiu.gt.100),and(total.eq.370,tkp.eq.185,tiu.eq.100,twk.gt.85)",
  );
});
