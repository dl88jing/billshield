/**
 * BillShield demo: one continuous Playwright screen recording of a simulated user on the LIVE app,
 * with a visible cursor overlay. v2 (Nov 18): EN -> ES -> JA UI and letters, then offline mode. Each scene is held for its Kokoro VO duration (assets/vo/durations.json)
 * and scene start times are written to assets/screen/marks.json for compose.mjs.
 * Uses only the app's built-in synthetic sample bills. No credentials needed.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "assets", "screen");
const BASE = process.env.DEMO_URL || "https://billshield-kappa.vercel.app";
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const VIEW = { width: 1920, height: 1080 };
const ZOOM = 1.6; // body zoom so the 1200px-wide app layout fills a 1080p frame with readable text
const VO = JSON.parse(fs.readFileSync(path.join(__dirname, "assets", "vo", "durations.json"), "utf8"));
const hold = (id) => (VO[id] + 0.7) * 1000;

fs.mkdirSync(OUT, { recursive: true });

const CURSOR_JS = `
(() => {
  if (window.__bsCursor) return;
  const mk = () => {
    const wrap = document.createElement('div');
    wrap.id = '__bs_cursor';
    wrap.innerHTML = '<svg width="44" height="44" viewBox="0 0 36 36" style="display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,.55))"><path d="M6 4 L6 28 L13 22 L18 32 L22 30 L17 20 L26 20 Z" fill="#0f172a" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg><div id="__bs_ring" style="position:absolute;left:-13px;top:-13px;width:38px;height:38px;border-radius:50%;border:3px solid #10b981;background:rgba(16,185,129,.35);opacity:0;transition:opacity .15s,transform .15s;pointer-events:none"></div>';
    wrap.style.cssText = 'position:fixed;left:960px;top:540px;width:30px;height:30px;pointer-events:none;z-index:2147483647;';
    return wrap;
  };
  const wrap = mk();
  const attach = () => { if (!document.getElementById('__bs_cursor') && document.documentElement) document.documentElement.appendChild(wrap); };
  attach();
  window.__bsCursor = wrap;
  window.__bsMove = (x, y) => { wrap.style.left = x + 'px'; wrap.style.top = y + 'px'; };
  window.__bsClick = () => { const r = document.getElementById('__bs_ring'); if (!r) return; r.style.opacity = '1'; r.style.transform = 'scale(1.7)'; setTimeout(() => { r.style.opacity = '0'; r.style.transform = 'scale(1)'; }, 260); };
  window.addEventListener('mousedown', () => window.__bsClick(), true);
  setInterval(attach, 400);
  const st = document.createElement('style');
  st.textContent = 'body{zoom:__ZOOM__}' + '.__bs_hl{outline:4px solid #10b981 !important;outline-offset:4px;border-radius:14px;transition:outline-color .3s}';
  document.head ? document.head.appendChild(st) : document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
})();
`;

let cur = { x: 960, y: 540 };
async function glide(page, x, y, ms = 700) {
  const steps = Math.max(8, Math.round(ms / 16));
  const from = { ...cur };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const px = from.x + (x - from.x) * e, py = from.y + (y - from.y) * e;
    await page.mouse.move(px, py);
    await page.evaluate(([a, b]) => window.__bsMove?.(a, b), [px, py]);
    await page.waitForTimeout(16);
  }
  cur = { x, y };
}
async function point(page, sel, { dx = 0.5, dy = 0.5, ms = 700 } = {}) {
  const loc = page.locator(sel).first();
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const b = await loc.boundingBox();
  if (!b) return;
  await glide(page, b.x + b.width * dx, b.y + Math.min(b.height * dy, b.height - 4), ms);
}
async function click(page, sel) {
  await point(page, sel);
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__bsClick?.());
  await page.locator(sel).first().click();
  await page.waitForTimeout(250);
}
async function hl(page, sel, on = true) {
  await page.evaluate(([s, o]) => { const el = document.querySelector(s); if (el) el.classList.toggle('__bs_hl', o); }, [sel, on]);
}
async function scrollToSel(page, sel, offset = 70, ms = 1100) {
  await page.evaluate(async ([s, off, dur]) => {
    const el = document.querySelector(s); if (!el) return;
    const start = window.scrollY, target = Math.max(0, el.getBoundingClientRect().top + start - off);
    const t0 = performance.now();
    await new Promise((res) => { const f = (now) => { const t = Math.min(1, (now - t0) / dur); const e = t < .5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2; window.scrollTo(0, start + (target - start) * e); t < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
  }, [sel, offset, ms]);
  await page.waitForTimeout(150);
}
async function scrollBy(page, dy, ms = 1200) {
  await page.evaluate(async ([d, dur]) => {
    const start = window.scrollY, t0 = performance.now();
    await new Promise((res) => { const f = (now) => { const t = Math.min(1, (now - t0) / dur); const e = t < .5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2; window.scrollTo(0, start + d * e); t < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
  }, [dy, ms]);
}

const videoDir = path.join(OUT, "_raw");
fs.rmSync(videoDir, { recursive: true, force: true });
fs.mkdirSync(videoDir, { recursive: true });
// Headed Chrome (run under xvfb-run): headless Chrome gets a 403 from the App Check reCAPTCHA Enterprise exchange.
const HEADLESS = process.env.HEADLESS === "1";
const browser = await chromium.launch({ executablePath: CHROME, headless: HEADLESS, args: ["--no-sandbox", "--disable-dev-shm-usage", `--window-size=${VIEW.width},${VIEW.height}`, "--disable-blink-features=AutomationControlled"] });
const context = await browser.newContext({
  viewport: VIEW, deviceScaleFactor: 1, locale: "en-US",
  recordVideo: { dir: videoDir, size: { width: 1920, height: 1080 } },
});
await context.addInitScript(CURSOR_JS.replace('__ZOOM__', String(ZOOM)));
const page = await context.newPage();
const T0 = Date.now();
const marks = {};
const cuts = [];
let cutInScene = 0;
const mark = (id) => { cutInScene = 0; marks[id] = (Date.now() - T0) / 1000; console.log("mark", id, marks[id]); };
// Cloud waits are recorded but cut out in compose.mjs (cuts.json); sceneEnd adds the cut time back so every
// scene still runs at least as long as its narration after the cut.
const sceneEnd = async (id) => { const left = marks[id] * 1000 + hold(id) + cutInScene * 1000 - (Date.now() - T0); cutInScene = 0; if (left > 0) await page.waitForTimeout(left); };
const now = () => (Date.now() - T0) / 1000;
const waitCut = async (fn) => { const a = now(); await fn(); const b = now(); if (b - a > 1.6) { cuts.push([+(a + 0.6).toFixed(3), +(b - 0.4).toFixed(3)]); cutInScene += b - a - 1.0; } };
const letterDone = async () => waitCut(async () => {
  await page.waitForSelector("[data-testid=letter]", { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector("[data-testid=letter-check]")?.getAttribute("data-pass") !== "", null, { timeout: 60000 }).catch(() => {});
});
const uiLang = async (l) => { await click(page, `[data-testid=ui-lang-${l}]`); await page.waitForFunction((x) => document.querySelector("main")?.getAttribute("data-ui-lang") === x, l, { timeout: 5000 }).catch(() => {}); };

// warm-up (not used in the cut): first visit installs the service worker; reload so the page is controlled
await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await page.evaluate(async () => { await navigator.serviceWorker?.ready; });
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelector("[data-testid=appcheck]")?.getAttribute("data-ok") !== "", null, { timeout: 30000 }).catch(() => {});
console.log("appcheck:", await page.locator("[data-testid=appcheck]").innerText(), "| offline pill:", await page.locator("[data-testid=offline]").innerText().catch(() => "none"));
await page.waitForTimeout(800);

// --- s1: landing, capability pills (App Check token OK)
mark("s1_problem");
await glide(page, 670, 240, 900);
await page.waitForTimeout(2500);
await point(page, "[data-testid=tagline]", { dx: 0.55, dy: 0.7 });
await page.waitForTimeout(5500);
await point(page, "[data-testid=caps] span:nth-child(1)");
await page.waitForTimeout(3000);
await point(page, "[data-testid=appcheck]");
await hl(page, "[data-testid=appcheck]");
await page.waitForTimeout(3500);
await hl(page, "[data-testid=appcheck]", false);
await sceneEnd("s1_problem");

// --- s3: load synthetic sample, audit privately
mark("s3_audit");
await click(page, "[data-testid=sample-0]");
await page.waitForTimeout(1200);
await point(page, "[data-testid=bill]", { dx: 0.35, dy: 0.12 });
await page.waitForTimeout(800);
await click(page, "[data-testid=run]");
await page.waitForTimeout(600);
for (const k of ["scan", "device", "gate", "audit"]) {
  const s = `[data-testid=step-${k}]`;
  if (await page.locator(s).count()) { await point(page, s, { dx: 0.3, ms: 600 }); await page.waitForTimeout(600); }
}
const devSel = (await page.locator("[data-testid^=step-][data-state=skipped]").count()) ? "[data-testid^=step-][data-state=skipped]" : "[data-testid=step-device]";
await point(page, devSel, { dx: 0.4 });
await hl(page, devSel);
await sceneEnd("s3_audit");
await hl(page, devSel, false);

// --- s4: findings + amount at stake
mark("s4_findings");
await point(page, "[data-testid=stake]");
await hl(page, "[data-testid=stake]");
await page.waitForTimeout(1800);
await hl(page, "[data-testid=stake]", false);
await scrollToSel(page, "[data-testid=findings]", 40);
const rows = page.locator("[data-testid=findings] tbody tr");
const n = await rows.count();
for (let i = 0; i < Math.min(n, 4); i++) { await point(page, `[data-testid=findings] tbody tr:nth-child(${i + 1})`, { dx: 0.25, ms: 650 }); await page.waitForTimeout(1500); }
await sceneEnd("s4_findings");

// --- s5: redacted text + privacy receipt (wait for letter so receipt is complete)
await letterDone();
mark("s5_receipt");
await scrollToSel(page, "[data-testid=redacted]", 90);
await point(page, "[data-testid=redacted]", { dx: 0.3, dy: 0.1 });
await page.waitForTimeout(1500);
await point(page, "[data-testid=receipt] dl", { dx: 0.5, dy: 0.12 });
await page.waitForTimeout(1600);
await point(page, "[data-testid=receipt] pre", { dx: 0.4, dy: 0.3 });
await page.waitForTimeout(1600);
await point(page, "[data-testid=receipt-appcheck]", { dx: 0.3 });
await hl(page, "[data-testid=receipt-appcheck]");
await page.waitForTimeout(2200);
await hl(page, "[data-testid=receipt-appcheck]", false);
await point(page, "[data-testid=letter-source]", { dx: 0.3 });
await hl(page, "[data-testid=letter-source]");
await page.waitForTimeout(2200);
await hl(page, "[data-testid=letter-source]", false);
await sceneEnd("s5_receipt");

// --- s6: letter fact check + identity re-inserted locally
mark("s6_letter");
await point(page, "[data-testid=letter-check]", { dx: 0.3 });
await hl(page, "[data-testid=letter-check]");
await page.waitForTimeout(2600);
await hl(page, "[data-testid=letter-check]", false);
await scrollToSel(page, "[data-testid=letter]", 30);
await point(page, "[data-testid=letter] pre", { dx: 0.3, dy: 0.1 });
await sceneEnd("s6_letter");

// --- s7: switch the UI to Español, audit again -> Spanish letter, same gate + fact check
mark("s7_spanish");
await scrollToSel(page, "main header", 20, 900);
await uiLang("es");
await page.waitForTimeout(700);
await point(page, "[data-testid=tagline]", { dx: 0.5, dy: 0.5 });
await page.waitForTimeout(1300);
await point(page, "[data-testid=lang-es]");
await hl(page, "[data-testid=lang-es]");
await page.waitForTimeout(800);
await hl(page, "[data-testid=lang-es]", false);
await click(page, "[data-testid=run]");
await page.waitForTimeout(600);
await point(page, "[data-testid=gate]", { dx: 0.4 });
await scrollToSel(page, "[data-testid=findings]", 40);
await point(page, "[data-testid=findings] tbody tr:nth-child(1)", { dx: 0.3 });
await letterDone();
await scrollToSel(page, "[data-testid=receipt]", 60);
await point(page, "[data-testid=letter-check]", { dx: 0.3 });
await hl(page, "[data-testid=letter-check]");
await page.waitForTimeout(1200);
await hl(page, "[data-testid=letter-check]", false);
await scrollToSel(page, "[data-testid=letter]", 30);
await point(page, "[data-testid=letter] pre", { dx: 0.3, dy: 0.1 });
await sceneEnd("s7_spanish");
console.log("es:", await page.locator("[data-testid=gate]").innerText(), "|", await page.locator("[data-testid=letter-check]").innerText());

// --- s8: 日本語
mark("s8_japanese");
await scrollToSel(page, "main header", 20, 800);
await uiLang("ja");
await click(page, "[data-testid=run]");
await page.waitForTimeout(400);
await point(page, "[data-testid=gate]", { dx: 0.4 });
await letterDone();
await scrollToSel(page, "[data-testid=receipt]", 60);
await point(page, "[data-testid=letter-check]", { dx: 0.3 });
await hl(page, "[data-testid=letter-check]");
await page.waitForTimeout(1100);
await hl(page, "[data-testid=letter-check]", false);
await scrollToSel(page, "[data-testid=letter]", 30);
await point(page, "[data-testid=letter] pre", { dx: 0.3, dy: 0.15 });
await sceneEnd("s8_japanese");
console.log("ja:", await page.locator("[data-testid=gate]").innerText(), "|", await page.locator("[data-testid=letter-check]").innerText());

// --- s9: installable + offline (network switched off; service worker serves the app)
mark("s9_offline");
await scrollToSel(page, "main header", 20, 600);
await uiLang("en");
await point(page, "[data-testid=offline]");
await hl(page, "[data-testid=offline]");
await page.waitForTimeout(1000);
await hl(page, "[data-testid=offline]", false);
await context.setOffline(true);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-testid=run]");
await page.waitForTimeout(400);
await point(page, "[data-testid=offline]");
await hl(page, "[data-testid=offline]");
await page.waitForTimeout(1200);
await hl(page, "[data-testid=offline]", false);
await click(page, "[data-testid=sample-0]");
await click(page, "[data-testid=run]");
await page.waitForSelector("[data-testid=letter]", { timeout: 30000 });
await point(page, "[data-testid=gate]", { dx: 0.4 });
await page.waitForTimeout(500);
await scrollToSel(page, "[data-testid=letter]", 30);
await point(page, "[data-testid=letter] p", { dx: 0.3 });
await hl(page, "[data-testid=letter]");
await sceneEnd("s9_offline");
console.log("offline:", await page.locator("[data-testid=offline]").innerText(), "|", await page.getAttribute("[data-testid=letter-source]", "data-source"));
mark("end");

await context.close();
await browser.close();
const files = fs.readdirSync(videoDir).filter((f) => f.endsWith(".webm"));
fs.renameSync(path.join(videoDir, files[0]), path.join(OUT, "session.webm"));
fs.rmSync(videoDir, { recursive: true, force: true });
fs.writeFileSync(path.join(OUT, "marks.json"), JSON.stringify(marks, null, 1));
fs.writeFileSync(path.join(OUT, "cuts.json"), JSON.stringify(cuts));
const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(OUT, "session.webm"), "-an", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-r", "30", path.join(OUT, "session.mp4")], { stdio: "inherit" });
if (r.status !== 0) throw new Error("ffmpeg failed");
console.log("saved", path.join(OUT, "session.mp4"), marks);
