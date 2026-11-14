import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "fs";
const bills = JSON.parse(readFileSync("/tmp/cloudbills.json", "utf8"));
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const p = await b.newPage();
await p.goto("https://billshield-kappa.vercel.app", { waitUntil: "networkidle" });
await p.waitForTimeout(6000);
const rows = [];
for (const bill of bills) {
  await p.fill('[data-testid=bill]', bill.text);
  const t0 = Date.now();
  await p.click('[data-testid=run]');
  await p.waitForSelector('[data-testid=letter]', { timeout: 90000 });
  await p.waitForFunction(() => !document.querySelector('[data-testid=run]').disabled, null, { timeout: 90000 });
  const source = await p.getAttribute('[data-testid=letter-source]', "data-source");
  const check = await p.locator('[data-testid=letter-check]').innerText();
  const gate = await p.locator('[data-testid=gate]').innerText();
  const note = await p.locator('[data-testid=letter] p.text-amber-700').count() ? await p.locator('[data-testid=letter] p.text-amber-700').innerText() : "";
  const aiError = await p.locator('[data-testid=ai-error]').count() ? await p.locator('[data-testid=ai-error]').innerText() : "";
  rows.push({ bill: bill.id, aiError: aiError.replace(/https:\/\/\S+/g, "<endpoint>"), source, gatePass: gate.includes("PASSED"), factCheck: check, note, seconds: (Date.now() - t0) / 1000 });
  console.log(JSON.stringify(rows.at(-1)));
  await p.waitForTimeout(1500);
}
const s = { generatedAt: new Date().toISOString(), target: "https://billshield-kappa.vercel.app", browser: "headless Chrome (no Gemini Nano) → cloud path", model: "gemini-3.5-flash-lite via Firebase AI Logic", n: rows.length,
  cloudLetters: rows.filter(r => r.source === "in_cloud").length, gatePassed: rows.filter(r => r.gatePass).length,
  factCheckPassed: rows.filter(r => r.factCheck.startsWith("PASSED")).length, rejectedToTemplate: rows.filter(r => r.factCheck.startsWith("REJECTED")).length, rows };
writeFileSync("/workspace/buildhybridai/billshield/public/eval/cloud.json", JSON.stringify(s, null, 2));
console.log(JSON.stringify({ ...s, rows: undefined }));
await b.close();
