"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { makeBill, DEMO_SEEDS } from "@/lib/samples";
import { detectPii, acceptModelProposals, redact, leakGate, rehydrate, type PiiSpan, type GateResult } from "@/lib/pii";
import { parseBill, audit, totalAtStake, type Finding } from "@/lib/audit";
import { buildPayload, templateLetter, checkLetter, stripInternalTags, LETTER_LANGS, type LetterCheck, type LetterLang } from "@/lib/letter";
import { capabilities, warmUpOnDevice, proposePiiOnDevice, draftLetter, firebaseReady, recordAggregate, status as fbStatus, type Capabilities, type ModelResult, type FirebaseStatus } from "@/lib/hybrid";
import { buildAggregate } from "@/lib/stats";
import { useOfflineState } from "@/lib/offline";
import { localizedFinding } from "@/lib/i18n";
import { UI, type StepKey, type StepState } from "@/lib/ui-i18n";
import { useUiLang } from "@/lib/use-ui-lang";
import { UiLangSwitch } from "@/components/ui-lang-switch";

const STEP_KEYS: StepKey[] = ["scan", "device", "gate", "audit", "letter"];
type Key = StepKey;

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

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
  const [uiLang, setUiLang] = useUiLang();
  const t = UI[uiLang];
  useEffect(() => { setLang(uiLang); }, [uiLang]); // letter language follows the UI language; can be changed independently below

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
    const payload = buildPayload(f, Object.keys(red.vault), bill.provider, lang);
    const g = leakGate(payload, red.vault);
    setGate(g);
    if (!g.pass) { set("gate", "blocked"); set("letter", "skipped"); setBusy(false); return; }
    set("gate", "done");
    setReceipt({ payload, bytes: g.checkedBytes, hash: await sha256(payload), rawBytes: new TextEncoder().encode(text).length });

    set("letter", "running");
    let l: ModelResult = offline
      ? { text: templateLetter(f, Object.keys(red.vault), bill.provider, lang), source: "template", ms: 0, note: t.noteOffline }
      : await draftLetter(payload, () => templateLetter(f, Object.keys(red.vault), bill.provider, lang), lang);
    // internal rule tags ([MATH], [DUP], 【RULE】 …) are removed deterministically before the fact check and display
    if (l.source !== "template") l = { ...l, text: stripInternalTags(l.text).text };
    if (l.source !== "template") {
      const lc = checkLetter(l.text, f, Object.keys(red.vault));
      setLcheck(lc);
      if (!lc.pass) l = { ...l, text: templateLetter(f, Object.keys(red.vault), bill.provider, lang), source: "template", note: t.noteRejected(lc.issues.join("; ")) };
    }
    // final guard: the model output itself must not contain raw identifiers before re-insertion
    if (!leakGate(l.text, red.vault).pass) l = { ...l, text: templateLetter(f, Object.keys(red.vault), bill.provider, lang), source: "template", note: t.noteIdentifier };
    setLetter(l); setLetterLang(lang);
    setFinalLetter(rehydrate(l.text, red.vault)); // identity re-inserted locally, never sent
    set("letter", "done");
    if (offline) setStore({ ok: false, error: "offline, nothing sent" });
    else recordAggregate(buildAggregate(f, dev.source, l.source)).then(setStore);
    setBusy(false);
  }

  const stake = findings ? totalAtStake(findings) : 0;
  const shown = findings?.map((f) => ({ f, ...localizedFinding(f, uiLang) }));
  return (
    <main className="mx-auto max-w-6xl px-5 py-8" lang={uiLang} data-ui-lang={uiLang}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">#BuildHybridAI · Web (Chrome)</p>
          <h1 className="mt-1 text-4xl font-bold tracking-tight">BillShield</h1>
          <p data-testid="tagline" className="mt-2 max-w-2xl text-[15px] text-neutral-700">{t.tagline[0]}<b>{t.tagline[1]}</b>{t.tagline[2]}</p>
        </div>
        <nav className="flex flex-wrap items-center gap-3 text-sm">
          <UiLangSwitch lang={uiLang} onChange={setUiLang} />
          <Link href="/eval" className="rounded-full border border-neutral-300 px-4 py-2 hover:bg-white">{t.navEval}</Link>
          <a href="https://github.com/dl88jing/billshield" className="rounded-full bg-neutral-900 px-4 py-2 text-white">GitHub</a>
        </nav>
      </header>

      <section data-testid="caps" className="mt-5 flex flex-wrap gap-2 text-xs">
        <span className={`rounded-full px-3 py-1 ${caps?.firebase ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>{t.fbLabel}: {caps ? (caps.firebase ? t.fbConnected(fb?.projectId ?? "") : t.fbNotConfigured) : "…"}</span>
        {fb && <span data-testid="appcheck" data-ok={fb.appCheck.ok === null ? "" : fb.appCheck.ok ? "1" : "0"} className={`rounded-full px-3 py-1 ${fb.appCheck.ok ? "bg-emerald-100 text-emerald-900" : fb.appCheck.ok === false ? "bg-amber-100 text-amber-900" : "bg-neutral-200"}`}>{t.appCheck(fb.appCheck.provider)}: {fb.appCheck.ok ? t.tokenOk : fb.appCheck.ok === false ? t.noToken : t.checking}</span>}
        {fb && <span className="rounded-full bg-neutral-200 px-3 py-1">{t.cloudModel}: {fb.remoteConfig.cloudModel}{fb.remoteConfig.ok ? t.viaRemoteConfig : ""}</span>}
        <span className="rounded-full bg-neutral-200 px-3 py-1">{t.onDeviceModel}: {caps ? t.onDeviceValue(caps.onDevice) : "…"}</span>
        {(net.offlineReady || !net.online) && <span data-testid="offline" data-online={net.online ? "1" : "0"} title={t.offlineTitle} className={`rounded-full px-3 py-1 ${net.online ? "bg-sky-100 text-sky-900" : "bg-amber-100 text-amber-900"}`}>{net.online ? t.offlineReady : t.offlineNow}</span>}
        {progress !== null && progress < 1 && <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-900">{t.downloadingNano(Math.round(progress * 100))}</span>}
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{t.yourBill}</span>
            {samples.map((s, i) => (
              <button key={s.id} data-testid={`sample-${i}`} onClick={() => setText(s.text)} className="rounded-full border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100">{t.sample(i + 1)}</button>
            ))}
          </div>
          <textarea data-testid="bill" lang="en" wrap="off" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="h-[380px] w-full resize-y rounded-lg border border-neutral-200 bg-neutral-50 p-3 font-mono text-[11.5px] leading-5" />
          <p className="mt-2 text-xs text-neutral-500">{t.samplesNote}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" role="radiogroup" aria-label={t.letterLanguage}>
            <span className="text-neutral-600">{t.letterLanguage}</span>
            {(Object.keys(LETTER_LANGS) as LetterLang[]).map((k) => (
              <button key={k} role="radio" aria-checked={lang === k} lang={k} data-testid={`lang-${k}`} onClick={() => setLang(k)} className={`rounded-full border px-3 py-1 ${lang === k ? "border-emerald-700 bg-emerald-700 text-white" : "border-neutral-300 hover:bg-neutral-100"}`}>{LETTER_LANGS[k]}</button>
            ))}
            <span className="text-neutral-500">{t.letterLangNote}</span>
          </div>
          <button data-testid="run" onClick={run} disabled={busy} className="mt-3 w-full rounded-xl bg-emerald-700 py-3 text-base font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">{busy ? t.running : t.run}</button>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <span className="text-sm font-semibold">{t.pipeline}</span>
          <ol className="mt-3 space-y-2">
            {STEP_KEYS.map((k, i) => { const st = steps[k]; return (
              <li key={k} data-testid={`step-${k}`} data-state={st} className={`flex items-center gap-3 rounded-xl border p-3 ${st === "blocked" ? "border-red-300 bg-red-50" : st === "done" ? "border-emerald-200 bg-emerald-50" : st === "skipped" ? "border-amber-200 bg-amber-50" : "border-neutral-200"}`}>
                <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${st === "done" ? "bg-emerald-600 text-white" : st === "blocked" ? "bg-red-600 text-white" : st === "running" ? "animate-pulse bg-sky-500 text-white" : "bg-neutral-200"}`}>{st === "done" ? "✓" : st === "blocked" ? "!" : i + 1}</span>
                <div className="flex-1"><div className="text-sm font-semibold">{t.steps[k].label}</div><div className="text-xs text-neutral-600">{t.steps[k].sub}</div></div>
                <span className="text-[11px] uppercase tracking-wide text-neutral-500">{t.stepState[st as StepState]}</span>
              </li> ); })}
          </ol>
          {device && <p className="mt-3 text-xs text-neutral-600"><b>{t.onDevicePass}</b> {t.source[device.source]}{device.proposals?.length ? ` · ${t.extraProposed(device.proposals.length)}` : ""}{device.note ? ` · ${t.modelNote(device.note)}` : ""}</p>}
          {gate && <div data-testid="gate" data-pass={gate.pass ? "1" : "0"} className={`mt-3 rounded-xl p-3 text-sm ${gate.pass ? "bg-emerald-900 text-emerald-50" : "bg-red-700 text-white"}`}>{gate.pass ? t.gatePass(gate.checkedBytes) : t.gateBlocked(gate.leaks.length)}</div>}
          {findings && (
            <div className="mt-4 rounded-xl bg-neutral-900 p-4 text-white">
              <div className="text-xs uppercase tracking-widest text-neutral-400">{t.disputable}</div>
              <div data-testid="stake" className="text-4xl font-bold">{usd(stake)}</div>
              <div className="text-xs text-neutral-400">{t.findingsCount(findings.length, findings.filter((f) => f.severity === "advisory").length)}</div>
            </div>
          )}
        </div>
      </section>

      {shown && (
        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm" data-testid="findings">
          <span className="text-sm font-semibold">{t.findingsTitle}</span>
          {shown.length === 0 ? <p className="mt-2 text-sm">{t.noFindings}</p> : (
            <table className="mt-3 w-full text-sm"><thead><tr className="text-left text-xs uppercase text-neutral-500"><th className="py-1">{t.thRule}</th><th>{t.thFinding}</th><th className="text-right">{t.thAmount}</th></tr></thead>
              <tbody>{shown.map(({ f, title, detail }, i) => (
                <tr key={i} className="border-t border-neutral-100 align-top"><td className="py-2 pr-3"><span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${f.severity === "advisory" ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-900"}`}>{f.rule}</span></td>
                  <td className="py-2"><div className="font-medium">{title}</div><div className="text-xs text-neutral-600">{detail}{f.lines.length ? t.billLine(f.lines.join(", ")) : ""}</div></td>
                  <td className="py-2 text-right font-mono">{usd(f.atStake)}</td></tr>))}</tbody></table>)}
        </section>
      )}

      {redacted && (
        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <span className="text-sm font-semibold">{t.redactorTitle(spans.length)}</span>
            <pre data-testid="redacted" lang="en" className="mt-3 max-h-[360px] overflow-auto whitespace-pre rounded-lg bg-neutral-50 p-3 font-mono text-[11px] leading-5" dangerouslySetInnerHTML={{ __html: redacted.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\[[A-Z_]+_\d+\]/g, (m) => `<span class="ph">${m}</span>`) }} />
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm" data-testid="receipt">
            <span className="text-sm font-semibold">{t.receiptTitle}</span>
            {receipt ? (<>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <dt className="text-neutral-500">{t.rawBytes}</dt><dd className="font-mono">{receipt.rawBytes}</dd>
                <dt className="text-neutral-500">{t.outBytes}</dt><dd className="font-mono">{receipt.bytes}</dd>
                <dt className="text-neutral-500">{t.sha}</dt><dd className="break-all font-mono">{receipt.hash.slice(0, 32)}…</dd>
                <dt className="text-neutral-500">{t.letterBy}</dt><dd data-testid="letter-source" data-source={letter?.source ?? ""}>{letter ? t.source[letter.source] : "…"}{letter?.model ? ` · ${letter.model}` : ""}</dd>
                <dt className="text-neutral-500">{t.scrubRan}</dt><dd>{device ? t.source[device.source] : "…"}</dd>
                <dt className="text-neutral-500">{t.guard}</dt><dd>{gate?.pass ? t.passed : t.blocked}</dd>
                <dt className="text-neutral-500">{t.appCheckRow}</dt><dd data-testid="receipt-appcheck" data-ok={fb ? (fb.appCheck.ok ? "1" : "0") : ""}>{fb ? (fb.appCheck.ok ? t.appCheckOk(fb.appCheck.provider) : t.appCheckNo(fb.appCheck.provider, fb.appCheck.error ?? "unknown")) : "…"}{letter && letter.source !== "template" && letter.appCheckAttached === false ? t.sentWithoutToken : ""}</dd>
                <dt className="text-neutral-500">{t.factCheck}</dt><dd data-testid="letter-check" data-pass={lcheck ? (lcheck.pass ? "1" : "0") : letter?.source === "template" ? "na" : ""}>{lcheck ? (lcheck.pass ? t.factPassed(lcheck.amountsChecked, lcheck.codesChecked) : t.factRejected(lcheck.issues.join("; "))) : letter?.source === "template" ? t.naTemplate : "…"}</dd>
                {letter?.error && (<><dt className="text-neutral-500">{t.aiError}</dt><dd data-testid="ai-error" className="break-words text-red-700">{letter.error}</dd></>)}
                <dt className="text-neutral-500">{t.stats}</dt><dd data-testid="store" data-ok={store ? (store.ok ? "1" : "0") : ""}>{store ? (store.ok ? t.statsSaved : t.statsNot(store.error ?? "")) : "…"}</dd>
              </dl>
              <pre lang="en" className="mt-3 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-900 p-3 font-mono text-[11px] leading-5 text-emerald-100">{receipt.payload}</pre>
            </>) : <p className="mt-3 text-sm text-neutral-500">{t.nothingLeft}</p>}
          </div>
        </section>
      )}

      {finalLetter && (
        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm" data-testid="letter" data-lang={letterLang} lang={letterLang}>
          <div className="flex items-center justify-between"><span className="text-sm font-semibold" lang={uiLang}>{t.letterTitle}</span>
            <div className="flex gap-2" lang={uiLang}>
              <button onClick={() => navigator.clipboard.writeText(finalLetter)} className="rounded-full border px-3 py-1 text-xs">{t.copy}</button>
              <a download={`billshield-dispute-letter${letterLang === "en" ? "" : `-${letterLang}`}.txt`} href={`data:text/plain;charset=utf-8,${encodeURIComponent(finalLetter)}`} className="rounded-full bg-neutral-900 px-3 py-1 text-xs text-white">{t.download}</a>
            </div></div>
          {letter?.note && <p className="mt-1 text-xs text-amber-700" lang={uiLang}>{t.modelNote(letter.note)}</p>}
          <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-neutral-50 p-4 text-[13px] leading-6">{finalLetter}</pre>
        </section>
      )}

      <footer className="mt-10 border-t border-neutral-200 pt-4 text-xs text-neutral-500">{t.footer}</footer>
    </main>
  );
}
