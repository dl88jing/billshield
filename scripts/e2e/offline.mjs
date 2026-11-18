// Headless Chrome PWA check: manifest + service worker register, then the app reloads and runs
// Sample 1 with the network switched OFF (rules-only scrub, audit, leak gate, template letter).
// Usage: node scripts/e2e/offline.mjs [url]   (needs the `playwright` package resolvable)
import { chromium } from "playwright";
const url = (process.argv[2] || "https://billshield-kappa.vercel.app").replace(/\/$/, "");
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const out = {};
await p.goto(url, { waitUntil: "networkidle" });
out.manifestHref = await p.getAttribute('link[rel="manifest"]', "href");
out.manifest = await p.evaluate(async (h) => { const m = await (await fetch(h)).json(); return { name: m.name, display: m.display, icons: m.icons.map((i) => `${i.sizes}/${i.purpose}`) }; }, out.manifestHref);
out.swScope = await p.evaluate(async () => (await navigator.serviceWorker.ready).scope);
if (!(await p.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await p.reload({ waitUntil: "networkidle" });
out.controlled = await p.evaluate(() => Boolean(navigator.serviceWorker.controller));
out.cached = await p.evaluate(async () => { const c = await caches.open("billshield-shell-v1"); return (await c.keys()).length; });
out.badgeOnline = await p.locator("[data-testid=offline]").innerText().catch(() => null);

await ctx.setOffline(true);
await p.reload({ waitUntil: "domcontentloaded" });
await p.waitForSelector("[data-testid=run]");
await p.click("[data-testid=sample-1]");
await p.click("[data-testid=run]");
await p.waitForSelector("[data-testid=letter]", { timeout: 30000 });
out.badgeOffline = await p.locator("[data-testid=offline]").innerText().catch(() => null);
out.stake = await p.locator("[data-testid=stake]").innerText();
out.gate = await p.locator("[data-testid=gate]").innerText();
out.gatePass = await p.getAttribute("[data-testid=gate]", "data-pass");
out.letterSource = await p.getAttribute("[data-testid=letter-source]", "data-source");
out.letterHasName = !/\[NAME_\d+\]/.test(await p.locator("[data-testid=letter] pre").innerText());
await p.goto(url + "/eval", { waitUntil: "domcontentloaded" });
out.evalOfflineTitle = (await p.locator("h1").first().innerText().catch(() => "")).slice(0, 60);
out.errors = errs;
console.log(JSON.stringify(out, null, 2));
await b.close();
const ok = out.controlled && out.manifest.display === "standalone" && out.letterSource === "template" && out.gatePass === "1" && out.letterHasName;
process.exit(ok ? 0 : 1);
