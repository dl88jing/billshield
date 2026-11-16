"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { makeBill, DEMO_SEEDS } from "@/lib/samples";
import { detectPii, acceptModelProposals, redact, leakGate, rehydrate, type PiiSpan, type GateResult } from "@/lib/pii";
import { parseBill, audit, totalAtStake, type Finding } from "@/lib/audit";
import { buildPayload, templateLetter, checkLetter, LETTER_LANGS, type LetterCheck, type LetterLang } from "@/lib/letter";
import { capabilities, warmUpOnDevice, proposePiiOnDevice, draftLetter, firebaseReady, recordAggregate, status as fbStatus, type Capabilities, type ModelResult, type FirebaseStatus } from "@/lib/hybrid";
import { buildAggregate } from "@/lib/stats";
import { useOfflineState } from "@/lib/offline";

type StepState = "idle" | "running" | "done" | "blocked" | "skipped";
const STEPS = [
  { key: "scan", label: "Rules scan", sub: "Deterministic PII patterns" },
  { key: "device", label: "On-device scrub", sub: "Gemini Nano, ONLY_ON_DEVICE" },
  { key: "gate", label: "Leak gate", sub: "Blocks any surviving PII" },
  { key: "audit", label: "Bill audit", sub: "7 deterministic rules" },
  { key: "letter", label: "Dispute letter", sub: "Cloud sees redacted text only" },
] as const;
type Key = (typeof STEPS)[number]["key"];

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const SOURCE_LABEL: Record<string, string> = { on_device: "Firebase AI Logic · on-device (Gemini Nano)", in_cloud: "Firebase AI Logic · cloud (Gemini)", chrome_prompt_api: "Chrome Prompt API · on-device", rules_only: "Rules only (no on-device model here)", template: "Deterministic template (no model)" };

export default function Home() {
  const samples = useMemo(() => DEMO_SEEDS.map(makeBill), []);
  const [text, setText] = useState(samples[0].text);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [steps, setSteps] = useState<Record<Key, StepState>>({ scan: "idle", device: "idle", gate: "idle", audit: "idle", letter: "idle" });
  const [spans, setSpans] = useState<PiiSpan[]>([]);
  const [redacted, setRedacted] = useState("");
  const [gate, setGate] = useState<GateResult | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [device, setDevice] = useState<(ModelResult & { proposals: string[] }) | null>(null);
  const [letter, setLetter] = useState<ModelResult | null>(null);
  const [letterLang, setLetterLang] = useState<LetterLang>("en");
  const [finalLetter, setFinalLetter] = useState("");
  const [receipt, setReceipt] = useState<{ payload: string; bytes: number; hash: string; rawBytes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [lcheck, setLcheck] = useState<LetterCheck | null>(null);
  const [fb, setFb] = useState<FirebaseStatus | null>(null);
  const [store, setStore] = useState<{ ok: boolean; error?: string } | null>(null);
  const net = useOfflineState();
  const [lang, setLang] = useState<LetterLang>("en");

  useEffect(() => { capabilities().then(setCaps); firebaseReady().then((st) => setFb({ ...st, appCheck: { ...st.appCheck }, remoteConfig: { ...st.remoteConfig } })); }, []);
  const set = (k: Key, v: StepState) => setSteps((s) => ({ ...s, [k]: v }));

  async function run() {
    setBusy(true); setFindings(null); setLetter(null); setFinalLetter(""); setReceipt(null); setGate(null); setDevice(null); setStore(null); setLcheck(null);
    setSteps({ scan: "idle", device: "idle", gate: "idle", audit: "idle", letter: "idle" });
    const warm = warmUpOnDevice((p) => setProgress(p)); // user-activation: started inside the click

    set("scan", "running");
    const rules = detectPii(text);
    set("scan", "done");

    set("device", "running");
    await warm;
    const dev = await proposePiiOnDevice(text);
    setDevice(dev);
    const modelSpans = acceptModelProposals(text, dev.proposals);
    set("device", dev.source === "rules_only" ? "skipped" : "done");

    const red = redact(text, [...rules, ...modelSpans]);
    setSpans(red.spans); setRedacted(red.redacted);

    set("audit", "running");
    const bill = parseBill(text);
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    // Offline: don't wait on App Check / Remote Config timeouts; use built-in defaults.
    const st = offline ? fbStatus : await firebaseReady();
    setFb({ ...st, appCheck: { ...st.appCheck }, remoteConfig: { ...st.remoteConfig } });
    const f = audit(bill, { outlierMultiple: st.remoteConfig.outlierMultiple });
    setFindings(f);
    set("audit", "done");

    set("gate", "running");
    const payload = buildPayload(f, Object.keys(red.vault), bill.provider);
    const g = leakGate(payload, red.vault);
    setGate(g);
    if (!g.pass) { set("gate", "blocked"); set("letter", "skipped"); setBusy(false); return; }
    set("gate", "done");
    setReceipt({ payload, bytes: g.checkedBytes, hash: await sha256(payload), rawBytes: new TextEncoder().encode(text).length });

    set("letter", "running");
    let l: ModelResult = offline
      ? { text: templateLetter(f, Object.keys(red.vault), bill.provider, lang), source: "template", ms: 0, note: "Offline: cloud letter writing needs a network connection, so the deterministic template was used. Nothing left the device." }
      : await draftLetter(payload, () => templateLetter(f, Object.keys(red.vault), bill.provider, lang), lang);
    if (l.source !== "template") {
      const lc = checkLetter(l.text, f, Object.keys(red.vault));
      setLcheck(lc);
      if (!lc.pass) l = { ...l, text: templateLetter(f, Object.keys(red.vault), bill.provider, lang), source: "template", note: `Model letter rejected by the fact checker (${lc.issues.join("; ")}), so the deterministic template was used` };
    }
    // final guard: the model output itself must not contain raw identifiers before re-insertion
    if (!leakGate(l.text, red.vault).pass) l = { ...l, text: templateLetter(f, Object.keys(red.vault), bill.provider, lang), source: "template", note: "Model letter contained an identifier, so the template was used" };
    setLetter(l); setLetterLang(lang);
    setFinalLetter(rehydrate(l.text, red.vault)); // identity re-inserted locally, never sent
    set("letter", "done");
    if (offline) setStore({ ok: false, error: "offline, nothing sent" });
    else recordAggregate(buildAggregate(f, dev.source, l.source)).then(setStore);
    setBusy(false);
  }

  const stake = findings ? totalAtStake(findings) : 0;
  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">#BuildHybridAI · Web (Chrome)</p>
          <h1 className="mt-1 text-4xl font-bold tracking-tight">BillShield</h1>
          <p className="mt-2 max-w-2xl text-[15px] text-neutral-700">Find overcharges on a medical bill and get a dispute letter, <b>without your name, DOB, MRN or insurance ID ever leaving your device</b>. Raw text is processed on-device; only redacted findings go to the cloud.</p>
        </div>
        <nav className="flex gap-3 text-sm">
          <Link href="/eval" className="rounded-full border border-neutral-300 px-4 py-2 hover:bg-white">Measured results →</Link>
          <a href="https://github.com/dl88jing/billshield" className="rounded-full bg-neutral-900 px-4 py-2 text-white">GitHub</a>
        </nav>
      </header>

      <section data-testid="caps" className="mt-5 flex flex-wrap gap-2 text-xs">
        <span className={`rounded-full px-3 py-1 ${caps?.firebase ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>Firebase AI Logic: {caps ? (caps.firebase ? `connected · ${fb?.projectId ?? ""}` : "not configured on this deployment") : "…"}</span>
        {fb && <span data-testid="appcheck" className={`rounded-full px-3 py-1 ${fb.appCheck.ok ? "bg-emerald-100 text-emerald-900" : fb.appCheck.ok === false ? "bg-amber-100 text-amber-900" : "bg-neutral-200"}`}>App Check ({fb.appCheck.provider}): {fb.appCheck.ok ? "token OK" : fb.appCheck.ok === false ? "no token" : "checking…"}</span>}
        {fb && <span className="rounded-full bg-neutral-200 px-3 py-1">Cloud model: {fb.remoteConfig.cloudModel}{fb.remoteConfig.ok ? " (Remote Config)" : ""}</span>}
        <span className="rounded-full bg-neutral-200 px-3 py-1">On-device model: {caps?.onDevice ?? "…"}</span>
        {(net.offlineReady || !net.online) && <span data-testid="offline" data-online={net.online ? "1" : "0"} title="Rules scan, on-device scrub, leak gate, bill audit and the template letter run with no network. Cloud letter writing needs a connection." className={`rounded-full px-3 py-1 ${net.online ? "bg-sky-100 text-sky-900" : "bg-amber-100 text-amber-900"}`}>{net.online ? "Works offline (rules-only) · installable" : "Offline: rules-only audit + template letter"}</span>}
        {progress !== null && progress < 1 && <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-900">Downloading Gemini Nano {Math.round(progress * 100)}%</span>}
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">1 · Your bill</span>
            {samples.map((s, i) => (
              <button key={s.id} data-testid={`sample-${i}`} onClick={() => setText(s.text)} className="rounded-full border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100">Sample {i + 1}</button>
            ))}
          </div>
          <textarea data-testid="bill" wrap="off" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="h-[380px] w-full resize-y rounded-lg border border-neutral-200 bg-neutral-50 p-3 font-mono text-[11.5px] leading-5" />
          <p className="mt-2 text-xs text-neutral-500">Samples are synthetic: fictional patients and providers. Paste a text itemized statement to try your own; nothing is uploaded.</p>
          <div className="mt-3 flex items-center gap-2 text-xs" role="radiogroup" aria-label="Letter language">
            <span className="text-neutral-600">Letter language:</span>
            {(Object.keys(LETTER_LANGS) as LetterLang[]).map((k) => (
              <button key={k} role="radio" aria-checked={lang === k} data-testid={`lang-${k}`} onClick={() => setLang(k)} className={`rounded-full border px-3 py-1 ${lang === k ? "border-emerald-700 bg-emerald-700 text-white" : "border-neutral-300 hover:bg-neutral-100"}`}>{LETTER_LANGS[k]}</button>
            ))}
            <span className="text-neutral-500">The model only sees placeholders in either language; names are re-inserted on your device.</span>
          </div>
          <button data-testid="run" onClick={run} disabled={busy} className="mt-3 w-full rounded-xl bg-emerald-700 py-3 text-base font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">{busy ? "Auditing…" : "Audit privately"}</button>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <span className="text-sm font-semibold">2 · Pipeline</span>
          <ol className="mt-3 space-y-2">
            {STEPS.map((s, i) => { const st = steps[s.key]; return (
              <li key={s.key} data-testid={`step-${s.key}`} data-state={st} className={`flex items-center gap-3 rounded-xl border p-3 ${st === "blocked" ? "border-red-300 bg-red-50" : st === "done" ? "border-emerald-200 bg-emerald-50" : st === "skipped" ? "border-amber-200 bg-amber-50" : "border-neutral-200"}`}>
                <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${st === "done" ? "bg-emerald-600 text-white" : st === "blocked" ? "bg-red-600 text-white" : st === "running" ? "animate-pulse bg-sky-500 text-white" : "bg-neutral-200"}`}>{st === "done" ? "✓" : st === "blocked" ? "!" : i + 1}</span>
                <div className="flex-1"><div className="text-sm font-semibold">{s.label}</div><div className="text-xs text-neutral-600">{s.sub}</div></div>
                <span className="text-[11px] uppercase tracking-wide text-neutral-500">{st}</span>
              </li> ); })}
          </ol>
          {device && <p className="mt-3 text-xs text-neutral-600"><b>On-device pass:</b> {SOURCE_LABEL[device.source]}{device.proposals?.length ? ` · ${device.proposals.length} extra items proposed` : ""}{device.note ? ` · ${device.note}` : ""}</p>}
          {gate && <div data-testid="gate" className={`mt-3 rounded-xl p-3 text-sm ${gate.pass ? "bg-emerald-900 text-emerald-50" : "bg-red-700 text-white"}`}>{gate.pass ? `Leak gate PASSED: 0 identifiers in ${gate.checkedBytes} outbound bytes.` : `BLOCKED: ${gate.leaks.length} identifier(s) survived redaction. Nothing was sent.`}</div>}
          {findings && (
            <div className="mt-4 rounded-xl bg-neutral-900 p-4 text-white">
              <div className="text-xs uppercase tracking-widest text-neutral-400">Disputable amount</div>
              <div data-testid="stake" className="text-4xl font-bold">{usd(stake)}</div>
              <div className="text-xs text-neutral-400">{findings.length} finding(s) · {findings.filter((f) => f.severity === "advisory").length} advisory, not counted</div>
            </div>
          )}
        </div>
      </section>

      {findings && (
        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm" data-testid="findings">
          <span className="text-sm font-semibold">3 · Findings (deterministic, reproducible)</span>
          {findings.length === 0 ? <p className="mt-2 text-sm">No billing errors detected by the 7 rules.</p> : (
            <table className="mt-3 w-full text-sm"><thead><tr className="text-left text-xs uppercase text-neutral-500"><th className="py-1">Rule</th><th>Finding</th><th className="text-right">Amount</th></tr></thead>
              <tbody>{findings.map((f, i) => (
                <tr key={i} className="border-t border-neutral-100 align-top"><td className="py-2 pr-3"><span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${f.severity === "advisory" ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-900"}`}>{f.rule}</span></td>
                  <td className="py-2"><div className="font-medium">{f.title}</div><div className="text-xs text-neutral-600">{f.detail}{f.lines.length ? ` (bill line ${f.lines.join(", ")})` : ""}</div></td>
                  <td className="py-2 text-right font-mono">{usd(f.atStake)}</td></tr>))}</tbody></table>)}
        </section>
      )}

      {redacted && (
        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <span className="text-sm font-semibold">4 · What the redactor produced ({spans.length} identifiers removed)</span>
            <pre data-testid="redacted" className="mt-3 max-h-[360px] overflow-auto whitespace-pre rounded-lg bg-neutral-50 p-3 font-mono text-[11px] leading-5" dangerouslySetInnerHTML={{ __html: redacted.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\[[A-Z_]+_\d+\]/g, (m) => `<span class="ph">${m}</span>`) }} />
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm" data-testid="receipt">
            <span className="text-sm font-semibold">5 · Privacy receipt</span>
            {receipt ? (<>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <dt className="text-neutral-500">Raw bill bytes kept on device</dt><dd className="font-mono">{receipt.rawBytes}</dd>
                <dt className="text-neutral-500">Bytes eligible to leave device</dt><dd className="font-mono">{receipt.bytes}</dd>
                <dt className="text-neutral-500">SHA-256 of outbound payload</dt><dd className="break-all font-mono">{receipt.hash.slice(0, 32)}…</dd>
                <dt className="text-neutral-500">Letter drafted by</dt><dd data-testid="letter-source" data-source={letter?.source ?? ""}>{letter ? SOURCE_LABEL[letter.source] : "…"}{letter?.model ? ` · ${letter.model}` : ""}</dd>
                <dt className="text-neutral-500">Raw-text scrub ran</dt><dd>{device ? SOURCE_LABEL[device.source] : "…"}</dd>
                <dt className="text-neutral-500">Redaction guard</dt><dd>{gate?.pass ? "PASSED" : "BLOCKED"}</dd>
                <dt className="text-neutral-500">App Check</dt><dd data-testid="receipt-appcheck">{fb ? (fb.appCheck.ok ? `token OK (${fb.appCheck.provider})` : `no token (${fb.appCheck.provider}): ${fb.appCheck.error ?? "unknown"}`) : "…"}{letter && letter.source !== "template" && letter.appCheckAttached === false ? " · AI request sent WITHOUT an App Check token (enforcement off; web app registration pending)" : ""}</dd>
                <dt className="text-neutral-500">Letter fact check</dt><dd data-testid="letter-check">{lcheck ? (lcheck.pass ? `PASSED: ${lcheck.amountsChecked} amounts, ${lcheck.codesChecked} codes all traced to findings` : `REJECTED: ${lcheck.issues.join("; ")}`) : letter?.source === "template" ? "n/a (template)" : "…"}</dd>
                {letter?.error && (<><dt className="text-neutral-500">AI call error</dt><dd data-testid="ai-error" className="break-words text-red-700">{letter.error}</dd></>)}
                <dt className="text-neutral-500">Anonymous stats (Firestore)</dt><dd data-testid="store">{store ? (store.ok ? "rule counts + $ bucket saved" : `not saved: ${store.error}`) : "…"}</dd>
              </dl>
              <pre className="mt-3 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-900 p-3 font-mono text-[11px] leading-5 text-emerald-100">{receipt.payload}</pre>
            </>) : <p className="mt-3 text-sm text-neutral-500">Nothing left the device.</p>}
          </div>
        </section>
      )}

      {finalLetter && (
        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm" data-testid="letter" data-lang={letterLang} lang={letterLang}>
          <div className="flex items-center justify-between"><span className="text-sm font-semibold">6 · Your dispute letter (identity re-inserted locally)</span>
            <div className="flex gap-2">
              <button onClick={() => navigator.clipboard.writeText(finalLetter)} className="rounded-full border px-3 py-1 text-xs">Copy</button>
              <a download={`billshield-dispute-letter${letterLang === "es" ? "-es" : ""}.txt`} href={`data:text/plain;charset=utf-8,${encodeURIComponent(finalLetter)}`} className="rounded-full bg-neutral-900 px-3 py-1 text-xs text-white">Download</a>
            </div></div>
          {letter?.note && <p className="mt-1 text-xs text-amber-700">{letter.note}</p>}
          <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-neutral-50 p-4 text-[13px] leading-6">{finalLetter}</pre>
        </section>
      )}

      <footer className="mt-10 border-t border-neutral-200 pt-4 text-xs text-neutral-500">Not legal or medical advice. Reference prices are illustrative, not a fee schedule. Open source (Apache-2.0) · Built for #BuildHybridAI 2026 by dl88jing · Green Robin Labs.</footer>
    </main>
  );
}
