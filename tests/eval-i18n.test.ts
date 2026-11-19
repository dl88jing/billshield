import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EVAL_UI, EVAL_MODE_KEYS, EVAL_MISS_KIND_KEYS, UI, formatEvalDate, type EvalStrings } from "../src/lib/ui-i18n";

const LANGS = ["en", "es", "ja"] as const;
const results = JSON.parse(readFileSync("public/eval/results.json", "utf8"));
const cloud = JSON.parse(readFileSync("public/eval/cloud.json", "utf8"));
// Sample arguments for every function-valued string on the /eval page.
const ARGS: Record<string, unknown[]> = {
  summary: [45, "rules-only (no model)", "Nov 14, 2026, 12:30 PM UTC", 812], mode: ["rules-only (no model)"], missesTitle: [7],
  missKind: ["PII leak (free-text, rules-only)"], factCheck: ["PASSED: 8 amounts, 6 codes all traced to findings"], historyLine: [4, 2, 6],
};
function flatten(s: EvalStrings): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (v: unknown, k: string) => {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "function") out[k] = String((v as (...a: unknown[]) => unknown)(...(ARGS[k] ?? [])));
    else if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v)) walk(vv, k ? `${k}.${kk}` : kk);
  };
  walk(s, "");
  return out;
}

test("/eval strings: same keys in EN, ES and JA, non-empty, every function renders", () => {
  assert.deepEqual(Object.keys(EVAL_UI), ["en", "es", "ja"]);
  const en = flatten(EVAL_UI.en);
  assert.ok(Object.keys(en).length >= 30, `only ${Object.keys(en).length} strings`);
  for (const l of LANGS) {
    const x = flatten(EVAL_UI[l]);
    assert.deepEqual(Object.keys(x).sort(), Object.keys(en).sort(), `${l} keys`);
    for (const [k, v] of Object.entries(x)) {
      assert.ok(v.trim().length > 0, `${l}.${k} empty`);
      assert.ok(!/undefined|NaN|\[object/.test(v), `${l}.${k} renders "${v}"`);
    }
  }
});

test("/eval ES and JA strings are actually translated (only FP/FN abbreviations may match English)", () => {
  const SAME_OK: Record<"es" | "ja", RegExp> = { es: /^(thFp|thFn)$/, ja: /^$/ };
  const en = flatten(EVAL_UI.en);
  for (const l of ["es", "ja"] as const) {
    const x = flatten(EVAL_UI[l]);
    const same = Object.keys(en).filter((k) => x[k] === en[k] && !SAME_OK[l].test(k));
    assert.deepEqual(same, [], `${l} untranslated: ${same.join(", ")}`);
  }
  for (const [k, v] of Object.entries(flatten(EVAL_UI.ja))) if (k !== "dateLocale") assert.match(v, /[\u3040-\u30ff\u4e00-\u9fff]/, `JA string has no Japanese: ${k}=${v}`);
});

test("/eval numbers pass through unchanged; npm run eval is never translated", () => {
  for (const l of LANGS) {
    const t = EVAL_UI[l];
    const s = t.summary(45, t.mode("rules-only (no model)"), "X", 812);
    assert.match(s, /45/); assert.match(s, /812 ms/);
    assert.match(t.missesTitle(7), /7/);
    const h = t.historyLine(4, 2, 6);
    for (const n of ["4", "2", "6"]) assert.ok(h.includes(n), `${l} historyLine missing ${n}: ${h}`);
    assert.match(t.cards.disputable, /\$/);
  }
  const view = readFileSync("src/app/eval/eval-view.tsx", "utf8");
  assert.match(view, /<code[^>]*>npm run eval<\/code>/);
  assert.match(view, /toLocaleString\("en-US"\)/); // $ amounts keep US separators in every UI language
});

test("every mode and miss kind in results.json has a translation; unknown labels are shown verbatim", () => {
  assert.ok(EVAL_MODE_KEYS.includes(results.mode), `missing mode: ${results.mode}`);
  for (const kind of new Set<string>(results.misses.map((m: { kind: string }) => m.kind))) assert.ok(EVAL_MISS_KIND_KEYS.includes(kind), `missing miss kind: ${kind}`);
  for (const l of ["es", "ja"] as const) {
    for (const k of EVAL_MODE_KEYS) assert.notEqual(EVAL_UI[l].mode(k), k);
    for (const k of EVAL_MISS_KIND_KEYS) assert.notEqual(EVAL_UI[l].missKind(k), k);
    assert.equal(EVAL_UI[l].mode("model-on (Gemini Nano)"), "model-on (Gemini Nano)");
    assert.equal(EVAL_UI[l].missKind("something new"), "something new");
  }
});

test("cloud fact-check verdicts are re-rendered with the same numbers via the main UI dictionary", () => {
  assert.ok(cloud.rows.length > 0);
  for (const row of cloud.rows) {
    const m = /^PASSED: (\d+) amounts, (\d+) codes/.exec(row.factCheck);
    for (const l of LANGS) {
      const out = EVAL_UI[l].factCheck(row.factCheck);
      if (m) assert.equal(out, UI[l].factPassed(Number(m[1]), Number(m[2])), `${l}: ${row.factCheck}`);
      if (l !== "en" && m) assert.notEqual(out, row.factCheck);
    }
  }
  assert.equal(EVAL_UI.en.factCheck("PASSED: 8 amounts, 6 codes all traced to findings"), "PASSED: 8 amounts, 6 codes all traced to findings");
  assert.match(EVAL_UI.ja.factCheck("REJECTED: unknown amount $9.99"), /\$9\.99/);
  assert.equal(EVAL_UI.es.factCheck("SKIPPED"), "SKIPPED");
});

test("eval dates render in UTC in every language (server and client agree); junk is shown verbatim", () => {
  const iso = "2026-11-14T12:30:06.783Z";
  assert.match(formatEvalDate(iso, "en"), /Nov 14, 2026.*12:30.*UTC$/);
  assert.match(formatEvalDate(iso, "es"), /14 nov 2026.*12:30.*UTC$/);
  assert.match(formatEvalDate(iso, "ja"), /2026\/11\/14 12:30 UTC$/);
  assert.equal(formatEvalDate("not a date", "ja"), "not a date");
});

test("the /eval view takes every label from the dictionary and uses the shared language switcher", () => {
  const view = readFileSync("src/app/eval/eval-view.tsx", "utf8");
  assert.match(view, /useUiLang\(\)/);
  assert.match(view, /<UiLangSwitch lang=\{lang\} onChange=\{setLang\} \/>/);
  for (const s of Object.values(flatten(EVAL_UI.en))) if (s !== "en-US") for (const lit of [`>${s}<`, `"${s}"`, `{"${s}"}`]) assert.ok(!view.includes(lit), `hard-coded English in eval-view.tsx: ${s}`);
  assert.doesNotMatch(view, />\s*[A-Z][a-z]+(?: [a-z]+){2,}/); // no English sentence typed straight into the JSX
  const home = readFileSync("src/app/page.tsx", "utf8");
  assert.match(home, /<UiLangSwitch lang=\{uiLang\} onChange=\{setUiLang\} \/>/);
});
