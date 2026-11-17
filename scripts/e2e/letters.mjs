// Live check of the localized letter paths: Sample 1 with Español or 日本語 selected.
// Usage: node scripts/e2e/letters.mjs [url] [--lang=es|ja] [--shot]   (needs the `playwright` package resolvable)
import { chromium } from "playwright";
const url = (process.argv.slice(2).find((a) => !a.startsWith("--")) || "https://billshield-kappa.vercel.app").replace(/\/$/, "");
const lang = (process.argv.find((a) => a.startsWith("--lang=")) || "--lang=es").slice(7);
const LOOKS = { es: /\b(cargo|cuenta|factura|Atentamente|solicito)\b/i, ja: /(請求|異議|明細|敬具|お願い)/ };
// English phrases from the audit engine's finding text: a localized letter should not quote them.
const ENGLISH = /\b(billed|after discharge|Lines add to|per unit|typical|is a component of|usually only|Amount in question)\b/;
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto(url, { waitUntil: "networkidle" });
await p.click("[data-testid=sample-1]");
await p.click(`[data-testid=lang-${lang}]`);
await p.click("[data-testid=run]");
await p.waitForSelector("[data-testid=letter]", { timeout: 90000 });
await p.waitForFunction(() => document.querySelector("[data-testid=store]")?.textContent !== "…", null, { timeout: 15000 }).catch(() => undefined);
const letter = await p.locator("[data-testid=letter] pre").innerText();
const out = {
  lang: await p.getAttribute("[data-testid=letter]", "data-lang"),
  source: await p.getAttribute("[data-testid=letter-source]", "data-source"),
  sourceLabel: await p.locator("[data-testid=letter-source]").innerText(),
  factCheck: await p.locator("[data-testid=letter-check]").innerText(),
  gate: await p.locator("[data-testid=gate]").innerText(),
  stake: await p.locator("[data-testid=stake]").innerText(),
  placeholdersLeft: (letter.match(/\[[A-Z_]+_\d+\]/g) || []).length,
  looksLocalized: LOOKS[lang].test(letter),
  englishFindingText: letter.match(ENGLISH)?.[0] ?? null,
  receiptLocalized: LOOKS[lang].test(await p.locator("[data-testid=receipt]").innerText().catch(() => "")),
  note: await p.locator("[data-testid=letter] p.text-amber-700").innerText().catch(() => ""),
  letterHead: letter.slice(0, 400),
  errors: errs,
};
if (process.argv.includes("--shot")) await p.screenshot({ path: `letter-${lang}.png`, fullPage: true });
console.log(JSON.stringify(out, null, 2));
await b.close();
process.exit(out.lang === lang && out.looksLocalized && !out.englishFindingText && out.placeholdersLeft === 0 && /PASSED/.test(out.gate) ? 0 : 1);
