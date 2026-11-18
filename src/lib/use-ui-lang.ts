"use client";
import { useCallback, useEffect, useState } from "react";
import type { Lang } from "./i18n";
import { resolveUiLang, isLang, UI_LANG_STORAGE_KEY } from "./ui-i18n";

/** UI language: saved choice (localStorage, the language code only) > navigator.languages > English.
 *  Starts as English so server and first client render match, then switches after mount. */
export function useUiLang(): [Lang, (l: Lang) => void, boolean] {
  const [lang, setLangState] = useState<Lang>("en");
  const [resolved, setResolved] = useState(false);
  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem(UI_LANG_STORAGE_KEY); } catch { /* storage blocked */ }
    setLangState(resolveUiLang(stored, navigator.languages?.length ? navigator.languages : [navigator.language]));
    setResolved(true);
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = useCallback((l: Lang) => {
    if (!isLang(l)) return;
    setLangState(l);
    try { localStorage.setItem(UI_LANG_STORAGE_KEY, l); } catch { /* storage blocked */ }
  }, []);
  return [lang, setLang, resolved];
}
