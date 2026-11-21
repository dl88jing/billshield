import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { routingTrace, TRACE_TEXT, NANO_DETAIL_REASONS, type TraceInput, type TraceReason } from "../src/lib/route-trace";

const NO_NANO = "unavailable (needs desktop Chrome 139+ with Gemini Nano)";
const base: TraceInput = {
  nano: NO_NANO, firebase: true, sdk: true, offline: false,
  device: { source: "rules_only" }, gate: { pass: true, bytes: 540, leaks: 0 },
};
const row = (t: ReturnType<typeof routingTrace>, s: string) => t.rows.find((r) => r.step === s)!;

test("no Gemini Nano (headless / non-Chrome): scrub stays local, letter falls back to cloud, only redacted bytes leave", () => {
  const t = routingTrace({ ...base, letter: { drafted: "in_cloud", final: "in_cloud", model: "gemini-3.5-flash-lite" } });
  assert.deepEqual(t.rows.map((r) => r.step), ["scrub", "gate", "letter", "check"]);
  assert.equal(row(t, "scrub").mode, "ONLY_ON_DEVICE");
  assert.equal(row(t, "scrub").path, "local"); assert.equal(row(t, "scrub").reason, "no_nano"); assert.equal(row(t, "scrub").detail, NO_NANO);
  assert.equal(row(t, "letter").mode, "PREFER_ON_DEVICE");
  assert.equal(row(t, "letter").path, "in_cloud"); assert.equal(row(t, "letter").reason, "letter_cloud"); assert.equal(row(t, "letter").model, "gemini-3.5-flash-lite");
  assert.equal(row(t, "check").reason, "check_pass");
  assert.equal(t.rawBytesOut, 0); assert.equal(t.redactedBytesOut, 540);
  assert.equal(row(t, "letter").bytesOut, 540);
});

test("Gemini Nano available: both model steps on-device, 0 bytes leave the device", () => {
  const t = routingTrace({ ...base, nano: "available", device: { source: "on_device" }, letter: { drafted: "on_device", final: "on_device", model: "Gemini Nano (on-device)" } });
  assert.equal(row(t, "scrub").path, "on_device"); assert.equal(row(t, "scrub").reason, "nano_ready");
  assert.equal(row(t, "letter").path, "on_device"); assert.equal(row(t, "letter").reason, "letter_nano");
  assert.equal(t.redactedBytesOut, 0);
  assert.ok(t.rows.every((r) => r.bytesOut === 0));
});

test("leak gate blocks: no model step runs and nothing is sent", () => {
  const t = routingTrace({ ...base, gate: { pass: false, bytes: 600, leaks: 2 } });
  assert.equal(row(t, "gate").reason, "gate_blocked"); assert.equal(row(t, "gate").detail, "2");
  assert.equal(row(t, "letter").path, "skipped"); assert.equal(row(t, "letter").reason, "letter_gate_blocked");
  assert.equal(row(t, "check").reason, "check_na");
  assert.equal(t.redactedBytesOut, 0);
});

test("offline, unconfigured Firebase, unreachable SDK chunk: template letter and 0 bytes out, each with its own reason", () => {
  const tpl = { drafted: "template" as const, final: "template" as const };
  const off = routingTrace({ ...base, offline: true, letter: tpl });
  assert.equal(row(off, "letter").reason, "letter_offline"); assert.equal(off.redactedBytesOut, 0);
  const nofb = routingTrace({ ...base, firebase: false, letter: tpl });
  assert.equal(row(nofb, "letter").reason, "letter_no_firebase"); assert.equal(nofb.redactedBytesOut, 0);
  const nosdk = routingTrace({ ...base, sdk: false, letter: tpl });
  assert.equal(row(nosdk, "scrub").reason, "sdk_unreachable"); assert.equal(row(nosdk, "letter").reason, "letter_sdk_unreachable");
  assert.equal(nosdk.redactedBytesOut, 0);
  for (const t of [off, nofb, nosdk]) { assert.equal(row(t, "letter").path, "template"); assert.equal(row(t, "check").reason, "check_na"); }
});

test("cloud call failed: template used, and the attempted redacted bytes are still reported (not hidden as 0)", () => {
  const t = routingTrace({ ...base, letter: { drafted: "template", final: "template", error: "503 UNAVAILABLE" } });
  assert.equal(row(t, "letter").reason, "letter_error"); assert.equal(row(t, "letter").detail, "503 UNAVAILABLE");
  assert.equal(t.redactedBytesOut, 540);
});

test("model letter rejected by the fact checker or the identifier guard is shown as replaced by the template", () => {
  const fc = routingTrace({ ...base, letter: { drafted: "in_cloud", final: "template", rejected: "fact_check" } });
  assert.equal(row(fc, "check").reason, "check_fact_rejected"); assert.equal(row(fc, "check").path, "template");
  assert.equal(fc.redactedBytesOut, 540); // the cloud did see the redacted payload
  const id = routingTrace({ ...base, letter: { drafted: "in_cloud", final: "template", rejected: "identifier" } });
  assert.equal(row(id, "check").reason, "check_identifier_rejected");
});

test("on-device scrub errors and the direct Prompt API path are reported with their reason", () => {
  const err = routingTrace({ ...base, nano: "available", device: { source: "rules_only", error: "session crashed" }, letter: { drafted: "on_device", final: "on_device" } });
  assert.equal(row(err, "scrub").reason, "nano_failed"); assert.equal(row(err, "scrub").detail, "session crashed");
  const direct = routingTrace({ ...base, firebase: false, nano: "available", device: { source: "chrome_prompt_api" }, letter: { drafted: "template", final: "template" } });
  assert.equal(row(direct, "scrub").reason, "prompt_api_direct"); assert.equal(row(direct, "scrub").path, "on_device");
});

test("raw bill bytes out is 0 in every branch (the scrub has no cloud path)", () => {
  for (const device of [{ source: "on_device" as const }, { source: "rules_only" as const }, { source: "rules_only" as const, error: "x" }, { source: "chrome_prompt_api" as const }])
    for (const pass of [true, false]) {
      const t = routingTrace({ ...base, device, gate: { pass, bytes: 100, leaks: pass ? 0 : 1 }, letter: pass ? { drafted: "in_cloud", final: "in_cloud" } : undefined });
      assert.equal(t.rawBytesOut, 0); assert.equal(row(t, "scrub").bytesOut, 0); assert.notEqual(row(t, "scrub").path, "in_cloud");
    }
});

test("every reason, step and path has EN/ES/JA text; numbers, model names and mode names pass through", () => {
  const reasons = Object.keys(TRACE_TEXT.en.reason) as TraceReason[];
  assert.equal(reasons.length, 18);
  for (const l of ["en", "es", "ja"] as const) {
    const tt = TRACE_TEXT[l];
    assert.deepEqual(Object.keys(tt.reason).sort(), [...reasons].sort());
    for (const r of reasons) assert.ok(tt.reason[r]("7", "gemini-3.5-flash-lite").length > 10, `${l} ${r}`);
    assert.match(tt.reason.gate_pass("540", ""), /540/);
    assert.match(tt.reason.letter_cloud("x", "gemini-3.5-flash-lite"), /gemini-3\.5-flash-lite/);
    assert.match(tt.reason.no_nano("", ""), /ONLY_ON_DEVICE/);
    assert.match(tt.summary(0, 540), /0[^\d].*540/);
    if (l !== "en") {
      for (const r of reasons) assert.notEqual(tt.reason[r]("7", "m"), TRACE_TEXT.en.reason[r]("7", "m"), `${l} untranslated ${r}`);
      assert.notEqual(tt.title, TRACE_TEXT.en.title);
    }
  }
  for (const v of [...Object.values(TRACE_TEXT.ja.step), ...Object.values(TRACE_TEXT.ja.path), TRACE_TEXT.ja.title]) assert.match(v, /[\u3040-\u30ff\u4e00-\u9fff]/, v);
  assert.deepEqual([...NANO_DETAIL_REASONS].sort(), ["letter_cloud", "no_nano"]);
});

test("page wires the trace from the run (sources recorded before validation, SDK fallback flagged) and the module has no I/O", () => {
  const page = readFileSync("src/app/page.tsx", "utf8");
  assert.match(page, /const drafted = l\.source;/);
  assert.match(page, /sdk = false; return hybridFallback\(\);/);
  assert.match(page, /data-testid="route-trace"/);
  assert.equal((page.match(/setTrace\(routingTrace\(/g) ?? []).length, 2); // gate-blocked path and normal path
  const mod = readFileSync("src/lib/route-trace.ts", "utf8");
  assert.doesNotMatch(mod, /fetch\(|localStorage|XMLHttpRequest|sendBeacon|from "firebase/);
  assert.doesNotMatch(mod, /^import (?!type )/m); // type-only imports
});
