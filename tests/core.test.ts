import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPii, redact, leakGate, rehydrate, luhn, acceptModelProposals } from "../src/lib/pii";
import { parseBill, audit } from "../src/lib/audit";
import { makeBill, EVAL_SEEDS } from "../src/lib/samples";

test("luhn", () => { assert.ok(luhn("4111 1111 1111 1111")); assert.ok(!luhn("4111 1111 1111 1112")); });
test("redaction removes all labeled PII and gate passes", () => {
  for (const s of EVAL_SEEDS.slice(0, 10)) {
    const b = makeBill(s); const red = redact(b.text, detectPii(b.text));
    for (const p of b.truth.pii) assert.ok(!red.redacted.includes(p), `${b.id} leaked ${p}`);
    assert.ok(leakGate(red.redacted, red.vault).pass, b.id);
    assert.equal(rehydrate(red.redacted, red.vault).length > 0, true);
  }
});
test("gate blocks a leaked SSN", () => { assert.equal(leakGate("note 123-45-6789", {}).pass, false); });
test("model proposals only accepted when present verbatim", () => {
  assert.equal(acceptModelProposals("Spouse Ana called", ["Ana", "Bob Hallucinated"]).length, 1);
});
test("parser reads every line item and audit finds planted errors", () => {
  const b = makeBill(3); const p = parseBill(b.text); assert.ok(p.items.length >= 5);
  const f = audit(p); for (const e of b.truth.errors) assert.ok(f.some((x) => x.rule === e.rule), `${b.id} missed ${e.rule}`);
});
