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
test("name capture stops before the DOB label", () => {
  const s = detectPii("Patient: Noah Abernathy    DOB: 04/22/1955    MRN: MV-0000038");
  assert.ok(s.some((x) => x.type === "NAME" && x.value === "Noah Abernathy"));
  assert.ok(!s.some((x) => x.value.includes("DOB") && x.type === "NAME"));
  const red = redact("Patient: Noah Abernathy    DOB: 04/22/1955", s).redacted;
  assert.ok(red.includes("DOB:"), red);
});
import { checkLetter } from "../src/lib/letter";
test("letter checker rejects invented amounts and codes", () => {
  const b = makeBill(3); const f = audit(parseBill(b.text));
  const good = `Dispute ${f[0].cpt ?? ""} for $${f[0].atStake.toFixed(2)}. [NAME_1]`;
  assert.ok(checkLetter(good, f, ["[NAME_1]"]).pass, JSON.stringify(checkLetter(good, f, ["[NAME_1]"])));
  const bad = `Refund $9,999.99 for 99999 to [NAME_7]`;
  assert.equal(checkLetter(bad, f, ["[NAME_1]"]).issues.length, 3);
});
test("letter checker accepts whole-dollar amounts quoted from findings", () => {
  const f = [{ rule: "PRICE_OUTLIER", lines: [1], cpt: "J1885", atStake: 80, severity: "advisory", title: "Price outlier: J1885", detail: "$125.00 per unit is over 3× a typical $15 charge" }] as never;
  assert.ok(checkLetter("Typical is $15.00; billed $125.00, $80.00 over. J1885", f, []).pass);
});
