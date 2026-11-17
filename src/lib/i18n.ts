// Deterministic localization of audit findings for non-English dispute letters.
// Every amount stays in US format with a leading $ and every billing code stays verbatim,
// so the same fact checker can trace a localized letter back to the findings.
import type { Finding, RuleId } from "./audit";

export type Lang = "en" | "es" | "ja";
type L10n = Exclude<Lang, "en">;

/** US format with thousands separators ($2,321.00), the exact form the prompt asks the model to keep. */
const usd = (n: number | string | undefined) => `$${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Statement dates are MM/DD/YYYY (US). Spell them out so they are unambiguous in the target language. */
export function localDate(mdy: string | number | undefined, lang: L10n): string {
  const m = String(mdy ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return String(mdy ?? "");
  const [mo, d, y] = [Number(m[1]), Number(m[2]), m[3]];
  return lang === "es" ? `${d} de ${MONTHS_ES[mo - 1]} de ${y}` : `${y}年${mo}月${d}日`;
}

/** Common panel / reference service names (from audit.ts PANELS and REFERENCE). Unknown codes fall back to the code alone. */
const SERVICE: Record<string, { es: string; ja: string }> = {
  "80053": { es: "panel metabólico completo", ja: "総合代謝パネル" }, "80048": { es: "panel metabólico básico", ja: "基本代謝パネル" },
  "85025": { es: "hemograma completo con diferencial", ja: "血算（白血球分画付き）" }, "80061": { es: "perfil lipídico", ja: "脂質パネル" },
  "99285": { es: "visita de urgencias, gravedad alta", ja: "救急外来受診（重症度：高）" }, "99284": { es: "visita de urgencias, gravedad moderada-alta", ja: "救急外来受診（重症度：中〜高）" },
  "99283": { es: "visita de urgencias, gravedad moderada", ja: "救急外来受診（重症度：中）" }, "99214": { es: "consulta de paciente establecido", ja: "再診（既存患者）" },
  "99215": { es: "consulta de paciente establecido, complejidad alta", ja: "再診（既存患者・高難度）" }, "99213": { es: "consulta de paciente establecido, complejidad baja", ja: "再診（既存患者・低難度）" },
  "82947": { es: "glucosa", ja: "血糖" }, "82565": { es: "creatinina", ja: "クレアチニン" }, "84132": { es: "potasio", ja: "カリウム" },
  "85018": { es: "hemoglobina", ja: "ヘモグロビン" }, "85014": { es: "hematocrito", ja: "ヘマトクリット" }, "36415": { es: "venopunción", ja: "静脈採血" },
  "71046": { es: "radiografía de tórax, 2 proyecciones", ja: "胸部X線（2方向）" }, "93005": { es: "trazado de ECG", ja: "心電図記録" },
  "96374": { es: "inyección IV directa, inicial", ja: "静脈注射（初回）" }, "J1885": { es: "inyección de ketorolaco, 15 mg", ja: "ケトロラク注射 15mg" },
  "74177": { es: "TC de abdomen y pelvis con contraste", ja: "腹部・骨盤CT（造影）" }, "J2405": { es: "inyección de ondansetrón, 1 mg", ja: "オンダンセトロン注射 1mg" },
  "96360": { es: "hidratación IV, primera hora", ja: "点滴による水分補給（初回1時間）" },
};
export const serviceName = (code: string | number | undefined, lang: L10n): string => SERVICE[String(code ?? "")]?.[lang] ?? "";
const named = (code: string | number | undefined, lang: L10n) => { const n = serviceName(code, lang); return n ? (lang === "es" ? `${code} (${n})` : `${code}（${n}）`) : String(code ?? ""); };

export const RULE_TITLE: Record<L10n, Record<RuleId, string>> = {
  es: { DUPLICATE: "Posible cargo duplicado", MATH: "Error de cálculo en la línea", TOTAL: "El subtotal no coincide con las líneas",
    UNBUNDLE: "Análisis de laboratorio facturado por separado (incluido en un panel)", POST_DISCHARGE: "Cargo posterior al alta",
    PRICE_OUTLIER: "Precio muy superior al habitual (solo para revisión)", DOUBLE_EM: "Varias visitas (E/M) el mismo día" },
  ja: { DUPLICATE: "重複請求の可能性", MATH: "明細行の計算誤り", TOTAL: "小計が明細の合計と一致しない",
    UNBUNDLE: "パネル検査に含まれる項目の個別請求", POST_DISCHARGE: "退院後の日付の請求",
    PRICE_OUTLIER: "一般的な料金を大きく上回る単価（確認のみ）", DOUBLE_EM: "同日に複数の診察（E/M）コード" },
};

/** Localized one-sentence detail built from `facts`. Returns null when the finding has no structured facts (caller falls back). */
export function localizedDetail(f: Finding, lang: L10n): string | null {
  const x = f.facts; if (!x) return null;
  const es = lang === "es";
  switch (f.rule) {
    case "MATH": return es ? `${x.qty} × ${usd(x.unit)} = ${usd(x.expect)}, pero se facturó ${usd(x.amount)}.` : `${x.qty} × ${usd(x.unit)} = ${usd(x.expect)} のところ、${usd(x.amount)} が請求されています。`;
    case "DUPLICATE": return es ? `El servicio «${serviceName(f.cpt, lang) || x.desc}» se facturó dos veces el ${localDate(x.date, lang)}, por ${usd(x.amount)} cada vez.` : `「${serviceName(f.cpt, lang) || x.desc}」が${localDate(x.date, lang)}に2回、各${usd(x.amount)}で請求されています。`;
    case "UNBUNDLE": return es ? `${named(x.comp, lang)} es un componente del ${named(x.panel, lang)}, facturado el mismo día.` : `${named(x.comp, lang)}は、同日に請求された${named(x.panel, lang)}に含まれる検査項目です。`;
    case "DOUBLE_EM": return es ? `${x.codes} el mismo día (${localDate(x.date, lang)}); normalmente solo se paga un nivel de E/M por encuentro.` : `${localDate(x.date, lang)}に${x.codes}が請求されています。通常、1回の受診で支払対象となるE/Mレベルは1つのみです。`;
    case "POST_DISCHARGE": return es ? `Servicio con fecha del ${localDate(x.date, lang)}, posterior al alta del ${localDate(x.discharge, lang)}.` : `サービス日が${localDate(x.date, lang)}で、退院日（${localDate(x.discharge, lang)}）より後です。`;
    case "PRICE_OUTLIER": return es ? `${usd(x.unit)} por unidad supera ${x.multiple} veces el cargo habitual de ${usd(x.typical)} por ${named(f.cpt, lang)}. Solicito una justificación detallada.` : `${named(f.cpt, lang)}の単価${usd(x.unit)}は、一般的な料金${usd(x.typical)}の${x.multiple}倍を超えています。明細の根拠をご説明ください。`;
    case "TOTAL": return es ? `Las líneas suman ${usd(x.sum)}, pero el estado de cuenta indica ${usd(x.subtotal)}.` : `明細の合計は${usd(x.sum)}ですが、請求書の小計は${usd(x.subtotal)}となっています。`;
  }
}

export function localizedFinding(f: Finding, lang: Lang): { title: string; detail: string } {
  if (lang === "en") return { title: f.title, detail: f.detail };
  const code = f.cpt ? (lang === "es" ? ` (código ${f.cpt})` : `（コード${f.cpt}）`) : "";
  return { title: `${RULE_TITLE[lang][f.rule]}${code}`, detail: localizedDetail(f, lang) ?? f.detail };
}
