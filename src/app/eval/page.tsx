import Link from "next/link";
import results from "../../../public/eval/results.json";

export const metadata = { title: "BillShield · Measured results" };
const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 1000) / 10}%`);

export default function Eval() {
  const r = results;
  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <Link href="/" className="text-sm text-emerald-700">← Back to BillShield</Link>
      <h1 className="mt-2 text-3xl font-bold">Measured results, misses included</h1>
      <p className="mt-2 text-sm text-neutral-700">{r.bills} seeded synthetic bills · mode: <b>{r.mode}</b> · generated {new Date(r.generatedAt).toUTCString()} · {r.runtimeMs} ms total. Reproduce with <code className="rounded bg-neutral-200 px-1">npm run eval</code>.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        {[["Labeled PII leaked", `${r.pii.labeledLeaked} / ${r.pii.labeledTotal}`], ["Free-text PII leaked (rules-only)", `${r.pii.hardLeaked} / ${r.pii.hardTotal}`], ["Clean bills falsely flagged", `${r.cleanBillsFlagged} / ${r.cleanBills}`], ["Disputable $ found", `$${r.totalAtStakeUsd.toLocaleString()}`]].map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-neutral-200 bg-white p-4"><div className="text-xs text-neutral-500">{k}</div><div className="mt-1 text-2xl font-bold">{v}</div></div>))}
      </div>

      <h2 className="mt-8 text-lg font-semibold">Billing-error rules</h2>
      <table className="mt-2 w-full rounded-xl bg-white text-sm"><thead><tr className="text-left text-xs uppercase text-neutral-500"><th className="p-2">Rule</th><th>TP</th><th>FP</th><th>FN</th><th>Precision</th><th>Recall</th></tr></thead>
        <tbody>{r.rules.map((x) => (<tr key={x.rule} className="border-t border-neutral-100"><td className="p-2 font-mono">{x.rule}</td><td>{x.tp}</td><td>{x.fp}</td><td>{x.fn}</td><td>{pct(x.precision)}</td><td>{pct(x.recall)}</td></tr>))}</tbody></table>

      <h2 className="mt-8 text-lg font-semibold">Every miss ({r.misses.length})</h2>
      <p className="text-sm text-neutral-600">The free-text leaks are why BillShield adds an on-device Gemini Nano pass: the regex layer alone misses spaced phone numbers, spelled-out birthdays and first names in notes. Model-on numbers will be added after measuring in Chrome with Nano.</p>
      <div className="mt-2 max-h-[420px] overflow-auto rounded-xl bg-white">
        <table className="w-full text-xs"><tbody>{r.misses.map((m, i) => (<tr key={i} className="border-t border-neutral-100"><td className="p-2 font-mono">{m.bill}</td><td className="p-2">{m.kind}</td><td className="p-2 font-mono text-neutral-600">{m.detail}</td></tr>))}</tbody></table>
      </div>

      <h2 className="mt-8 text-lg font-semibold">Notes</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-700">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>
    </main>
  );
}
