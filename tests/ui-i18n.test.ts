import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { UI, UI_LANGS, MODEL_NOTE_KEYS, resolveUiLang, isLang, type UiStrings } from "../src/lib/ui-i18n";
import { LETTER_LANGS, buildPayload } from "../src/lib/letter";
import { makeBill, DEMO_SEEDS } from "../src/lib/samples";
import { detectPii, redact, leakGate } from "../src/lib/pii";
import { parseBill, audit } from "../src/lib/audit";

const LANGS = ["en", "es", "ja"] as const;
// Sample arguments for every function-valued string, so each one can be rendered in every language.
const ARGS: Record<string, unknown[]> = {
  fbConnected: ["demo-project"], appCheck: ["reCAPTCHA Enterprise"], onDeviceValue: ["available"], downloadingNano: [42], sample: [2],
  extraProposed: [3], gatePass: [712], gateBlocked: [2], findingsCount: [4, 1], billLine: ["3, 4"], redactorTitle: [9],
  appCheckOk: ["reCAPTCHA Enterprise"], appCheckNo: ["reCAPTCHA Enterprise", "timeout"], factPassed: [7, 2], factRejected: ["unknown amount $9.99"],
  statsNot: ["offline"], noteRejected: ["unknown amount $9.99"], modelNote: ["On-device model failed, so rules-only scrub used"],
};
function flatten(s: UiStrings): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (v: unknown, k: string) => {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "function") out[k] = String((v as (...a: unknown[]) => unknown)(...(ARGS[k.split(".")[0]] ?? [])));
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${k}.${i}`));
    else if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v)) walk(vv, k ? `${k}.${kk}` : kk);
  };
  walk(s, "");
  return out;
}

test("UI languages match the letter languages: English, Español, 日本語", () => {
  assert.deepEqual(Object.keys(UI_LANGS), Object.keys(LETTER_LANGS));
  assert.deepEqual(Object.keys(UI), ["en", "es", "ja"]);
});

test("every UI string exists, is non-empty and renders in ES and JA (same keys as EN; functions get every argument)", () => {
  const en = flatten(UI.en);
  assert.ok(Object.keys(en).length > 80, `only ${Object.keys(en).length} strings`);
  for (const l of ["es", "ja"] as const) {
    const x = flatten(UI[l]);
    assert.deepEqual(Object.keys(x).sort(), Object.keys(en).sort(), `${l} keys`);
    for (const [k, v] of Object.entries(x)) {
      assert.ok(v.trim().length > 0, `${l}.${k} empty`);
      assert.ok(!/undefined|NaN|\[object/.test(v), `${l}.${k} renders "${v}"`);
    }
  }
});

test("ES and JA strings are actually translated (only product names, codes and brand lines may match English)", () => {
  const SAME_OK = /^(fbLabel|appCheck|appCheckRow|viaRemoteConfig|steps\.device\.sub|onDeviceValue)$/;
  const en = flatten(UI.en);
  for (const l of ["es", "ja"] as const) {
    const x = flatten(UI[l]);
    const same = Object.keys(en).filter((k) => x[k] === en[k] && !SAME_OK.test(k));
    assert.deepEqual(same, [], `${l} untranslated: ${same.join(", ")}`);
  }
  for (const v of Object.values(flatten(UI.ja))) if (v.length > 12 && !/^(Firebase|Chrome|App Check|Gemini|\s?\(|（)/.test(v)) assert.match(v, /[\u3040-\u30ff\u4e00-\u9fff]/, `JA string has no Japanese: ${v}`);
});

test("numbers, byte counts, $ amounts and provider names pass through unchanged in every language", () => {
  for (const l of LANGS) {
    const t = UI[l];
    assert.match(t.gatePass(712), /712/); assert.match(t.gateBlocked(2), /2/);
    assert.match(t.factPassed(7, 2), /7[^\d].*2|2[^\d].*7/);
    assert.match(t.factRejected("unknown amount $9.99"), /\$9\.99/);
    assert.match(t.appCheckOk("reCAPTCHA Enterprise"), /reCAPTCHA Enterprise/);
    assert.match(t.fbConnected("demo-project"), /demo-project/);
    assert.match(t.downloadingNano(42), /42%/);
    assert.match(t.steps.device.sub, /ONLY_ON_DEVICE/); // the inference mode name is never translated
  }
  assert.match(UI.ja.onDeviceValue("unavailable (needs desktop Chrome 139+ with Gemini Nano)"), /利用不可/);
  assert.equal(UI.es.onDeviceValue("downloadable"), "descargable");
  assert.equal(UI.es.onDeviceValue("something-new"), "something-new"); // unknown states shown verbatim, never hidden
});

test("language resolution: saved choice > navigator.languages > English; junk in storage is ignored", () => {
  assert.equal(resolveUiLang(null, ["ja-JP", "en-US"]), "ja");
  assert.equal(resolveUiLang(null, ["es-MX"]), "es");
  assert.equal(resolveUiLang(null, ["es_419"]), "es");
  assert.equal(resolveUiLang(null, ["fr-FR", "de"]), "en");
  assert.equal(resolveUiLang(null, ["fr-FR", "ES"]), "es");
  assert.equal(resolveUiLang(undefined, undefined), "en");
  assert.equal(resolveUiLang("ja", ["es-ES"]), "ja");
  assert.equal(resolveUiLang("en", ["ja"]), "en");
  for (const junk of ["", "JA", "ja-JP", "<script>", "{\"lang\":\"ja\"}", "zh"]) assert.equal(resolveUiLang(junk, ["es"]), "es", junk);
  assert.ok(isLang("ja") && !isLang("jp") && !isLang(undefined));
});

test("UI language cannot change what leaves the device: the outbound payload depends only on the letter language", () => {
  for (const seed of DEMO_SEEDS) {
    const b = makeBill(seed);
    const red = redact(b.text, detectPii(b.text));
    const bill = parseBill(b.text);
    const f = audit(bill);
    for (const letterLang of LANGS) {
      const p = buildPayload(f, Object.keys(red.vault), bill.provider, letterLang);
      assert.ok(leakGate(p, red.vault).pass, `seed ${seed} ${letterLang}`);
    }
  }
  // Structural guards on the source: the UI dictionary has no I/O, the hook stores only a validated code,
  // and the page builds the payload from the letter language variable, not the UI language.
  const dict = readFileSync("src/lib/ui-i18n.ts", "utf8");
  assert.doesNotMatch(dict, /fetch\(|localStorage|XMLHttpRequest|sendBeacon|firebase\//);
  const hook = readFileSync("src/lib/use-ui-lang.ts", "utf8");
  assert.match(hook, /if \(!isLang\(l\)\) return;/);
  assert.equal((hook.match(/localStorage\.setItem\(/g) ?? []).length, 1);
  const page = readFileSync("src/app/page.tsx", "utf8");
  assert.match(page, /buildPayload\(f, Object\.keys\(red\.vault\), bill\.provider, lang\)/);
  assert.doesNotMatch(page, /buildPayload\([^)]*uiLang/);
  assert.doesNotMatch(page, /draftLetter\([^;]*uiLang/);
});

test("every diagnostic note hybrid.ts can show is translated; unknown notes are shown verbatim", () => {
  const src = readFileSync("src/lib/hybrid.ts", "utf8");
  const notes = [...src.matchAll(/note: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(notes.length >= 5);
  for (const n of notes) {
    assert.ok(MODEL_NOTE_KEYS.includes(n), `missing translation: ${n}`);
    for (const l of ["es", "ja"] as const) assert.notEqual(UI[l].modelNote(n), n, `${l}: ${n}`);
  }
  assert.equal(UI.en.modelNote("On-device model failed, so rules-only scrub used"), "On-device model failed, so rules-only scrub used");
  assert.equal(UI.ja.modelNote("some new diagnostic"), "some new diagnostic");
});
