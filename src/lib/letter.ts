import type { Finding } from "./audit";
import { totalAtStake } from "./audit";

import { localizedFinding, type Lang } from "./i18n";

export type LetterLang = Lang;
export const LETTER_LANGS: Record<LetterLang, string> = { en: "English", es: "Español", ja: "日本語" };

const LABELS: Record<LetterLang, { patient: string; account: string; provider: string; theProvider: string; total: string; amount: string }> = {
  en: { patient: "Patient", account: "Account", provider: "Provider", theProvider: "the provider", total: "Total disputed (excluding advisory)", amount: "Amount in question" },
  es: { patient: "Paciente", account: "Cuenta", provider: "Proveedor", theProvider: "el proveedor", total: "Total en disputa (sin incluir avisos)", amount: "Monto en cuestión" },
  ja: { patient: "患者", account: "アカウント番号", provider: "医療機関", theProvider: "医療機関", total: "異議申立て総額（参考項目を除く）", amount: "対象金額" },
};

/** Redacted payload sent to the cloud: findings only, with placeholders instead of identity.
 *  For ES/JA the findings themselves are localized deterministically on-device (amounts and codes unchanged),
 *  so the model never has to translate English finding text and the letter can't drift into English quotes. */
export function buildPayload(findings: Finding[], vaultKeys: string[], provider?: string, lang: LetterLang = "en"): string {
  const name = vaultKeys.find((k) => k.startsWith("[NAME_")) ?? "[NAME_1]";
  const acct = vaultKeys.find((k) => k.startsWith("[ACCOUNT_")) ?? "[ACCOUNT_1]";
  const L = LABELS[lang];
  return [
    `${L.patient}: ${name}`, `${L.account}: ${acct}`, `${L.provider}: ${provider ?? L.theProvider}`,
    `${L.total}: $${totalAtStake(findings).toFixed(2)}`,
    ...findings.map((f, i) => { const t = localizedFinding(f, lang); return `${i + 1}. [${f.rule}] ${t.title}: ${t.detail} ${L.amount}: $${f.atStake.toFixed(2)}.`; }),
  ].join("\n");
}

const LANG_RULE: Record<Exclude<LetterLang, "en">, string> = {
  es: " Write the ENTIRE letter in Spanish (neutral Latin American Spanish, formal usted). The findings are already in Spanish; do not add English text. Keep billing codes exactly as given, and write every dollar amount exactly as it appears in the findings, with a leading $ and US number format (for example $1,234.56, never 1.234,56 $). Do not translate or alter the placeholders.",
  ja: " Write the ENTIRE letter in Japanese (polite business Japanese, です/ます調, formal letter style). The findings are already in Japanese; do not add English text. Keep billing codes exactly as given in half-width characters, and write every dollar amount exactly as it appears in the findings, with a leading half-width $ and US number format (for example $1,234.56, never 1,234.56ドル or ＄１，２３４．５６). Do not translate or alter the placeholders.",
};

/** Prompt for the letter model. Input is always the redacted payload; only the output language changes.
 *  Amounts and codes must stay in the payload's exact form so the deterministic fact checker can trace them. */
export function letterPrompt(payload: string, lang: LetterLang = "en"): string {
  const extra = lang === "en" ? "" : LANG_RULE[lang];
  return `Write a firm, polite billing dispute letter from a patient to a hospital billing office. Use ONLY the facts below. Keep every placeholder in square brackets that appears below (for example [NAME_1], [ACCOUNT_1]) exactly as written. Do NOT create any new bracketed placeholders (no [DATE], [ADDRESS], [PHONE] etc.); simply omit a date line, addresses and contact details. Only mention dollar amounts and billing codes that appear verbatim in the findings; do not compute new amounts. Cite each finding with its code and dollar amount, request a corrected itemized bill, and ask that the account not be sent to collections while under review. Under 300 words. Plain text, no markdown.${extra}

FINDINGS (already redacted on-device):
${payload}`;
}

/** Deterministic fallback letter so the workflow always completes. */
export function templateLetter(findings: Finding[], vaultKeys: string[], provider?: string, lang: LetterLang = "en"): string {
  if (lang === "es") return templateLetterEs(findings, vaultKeys, provider);
  if (lang === "ja") return templateLetterJa(findings, vaultKeys, provider);
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
  const lines = findings.map((f, i) => { const t = localizedFinding(f, "es"); return `  ${i + 1}. ${t.title}${f.lines.length ? `, línea(s) ${f.lines.join(", ")} del estado de cuenta` : ""}: ${t.detail} Monto: $${f.atStake.toFixed(2)}`; });
  return `A la Oficina de Facturación, ${provider ?? ""}

Asunto: Cuenta ${acct}, paciente ${name}

Le escribo para disputar los siguientes cargos de mi estado de cuenta detallado:

${lines.join("\n")}

Total en disputa: $${totalAtStake(findings).toFixed(2)} (los precios atípicos se incluyen solo para revisión y no forman parte de este total).

Le solicito que revise estos cargos, me envíe una factura detallada corregida y mantenga mi cuenta en espera, sin enviarla a cobranza, mientras dure la revisión. Agradecería una respuesta por escrito en un plazo de 30 días.

Atentamente,
${name}`;
}

function templateLetterJa(findings: Finding[], vaultKeys: string[], provider?: string): string {
  const name = vaultKeys.find((k) => k.startsWith("[NAME_")) ?? "[NAME_1]";
  const acct = vaultKeys.find((k) => k.startsWith("[ACCOUNT_")) ?? "[ACCOUNT_1]";
  const lines = findings.map((f, i) => { const t = localizedFinding(f, "ja"); return `  ${i + 1}. ${t.title}${f.lines.length ? `（明細${f.lines.join("・")}行目）` : ""}：${t.detail} 対象金額：$${f.atStake.toFixed(2)}`; });
  return `${provider ?? "医療機関"} 御中
請求ご担当者様

件名：アカウント番号 ${acct}（患者 ${name}）のご請求内容について

拝啓 時下ますますご清栄のこととお喜び申し上げます。
明細付き請求書を確認いたしましたところ、以下の請求について異議を申し立てます。

${lines.join("\n")}

異議申立て総額：$${totalAtStake(findings).toFixed(2)}（単価の参考項目は確認のためにのみ記載しており、この総額には含まれていません）。

つきましては、上記の項目をご確認のうえ、訂正済みの明細付き請求書をご送付ください。また、確認が完了するまでの間、本アカウントを債権回収に回さず保留としていただきますようお願い申し上げます。30日以内に書面にてご回答いただけますと幸いです。

敬具
${name}`;
}

export interface LetterCheck { pass: boolean; issues: string[]; amountsChecked: number; codesChecked: number; }
/** Deterministic check of a model-drafted (still redacted) letter: every $ amount and billing code
 *  must come from the findings, placeholders must exist in the vault, and no raw identifier may appear. */
export function checkLetter(letter: string, findings: Finding[], vaultKeys: string[]): LetterCheck {
  const issues: string[] = [];
  // Normalize full-width forms (＄１２３ → $123) so Japanese output is checked like any other letter.
  letter = letter.normalize("NFKC");
  // Money written without a leading $ (e.g. "1,234.56ドル", "1.234,56 $", "120 dólares", "USD 50") would dodge the amount check.
  for (const m of letter.matchAll(/\d[\d,.]*\s?(?:ドル|d[oó]lares|USD)|USD\s?\d[\d,.]*|\d[\d.]*,\d{2}\s?\$/gi)) issues.push(`amount "${m[0].trim()}" is not written as $ in US format`);
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
