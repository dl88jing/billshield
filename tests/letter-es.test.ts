import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBill, DEMO_SEEDS, EVAL_SEEDS } from "../src/lib/samples";
import { detectPii, redact, leakGate, rehydrate } from "../src/lib/pii";
import { parseBill, audit, totalAtStake } from "../src/lib/audit";
import { buildPayload, templateLetter, checkLetter, letterPrompt } from "../src/lib/letter";

function pipeline(seed: number) {
  const b = makeBill(seed);
  const red = redact(b.text, detectPii(b.text));
  const f = audit(parseBill(b.text));
  const keys = Object.keys(red.vault);
  return { b, red, f, keys, payload: buildPayload(f, keys, parseBill(b.text).provider) };
}

test("Spanish prompt: same redacted payload, asks for Spanish, keeps $ and US number format; English prompt unchanged", () => {
  const { payload, red } = pipeline(DEMO_SEEDS[0]);
  const es = letterPrompt(payload, "es"), en = letterPrompt(payload, "en");
  assert.ok(es.includes(payload) && en.includes(payload));
  assert.match(es, /in Spanish/); assert.match(es, /\$1,234\.56/);
  assert.doesNotMatch(en, /Spanish/);
  assert.equal(letterPrompt(payload), en);
  assert.ok(leakGate(es, red.vault).pass, "the Spanish prompt carries no identifiers");
});

test("Spanish template letter passes the fact checker and the leak gate, then re-inserts the real name on-device", () => {
  for (const s of [...DEMO_SEEDS, ...EVAL_SEEDS.slice(0, 10)]) {
    const { b, red, f, keys } = pipeline(s);
    const letter = templateLetter(f, keys, parseBill(b.text).provider, "es");
    assert.match(letter, /Le escribo para disputar/);
    assert.match(letter, /Atentamente/);
    assert.ok(letter.includes(`$${totalAtStake(f).toFixed(2)}`));
    const lc = checkLetter(letter, f, keys);
    assert.ok(lc.pass, `${b.id}: ${lc.issues.join("; ")}`);
    assert.ok(leakGate(letter, red.vault).pass, b.id);
    const final = rehydrate(letter, red.vault);
    assert.doesNotMatch(final, /\[NAME_\d+\]/, b.id);
    const name = red.vault[keys.find((k) => k.startsWith("[NAME_"))!];
    assert.ok(final.includes(name), `${b.id}: real name re-inserted locally`);
  }
});

test("fact checker still guards Spanish model output: invented amounts, European number format and unknown placeholders are rejected", () => {
  const { f, keys } = pipeline(DEMO_SEEDS[0]);
  const real = f.find((x) => x.atStake > 0)!;
  const good = `Estimados señores: disputo el cargo ${real.cpt ?? ""} por $${real.atStake.toFixed(2)}. Atentamente, ${keys.find((k) => k.startsWith("[NAME_"))}`;
  assert.ok(checkLetter(good, f, keys).pass, JSON.stringify(checkLetter(good, f, keys)));
  const bad = `Le solicito un reembolso de $9.999,99 por el código 99999. Atentamente, [NOMBRE_1]`;
  const r = checkLetter(bad, f, keys);
  assert.equal(r.pass, false);
  assert.ok(r.issues.some((i) => i.includes("99999")));
  assert.ok(r.issues.some((i) => i.includes("[NOMBRE_1]")));
});

test("English template letter is unchanged by the language option", () => {
  const { b, f, keys } = pipeline(DEMO_SEEDS[0]);
  const p = parseBill(b.text).provider;
  assert.equal(templateLetter(f, keys, p), templateLetter(f, keys, p, "en"));
  assert.match(templateLetter(f, keys, p), /^To the Billing Office/);
});
