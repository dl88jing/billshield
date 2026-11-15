import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGGREGATE_FIELDS, buildAggregate, stakeBucket } from "../src/lib/stats";
import { parseBill, audit } from "../src/lib/audit";
import { makeBill, EVAL_SEEDS } from "../src/lib/samples";
import { detectPii } from "../src/lib/pii";

const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const allowed = JSON.parse((rules.match(/hasOnly\((\[[^\]]*\])\)/)?.[1] ?? "[]").replace(/'/g, '"')) as string[];

test("aggregate record fields match the firestore.rules allow-list", () => {
  assert.ok(allowed.length > 0, "hasOnly() list not found in firestore.rules");
  for (const k of AGGREGATE_FIELDS) assert.ok(allowed.includes(k), `${k} not allowed by firestore.rules`);
  const rec = buildAggregate(audit(parseBill(makeBill(3).text)), "rules_only", "in_cloud");
  assert.deepEqual(Object.keys(rec).sort(), [...AGGREGATE_FIELDS].sort());
  for (const k of [...Object.keys(rec), "v", "at"]) assert.ok(allowed.includes(k), `${k} would be rejected`);
});

test("aggregate record satisfies the rule constraints and carries no identifiers or exact amounts", () => {
  for (const s of EVAL_SEEDS) {
    const b = makeBill(s); const f = audit(parseBill(b.text));
    const rec = buildAggregate(f, "rules_only", "template");
    assert.ok(Object.keys(rec.rules).length <= 10);
    assert.ok(rec.stakeBucket.length < 16);
    assert.equal(typeof rec.gatePass, "boolean");
    const json = JSON.stringify(rec);
    for (const p of detectPii(b.text)) assert.ok(!json.includes(p.value), `${b.id} aggregate contains identifier ${p.value}`);
    assert.ok(!/\d+\.\d{2}/.test(json), `${b.id} aggregate contains an exact dollar amount: ${json}`);
  }
});

test("stake buckets", () => {
  assert.equal(stakeBucket(0), "0"); assert.equal(stakeBucket(249.99), "<250");
  assert.equal(stakeBucket(250), "250-1k"); assert.equal(stakeBucket(1000), ">=1k");
});
