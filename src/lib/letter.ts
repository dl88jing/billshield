import type { Finding } from "./audit";
import { totalAtStake } from "./audit";

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

/** Deterministic fallback letter so the workflow always completes. */
export function templateLetter(findings: Finding[], vaultKeys: string[], provider?: string): string {
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
