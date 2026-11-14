/**
 * Build the HyperFrames composition (index.html) from the Playwright screen recording
 * (assets/screen/session.mp4 + marks.json) and the Kokoro VO (assets/vo/*.wav), then render it.
 *   node compose.mjs            -> writes index.html, renders renders/billshield-demo.mp4
 *   OUT=/path/file.mp4 node compose.mjs  -> also copies the render there
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const dir = path.dirname(fileURLToPath(import.meta.url));
const vo = JSON.parse(fs.readFileSync(path.join(dir, "assets/vo/durations.json"), "utf8"));
const marks = JSON.parse(fs.readFileSync(path.join(dir, "assets/screen/marks.json"), "utf8"));
const order = ["s1_problem", "s3_audit", "s4_findings", "s5_receipt", "s6_letter", "s7_eval", "end"];
const seg = (id) => ({ media: marks[id], dur: marks[order[order.indexOf(id) + 1]] - marks[id] });

const CAPTIONS = {
  s1_problem: ["Live app · billshield-kappa.vercel.app", "Firebase AI Logic connected · model from Remote Config"],
  s3_audit: ["Synthetic sample bill (fictional patient)", "Rules scan → on-device scrub → audit → leak gate"],
  s4_findings: ["Deterministic audit: 7 billing rules", "Model never decides what is wrong"],
  s5_receipt: ["Only redacted findings leave the tab", "Privacy receipt: payload · bytes · SHA-256 · inference source"],
  s6_letter: ["Letter fact-checked against findings", "Real identity re-inserted locally"],
  s7_eval: ["/eval · measured results, misses included", "40 synthetic bills · live cloud path 12/12"],
};

// timeline
const items = [];
let t = 0;
const add = (kind, id, dur, extra = {}) => { items.push({ kind, id, start: +t.toFixed(3), dur: +dur.toFixed(3), ...extra }); t += dur; };
add("card", "s0_title", vo.s0_title + 0.9);
add("screen", "s1_problem", seg("s1_problem").dur, { media: seg("s1_problem").media });
add("card", "s2_hybrid", vo.s2_hybrid + 1.0);
for (const id of ["s3_audit", "s4_findings", "s5_receipt", "s6_letter", "s7_eval"]) add("screen", id, seg(id).dur, { media: seg(id).media });
add("card", "s8_outro", vo.s8_outro + 3.2);
const total = +t.toFixed(3);

const voDelay = { s0_title: 0.5, s2_hybrid: 0.4, s8_outro: 0.4 };
const T = (id) => items.find((i) => i.id === id);

let body = "";
for (const it of items) {
  if (it.kind === "screen") {
    const [a, b] = CAPTIONS[it.id];
    body += `
<video id="v_${it.id}" class="clip" src="assets/screen/session.mp4" muted playsinline data-start="${it.start}" data-duration="${it.dur}" data-media-start="${it.media.toFixed(3)}" data-volume="0" data-track-index="0"></video>
<div id="cap_${it.id}" class="clip lower" data-start="${it.start}" data-duration="${it.dur}" data-track-index="3"><div class="pill"><span class="dot"></span>${a}</div><div class="pill soft">${b}</div><div class="brand">BillShield · #BuildHybridAI</div></div>`;
  }
}
const s0 = T("s0_title"), s2 = T("s2_hybrid"), s8 = T("s8_outro");
body += `
<div id="c0" class="clip scene" data-start="${s0.start}" data-duration="${s0.dur}" data-track-index="0">
  <div class="kicker" id="c0k">#BuildHybridAI 2026 · Web (Chrome)</div>
  <h1 id="c0h">BillShield</h1>
  <p class="sub" id="c0s">Private medical bill audits with hybrid AI.<br/>Gemini Nano on-device, Gemini in the cloud, one Firebase AI Logic SDK.</p>
  <div class="chips" id="c0c"><span>Firebase AI Logic</span><span>App Check</span><span>Remote Config</span><span>Firestore</span></div>
  <div class="foot" id="c0f">Green Robin Labs · built during the submission period (Nov 2026) · synthetic data only</div>
</div>
<div id="c2" class="clip scene" data-start="${s2.start}" data-duration="${s2.dur}" data-track-index="0">
  <div class="kicker">The hybrid design: inference as a privacy firewall</div>
  <div class="zone dev" id="zdev"><div class="ztag">IN THE BROWSER TAB</div>
    <div class="box" id="b1"><b>Raw bill text</b><i>name · DOB · MRN · member ID</i></div>
    <div class="arrow" id="a1">→</div>
    <div class="box nano" id="b2"><b>Gemini Nano</b><i>InferenceMode.ONLY_ON_DEVICE</i><em>never PREFER_ON_DEVICE: no cloud fallback with raw PII</em></div>
    <div class="arrow" id="a2">→</div>
    <div class="box" id="b3"><b>Redact + leak gate</b><i>rescan every outbound byte · any hit blocks the call</i></div>
  </div>
  <div class="arrow big" id="a3">↓ redacted findings only</div>
  <div class="zone cloud" id="zcl"><div class="ztag">LETTER STEP</div>
    <div class="box" id="b4"><b>InferenceMode.PREFER_ON_DEVICE</b><i>Gemini Nano if present, else cloud Gemini (model via Remote Config)</i></div>
    <div class="arrow" id="a4">→</div>
    <div class="box" id="b5"><b>Fact check + re-insert identity locally</b><i>placeholders like [NAME_1] stay placeholders in the cloud</i></div>
  </div>
</div>
<div id="c8" class="clip scene" data-start="${s8.start}" data-duration="${s8.dur}" data-track-index="0">
  <div class="cta" id="c8i">
    <div class="kicker" style="position:static">BillShield</div>
    <h1 style="position:static;width:auto;font-size:92px">Audit your bill. Keep your identity.</h1>
    <div class="urls">billshield-kappa.vercel.app<br/>github.com/dl88jing/billshield</div>
    <div class="tag">Built during the #BuildHybridAI submission period · Apache-2.0</div>
    <div class="credit">Green Robin Labs · Firebase AI Logic hybrid inference · Web (Chrome)</div>
  </div>
</div>`;
for (const id of Object.keys(vo)) {
  const it = T(id);
  const d = voDelay[id] ?? 0.25;
  body += `\n<audio id="a_${id}" src="assets/vo/${id}.wav" data-start="${(it.start + d).toFixed(3)}" data-duration="${vo[id]}" data-track-index="1" data-volume="1"></audio>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=1920, height=1080"/>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1920px;height:1080px;overflow:hidden;background:#0b1210}
#root{width:1920px;height:1080px;position:relative;font-family:Inter,system-ui,sans-serif;color:#f5f5f4}
video.clip{position:absolute;inset:0;width:1920px;height:1080px;object-fit:cover;background:#f5f5f4}
.scene{position:absolute;inset:0;background:radial-gradient(1100px 700px at 15% -10%,rgba(16,185,129,.25),transparent 60%),radial-gradient(900px 600px at 105% 110%,rgba(59,130,246,.16),transparent 55%),#0b1210}
.kicker{position:absolute;left:110px;top:90px;font-size:24px;letter-spacing:.2em;text-transform:uppercase;color:#34d399;font-weight:700}
h1{position:absolute;left:110px;top:170px;font-size:150px;line-height:1;letter-spacing:-.04em;font-weight:800}
.sub{position:absolute;left:110px;top:370px;font-size:40px;line-height:1.4;color:#d6d3d1;font-weight:500;width:1500px}
.chips{position:absolute;left:110px;top:560px;display:flex;gap:16px}
.chips span{border:1px solid #2f4f43;background:rgba(16,185,129,.12);color:#a7f3d0;border-radius:999px;padding:12px 26px;font-size:26px;font-weight:600}
.foot{position:absolute;left:110px;bottom:90px;font-size:26px;color:#a8a29e}
.lower{position:absolute;left:0;right:0;bottom:0;height:150px;background:linear-gradient(transparent,rgba(11,18,16,.88) 55%);display:flex;align-items:flex-end;gap:16px;padding:0 48px 30px;z-index:5}
.pill{background:#064e3b;border:1px solid #10b981;color:#ecfdf5;border-radius:999px;padding:12px 24px;font-size:26px;font-weight:700;display:flex;align-items:center}
.pill.soft{background:rgba(28,25,23,.92);border-color:#57534e;color:#e7e5e4;font-weight:600}
.dot{width:12px;height:12px;border-radius:50%;background:#34d399;box-shadow:0 0 10px #34d399;margin-right:12px}
.brand{margin-left:auto;font-size:20px;color:#d6d3d1;font-weight:600;letter-spacing:.04em;padding-bottom:12px}
.zone{position:absolute;left:110px;right:110px;border-radius:28px;padding:64px 36px 36px;display:flex;align-items:stretch;gap:20px}
.zone.dev{top:170px;border:2px solid #10b981;background:rgba(16,185,129,.07)}
.zone.cloud{top:640px;border:2px dashed #60a5fa;background:rgba(59,130,246,.07)}
.ztag{position:absolute;left:36px;top:20px;font-size:20px;letter-spacing:.18em;font-weight:800;color:#6ee7b7}
.zone.cloud .ztag{color:#93c5fd}
.box{flex:1;background:#111c19;border:1px solid #3f4f49;border-radius:20px;padding:22px 26px;display:flex;flex-direction:column;gap:10px}
.box b{font-size:30px;font-weight:800}
.box i{font-style:normal;font-family:"JetBrains Mono",monospace;font-size:20px;color:#a7f3d0;line-height:1.4}
.box em{font-style:normal;font-size:20px;color:#fca5a5;line-height:1.35}
.box.nano{border-color:#10b981;box-shadow:0 0 0 3px rgba(16,185,129,.25)}
.zone.cloud .box i{color:#bfdbfe}
.arrow{align-self:center;font-size:48px;color:#6ee7b7;font-weight:800}
.arrow.big{position:absolute;left:0;right:0;top:545px;text-align:center;font-size:34px;color:#93c5fd}
.cta{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:26px}
.urls{font-family:"JetBrains Mono",monospace;font-size:44px;color:#34d399;line-height:1.6;margin-top:10px}
.tag{font-size:30px;color:#e7e5e4}
.credit{font-size:22px;color:#a8a29e;letter-spacing:.08em;text-transform:uppercase}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="1920" data-height="1080" data-fps="30">
${body}
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({paused:true});
tl.from("#c0k, #c0h, #c0s, #c0c, #c0f", {opacity:0, y:30, duration:0.8, stagger:0.15, ease:"power2.out"}, ${s0.start + 0.15});
const h = ${s2.start};
tl.from("#zdev", {opacity:0, y:20, duration:0.6}, h + 0.2);
tl.from("#b1", {opacity:0, x:-30, duration:0.5}, h + 0.6);
tl.from("#a1, #b2", {opacity:0, x:-30, duration:0.5, stagger:0.2}, h + 2.0);
tl.from("#a2, #b3", {opacity:0, x:-30, duration:0.5, stagger:0.2}, h + 9.0);
tl.from("#a3, #zcl", {opacity:0, y:-20, duration:0.6, stagger:0.2}, h + 12.5);
tl.from("#b4", {opacity:0, x:-30, duration:0.5}, h + 13.3);
tl.from("#a4, #b5", {opacity:0, x:-30, duration:0.5, stagger:0.2}, h + 17.0);
${items.filter((i) => i.kind === "screen").map((i) => `tl.from("#cap_${i.id} .pill", {opacity:0, y:24, duration:0.5, stagger:0.15}, ${i.start + 0.2});`).join("\n")}
tl.from("#c8i > *", {opacity:0, y:24, duration:0.7, stagger:0.12, ease:"power2.out"}, ${s8.start + 0.1});
window.__timelines["main"] = tl;
</script>
</div>
</body>
</html>
`;
fs.writeFileSync(path.join(dir, "index.html"), html);
console.log("index.html written; total", total, "s");
console.log(items.map((i) => `${i.id} @${i.start} for ${i.dur}`).join("\n"));
if (process.env.NO_RENDER) process.exit(0);
const out = path.join(dir, "renders", "billshield-demo.mp4");
fs.mkdirSync(path.dirname(out), { recursive: true });
const r = spawnSync("npx", ["--yes", "hyperframes@0.8.60", "render", ".", "-o", out, "--quality=delivery"], { cwd: dir, stdio: "inherit" });
if (r.status !== 0) throw new Error("hyperframes render failed");
if (process.env.OUT) { fs.mkdirSync(path.dirname(process.env.OUT), { recursive: true }); fs.copyFileSync(out, process.env.OUT); console.log("copied to", process.env.OUT); }
