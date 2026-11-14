// Rules-only evaluation on 40 seeded synthetic bills. Writes public/eval/results.json.
import { writeFileSync, mkdirSync } from "node:fs";
import { detectPii, redact, leakGate } from "../src/lib/pii";
import { parseBill, audit, totalAtStake, type RuleId } from "../src/lib/audit";
import { makeBill, EVAL_SEEDS } from "../src/lib/samples";

const RULES: RuleId[] = ["DUPLICATE", "MATH", "TOTAL", "UNBUNDLE", "POST_DISCHARGE", "PRICE_OUTLIER", "DOUBLE_EM"];
const per: Record<string, { tp: number; fp: number; fn: number }> = Object.fromEntries(RULES.map((r) => [r, { tp: 0, fp: 0, fn: 0 }]));
const misses: Array<{ bill: string; kind: string; detail: string }> = [];
let labeledTotal = 0, labeledLeaked = 0, hardTotal = 0, hardLeaked = 0, gateBlocks = 0, clean = 0, cleanFlagged = 0, stake = 0;
const t0 = performance.now();

for (const seed of EVAL_SEEDS) {
  const b = makeBill(seed);
  const findings = audit(parseBill(b.text));
  stake += totalAtStake(findings);
  if (b.truth.errors.length === 0) { clean++; if (findings.some((f) => f.severity !== "advisory")) cleanFlagged++; }
  const used = new Set<number>();
  for (const e of b.truth.errors) {
    const i = findings.findIndex((f, k) => !used.has(k) && f.rule === e.rule && (!e.cpt || f.cpt === e.cpt || e.rule === "DOUBLE_EM"));
    if (i >= 0) { used.add(i); per[e.rule].tp++; } else { per[e.rule].fn++; misses.push({ bill: b.id, kind: `missed ${e.rule}`, detail: `planted ${e.rule}${e.cpt ? " on " + e.cpt : ""} not detected` }); }
  }
  findings.forEach((f, k) => { if (!used.has(k)) { per[f.rule].fp++; misses.push({ bill: b.id, kind: `false positive ${f.rule}`, detail: f.title }); } });

  const red = redact(b.text, detectPii(b.text));
  for (const p of b.truth.pii) { labeledTotal++; if (red.redacted.includes(p)) { labeledLeaked++; misses.push({ bill: b.id, kind: "PII leak (labeled)", detail: p.replace(/./g, (c, i) => (i < 2 ? c : "•")) }); } }
  for (const p of b.truth.hardPii) { hardTotal++; if (red.redacted.includes(p)) { hardLeaked++; misses.push({ bill: b.id, kind: "PII leak (free-text, rules-only)", detail: p.replace(/\d/g, "#") }); } }
  if (!leakGate(red.redacted, red.vault).pass) gateBlocks++;
}

const rules = RULES.map((r) => { const { tp, fp, fn } = per[r]; return { rule: r, tp, fp, fn,
  precision: tp + fp ? +(tp / (tp + fp)).toFixed(3) : null, recall: tp + fn ? +(tp / (tp + fn)).toFixed(3) : null }; });
const out = {
  generatedAt: new Date().toISOString(), mode: "rules-only (no model)", bills: EVAL_SEEDS.length, runtimeMs: Math.round(performance.now() - t0),
  rules, cleanBills: clean, cleanBillsFlagged: cleanFlagged, totalAtStakeUsd: Math.round(stake),
  pii: { labeledTotal, labeledLeaked, hardTotal, hardLeaked, hardLeakRate: hardTotal ? +(hardLeaked / hardTotal).toFixed(3) : 0, gateBlocks },
  misses,
  notes: [
    "Synthetic, seeded bills (fictional people). Ground truth = planted errors + every PII string written into the bill.",
    "'Free-text' PII is deliberately written in formats the regex layer does not cover (spaced phone numbers, spelled-out birthdays, spouse first names). These misses are what the on-device Gemini Nano pass is for; model-on numbers will be published separately once measured in Chrome.",
    "Eval history: the first run (v0.1) produced 10 false positives: 8 DUPLICATE flags on a legit same-code venipuncture decoy (a generator bug that put both draws on the same day) and 2 DOUBLE_EM flags caused by counting an exact duplicate E/M line twice (an engine bug, now fixed: exact duplicates are reported once, under DUPLICATE).",
    "The leak gate re-checks every outbound payload; gateBlocks counts payloads it would refuse to send.",
  ],
};
mkdirSync("public/eval", { recursive: true });
writeFileSync("public/eval/results.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ rules, pii: out.pii, cleanFlagged, clean, missCount: misses.length }, null, 1));
