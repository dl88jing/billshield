import { chromium } from "playwright";
const url = process.argv[2]; const loc = process.argv[3] || "en-US";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const ctx = await b.newContext({ locale: loc, viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto(url, { waitUntil: "networkidle" });
await p.click('[data-testid=sample-0]'); await p.click('[data-testid=run]');
await p.waitForSelector('[data-testid=route-trace]', { timeout: 90000 });
await p.waitForSelector('[data-testid=letter]', { timeout: 90000 });
const tr = p.locator('[data-testid=route-trace]');
console.log("raw-out", await tr.getAttribute("data-raw-out"), "redacted-out", await tr.getAttribute("data-redacted-out"));
for (const s of ["scrub","gate","letter","check"]) { const r = p.locator(`[data-testid=trace-${s}]`); console.log(s, await r.getAttribute("data-path"), await r.getAttribute("data-reason")); }
console.log(await tr.innerText());
console.log("gate:", await p.locator('[data-testid=gate]').innerText());
console.log("letter-source:", await p.getAttribute('[data-testid=letter-source]', 'data-source'));
await tr.screenshot({ path: `/tmp/trace-${loc}.png` });
console.log("errors:", errs); await b.close();
