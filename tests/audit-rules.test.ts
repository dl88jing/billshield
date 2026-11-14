import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBill, audit, totalAtStake, type RuleId } from "../src/lib/audit";
import { makeBill, EVAL_SEEDS } from "../src/lib/samples";
import { detectPii, redact, leakGate } from "../src/lib/pii";

test("every planted error across all seeds is found (recall)", () => {
  for (const s of EVAL_SEEDS) {
    const b = makeBill(s); const f = audit(parseBill(b.text));
    for (const e of b.truth.errors) assert.ok(f.some((x) => x.rule === e.rule), `${b.id} missed ${e.rule}`);
  }
});
test("no non-advisory finding on a bill with no planted errors (precision)", () => {
  const clean = EVAL_SEEDS.map(makeBill).filter((b) => b.truth.errors.length === 0);
  assert.ok(clean.length > 0);
  for (const b of clean) {
    const bad = audit(parseBill(b.text)).filter((x) => x.severity !== "advisory");
    assert.equal(bad.length, 0, `${b.id}: ${bad.map((x) => x.rule).join(",")}`);
  }
});
test("audit is deterministic", () => {
  const b = makeBill(3);
  assert.deepEqual(audit(parseBill(b.text)), audit(parseBill(b.text)));
});
test("findings only use known rule ids and non-negative dollars", () => {
  const ok: RuleId[] = ["DUPLICATE", "MATH", "TOTAL", "UNBUNDLE", "POST_DISCHARGE", "PRICE_OUTLIER", "DOUBLE_EM"];
  for (const s of EVAL_SEEDS.slice(0, 15)) {
    const f = audit(parseBill(makeBill(s).text));
    for (const x of f) { assert.ok(ok.includes(x.rule)); assert.ok(x.atStake >= 0); }
    assert.ok(totalAtStake(f) >= 0);
  }
});
test("end to end: outbound payload built from redacted text never leaks any identifier", () => {
  for (const s of EVAL_SEEDS) {
    const b = makeBill(s); const red = redact(b.text, detectPii(b.text));
    assert.ok(leakGate(red.redacted, red.vault).pass, b.id);
  }
});
