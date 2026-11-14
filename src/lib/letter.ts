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
