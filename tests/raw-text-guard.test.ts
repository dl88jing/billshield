import { test } from "node:test";
import assert from "node:assert/strict";

// Why this test exists: in @firebase/ai 3.1.0, getGenerativeModel() only creates the on-device
// adapter when `LanguageModel` exists. Without it, even InferenceMode.ONLY_ON_DEVICE is sent to
// the cloud. BillShield must therefore refuse to build a raw-text request unless Chrome reports
// the on-device model as "available". These cases assert no network request is made.
const calls: string[] = [];
globalThis.fetch = (async (u: unknown) => { calls.push(String(u)); throw new Error("network blocked in test"); }) as typeof fetch;
const g = globalThis as unknown as { self?: unknown; LanguageModel?: unknown };
g.self = globalThis;

const RAW = "Patient: Noah Abernathy    DOB: 04/22/1955    MRN: MV-0000038\nSpouse Ana can be reached at five five five, 0142.";

for (const avail of [null, "unavailable", "downloadable", "downloading"] as const) {
  test(`raw bill text never leaves the tab when on-device model is ${avail ?? "absent"}`, async () => {
    calls.length = 0;
    let prompted = false;
    g.LanguageModel = avail === null ? undefined : { availability: async () => avail, create: async () => ({ prompt: async () => { prompted = true; return "[]"; } }) };
    const { proposePiiOnDevice } = await import("../src/lib/hybrid");
    const r = await proposePiiOnDevice(RAW);
    assert.equal(r.source, "rules_only");
    assert.deepEqual(r.proposals, []);
    assert.equal(prompted, false);
    assert.deepEqual(calls, [], `unexpected network calls: ${calls.join(", ")}`);
  });
}
