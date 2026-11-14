// Deterministic PII detector, redactor and leak gate.
// The on-device model may PROPOSE extra PII strings; only this code applies redactions
// and decides whether anything is allowed to leave the device.

export type PiiType =
  | "NAME" | "SSN" | "DOB" | "PHONE" | "EMAIL" | "MRN" | "MEMBER_ID"
  | "ACCOUNT" | "ADDRESS" | "CARD" | "MODEL_FLAGGED";

export interface PiiSpan { type: PiiType; value: string; start: number; end: number; source: "rules" | "model"; }

const LABELED: Array<[PiiType, RegExp]> = [
  ["NAME", /(?:Patient|Guarantor|Patient Name|Emergency Contact|Responsible Party)\s*:\s*([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]*){1,3})/g],
  ["DOB", /(?:DOB|Date of Birth|Birth Date)\s*:\s*([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/gi],
  ["MRN", /(?:MRN|Medical Record(?: No\.?| Number)?)\s*[:#]?\s*([A-Z]{0,4}-?[0-9]{5,10})/gi],
  ["MEMBER_ID", /(?:Member ID|Policy(?: No\.?| Number)?|Subscriber ID|Group No\.?)\s*[:#]?\s*([A-Z0-9]{6,14})/gi],
  ["ACCOUNT", /(?:Account(?: No\.?| Number| #)?|Acct\.? ?#?)\s*[:#]?\s*([0-9]{4,10}-?[0-9]{0,6})/gi],
];

const FREE: Array<[PiiType, RegExp]> = [
  ["SSN", /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g],
  ["PHONE", /(?:\(\d{3}\)\s?|\b\d{3}[-.])\d{3}[-.]\d{4}\b/g],
  ["EMAIL", /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
  ["ADDRESS", /\b\d{2,6}\s+(?:[A-Z][a-z]+\s){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Ln|Lane|Dr|Drive|Ct|Way|Pl)\.?(?:,?\s+(?:Apt|Unit|#)\s*\w+)?(?:,\s*[A-Z][a-zA-Z ]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)?/g],
  ["CARD", /\b(?:\d[ -]?){13,19}\b/g],
];

export function luhn(num: string): boolean {
  const d = num.replace(/\D/g, "");
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

function findAll(text: string, value: string, type: PiiType, source: PiiSpan["source"]): PiiSpan[] {
  const out: PiiSpan[] = [];
  if (!value || value.length < 3) return out;
  let i = text.indexOf(value);
  while (i !== -1) { out.push({ type, value, start: i, end: i + value.length, source }); i = text.indexOf(value, i + value.length); }
  return out;
}

/** Rules-only detection. Labeled names are expanded: every later mention of the
 *  full name, and of each surname/given-name token (>=3 chars), is also caught. */
export function detectPii(text: string): PiiSpan[] {
  const spans: PiiSpan[] = [];
  const names = new Set<string>();
  for (const [type, re] of LABELED) {
    for (const m of text.matchAll(re)) {
      const v = m[1].trim();
      const start = (m.index ?? 0) + m[0].indexOf(m[1]);
      spans.push({ type, value: v, start, end: start + v.length, source: "rules" });
      if (type === "NAME") names.add(v);
    }
  }
  for (const [type, re] of FREE) {
    for (const m of text.matchAll(re)) {
      if (type === "CARD" && !luhn(m[0])) continue;
      const v = m[0].trim();
      spans.push({ type, value: v, start: m.index ?? 0, end: (m.index ?? 0) + v.length, source: "rules" });
    }
  }
  for (const full of names) {
    spans.push(...findAll(text, full, "NAME", "rules"));
    for (const tok of full.split(/\s+/)) if (tok.replace(/\W/g, "").length >= 3) {
      const re = new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      for (const m of text.matchAll(re)) spans.push({ type: "NAME", value: tok, start: m.index ?? 0, end: (m.index ?? 0) + tok.length, source: "rules" });
    }
  }
  return mergeSpans(spans);
}

/** Model proposals are only accepted if the exact string occurs in the source text. */
export function acceptModelProposals(text: string, proposals: string[]): PiiSpan[] {
  const out: PiiSpan[] = [];
  for (const p of proposals) {
    const v = String(p ?? "").trim();
    if (v.length < 3 || v.length > 80) continue;
    out.push(...findAll(text, v, "MODEL_FLAGGED", "model"));
  }
  return out;
}

export function mergeSpans(spans: PiiSpan[]): PiiSpan[] {
  const s = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: PiiSpan[] = [];
  for (const sp of s) {
    const last = out[out.length - 1];
    if (last && sp.start < last.end) { if (sp.end > last.end) { last.end = sp.end; last.value = last.value + "…"; } continue; }
    out.push({ ...sp });
  }
  return out;
}

export interface Redaction { redacted: string; vault: Record<string, string>; spans: PiiSpan[]; }

/** Replace spans with stable placeholders. The vault (placeholder -> original) never leaves the browser. */
export function redact(text: string, spans: PiiSpan[]): Redaction {
  const merged = mergeSpans(spans);
  const vault: Record<string, string> = {};
  const counters: Record<string, number> = {};
  const seen = new Map<string, string>();
  let out = "", pos = 0;
  for (const sp of merged) {
    const original = text.slice(sp.start, sp.end);
    let ph = seen.get(original);
    if (!ph) { counters[sp.type] = (counters[sp.type] ?? 0) + 1; ph = `[${sp.type}_${counters[sp.type]}]`; seen.set(original, ph); vault[ph] = original; }
    out += text.slice(pos, sp.start) + ph; pos = sp.end;
  }
  out += text.slice(pos);
  return { redacted: out, vault, spans: merged };
}

export interface GateResult { pass: boolean; leaks: PiiSpan[]; checkedBytes: number; }

/** Final deterministic gate: re-runs every pattern and every known original value on the
 *  outbound payload. Any hit blocks the cloud call. */
export function leakGate(outbound: string, vault: Record<string, string>): GateResult {
  const leaks = detectPii(outbound).filter((s) => !/^\[[A-Z_]+_\d+\]$/.test(s.value));
  for (const original of Object.values(vault)) {
    const base = original.replace(/…$/, "");
    if (base.length >= 3 && outbound.includes(base)) leaks.push({ type: "MODEL_FLAGGED", value: base, start: outbound.indexOf(base), end: outbound.indexOf(base) + base.length, source: "rules" });
  }
  return { pass: leaks.length === 0, leaks: mergeSpans(leaks), checkedBytes: new TextEncoder().encode(outbound).length };
}

export function rehydrate(text: string, vault: Record<string, string>): string {
  return text.replace(/\[[A-Z_]+_\d+\]/g, (ph) => vault[ph] ?? ph);
}
