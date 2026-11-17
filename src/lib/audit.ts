// Deterministic bill parser + audit engine. No model involved: every finding is reproducible.

export interface LineItem { line: number; date: string; cpt: string; description: string; qty: number; unit: number; amount: number; }
export interface ParsedBill { items: LineItem[]; subtotal?: number; totalDue?: number; admission?: string; discharge?: string; provider?: string; }

export type RuleId = "DUPLICATE" | "MATH" | "TOTAL" | "UNBUNDLE" | "POST_DISCHARGE" | "PRICE_OUTLIER" | "DOUBLE_EM";
export interface Finding { rule: RuleId; lines: number[]; cpt?: string; atStake: number; title: string; detail: string; severity: "high" | "medium" | "advisory";
  /** Structured facts behind `detail`, so letters can be localized without re-parsing English text. Never includes identifiers. */
  facts?: Record<string, string | number>; }

const money = (s: string) => Number(s.replace(/[$,]/g, ""));
const ITEM = /^\s*(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{5}|[A-Z]\d{4})\s+(.+?)\s+(\d+)\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})\s*$/;

export function parseBill(text: string): ParsedBill {
  const bill: ParsedBill = { items: [] };
  text.split(/\r?\n/).forEach((raw, idx) => {
    const m = raw.match(ITEM);
    if (m) { bill.items.push({ line: idx + 1, date: m[1], cpt: m[2], description: m[3].trim(), qty: Number(m[4]), unit: money(m[5]), amount: money(m[6]) }); return; }
    const sub = raw.match(/SUBTOTAL\s*:?\s*\$?([\d,]+\.\d{2})/i); if (sub) bill.subtotal = money(sub[1]);
    const tot = raw.match(/TOTAL DUE\s*:?\s*\$?([\d,]+\.\d{2})/i); if (tot) bill.totalDue = money(tot[1]);
    const adm = raw.match(/Admission\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i); if (adm) bill.admission = adm[1];
    const dis = raw.match(/Discharge\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i); if (dis) bill.discharge = dis[1];
    if (idx === 0 && raw.trim()) bill.provider = raw.trim();
  });
  return bill;
}

// Panel codes and the component tests they already include (NCCI-style bundling, simplified).
export const PANELS: Record<string, { name: string; includes: string[] }> = {
  "80053": { name: "Comprehensive metabolic panel", includes: ["82947", "82565", "84132", "84295", "82310", "82374", "84520", "84075", "84155", "82040", "82247", "84450", "84460", "82435"] },
  "80048": { name: "Basic metabolic panel", includes: ["82947", "82565", "84132", "84295", "82310", "82374", "84520", "82435"] },
  "85025": { name: "CBC with differential", includes: ["85018", "85014", "85041", "85048", "85049"] },
  "80061": { name: "Lipid panel", includes: ["82465", "83718", "84478"] },
};
export const EM_CODES = new Set(["99202", "99203", "99204", "99205", "99211", "99212", "99213", "99214", "99215", "99281", "99282", "99283", "99284", "99285"]);

// Illustrative typical charges (USD) used only for an advisory outlier flag. NOT a fee schedule.
export const REFERENCE: Record<string, { name: string; typical: number }> = {
  "99285": { name: "ED visit, high severity", typical: 1400 }, "99284": { name: "ED visit, mod-high", typical: 900 },
  "99283": { name: "ED visit, moderate", typical: 550 }, "99214": { name: "Office visit, est.", typical: 250 },
  "99215": { name: "Office visit, est., high", typical: 350 }, "99213": { name: "Office visit, est., low", typical: 180 },
  "80053": { name: "CMP", typical: 180 }, "80048": { name: "BMP", typical: 120 }, "85025": { name: "CBC w/ diff", typical: 90 },
  "80061": { name: "Lipid panel", typical: 110 }, "82947": { name: "Glucose", typical: 35 }, "82565": { name: "Creatinine", typical: 40 },
  "84132": { name: "Potassium", typical: 35 }, "85018": { name: "Hemoglobin", typical: 30 }, "85014": { name: "Hematocrit", typical: 30 },
  "36415": { name: "Venipuncture", typical: 25 }, "71046": { name: "Chest X-ray, 2 views", typical: 350 },
  "93005": { name: "ECG tracing", typical: 200 }, "96374": { name: "IV push, initial", typical: 300 },
  "J1885": { name: "Ketorolac inj., 15mg", typical: 15 }, "74177": { name: "CT abd/pelvis w/ contrast", typical: 2800 },
  "J2405": { name: "Ondansetron inj., 1mg", typical: 8 }, "96360": { name: "IV hydration, initial hr", typical: 400 },
};
export const OUTLIER_MULTIPLE = 3;

const toDate = (s: string) => { const [m, d, y] = s.split("/").map(Number); return new Date(y, m - 1, d).getTime(); };
const r2 = (n: number) => Math.round(n * 100) / 100;

export function audit(bill: ParsedBill, opts: { outlierMultiple?: number } = {}): Finding[] {
  const OUT = opts.outlierMultiple && opts.outlierMultiple > 1 ? opts.outlierMultiple : OUTLIER_MULTIPLE;
  const f: Finding[] = [];
  const items = bill.items;

  // MATH: qty * unit must equal amount.
  for (const it of items) {
    const expect = r2(it.qty * it.unit);
    if (Math.abs(expect - it.amount) > 0.01) f.push({ rule: "MATH", lines: [it.line], cpt: it.cpt, atStake: r2(Math.max(0, it.amount - expect)), severity: "high",
      title: `Line math error on ${it.cpt}`, detail: `${it.qty} × $${it.unit.toFixed(2)} = $${expect.toFixed(2)}, but billed $${it.amount.toFixed(2)}.`, facts: { qty: it.qty, unit: it.unit, expect, amount: it.amount } });
  }
  // DUPLICATE: same date + code + amount appearing more than once.
  const seen = new Map<string, LineItem>();
  for (const it of items) {
    const k = `${it.date}|${it.cpt}|${it.amount}`;
    const prev = seen.get(k);
    if (prev) f.push({ rule: "DUPLICATE", lines: [prev.line, it.line], cpt: it.cpt, atStake: it.amount, severity: "high",
      title: `Possible duplicate charge: ${it.cpt}`, detail: `"${it.description}" billed twice on ${it.date} for $${it.amount.toFixed(2)} each.`, facts: { desc: it.description, date: it.date, amount: it.amount } });
    else seen.set(k, it);
  }
  // UNBUNDLE: component test billed on the same date as a panel that includes it.
  for (const it of items) {
    const panel = PANELS[it.cpt]; if (!panel) continue;
    for (const c of items) if (c.date === it.date && panel.includes.includes(c.cpt))
      f.push({ rule: "UNBUNDLE", lines: [it.line, c.line], cpt: c.cpt, atStake: c.amount, severity: "high",
        title: `Unbundled lab: ${c.cpt} inside ${it.cpt}`, detail: `${c.cpt} (${c.description}) is a component of the ${panel.name} (${it.cpt}) billed the same day.`, facts: { comp: c.cpt, compDesc: c.description, panel: it.cpt } });
  }
  // DOUBLE_EM: more than one E/M visit code on the same date.
  const emByDate = new Map<string, LineItem[]>();
  // Exact duplicates are already reported by DUPLICATE; count each distinct E/M line once here.
  const emSeen = new Set<string>();
  for (const it of items) if (EM_CODES.has(it.cpt)) { const k = `${it.date}|${it.cpt}|${it.amount}`; if (emSeen.has(k)) continue; emSeen.add(k); emByDate.set(it.date, [...(emByDate.get(it.date) ?? []), it]); }
  for (const [date, list] of emByDate) if (list.length > 1) {
    const sorted = [...list].sort((a, b) => b.amount - a.amount);
    f.push({ rule: "DOUBLE_EM", lines: list.map((x) => x.line), cpt: sorted[1].cpt, atStake: sorted.slice(1).reduce((s, x) => s + x.amount, 0), severity: "medium",
      title: `Multiple visit (E/M) codes on ${date}`, detail: `${list.map((x) => x.cpt).join(" + ")} on the same day; usually only one E/M level is payable per encounter.`, facts: { date, codes: list.map((x) => x.cpt).join(" + ") } });
  }
  // POST_DISCHARGE: service after discharge date.
  if (bill.discharge) for (const it of items) if (toDate(it.date) > toDate(bill.discharge))
    f.push({ rule: "POST_DISCHARGE", lines: [it.line], cpt: it.cpt, atStake: it.amount, severity: "high",
      title: `Charge after discharge: ${it.cpt}`, detail: `Service dated ${it.date}, after discharge on ${bill.discharge}.`, facts: { date: it.date, discharge: bill.discharge } });
  // PRICE_OUTLIER: unit price > OUTLIER_MULTIPLE × typical.
  for (const it of items) { const ref = REFERENCE[it.cpt];
    if (ref && it.unit > ref.typical * OUT) f.push({ rule: "PRICE_OUTLIER", lines: [it.line], cpt: it.cpt, atStake: r2((it.unit - ref.typical * OUT) * it.qty), severity: "advisory",
      title: `Price outlier: ${it.cpt}`, detail: `$${it.unit.toFixed(2)} per unit is over ${OUT}× a typical $${ref.typical} charge for ${ref.name}. Ask for an itemized justification.`, facts: { unit: it.unit, multiple: OUT, typical: ref.typical } }); }
  // TOTAL: stated subtotal must equal the sum of lines.
  const sum = r2(items.reduce((s, x) => s + x.amount, 0));
  if (bill.subtotal !== undefined && Math.abs(sum - bill.subtotal) > 0.01)
    f.push({ rule: "TOTAL", lines: [], atStake: r2(Math.max(0, bill.subtotal - sum)), severity: "high",
      title: "Subtotal does not match line items", detail: `Lines add to $${sum.toFixed(2)} but the bill states $${bill.subtotal.toFixed(2)}.`, facts: { sum, subtotal: bill.subtotal } });
  return f;
}

export function totalAtStake(f: Finding[]): number {
  return r2(f.filter((x) => x.severity !== "advisory").reduce((s, x) => s + x.atStake, 0));
}
