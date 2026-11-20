// UI chrome strings for English, Español and 日本語.
// Pure data + pure functions: no network, no storage access here (the hook in use-ui-lang.ts does that),
// so the language choice can never change what leaves the device. The outbound payload depends only on
// the *letter* language, built by letter.ts behind the same leak gate in every language.
import type { Lang } from "./i18n";
import type { Source } from "./hybrid";

export const UI_LANGS: Record<Lang, string> = { en: "English", es: "Español", ja: "日本語" };
export const UI_LANG_SHORT: Record<Lang, string> = { en: "EN", es: "ES", ja: "日本語" };
export const UI_LANG_STORAGE_KEY = "billshield.uiLang";
export type StepKey = "scan" | "device" | "gate" | "audit" | "letter";
export type StepState = "idle" | "running" | "done" | "blocked" | "skipped";

export const isLang = (v: unknown): v is Lang => v === "en" || v === "es" || v === "ja";

/** Stored choice wins if valid; otherwise the first supported entry of navigator.languages; otherwise English. */
export function resolveUiLang(stored: string | null | undefined, browserLangs: readonly string[] | undefined): Lang {
  if (isLang(stored)) return stored;
  for (const l of browserLangs ?? []) {
    const base = String(l).toLowerCase().split(/[-_]/)[0];
    if (isLang(base)) return base;
  }
  return "en";
}

export interface UiStrings {
  tagline: [string, string, string]; // before, bold, after
  navEval: string;
  uiLang: string;
  fbConnected: (project: string) => string; fbNotConfigured: string; fbLabel: string;
  appCheck: (provider: string) => string; tokenOk: string; noToken: string; checking: string;
  cloudModel: string; viaRemoteConfig: string;
  onDeviceModel: string; onDeviceValue: (raw: string) => string;
  offlineReady: string; offlineNow: string; offlineTitle: string;
  downloadingNano: (pct: number) => string;
  yourBill: string; sample: (n: number) => string; samplesNote: string;
  letterLanguage: string; letterLangNote: string;
  run: string; running: string;
  pipeline: string;
  steps: Record<StepKey, { label: string; sub: string }>;
  stepState: Record<StepState, string>;
  onDevicePass: string; extraProposed: (n: number) => string;
  gatePass: (bytes: number) => string; gateBlocked: (n: number) => string;
  disputable: string; findingsCount: (n: number, advisory: number) => string;
  findingsTitle: string; noFindings: string; thRule: string; thFinding: string; thAmount: string; billLine: (lines: string) => string;
  redactorTitle: (n: number) => string;
  receiptTitle: string; rawBytes: string; outBytes: string; sha: string; letterBy: string; scrubRan: string; guard: string;
  passed: string; blocked: string; appCheckRow: string;
  appCheckOk: (provider: string) => string; appCheckNo: (provider: string, err: string) => string; sentWithoutToken: string;
  factCheck: string; factPassed: (amounts: number, codes: number) => string; factRejected: (issues: string) => string; naTemplate: string;
  aiError: string; stats: string; statsSaved: string; statsNot: (err: string) => string; nothingLeft: string;
  source: Record<Source, string>;
  letterTitle: string; copy: string; download: string;
  noteOffline: string; noteRejected: (issues: string) => string; noteIdentifier: string;
  footer: string;
  /** Diagnostic notes produced by hybrid.ts (English) shown in the UI language; unknown notes pass through verbatim. */
  modelNote: (note: string) => string;
}

/** English note text from hybrid.ts -> translation. A unit test checks every note in hybrid.ts is covered. */
const MODEL_NOTES: Record<"es" | "ja", Record<string, string>> = {
  es: {
    "No on-device model in this browser, so rules-only scrub used (raw text is never sent to the cloud)": "Este navegador no tiene modelo en el dispositivo, así que se usó solo la limpieza por reglas (el texto original nunca se envía a la nube)",
    "On-device model failed, so rules-only scrub used": "El modelo en el dispositivo falló, así que se usó solo la limpieza por reglas",
    "Firebase not configured: Chrome Prompt API called directly": "Firebase no está configurado: se llamó directamente a la Chrome Prompt API",
    "Firebase not configured, so the deterministic template was used": "Firebase no está configurado, así que se usó la plantilla determinista",
    "Firebase AI Logic call failed, so the deterministic template was used": "La llamada a Firebase AI Logic falló, así que se usó la plantilla determinista",
    "AI module could not be loaded (offline?), so rules-only scrub used": "No se pudo cargar el módulo de IA (¿sin conexión?), así que se usó solo la limpieza por reglas",
    unreachable: "inalcanzable",
  },
  ja: {
    "No on-device model in this browser, so rules-only scrub used (raw text is never sent to the cloud)": "このブラウザには端末上のモデルがないため、ルールのみでマスキングしました（元のテキストがクラウドに送られることはありません）",
    "On-device model failed, so rules-only scrub used": "端末上のモデルが失敗したため、ルールのみでマスキングしました",
    "Firebase not configured: Chrome Prompt API called directly": "Firebase 未設定のため、Chrome Prompt API を直接呼び出しました",
    "Firebase not configured, so the deterministic template was used": "Firebase 未設定のため、決定的テンプレートを使用しました",
    "Firebase AI Logic call failed, so the deterministic template was used": "Firebase AI Logic の呼び出しに失敗したため、決定的テンプレートを使用しました",
    "AI module could not be loaded (offline?), so rules-only scrub used": "AI モジュールを読み込めなかったため（オフライン？）、ルールのみでマスキングしました",
    unreachable: "到達不能",
  },
};
export const MODEL_NOTE_KEYS = Object.keys(MODEL_NOTES.es);

const ONDEVICE_ES: Record<string, string> = { available: "disponible", downloadable: "descargable", downloading: "descargando", unavailable: "no disponible", error: "error" };
const ONDEVICE_JA: Record<string, string> = { available: "利用可能", downloadable: "ダウンロード可能", downloading: "ダウンロード中", unavailable: "利用不可", error: "エラー" };
const onDevice = (map: Record<string, string>, needs: string) => (raw: string) =>
  raw.startsWith("unavailable (") ? `${map.unavailable} (${needs})` : map[raw] ?? raw;

export const UI: Record<Lang, UiStrings> = {
  en: {
    tagline: ["Find overcharges on a medical bill and get a dispute letter, ", "without your name, DOB, MRN or insurance ID ever leaving your device", ". Raw text is processed on-device; only redacted findings go to the cloud."],
    navEval: "Measured results →", uiLang: "Language",
    fbLabel: "Firebase AI Logic", fbConnected: (p) => `connected · ${p}`, fbNotConfigured: "not configured on this deployment",
    appCheck: (p) => `App Check (${p})`, tokenOk: "token OK", noToken: "no token", checking: "checking…",
    cloudModel: "Cloud model", viaRemoteConfig: " (Remote Config)",
    onDeviceModel: "On-device model", onDeviceValue: (raw) => raw,
    offlineReady: "Works offline (rules-only) · installable", offlineNow: "Offline: rules-only audit + template letter",
    offlineTitle: "Rules scan, on-device scrub, leak gate, bill audit and the template letter run with no network. Cloud letter writing needs a connection.",
    downloadingNano: (p) => `Downloading Gemini Nano ${p}%`,
    yourBill: "1 · Your bill", sample: (n) => `Sample ${n}`,
    samplesNote: "Samples are synthetic: fictional patients and providers. Paste a text itemized statement to try your own; nothing is uploaded.",
    letterLanguage: "Letter language:", letterLangNote: "The model only sees placeholders in every language; names are re-inserted on your device.",
    run: "Audit privately", running: "Auditing…", pipeline: "2 · Pipeline",
    steps: {
      scan: { label: "Rules scan", sub: "Deterministic PII patterns" },
      device: { label: "On-device scrub", sub: "Gemini Nano, ONLY_ON_DEVICE" },
      gate: { label: "Leak gate", sub: "Blocks any surviving PII" },
      audit: { label: "Bill audit", sub: "7 deterministic rules" },
      letter: { label: "Dispute letter", sub: "Cloud sees redacted text only" },
    },
    stepState: { idle: "idle", running: "running", done: "done", blocked: "blocked", skipped: "skipped" },
    onDevicePass: "On-device pass:", extraProposed: (n) => `${n} extra items proposed`,
    gatePass: (b) => `Leak gate PASSED: 0 identifiers in ${b} outbound bytes.`, gateBlocked: (n) => `BLOCKED: ${n} identifier(s) survived redaction. Nothing was sent.`,
    disputable: "Disputable amount", findingsCount: (n, a) => `${n} finding(s) · ${a} advisory, not counted`,
    findingsTitle: "3 · Findings (deterministic, reproducible)", noFindings: "No billing errors detected by the 7 rules.",
    thRule: "Rule", thFinding: "Finding", thAmount: "Amount", billLine: (l) => ` (bill line ${l})`,
    redactorTitle: (n) => `4 · What the redactor produced (${n} identifiers removed)`,
    receiptTitle: "5 · Privacy receipt", rawBytes: "Raw bill bytes kept on device", outBytes: "Bytes eligible to leave device", sha: "SHA-256 of outbound payload",
    letterBy: "Letter drafted by", scrubRan: "Raw-text scrub ran", guard: "Redaction guard", passed: "PASSED", blocked: "BLOCKED", appCheckRow: "App Check",
    appCheckOk: (p) => `token OK (${p})`, appCheckNo: (p, e) => `no token (${p}): ${e}`, sentWithoutToken: " · AI request sent WITHOUT an App Check token (enforcement is off)",
    factCheck: "Letter fact check", factPassed: (a, c) => `PASSED: ${a} amounts, ${c} codes all traced to findings`, factRejected: (i) => `REJECTED: ${i}`, naTemplate: "n/a (template)",
    aiError: "AI call error", stats: "Anonymous stats (Firestore)", statsSaved: "rule counts + $ bucket saved", statsNot: (e) => `not saved: ${e}`, nothingLeft: "Nothing left the device.",
    source: { on_device: "Firebase AI Logic · on-device (Gemini Nano)", in_cloud: "Firebase AI Logic · cloud (Gemini)", chrome_prompt_api: "Chrome Prompt API · on-device", rules_only: "Rules only (no on-device model here)", template: "Deterministic template (no model)" },
    letterTitle: "6 · Your dispute letter (identity re-inserted locally)", copy: "Copy", download: "Download",
    noteOffline: "Offline: cloud letter writing needs a network connection, so the deterministic template was used. Nothing left the device.",
    noteRejected: (i) => `Model letter rejected by the fact checker (${i}), so the deterministic template was used`,
    noteIdentifier: "Model letter contained an identifier, so the template was used",
    modelNote: (n) => n,
    footer: "Not legal or medical advice. Reference prices are illustrative, not a fee schedule. Open source (Apache-2.0) · Built for #BuildHybridAI 2026 by dl88jing · Green Robin Labs.",
  },
  es: {
    tagline: ["Encuentra cobros indebidos en una factura médica y obtén una carta de reclamación, ", "sin que tu nombre, fecha de nacimiento, número de expediente ni ID del seguro salgan de tu dispositivo", ". El texto original se procesa en el dispositivo; a la nube solo llegan hallazgos anonimizados."],
    navEval: "Resultados medidos →", uiLang: "Idioma",
    fbLabel: "Firebase AI Logic", fbConnected: (p) => `conectado · ${p}`, fbNotConfigured: "no configurado en este despliegue",
    appCheck: (p) => `App Check (${p})`, tokenOk: "token válido", noToken: "sin token", checking: "comprobando…",
    cloudModel: "Modelo en la nube", viaRemoteConfig: " (Remote Config)",
    onDeviceModel: "Modelo en el dispositivo", onDeviceValue: onDevice(ONDEVICE_ES, "requiere Chrome 139+ de escritorio con Gemini Nano"),
    offlineReady: "Funciona sin conexión (solo reglas) · instalable", offlineNow: "Sin conexión: auditoría con reglas + carta de plantilla",
    offlineTitle: "El análisis por reglas, la limpieza en el dispositivo, el filtro de fugas, la auditoría y la carta de plantilla funcionan sin red. La redacción en la nube necesita conexión.",
    downloadingNano: (p) => `Descargando Gemini Nano ${p}%`,
    yourBill: "1 · Tu factura", sample: (n) => `Ejemplo ${n}`,
    samplesNote: "Los ejemplos son sintéticos: pacientes y proveedores ficticios. Pega un estado de cuenta detallado en texto para probar el tuyo; no se sube nada.",
    letterLanguage: "Idioma de la carta:", letterLangNote: "En todos los idiomas el modelo solo ve marcadores; los nombres se reinsertan en tu dispositivo.",
    run: "Auditar en privado", running: "Auditando…", pipeline: "2 · Proceso",
    steps: {
      scan: { label: "Análisis por reglas", sub: "Patrones deterministas de datos personales" },
      device: { label: "Limpieza en el dispositivo", sub: "Gemini Nano, ONLY_ON_DEVICE" },
      gate: { label: "Filtro de fugas", sub: "Bloquea cualquier dato personal restante" },
      audit: { label: "Auditoría de la factura", sub: "7 reglas deterministas" },
      letter: { label: "Carta de reclamación", sub: "La nube solo ve texto anonimizado" },
    },
    stepState: { idle: "en espera", running: "en curso", done: "listo", blocked: "bloqueado", skipped: "omitido" },
    onDevicePass: "Pasada en el dispositivo:", extraProposed: (n) => `${n} elementos adicionales propuestos`,
    gatePass: (b) => `Filtro de fugas SUPERADO: 0 identificadores en ${b} bytes salientes.`, gateBlocked: (n) => `BLOQUEADO: ${n} identificador(es) sobrevivieron a la anonimización. No se envió nada.`,
    disputable: "Importe reclamable", findingsCount: (n, a) => `${n} hallazgo(s) · ${a} orientativo(s), no sumado(s)`,
    findingsTitle: "3 · Hallazgos (deterministas, reproducibles)", noFindings: "Las 7 reglas no detectaron errores de facturación.",
    thRule: "Regla", thFinding: "Hallazgo", thAmount: "Importe", billLine: (l) => ` (${l.includes(",") ? "líneas" : "línea"} ${l} de la factura)`,
    redactorTitle: (n) => `4 · Resultado de la anonimización (${n} identificadores eliminados)`,
    receiptTitle: "5 · Recibo de privacidad", rawBytes: "Bytes de la factura original que se quedan en el dispositivo", outBytes: "Bytes que pueden salir del dispositivo", sha: "SHA-256 de la carga saliente",
    letterBy: "Carta redactada por", scrubRan: "Limpieza del texto original", guard: "Control de anonimización", passed: "SUPERADO", blocked: "BLOQUEADO", appCheckRow: "App Check",
    appCheckOk: (p) => `token válido (${p})`, appCheckNo: (p, e) => `sin token (${p}): ${e}`, sentWithoutToken: " · Solicitud de IA enviada SIN token de App Check (la verificación obligatoria está desactivada)",
    factCheck: "Verificación de datos de la carta", factPassed: (a, c) => `SUPERADA: ${a} importes y ${c} códigos, todos vinculados a hallazgos`, factRejected: (i) => `RECHAZADA: ${i}`, naTemplate: "n/a (plantilla)",
    aiError: "Error en la llamada de IA", stats: "Estadísticas anónimas (Firestore)", statsSaved: "recuento de reglas + rango de $ guardados", statsNot: (e) => `no guardadas: ${e}`, nothingLeft: "Nada salió del dispositivo.",
    source: { on_device: "Firebase AI Logic · en el dispositivo (Gemini Nano)", in_cloud: "Firebase AI Logic · nube (Gemini)", chrome_prompt_api: "Chrome Prompt API · en el dispositivo", rules_only: "Solo reglas (sin modelo en este dispositivo)", template: "Plantilla determinista (sin modelo)" },
    letterTitle: "6 · Tu carta de reclamación (identidad reinsertada localmente)", copy: "Copiar", download: "Descargar",
    noteOffline: "Sin conexión: la redacción en la nube necesita red, así que se usó la plantilla determinista. Nada salió del dispositivo.",
    noteRejected: (i) => `El verificador rechazó la carta del modelo (${i}), así que se usó la plantilla determinista`,
    noteIdentifier: "La carta del modelo contenía un identificador, así que se usó la plantilla",
    modelNote: (n) => MODEL_NOTES.es[n] ?? n,
    footer: "No es asesoramiento legal ni médico. Los precios de referencia son ilustrativos, no un baremo oficial. Código abierto (Apache-2.0) · Creado para #BuildHybridAI 2026 por dl88jing · Green Robin Labs.",
  },
  ja: {
    tagline: ["医療費の請求書から過請求を見つけ、異議申立書を作成します。", "氏名・生年月日・カルテ番号・保険証番号は端末の外に出ません", "。元のテキストは端末上で処理され、クラウドに送られるのは匿名化された指摘事項だけです。"],
    navEval: "測定結果 →", uiLang: "言語",
    fbLabel: "Firebase AI Logic", fbConnected: (p) => `接続済み · ${p}`, fbNotConfigured: "このデプロイでは未設定",
    appCheck: (p) => `App Check（${p}）`, tokenOk: "トークンOK", noToken: "トークンなし", checking: "確認中…",
    cloudModel: "クラウドモデル", viaRemoteConfig: "（Remote Config）",
    onDeviceModel: "端末上のモデル", onDeviceValue: onDevice(ONDEVICE_JA, "Gemini Nano 搭載のデスクトップ版 Chrome 139 以降が必要"),
    offlineReady: "オフライン対応（ルールのみ）· インストール可能", offlineNow: "オフライン：ルールによる監査 + テンプレートの申立書",
    offlineTitle: "ルール検査、端末上のマスキング、漏えいゲート、請求書の監査、テンプレートの申立書はネットワークなしで動作します。クラウドでの申立書作成には接続が必要です。",
    downloadingNano: (p) => `Gemini Nano をダウンロード中 ${p}%`,
    yourBill: "1 · 請求書", sample: (n) => `サンプル ${n}`,
    samplesNote: "サンプルは架空の患者・医療機関による合成データです。ご自身の明細書のテキストを貼り付けて試せます。アップロードは一切ありません。",
    letterLanguage: "申立書の言語：", letterLangNote: "どの言語でもモデルが見るのはプレースホルダーだけで、氏名は端末上で再挿入されます。",
    run: "プライベートに監査", running: "監査中…", pipeline: "2 · 処理の流れ",
    steps: {
      scan: { label: "ルール検査", sub: "個人情報の決定的パターン" },
      device: { label: "端末上のマスキング", sub: "Gemini Nano、ONLY_ON_DEVICE" },
      gate: { label: "漏えいゲート", sub: "残った個人情報があれば送信を阻止" },
      audit: { label: "請求書の監査", sub: "7つの決定的ルール" },
      letter: { label: "異議申立書", sub: "クラウドは匿名化済みテキストのみ参照" },
    },
    stepState: { idle: "待機", running: "実行中", done: "完了", blocked: "阻止", skipped: "スキップ" },
    onDevicePass: "端末上の処理：", extraProposed: (n) => `追加候補 ${n} 件`,
    gatePass: (b) => `漏えいゲート合格：送信予定の ${b} バイトに識別子は 0 件。`, gateBlocked: (n) => `阻止：匿名化後も識別子が ${n} 件残っていたため、何も送信していません。`,
    disputable: "異議申立が可能な金額", findingsCount: (n, a) => `指摘 ${n} 件 · うち参考 ${a} 件（金額に含まず）`,
    findingsTitle: "3 · 指摘事項（決定的・再現可能）", noFindings: "7つのルールで請求の誤りは検出されませんでした。",
    thRule: "ルール", thFinding: "指摘内容", thAmount: "金額", billLine: (l) => `（請求書 ${l} 行目）`,
    redactorTitle: (n) => `4 · 匿名化の結果（識別子 ${n} 件を削除）`,
    receiptTitle: "5 · プライバシー・レシート", rawBytes: "端末に残る元の請求書（バイト）", outBytes: "端末外に送信可能なデータ（バイト）", sha: "送信データの SHA-256",
    letterBy: "申立書の作成元", scrubRan: "元テキストのマスキング", guard: "匿名化チェック", passed: "合格", blocked: "阻止", appCheckRow: "App Check",
    appCheckOk: (p) => `トークンOK（${p}）`, appCheckNo: (p, e) => `トークンなし（${p}）：${e}`, sentWithoutToken: " · AI リクエストは App Check トークンなしで送信（強制は無効）",
    factCheck: "申立書のファクトチェック", factPassed: (a, c) => `合格：金額 ${a} 件・コード ${c} 件すべてが指摘事項と一致`, factRejected: (i) => `不合格：${i}`, naTemplate: "対象外（テンプレート）",
    aiError: "AI 呼び出しエラー", stats: "匿名統計（Firestore）", statsSaved: "ルール別件数 + 金額帯を保存", statsNot: (e) => `未保存：${e}`, nothingLeft: "端末の外には何も送信されていません。",
    source: { on_device: "Firebase AI Logic · 端末上（Gemini Nano）", in_cloud: "Firebase AI Logic · クラウド（Gemini）", chrome_prompt_api: "Chrome Prompt API · 端末上", rules_only: "ルールのみ（この端末にモデルなし）", template: "決定的テンプレート（モデル不使用）" },
    letterTitle: "6 · 異議申立書（本人情報は端末上で再挿入）", copy: "コピー", download: "ダウンロード",
    noteOffline: "オフラインのため、クラウドでの作成はできず決定的テンプレートを使用しました。端末の外には何も送信していません。",
    noteRejected: (i) => `モデルの申立書がファクトチェックで不合格（${i}）だったため、決定的テンプレートを使用しました`,
    noteIdentifier: "モデルの申立書に識別子が含まれていたため、テンプレートを使用しました",
    modelNote: (n) => MODEL_NOTES.ja[n] ?? n,
    footer: "法的・医学的助言ではありません。参考価格は例示であり、公式の料金表ではありません。オープンソース（Apache-2.0）· #BuildHybridAI 2026 向けに dl88jing · Green Robin Labs が制作。",
  },
};

// ---------------------------------------------------------------------------------------------
// /eval page ("Measured results"). Same rules as above: pure data, no I/O. The measured numbers come
// from public/eval/*.json and are passed through unchanged; only labels are translated. Free-text
// measurement notes are shown verbatim (recorded in English) and marked as such, never machine-translated.
export interface EvalStrings {
  back: string; title: string;
  summary: (bills: number, mode: string, generated: string, ms: number) => string;
  reproduce: string;
  dateLocale: string;
  mode: (raw: string) => string;
  cards: { labeledLeaked: string; freeTextLeaked: string; cleanFlagged: string; disputable: string };
  rulesTitle: string; thRule: string; thTp: string; thFp: string; thFn: string; thPrecision: string; thRecall: string; na: string;
  missesTitle: (n: number) => string; missesNote: string;
  /** Column headers for the misses and cloud tables (visually hidden; read by screen readers). */
  thBill: string; thKind: string; thDetail: string; thPath: string; thFactCheck: string; thError: string;
  missKind: (raw: string) => string;
  cloudTitle: string; cloudNote: string;
  cloudCards: { bills: string; accepted: string; rejected: string; guard: string };
  pending: string;
  factCheck: (raw: string) => string;
  historyTitle: string; historyLine: (accepted: number, rejected: number, failed: number) => string;
  notesTitle: string; recordedInEnglish: string;
}

const EVAL_MODES: Record<"es" | "ja", Record<string, string>> = {
  es: { "rules-only (no model)": "solo reglas (sin modelo)" },
  ja: { "rules-only (no model)": "ルールのみ（モデルなし）" },
};
const EVAL_MISS_KINDS: Record<"es" | "ja", Record<string, string>> = {
  es: { "PII leak (free-text, rules-only)": "Fuga de datos personales (texto libre, solo reglas)" },
  ja: { "PII leak (free-text, rules-only)": "個人情報の漏れ（自由記述・ルールのみ）" },
};
/** English mode / miss-kind labels that eval.ts can emit; a unit test checks results.json is covered. */
export const EVAL_MODE_KEYS = Object.keys(EVAL_MODES.es);
export const EVAL_MISS_KIND_KEYS = Object.keys(EVAL_MISS_KINDS.es);
const lookup = (map: Record<string, string>) => (raw: string) => map[raw] ?? raw;
/** Re-render the English fact-check verdict from cloud_eval.mjs ("PASSED: 8 amounts, 6 codes …") in the UI language. */
const evalFactCheck = (l: Lang) => (raw: string) => {
  const m = /^PASSED: (\d+) amounts, (\d+) codes all traced to findings$/.exec(raw);
  if (m) return UI[l].factPassed(Number(m[1]), Number(m[2]));
  const r = /^REJECTED: (.+)$/.exec(raw);
  if (r) return UI[l].factRejected(r[1]);
  return raw;
};

export const EVAL_UI: Record<Lang, EvalStrings> = {
  en: {
    back: "← Back to BillShield", title: "Measured results, misses included",
    summary: (b, m, g, ms) => `${b} seeded synthetic bills · mode: ${m} · generated ${g} · ${ms} ms total.`,
    reproduce: "Reproduce with", dateLocale: "en-US", mode: (m) => m,
    cards: { labeledLeaked: "Labeled PII leaked", freeTextLeaked: "Free-text PII leaked (rules-only)", cleanFlagged: "Clean bills falsely flagged", disputable: "Disputable $ found" },
    rulesTitle: "Billing-error rules", thRule: "Rule", thTp: "TP", thFp: "FP", thFn: "FN", thPrecision: "Precision", thRecall: "Recall", na: "n/a", thBill: "Bill", thKind: "Kind", thDetail: "Detail", thPath: "Path", thFactCheck: "Fact check", thError: "Error",
    missesTitle: (n) => `Every miss (${n})`,
    missesNote: "The free-text leaks are why BillShield adds an on-device Gemini Nano pass: the regex layer alone misses spaced phone numbers, spelled-out birthdays and first names in notes. Model-on numbers will be added after measuring in Chrome with Nano.",
    missKind: (k) => k,
    cloudTitle: "Cloud letter path (Firebase AI Logic, live site)",
    cloudNote: "Each letter drafted by the cloud model is checked by deterministic code: every dollar amount and billing code must trace to a finding, no new placeholders, no raw identifiers. Anything that fails falls back to the template. Measured with headless Chrome against the live deployment.",
    cloudCards: { bills: "Bills", accepted: "Cloud letters accepted", rejected: "Rejected by fact checker", guard: "Redaction guard passed" },
    pending: "Pending re-run.", factCheck: (r) => r,
    historyTitle: "Run history (what the checker caught)",
    historyLine: (a, r, f) => `${a} accepted, ${r} rejected, ${f} call failures.`,
    notesTitle: "Notes", recordedInEnglish: "Measurement notes as recorded.",
  },
  es: {
    back: "← Volver a BillShield", title: "Resultados medidos, fallos incluidos",
    summary: (b, m, g, ms) => `${b} facturas sintéticas con semilla · modo: ${m} · generado el ${g} · ${ms} ms en total.`,
    reproduce: "Reprodúcelo con", dateLocale: "es-ES", mode: lookup(EVAL_MODES.es),
    cards: { labeledLeaked: "Datos personales etiquetados filtrados", freeTextLeaked: "Datos personales en texto libre filtrados (solo reglas)", cleanFlagged: "Facturas correctas marcadas por error", disputable: "Importe reclamable encontrado ($)" },
    rulesTitle: "Reglas de errores de facturación", thRule: "Regla", thTp: "VP", thFp: "FP", thFn: "FN", thPrecision: "Precisión", thRecall: "Exhaustividad", na: "n/d", thBill: "Factura", thKind: "Tipo", thDetail: "Detalle", thPath: "Ruta", thFactCheck: "Verificación", thError: "Fallo",
    missesTitle: (n) => `Todos los fallos (${n})`,
    missesNote: "Estas fugas en texto libre son la razón por la que BillShield añade una pasada con Gemini Nano en el dispositivo: la capa de expresiones regulares no detecta por sí sola teléfonos con espacios, fechas de nacimiento escritas con letras ni nombres de pila en las notas. Las cifras con el modelo activado se añadirán cuando se midan en Chrome con Nano.",
    missKind: lookup(EVAL_MISS_KINDS.es),
    cloudTitle: "Cartas en la nube (Firebase AI Logic, sitio en producción)",
    cloudNote: "Cada carta redactada por el modelo en la nube la verifica código determinista: cada importe en dólares y cada código de facturación debe corresponder a un hallazgo, sin marcadores nuevos ni identificadores sin anonimizar. Si algo falla, se usa la plantilla. Medido con Chrome headless contra el despliegue en producción.",
    cloudCards: { bills: "Facturas", accepted: "Cartas de la nube aceptadas", rejected: "Rechazadas por el verificador", guard: "Superaron el control de anonimización" },
    pending: "Pendiente de una nueva ejecución.", factCheck: evalFactCheck("es"),
    historyTitle: "Historial de ejecuciones (lo que detectó el verificador)",
    historyLine: (a, r, f) => `${a} aceptadas, ${r} rechazadas, ${f} llamadas fallidas.`,
    notesTitle: "Notas", recordedInEnglish: "Notas de medición tal como se registraron (en inglés).",
  },
  ja: {
    back: "← BillShield に戻る", title: "測定結果（見逃しも含めて公開）",
    summary: (b, m, g, ms) => `シード付き合成請求書 ${b} 件 · モード：${m} · 生成日時 ${g} · 合計 ${ms} ms。`,
    reproduce: "再現コマンド：", dateLocale: "ja-JP", mode: lookup(EVAL_MODES.ja),
    cards: { labeledLeaked: "ラベル付き個人情報の漏れ", freeTextLeaked: "自由記述の個人情報の漏れ（ルールのみ）", cleanFlagged: "正しい請求書の誤検出", disputable: "異議申立てできる金額（$）" },
    rulesTitle: "請求ミス検出ルール", thRule: "ルール", thTp: "真陽性", thFp: "偽陽性", thFn: "偽陰性", thPrecision: "適合率", thRecall: "再現率", na: "該当なし", thBill: "請求書", thKind: "種類", thDetail: "詳細", thPath: "経路", thFactCheck: "事実確認", thError: "エラー",
    missesTitle: (n) => `すべての見逃し（${n} 件）`,
    missesNote: "自由記述での漏れがあるからこそ、BillShield は端末上の Gemini Nano による確認を加えています。正規表現だけでは、スペース区切りの電話番号、文字で書かれた生年月日、メモ内の名前を見逃します。モデル有効時の数値は、Nano 搭載の Chrome で測定してから追加します。",
    missKind: lookup(EVAL_MISS_KINDS.ja),
    cloudTitle: "クラウドでの申立書作成（Firebase AI Logic・本番サイト）",
    cloudNote: "クラウドのモデルが作成した申立書は、すべて決定的なコードで検証します。金額と請求コードはすべて指摘事項に対応している必要があり、新しいプレースホルダーや生の識別子は認めません。不合格の場合はテンプレートを使います。本番環境に対してヘッドレス Chrome で測定しました。",
    cloudCards: { bills: "請求書", accepted: "採用されたクラウドの申立書", rejected: "事実確認で不採用", guard: "匿名化チェック合格" },
    pending: "再実行待ちです。", factCheck: evalFactCheck("ja"),
    historyTitle: "実行履歴（チェッカーが検出したもの）",
    historyLine: (a, r, f) => `採用 ${a} 件、不採用 ${r} 件、呼び出し失敗 ${f} 件。`,
    notesTitle: "メモ", recordedInEnglish: "測定メモは記録時のまま（英語）表示しています。",
  },
};

/** Date/time of an eval run in the UI language, always in UTC so server and client render the same text. */
export function formatEvalDate(iso: string, l: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${new Intl.DateTimeFormat(EVAL_UI[l].dateLocale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(d)} UTC`;
}
