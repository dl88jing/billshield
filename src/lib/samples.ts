// Seeded synthetic medical bills with ground truth (planted billing errors + every PII string).
// All people, numbers and providers are fictional.
import type { RuleId } from "./audit";

export interface Truth { errors: Array<{ rule: RuleId; cpt?: string }>; pii: string[]; hardPii: string[]; }
export interface SampleBill { id: string; title: string; text: string; truth: Truth; }

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

const FIRST = ["Maria", "James", "Aisha", "Wei", "Daniel", "Priya", "Lucas", "Fatima", "Noah", "Elena", "Kwame", "Sofia"];
const LAST = ["Delgado", "Okafor", "Nguyen", "Kowalski", "Haddad", "Brennan", "Yamamoto", "Petrov", "Abernathy", "Lindqvist"];
const STREETS = ["Alder", "Juniper", "Harbor View", "Maple", "Cedar Hill", "Lakeshore", "Willow"];
const SUFFIX = ["St", "Ave", "Rd", "Blvd", "Ln", "Dr"];
const CITIES = [["Portland", "OR", "97205"], ["Austin", "TX", "78704"], ["Columbus", "OH", "43215"], ["Raleigh", "NC", "27601"], ["Fresno", "CA", "93721"]];
const PROVIDERS = ["MERCY VALLEY MEDICAL CENTER", "ST. AUDRA REGIONAL HOSPITAL", "NORTHGATE COMMUNITY HEALTH", "RIVERBEND EMERGENCY CARE"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Row = { date: string; cpt: string; desc: string; qty: number; unit: number; amount?: number };
const BASE: Array<Omit<Row, "date">> = [
  { cpt: "99284", desc: "ED visit moderate-high severity", qty: 1, unit: 880 },
  { cpt: "80053", desc: "Comprehensive metabolic panel", qty: 1, unit: 165 },
  { cpt: "85025", desc: "CBC with automated differential", qty: 1, unit: 84 },
  { cpt: "36415", desc: "Routine venipuncture", qty: 1, unit: 22 },
  { cpt: "71046", desc: "Chest X-ray 2 views", qty: 1, unit: 340 },
  { cpt: "93005", desc: "Electrocardiogram tracing", qty: 1, unit: 190 },
  { cpt: "96374", desc: "IV push single drug initial", qty: 1, unit: 285 },
  { cpt: "J2405", desc: "Ondansetron injection per 1 mg", qty: 4, unit: 7.5 },
  { cpt: "96360", desc: "IV hydration initial hour", qty: 1, unit: 390 },
];
const ERROR_TYPES: RuleId[] = ["DUPLICATE", "MATH", "TOTAL", "UNBUNDLE", "POST_DISCHARGE", "PRICE_OUTLIER", "DOUBLE_EM"];

export function makeBill(seed: number): SampleBill {
  const r = rng(seed * 7919 + 17);
  const first = pick(r, FIRST), last = pick(r, LAST), name = `${first} ${last}`;
  const spouse = `${pick(r, FIRST)} ${last}`;
  const [city, st, zip] = pick(r, CITIES);
  const addr = `${100 + Math.floor(r() * 9800)} ${pick(r, STREETS)} ${pick(r, SUFFIX)}, ${city}, ${st} ${zip}`;
  const dobM = 1 + Math.floor(r() * 12), dobD = 1 + Math.floor(r() * 28), dobY = 1950 + Math.floor(r() * 50);
  const dob = `${pad(dobM)}/${pad(dobD)}/${dobY}`;
  const area = 200 + Math.floor(r() * 700);
  const phone = `(${area}) 555-${pad(Math.floor(r() * 10000), 4)}`;
  const email = `${first.toLowerCase()}.${last.toLowerCase()}${Math.floor(r() * 90 + 10)}@example.com`;
  const ssn = `${100 + Math.floor(r() * 500)}-${pad(10 + Math.floor(r() * 89))}-${pad(1000 + Math.floor(r() * 8999), 4)}`;
  const mrn = `MV-${pad(Math.floor(r() * 9999999), 7)}`;
  const member = `W${pad(Math.floor(r() * 999999999), 9)}`;
  const acct = `${pad(10000 + Math.floor(r() * 89999), 5)}-${pad(Math.floor(r() * 99), 2)}`;
  const provider = pick(r, PROVIDERS);
  const mo = 1 + Math.floor(r() * 9), day = 1 + Math.floor(r() * 20);
  const d0 = `${pad(mo)}/${pad(day)}/2026`, d1 = `${pad(mo)}/${pad(day + 1)}/2026`, d2 = `${pad(mo)}/${pad(day + 2)}/2026`, d5 = `${pad(mo)}/${pad(day + 5)}/2026`;

  const rows: Row[] = BASE.filter(() => r() > 0.25).map((b, i) => ({ ...b, date: i % 3 === 2 ? d1 : d0 }));
  if (!rows.find((x) => x.cpt === "80053")) rows.splice(1, 0, { ...BASE[1], date: d0 });
  if (!rows.find((x) => x.cpt === "99284")) rows.unshift({ ...BASE[0], date: d0 });
  // Decoy: legit repeat venipuncture on a different day (must NOT be flagged).
  if (r() > 0.5) { const orig = rows.find((x) => x.cpt === "36415"); rows.push({ cpt: "36415", desc: "Routine venipuncture", qty: 1, unit: 22, date: orig?.date === d1 ? d0 : d1 }); }

  const errors: Truth["errors"] = [];
  const nErr = Math.floor(r() * 4); // 0..3 planted errors; some bills are clean
  const chosen = new Set<RuleId>();
  while (chosen.size < nErr) chosen.add(pick(r, ERROR_TYPES));
  let subtotalBump = 0;
  for (const e of chosen) {
    if (e === "DUPLICATE") { const src = rows[Math.floor(r() * rows.length)]; rows.push({ ...src }); errors.push({ rule: e, cpt: src.cpt }); }
    if (e === "MATH") { const src = rows[Math.floor(r() * rows.length)]; src.amount = Math.round((src.qty * src.unit + 50 + r() * 200) * 100) / 100; errors.push({ rule: e, cpt: src.cpt }); }
    if (e === "UNBUNDLE") { const c = pick(r, [["82947", "Glucose blood quant", 34], ["82565", "Creatinine blood", 41], ["84132", "Potassium serum", 36]] as const); rows.push({ cpt: c[0], desc: c[1], qty: 1, unit: c[2], date: rows.find((x) => x.cpt === "80053")!.date }); errors.push({ rule: e, cpt: c[0] }); }
    if (e === "POST_DISCHARGE") { rows.push({ cpt: "93005", desc: "Electrocardiogram tracing", qty: 1, unit: 190, date: d5 }); errors.push({ rule: e, cpt: "93005" }); }
    if (e === "PRICE_OUTLIER") { rows.push({ cpt: "J1885", desc: "Ketorolac injection per 15 mg", qty: 1, unit: 95 + Math.round(r() * 60), date: d0 }); errors.push({ rule: e, cpt: "J1885" }); }
    if (e === "DOUBLE_EM") { rows.push({ cpt: "99285", desc: "ED visit high severity", qty: 1, unit: 1390, date: rows[0].date }); errors.push({ rule: e }); }
    if (e === "TOTAL") { subtotalBump = Math.round((100 + r() * 400) * 100) / 100; errors.push({ rule: e }); }
  }

  const hard: string[] = [];
  const notes: string[] = [];
  if (r() > 0.4) { const p = `${area} 555 ${pad(Math.floor(r() * 10000), 4)}`; notes.push(`Spouse ${spouse} called back from ${p} re: payment plan.`); hard.push(spouse.split(" ")[0], p); }
  if (r() > 0.6) { const b = `born ${MONTHS[dobM - 1]} ${dobD}, ${dobY}`; notes.push(`Verified identity: patient ${b}.`); hard.push(b); }
  if (r() > 0.7) { notes.push(`Card on file ending 4417 declined; ask ${first} to update.`); }

  const line = (x: Row) => { const amt = x.amount ?? Math.round(x.qty * x.unit * 100) / 100;
    return `${x.date} ${x.cpt}  ${x.desc.padEnd(36)} ${String(x.qty).padStart(3)}  ${x.unit.toFixed(2).padStart(9)}  ${amt.toFixed(2).padStart(9)}`; };
  const sum = rows.reduce((s, x) => s + (x.amount ?? Math.round(x.qty * x.unit * 100) / 100), 0);
  const subtotal = Math.round((sum + subtotalBump) * 100) / 100;
  const ins = Math.round(subtotal * 0.42 * 100) / 100;

  const text = [
    provider,
    "ITEMIZED STATEMENT OF SERVICES",
    `Patient: ${name}    DOB: ${dob}    MRN: ${mrn}`,
    `Address: ${addr}`,
    `Phone: ${phone}    Email: ${email}`,
    `Insurance: Aetna Choice POS II    Member ID: ${member}    SSN: ${ssn}`,
    `Account #: ${acct}    Admission: ${d0}    Discharge: ${d2}`,
    "",
    "DATE       CODE   DESCRIPTION                          QTY       UNIT     AMOUNT",
    ...rows.map(line),
    "",
    `SUBTOTAL: ${subtotal.toFixed(2)}`,
    `Insurance adjustments: -${ins.toFixed(2)}`,
    `TOTAL DUE: ${(subtotal - ins).toFixed(2)}`,
    ...(notes.length ? ["", "NOTES:", ...notes] : []),
  ].join("\n");

  return { id: `bill-${pad(seed, 3)}`, title: `${provider.split(" ").slice(0, 2).join(" ")} · ${errors.length ? errors.map((e) => e.rule).join(", ") : "clean"}`, text,
    truth: { errors, pii: [name, first, last, dob, mrn, addr, phone, email, ssn, member, acct], hardPii: hard } };
}

export const DEMO_SEEDS = [3, 7, 11, 21, 34];
export const EVAL_SEEDS = Array.from({ length: 40 }, (_, i) => 100 + i);
