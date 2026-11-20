"use client";
import type { Lang } from "@/lib/i18n";
import { UI, UI_LANGS, UI_LANG_SHORT } from "@/lib/ui-i18n";

/** 🌐 EN / ES / 日本語 switcher shared by the home page and /eval (same storage key via useUiLang). */
export function UiLangSwitch({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div role="radiogroup" aria-label={UI[lang].uiLang} data-testid="ui-lang" className="flex items-center rounded-full border border-neutral-300 bg-white p-0.5 text-xs">
      <span aria-hidden className="px-2 text-neutral-600">🌐</span>
      {(Object.keys(UI_LANGS) as Lang[]).map((k) => (
        <button key={k} role="radio" aria-checked={lang === k} aria-label={UI_LANGS[k]} title={UI_LANGS[k]} lang={k} data-testid={`ui-lang-${k}`} onClick={() => onChange(k)} className={`rounded-full px-3 py-1.5 ${lang === k ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"}`}>{UI_LANG_SHORT[k]}</button>
      ))}
    </div>
  );
}
