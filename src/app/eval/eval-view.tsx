"use client";
import Link from "next/link";
import { EVAL_UI, UI, formatEvalDate } from "@/lib/ui-i18n";
import { useUiLang } from "@/lib/use-ui-lang";
import { UiLangSwitch } from "@/components/ui-lang-switch";
import type { Source } from "@/lib/hybrid";

type Rule = { rule: string; tp: number; fp: number; fn: number; precision: number | null; recall: number | null };
type Miss = { bill: string; kind: string; detail: string };
export type Results = {
  generatedAt: string; mode: string; bills: number; runtimeMs: number; rules: Rule[]; cleanBills: number; cleanBillsFlagged: number;
  totalAtStakeUsd: number; pii: { labeledLeaked: number; labeledTotal: number; hardLeaked: number; hardTotal: number }; misses: Miss[]; notes: string[];
};
type CloudRow = { bill: string; source: string; gatePass: boolean; factCheck: string; aiError?: string; seconds: number };
export type Cloud = { n: number; rows: CloudRow[]; generatedAt?: string; model?: string; browser?: string; cloudLetters?: number; factCheckPassed?: number; rejectedToTemplate?: number; gatePassed?: number };
export type HistoryRun = { run: string; at: string; cloudLettersAccepted: number; rejectedByChecker: number; aiCallsFailed: number; finding: string };

const pct = (v: number | null, na: string) => (v === null ? na : `${Math.round(v * 1000) / 10}%`);
const Card = ({ k, v }: { k: string; v: string | number | undefined }) => (
  <div className="rounded-2xl border border-neutral-200 bg-white p-4"><div className="text-xs text-neutral-600">{k}</div><div className="mt-1 text-2xl font-bold">{v}</div></div>
);

export default function EvalView({ r, cloud, history }: { r: Results; cloud: Cloud; history: HistoryRun[] }) {
  const [lang, setLang] = useUiLang();
  const t = EVAL_UI[lang];
  const src = UI[lang].source as Record<string, string>;
  return (
    <main className="mx-auto max-w-5xl px-5 py-8" lang={lang} data-ui-lang={lang}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/" data-testid="eval-back" className="text-sm text-emerald-700">{t.back}</Link>
        <UiLangSwitch lang={lang} onChange={setLang} />
      </div>
      <h1 data-testid="eval-title" className="mt-2 text-3xl font-bold">{t.title}</h1>
      <p className="mt-2 text-sm text-neutral-700">{t.summary(r.bills, t.mode(r.mode), formatEvalDate(r.generatedAt, lang), r.runtimeMs)} {t.reproduce} <code className="rounded bg-neutral-200 px-1">npm run eval</code>.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <Card k={t.cards.labeledLeaked} v={`${r.pii.labeledLeaked} / ${r.pii.labeledTotal}`} />
        <Card k={t.cards.freeTextLeaked} v={`${r.pii.hardLeaked} / ${r.pii.hardTotal}`} />
        <Card k={t.cards.cleanFlagged} v={`${r.cleanBillsFlagged} / ${r.cleanBills}`} />
        <Card k={t.cards.disputable} v={`$${r.totalAtStakeUsd.toLocaleString("en-US")}`} />
      </div>

      <h2 className="mt-8 text-lg font-semibold">{t.rulesTitle}</h2>
      <table data-testid="eval-rules" className="mt-2 w-full rounded-xl bg-white text-sm"><thead><tr className="text-left text-xs uppercase text-neutral-600"><th scope="col" className="p-2">{t.thRule}</th><th scope="col">{t.thTp}</th><th scope="col">{t.thFp}</th><th scope="col">{t.thFn}</th><th scope="col">{t.thPrecision}</th><th scope="col">{t.thRecall}</th></tr></thead>
        <tbody>{r.rules.map((x) => (<tr key={x.rule} className="border-t border-neutral-100"><td className="p-2 font-mono">{x.rule}</td><td>{x.tp}</td><td>{x.fp}</td><td>{x.fn}</td><td>{pct(x.precision, t.na)}</td><td>{pct(x.recall, t.na)}</td></tr>))}</tbody></table>

      <h2 className="mt-8 text-lg font-semibold">{t.missesTitle(r.misses.length)}</h2>
      <p className="text-sm text-neutral-600">{t.missesNote}</p>
      <div className="mt-2 max-h-[420px] overflow-auto rounded-xl bg-white">
        <table className="w-full text-xs"><caption className="sr-only">{t.missesTitle(r.misses.length)}</caption><thead className="sr-only"><tr><th scope="col">{t.thBill}</th><th scope="col">{t.thKind}</th><th scope="col">{t.thDetail}</th></tr></thead><tbody>{r.misses.map((m, i) => (<tr key={i} className="border-t border-neutral-100"><td className="p-2 font-mono">{m.bill}</td><td className="p-2">{t.missKind(m.kind)}</td><td className="p-2 font-mono text-neutral-600" lang="en">{m.detail}</td></tr>))}</tbody></table>
      </div>

      <h2 className="mt-10 text-lg font-semibold">{t.cloudTitle}</h2>
      <p className="text-sm text-neutral-600">{t.cloudNote}</p>
      {cloud.n > 0 ? (<>
        <div className="mt-3 grid gap-4 sm:grid-cols-4">
          <Card k={t.cloudCards.bills} v={cloud.n} />
          <Card k={t.cloudCards.accepted} v={`${cloud.factCheckPassed} / ${cloud.n}`} />
          <Card k={t.cloudCards.rejected} v={cloud.rejectedToTemplate} />
          <Card k={t.cloudCards.guard} v={`${cloud.gatePassed} / ${cloud.n}`} />
        </div>
        <p className="mt-2 text-xs text-neutral-600" lang="en">{cloud.model} · {cloud.browser} · {cloud.generatedAt}</p>
        <div className="mt-2 max-h-[300px] overflow-auto rounded-xl bg-white"><table className="w-full text-xs"><caption className="sr-only">{t.cloudTitle}</caption><thead className="sr-only"><tr><th scope="col">{t.thBill}</th><th scope="col">{t.thPath}</th><th scope="col">{t.thFactCheck}</th><th scope="col">{t.thError}</th></tr></thead><tbody>{cloud.rows.map((x) => (
          <tr key={x.bill} className="border-t border-neutral-100"><td className="p-2 font-mono">{x.bill}</td><td className="p-2">{src[x.source as Source] ?? x.source}</td><td className="p-2">{t.factCheck(x.factCheck)}</td><td className="p-2 text-red-700" lang="en">{x.aiError}</td></tr>))}</tbody></table></div>
      </>) : <p className="mt-2 text-sm">{t.pending}</p>}
      <h3 className="mt-4 text-sm font-semibold">{t.historyTitle}</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-neutral-700">{history.map((h) => <li key={h.run}><b>{h.run}</b> ({formatEvalDate(h.at, lang)}): {t.historyLine(h.cloudLettersAccepted, h.rejectedByChecker, h.aiCallsFailed)} <span lang="en">{h.finding}</span></li>)}</ul>

      <h2 className="mt-8 text-lg font-semibold">{t.notesTitle}</h2>
      <p className="text-xs text-neutral-600">{t.recordedInEnglish}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-700" lang="en">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>
    </main>
  );
}
