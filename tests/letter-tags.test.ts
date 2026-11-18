import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBill, DEMO_SEEDS, EVAL_SEEDS } from "../src/lib/samples";
import { detectPii, redact, leakGate } from "../src/lib/pii";
import { parseBill, audit } from "../src/lib/audit";
import { buildPayload, templateLetter, checkLetter, letterPrompt, stripInternalTags, isInternalTag } from "../src/lib/letter";

const SEEDS = [...DEMO_SEEDS, ...EVAL_SEEDS];
const TAG = /[[［【〔]\s*(?:RULE|MATH|DUP|DUPLICATE|UNBUNDLE|TOTAL|DOUBLE_EM|POST_DISCHARGE|PRICE_OUTLIER)\b/i;

test("internal tags are recognized; placeholders and ordinary bracketed text are not", () => {
  for (const t of ["MATH", "DUP", "DUPLICATE", "RULE", "RULE: MATH", "RULE_MATH", "double-em", "Price Outlier", "POST_DISCHARGE", "UNBUNDLE", "TOTAL", "ＭＡＴＨ"]) assert.ok(isInternalTag(t), t);
  for (const t of ["NAME_1", "ACCOUNT_1", "DATE_1", "sic", "1", "CPT 85025", "MA", "Total disputed $10.00"]) assert.equal(isInternalTag(t), false, t);
});

test("stripInternalTags removes [MATH]/[RULE]/[DUP] etc. in EN, ES and JA and keeps placeholders verbatim", () => {
  const cases: Array<[string, string]> = [
    ["1. [MATH] Line 3 is billed $50.00.\n2. [DUP]: Line 4 repeats line 2.\nSincerely,\n[NAME_1]", "1. Line 3 is billed $50.00.\n2. Line 4 repeats line 2.\nSincerely,\n[NAME_1]"],
    ["Re: Account [ACCOUNT_1] [RULE] [DUPLICATE] - charge 85025", "Re: Account [ACCOUNT_1] charge 85025"],
    ["1. [DUPLICADO no] [UNBUNDLE] Cargo por 85025: $12.00. Atentamente, [NAME_1]", "1. [DUPLICADO no] Cargo por 85025: $12.00. Atentamente, [NAME_1]"],
    ["1. 【MATH】数量×単価が一致しません。対象金額：$50.00\n2. ［DOUBLE_EM］：同日の診察料 [NAME_1]", "1. 数量×単価が一致しません。対象金額：$50.00\n2. 同日の診察料 [NAME_1]"],
    ["[RULE: PRICE_OUTLIER] Unit price is high. [sic]", "Unit price is high. [sic]"],
  ];
  for (const [inp, want] of cases) assert.equal(stripInternalTags(inp).text, want, inp);
  assert.deepEqual(stripInternalTags("[MATH] a [NAME_1] [DUP] b").removed, ["MATH", "DUP"]);
  const clean = "No tags here.\n  1. Indented line kept as is  ";
  assert.equal(stripInternalTags(clean).text, clean, "letters without tags are returned unchanged");
});

test("a model letter that echoes every payload tag passes the fact check after stripping, in all three languages", () => {
  for (const s of SEEDS) {
    const b = makeBill(s);
    const red = redact(b.text, detectPii(b.text));
    const bill = parseBill(b.text);
    const f = audit(bill);
    if (!f.length) continue;
    const keys = Object.keys(red.vault);
    for (const lang of ["en", "es", "ja"] as const) {
      // worst case: the model copies the payload verbatim, rule tags included
      const echoed = buildPayload(f, keys, bill.provider, lang);
      assert.match(echoed, TAG, `${b.id}/${lang}: payload carries tags (test precondition)`);
      const out = stripInternalTags(echoed);
      assert.doesNotMatch(out.text, TAG, `${b.id}/${lang}`);
      assert.equal(out.removed.length, f.length, `${b.id}/${lang}: one tag per finding`);
      for (const k of keys.filter((k) => echoed.includes(k))) assert.ok(out.text.includes(k), `${b.id}/${lang}: ${k} kept`);
      assert.ok(checkLetter(out.text, f, keys).pass, `${b.id}/${lang}: ${checkLetter(out.text, f, keys).issues.join("; ")}`);
      assert.ok(leakGate(out.text, red.vault).pass, `${b.id}/${lang}`);
      // templates never contain tags, so stripping is a no-op on them
      const tpl = templateLetter(f, keys, bill.provider, lang);
      assert.equal(stripInternalTags(tpl).text, tpl, `${b.id}/${lang} template`);
    }
  }
});

test("the prompt instruction is kept alongside the post-processor", () => {
  for (const lang of ["en", "es", "ja"] as const) assert.match(letterPrompt("x", lang), /internal rule labels: do not copy them into the letter/);
});

test("page.tsx strips tags from model letters before the fact check, the identifier guard and display", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const strip = src.indexOf("stripInternalTags(l.text)");
  assert.ok(strip > 0, "post-processor is wired in");
  assert.ok(strip < src.indexOf("checkLetter(l.text"), "before fact check");
  assert.ok(strip < src.indexOf("leakGate(l.text"), "before identifier guard");
  assert.ok(strip < src.indexOf("rehydrate(l.text"), "before display");
});
