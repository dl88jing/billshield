// Live check of the localized UI chrome: browser locale picks the UI language, the switcher persists it,
// and a localized run still passes the leak gate and the letter fact check.
// Usage: node scripts/e2e/ui-lang.mjs [url] [--locale=ja-JP] [--run] [--shot]   (needs the `playwright` package resolvable)
import { chromium } from "playwright";
const url = (process.argv.slice(2).find((a) => !a.startsWith("--")) || "https://billshield-kappa.vercel.app").replace(/\/$/, "");
const locale = (process.argv.find((a) => a.startsWith("--locale=")) || "--locale=ja-JP").slice(9);
const want = locale.split("-")[0];
const RUN = { en: "Audit privately", es: "Auditar en privado", ja: "プライベートに監査" };
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const ctx = await b.newContext({ locale, viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto(url, { waitUntil: "networkidle" });
await p.waitForFunction((w) => document.querySelector("main")?.getAttribute("data-ui-lang") === w, want, { timeout: 10000 }).catch(() => undefined);
const out = { locale, uiLang: await p.getAttribute("main", "data-ui-lang"), htmlLang: await p.evaluate(() => document.documentElement.lang), runLabel: await p.locator("[data-testid=run]").innerText() };
// switch to the other language, reload: the choice must persist
const other = want === "es" ? "ja" : "es";
await p.click(`[data-testid=ui-lang-${other}]`);
out.afterSwitch = await p.getAttribute("main", "data-ui-lang");
out.stored = await p.evaluate(() => localStorage.getItem("billshield.uiLang"));
await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(500);
out.afterReload = await p.getAttribute("main", "data-ui-lang");
await p.click(`[data-testid=ui-lang-${want}]`);
await p.waitForTimeout(300);
out.letterLangFollows = await p.getAttribute(`[data-testid=lang-${want}]`, "aria-checked");
if (process.argv.includes("--run")) {
  await p.click("[data-testid=sample-1]");
  await p.click("[data-testid=run]");
  await p.waitForSelector("[data-testid=letter]", { timeout: 90000 });
  await p.waitForFunction(() => document.querySelector("[data-testid=letter-check]")?.getAttribute("data-pass") !== "", null, { timeout: 30000 }).catch(() => undefined);
  out.gate = await p.locator("[data-testid=gate]").innerText();
  out.gatePass = await p.getAttribute("[data-testid=gate]", "data-pass");
  out.factCheck = await p.locator("[data-testid=letter-check]").innerText();
  out.factPass = await p.getAttribute("[data-testid=letter-check]", "data-pass");
  out.letterLang = await p.getAttribute("[data-testid=letter]", "data-lang");
  out.letterSource = await p.getAttribute("[data-testid=letter-source]", "data-source");
  out.appCheck = await p.locator("[data-testid=receipt-appcheck]").innerText();
  out.firstFinding = await p.locator("[data-testid=findings] tbody tr").first().innerText().catch(() => "");
}
if (process.argv.includes("--shot")) await p.screenshot({ path: `ui-${want}.png`, fullPage: true });
out.errors = errs;
console.log(JSON.stringify(out, null, 2));
await b.close();
const ok = out.uiLang === want && out.htmlLang === want && out.runLabel === RUN[want] && out.afterSwitch === other && out.stored === other && out.afterReload === other && out.letterLangFollows === "true"
  && (!process.argv.includes("--run") || (out.gatePass === "1" && (out.factPass === "1" || out.factPass === "na") && out.letterLang === want)) && errs.length === 0;
process.exit(ok ? 0 : 1);
