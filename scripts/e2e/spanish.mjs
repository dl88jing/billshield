// Live check of the Spanish letter path: Sample 1 with "Español" selected.
// Usage: node scripts/e2e/spanish.mjs [url]   (needs the `playwright` package resolvable)
import { chromium } from "playwright";
const url = (process.argv[2] || "https://billshield-kappa.vercel.app").replace(/\/$/, "");
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto(url, { waitUntil: "networkidle" });
await p.click("[data-testid=sample-1]");
await p.click("[data-testid=lang-es]");
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
  looksSpanish: /\b(cargo|cuenta|factura|Atentamente|solicito)\b/i.test(letter),
  note: await p.locator("[data-testid=letter] p.text-amber-700").innerText().catch(() => ""),
  letterHead: letter.slice(0, 400),
  errors: errs,
};
if (process.argv.includes("--shot")) await p.screenshot({ path: "spanish-letter.png", fullPage: true });
console.log(JSON.stringify(out, null, 2));
await b.close();
process.exit(out.lang === "es" && out.looksSpanish && out.placeholdersLeft === 0 && /PASSED/.test(out.gate) ? 0 : 1);
