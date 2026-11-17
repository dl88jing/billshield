import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBill, DEMO_SEEDS, EVAL_SEEDS } from "../src/lib/samples";
import { detectPii, redact, leakGate, rehydrate } from "../src/lib/pii";
import { parseBill, audit, totalAtStake, type Finding } from "../src/lib/audit";
import { buildPayload, templateLetter, checkLetter, letterPrompt, LETTER_LANGS } from "../src/lib/letter";
import { localizedFinding, localDate } from "../src/lib/i18n";

const SEEDS = [...DEMO_SEEDS, ...EVAL_SEEDS];
function pipeline(seed: number) {
  const b = makeBill(seed);
  const red = redact(b.text, detectPii(b.text));
  const bill = parseBill(b.text);
  const f = audit(bill);
  return { b, red, f, keys: Object.keys(red.vault), provider: bill.provider };
}
const amounts = (s: string) => [...s.matchAll(/\$([\d,]+(?:\.\d{2})?)/g)].map((m) => Number(m[1].replace(/,/g, "")).toFixed(2)).sort();
const codes = (s: string) => [...s.matchAll(/\b(\d{5}|[A-Z]\d{4})\b/g)].map((m) => m[1]).sort();
// English phrases that appear in the audit engine's English finding text.
const ENGLISH = /\b(billed|after discharge|Lines add to|per unit|typical|is a component of|the same day|usually only|Amount in question|Total disputed|Patient:|Account:)\b/;

test("languages offered: English, Español, 日本語", () => {
  assert.deepEqual(Object.keys(LETTER_LANGS), ["en", "es", "ja"]);
});

test("every rule the audit fires on the 45 sample bills has a structured, localized detail in ES and JA", () => {
  const rulesSeen = new Set<string>();
  for (const s of SEEDS) for (const f of pipeline(s).f) {
    rulesSeen.add(f.rule);
    assert.ok(f.facts, `${f.rule} has facts`);
    for (const lang of ["es", "ja"] as const) {
      const t = localizedFinding(f, lang);
      assert.notEqual(t.detail, f.detail, `${f.rule} ${lang} is localized, not the English fallback`);
      assert.deepEqual(amounts(t.detail), amounts(f.detail), `${f.rule} ${lang}: same dollar amounts as the English detail`);
      for (const c of codes(f.detail)) assert.ok((t.title + t.detail).includes(c), `${f.rule} ${lang}: keeps code ${c}`);
    }
  }
  assert.ok(rulesSeen.size >= 6, `samples exercise ${[...rulesSeen].join(",")}`);
});

test("ES/JA payloads carry no English finding text, the same amounts and codes as English, and no identifiers", () => {
  for (const s of SEEDS) {
    const { b, red, f, keys, provider } = pipeline(s);
    const en = buildPayload(f, keys, provider, "en");
    assert.equal(buildPayload(f, keys, provider), en, "English payload unchanged by default");
    for (const lang of ["es", "ja"] as const) {
      const p = buildPayload(f, keys, provider, lang).replace(provider ?? "", "");
      assert.doesNotMatch(p, ENGLISH, `${b.id} ${lang}: ${p.match(ENGLISH)?.[0]}`);
      assert.deepEqual(amounts(p), amounts(en.replace(provider ?? "", "")), `${b.id} ${lang}: amounts`);
      assert.ok(leakGate(buildPayload(f, keys, provider, lang), red.vault).pass, `${b.id} ${lang}: leak gate`);
    }
  }
});

test("Japanese prompt: same redacted payload, asks for Japanese, half-width $ in US format; passes the leak gate", () => {
  const { red, f, keys, provider } = pipeline(DEMO_SEEDS[0]);
  const payload = buildPayload(f, keys, provider, "ja");
  const ja = letterPrompt(payload, "ja");
  assert.ok(ja.includes(payload));
  assert.match(ja, /in Japanese/); assert.match(ja, /\$1,234\.56/); assert.match(ja, /half-width/);
  assert.doesNotMatch(letterPrompt(payload, "es"), /Japanese/);
  assert.ok(leakGate(ja, red.vault).pass);
});

test("Japanese template letter passes the fact checker and the leak gate, then re-inserts the real name on-device", () => {
  for (const s of SEEDS) {
    const { b, red, f, keys, provider } = pipeline(s);
    const letter = templateLetter(f, keys, provider, "ja");
    assert.match(letter, /拝啓/); assert.match(letter, /敬具/); assert.match(letter, /御中/);
    assert.ok(letter.includes(`$${totalAtStake(f).toFixed(2)}`));
    const lc = checkLetter(letter, f, keys);
    assert.ok(lc.pass, `${b.id}: ${lc.issues.join("; ")}`);
    assert.equal(lc.amountsChecked, amounts(letter).length);
    assert.ok(leakGate(letter, red.vault).pass, b.id);
    const final = rehydrate(letter, red.vault);
    assert.doesNotMatch(final, /\[(NAME|ACCOUNT)_\d+\]/, b.id);
    assert.ok(final.includes(red.vault[keys.find((k) => k.startsWith("[NAME_"))!]), `${b.id}: real name re-inserted locally`);
  }
});

test("Spanish template letter now quotes localized finding details (no English) and still passes every check", () => {
  for (const s of SEEDS) {
    const { b, red, f, keys, provider } = pipeline(s);
    const letter = templateLetter(f, keys, provider, "es");
    assert.doesNotMatch(letter.replace(provider ?? "", ""), ENGLISH, `${b.id}: ${letter.match(ENGLISH)?.[0]}`);
    assert.ok(checkLetter(letter, f, keys).pass, b.id);
    assert.ok(leakGate(letter, red.vault).pass, b.id);
  }
});

test("fact checker: full-width ＄ is normalized; money not written as $ US format (ドル, dólares, 1.234,56 $) is rejected", () => {
  const { f, keys } = pipeline(DEMO_SEEDS[0]);
  const real = f.find((x) => x.atStake > 0)! as Finding;
  const name = keys.find((k) => k.startsWith("[NAME_"))!;
  const fw = `$${real.atStake.toFixed(2)}`.replace(/[$0-9.,]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
  assert.ok(checkLetter(`請求額${fw}について異議を申し立てます。${name}`, f, keys).pass, "full-width real amount is accepted");
  assert.equal(checkLetter(`請求額＄９，９９９．００について。${name}`, f, keys).pass, false, "full-width invented amount is caught");
  for (const bad of [`${real.atStake.toFixed(2)}ドルの返金を求めます。`, `un reembolso de 1.234,56 $`, `un total de 120 dólares`, `USD 75.00`]) {
    const r = checkLetter(bad, f, keys);
    assert.equal(r.pass, false, bad);
    assert.ok(r.issues.some((i) => i.includes("US format")), `${bad}: ${r.issues.join("; ")}`);
  }
});

test("localized amounts use US thousands separators; prompt tells the model not to copy internal rule tags", () => {
  const f = { rule: "TOTAL", lines: [], atStake: 160.23, severity: "high", title: "Subtotal does not match line items", detail: "Lines add to $2321.00 but the bill states $2481.23.", facts: { sum: 2321, subtotal: 2481.23 } } as Finding;
  assert.match(localizedFinding(f, "ja").detail, /\$2,321\.00.*\$2,481\.23/);
  assert.match(localizedFinding(f, "es").detail, /\$2,321\.00.*\$2,481\.23/);
  assert.ok(checkLetter(`明細の合計は$2,321.00、小計は$2,481.23です。`, [f], []).pass);
  for (const lang of ["en", "es", "ja"] as const) assert.match(letterPrompt("x", lang), /do not copy them into the letter/);
});

test("localDate spells out US statement dates unambiguously", () => {
  assert.equal(localDate("03/04/2026", "es"), "4 de marzo de 2026");
  assert.equal(localDate("03/04/2026", "ja"), "2026年3月4日");
  assert.equal(localDate("n/a", "ja"), "n/a");
});
