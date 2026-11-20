import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadHybrid, loadedHybrid, loadHybridWhenNeeded, hybridFallback, _resetLazyHybrid, LAZY_EVENTS, NOTE_MODULE_UNAVAILABLE, type Hybrid } from "../src/lib/lazy-hybrid";
import { UI } from "../src/lib/ui-i18n";

const fake = { marker: 1 } as unknown as Hybrid;

test("page.tsx does not import the Firebase SDK module statically (only types + the lazy loader)", () => {
  const src = readFileSync("src/app/page.tsx", "utf8");
  for (const line of src.split("\n").filter((l) => /from "@\/lib\/hybrid"/.test(l))) assert.match(line, /^import type /, line);
  assert.doesNotMatch(src, /from "firebase\//);
  const caps = readFileSync("src/lib/caps.ts", "utf8");
  assert.doesNotMatch(caps, /from "firebase/);
});

test("loadHybrid imports once, caches the module and retries after a failed import", async () => {
  _resetLazyHybrid();
  let calls = 0;
  await assert.rejects(loadHybrid(async () => { calls++; throw new Error("offline"); }));
  assert.equal(loadedHybrid(), null);
  const imp = async () => { calls++; return fake; };
  const [a, b] = await Promise.all([loadHybrid(imp), loadHybrid(imp)]);
  assert.equal(a, fake); assert.equal(b, fake); assert.equal(loadedHybrid(), fake);
  await loadHybrid(imp);
  assert.equal(calls, 2);
  _resetLazyHybrid();
});

test("loadHybridWhenNeeded fires on the first interaction only, and removes its listeners", async () => {
  _resetLazyHybrid();
  const t = new EventTarget();
  let loads = 0, imports = 0;
  loadHybridWhenNeeded(t, () => { loads++; }, 60_000, async () => { imports++; return fake; });
  t.dispatchEvent(new Event(LAZY_EVENTS[0]));
  t.dispatchEvent(new Event("keydown"));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(imports, 1); assert.equal(loads, 1);
  _resetLazyHybrid();
});

test("loadHybridWhenNeeded falls back to a timer; cleanup cancels it", async () => {
  _resetLazyHybrid();
  let loads = 0;
  loadHybridWhenNeeded(new EventTarget(), () => { loads++; }, 5, async () => fake);
  const cancel = loadHybridWhenNeeded(new EventTarget(), () => { loads += 100; }, 5, async () => fake);
  cancel();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(loads, 1);
  _resetLazyHybrid();
});

test("hybridFallback (chunk unreachable) is rules-only and sends nothing; its note is translated", async () => {
  const h = hybridFallback();
  const d = await h.proposePiiOnDevice("Avery Northbridge 555 010 1234");
  assert.equal(d.source, "rules_only"); assert.deepEqual(d.proposals, []);
  const l = await h.draftLetter("payload", () => "TEMPLATE");
  assert.equal(l.source, "template"); assert.equal(l.text, "TEMPLATE");
  assert.equal((await h.recordAggregate({ rules: {}, stakeBucket: "0", deviceSource: "rules_only", letterSource: "template", gatePass: true })).ok, false);
  assert.equal((await h.firebaseReady()).remoteConfig.outlierMultiple, 3);
  for (const lang of ["es", "ja"] as const) assert.notEqual(UI[lang].modelNote(NOTE_MODULE_UNAVAILABLE), NOTE_MODULE_UNAVAILABLE, lang);
});

test("a11y: bill textarea is labelled, eval tables have column headers, no low-contrast grey on the page background", () => {
  const page = readFileSync("src/app/page.tsx", "utf8");
  assert.match(page, /<textarea[^>]*aria-labelledby="bill-label"/);
  assert.match(page, /id="bill-label"/);
  const ev = readFileSync("src/app/eval/eval-view.tsx", "utf8");
  const tables = ev.match(/<table[\s\S]*?<\/table>/g) ?? [];
  assert.equal(tables.length, 3);
  for (const tb of tables) assert.match(tb, /<th scope="col"/);
  // text-neutral-500 (#737373) is 4.4:1 on the #f6f7f4 page background: below WCAG AA 4.5:1 (Lighthouse color-contrast)
  for (const f of ["src/app/page.tsx", "src/app/eval/eval-view.tsx", "src/components/ui-lang-switch.tsx"]) assert.doesNotMatch(readFileSync(f, "utf8"), /text-neutral-500/, f);
});
