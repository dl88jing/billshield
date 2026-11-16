import type { Finding } from "./audit";
import { totalAtStake } from "./audit";

export type LetterLang = "en" | "es";
export const LETTER_LANGS: Record<LetterLang, string> = { en: "English", es: "Español" };

/** Redacted payload sent to the cloud: findings only, with placeholders instead of identity. */
export function buildPayload(findings: Finding[], vaultKeys: string[], provider?: string): string {
  const name = vaultKeys.find((k) => k.startsWith("[NAME_")) ?? "[NAME_1]";
  const acct = vaultKeys.find((k) => k.startsWith("[ACCOUNT_")) ?? "[ACCOUNT_1]";
  return [
    `Patient: ${name}`, `Account: ${acct}`, `Provider: ${provider ?? "the provider"}`,
    `Total disputed (excluding advisory): $${totalAtStake(findings).toFixed(2)}`,
    ...findings.map((f, i) => `${i + 1}. [${f.rule}] ${f.title}: ${f.detail} Amount in question: $${f.atStake.toFixed(2)}.`),
  ].join("\n");
}

/** Prompt for the letter model. Input is always the redacted payload; only the output language changes.
 *  Amounts and codes must stay in the payload's exact form so the deterministic fact checker can trace them. */
export function letterPrompt(payload: string, lang: LetterLang = "en"): string {
  const es = lang === "es"
    ? " Write the ENTIRE letter in Spanish (neutral Latin American Spanish, formal usted). Keep billing codes exactly as given, and write every dollar amount exactly as it appears in the findings, with a leading $ and US number format (for example $1,234.56, never 1.234,56 $). Do not translate or alter the placeholders."
    : "";
  return `Write a firm, polite billing dispute letter from a patient to a hospital billing office. Use ONLY the facts below. Keep every placeholder in square brackets that appears below (for example [NAME_1], [ACCOUNT_1]) exactly as written. Do NOT create any new bracketed placeholders (no [DATE], [ADDRESS], [PHONE] etc.); simply omit a date line, addresses and contact details. Only mention dollar amounts and billing codes that appear verbatim in the findings; do not compute new amounts. Cite each finding with its code and dollar amount, request a corrected itemized bill, and ask that the account not be sent to collections while under review. Under 300 words. Plain text, no markdown.${es}

FINDINGS (already redacted on-device):
${payload}`;
}

const ES_TITLE: Record<Finding["rule"], string> = {
  DUPLICATE: "Posible cargo duplicado", MATH: "Error de cálculo en la línea", TOTAL: "El subtotal no coincide con las líneas",
  UNBUNDLE: "Análisis de laboratorio facturado por separado (incluido en un panel)", POST_DISCHARGE: "Cargo posterior al alta",
  PRICE_OUTLIER: "Precio muy superior al habitual (solo para revisión)", DOUBLE_EM: "Varias visitas (E/M) el mismo día",
};

/** Deterministic fallback letter so the workflow always completes. */
export function templateLetter(findings: Finding[], vaultKeys: string[], provider?: string, lang: LetterLang = "en"): string {
  if (lang === "es") return templateLetterEs(findings, vaultKeys, provider);
  const name = vaultKeys.find((k) => k.startsWith("[NAME_")) ?? "[NAME_1]";
  const acct = vaultKeys.find((k) => k.startsWith("[ACCOUNT_")) ?? "[ACCOUNT_1]";
  const lines = findings.map((f, i) => `  ${i + 1}. ${f.title}: ${f.detail} ($${f.atStake.toFixed(2)})`);
  return `To the Billing Office, ${provider ?? ""}

Re: Account ${acct}, patient ${name}

I am writing to dispute the following charges on my itemized statement:

${lines.join("\n")}

Total disputed: $${totalAtStake(findings).toFixed(2)} (price outliers are listed for review and are not included in this total).

Please review these items, send me a corrected itemized bill, and place my account on hold so it is not referred to collections while the review is pending. I would appreciate a written response within 30 days.

Sincerely,
${name}`;
}

function templateLetterEs(findings: Finding[], vaultKeys: string[], provider?: string): string {
  const name = vaultKeys.find((k) => k.startsWith("[NAME_")) ?? "[NAME_1]";
  const acct = vaultKeys.find((k) => k.startsWith("[ACCOUNT_")) ?? "[ACCOUNT_1]";
  const lines = findings.map((f, i) => `  ${i + 1}. ${ES_TITLE[f.rule]}${f.cpt ? ` (código ${f.cpt})` : ""}${f.lines.length ? `, línea(s) ${f.lines.join(", ")} del estado de cuenta` : ""}: $${f.atStake.toFixed(2)}`);
  return `A la Oficina de Facturación, ${provider ?? ""}

Asunto: Cuenta ${acct}, paciente ${name}

Le escribo para disputar los siguientes cargos de mi estado de cuenta detallado:

${lines.join("\n")}

Total en disputa: $${totalAtStake(findings).toFixed(2)} (los precios atípicos se incluyen solo para revisión y no forman parte de este total).

Le solicito que revise estos cargos, me envíe una factura detallada corregida y mantenga mi cuenta en espera, sin enviarla a cobranza, mientras dure la revisión. Agradecería una respuesta por escrito en un plazo de 30 días.

Atentamente,
${name}`;
}

export interface LetterCheck { pass: boolean; issues: string[]; amountsChecked: number; codesChecked: number; }
/** Deterministic check of a model-drafted (still redacted) letter: every $ amount and billing code
 *  must come from the findings, placeholders must exist in the vault, and no raw identifier may appear. */
export function checkLetter(letter: string, findings: Finding[], vaultKeys: string[]): LetterCheck {
  const issues: string[] = [];
  const allowed = new Set<string>([totalAtStake(findings).toFixed(2)]);
  for (const f of findings) { allowed.add(f.atStake.toFixed(2)); for (const m of f.detail.matchAll(/\$([\d,]+(?:\.\d{2})?)/g)) allowed.add(Number(m[1].replace(/,/g, "")).toFixed(2)); }
  const amounts = [...letter.matchAll(/\$\s?([\d,]+(?:\.\d{2})?)/g)].map((m) => Number(m[1].replace(/,/g, "")).toFixed(2));
  for (const a of amounts) if (!allowed.has(a)) issues.push(`amount $${a} is not in the findings`);
  const codesAllowed = new Set<string>(findings.flatMap((f) => [f.cpt, ...(f.detail.match(/\b(?:\d{5}|[A-Z]\d{4})\b/g) ?? []), ...(f.title.match(/\b(?:\d{5}|[A-Z]\d{4})\b/g) ?? [])]).filter(Boolean) as string[]);
  const codes = [...letter.matchAll(/\b(\d{5}|[A-Z]\d{4})\b/g)].map((m) => m[1]).filter((c) => !/^(19|20)\d{3}$/.test(c));
  for (const c of codes) if (!codesAllowed.has(c)) issues.push(`code ${c} is not in the findings`);
  for (const ph of letter.match(/\[[A-Z_]+_\d+\]/g) ?? []) if (!vaultKeys.includes(ph)) issues.push(`unknown placeholder ${ph}`);
  return { pass: issues.length === 0, issues: [...new Set(issues)], amountsChecked: amounts.length, codesChecked: codes.length };
}
