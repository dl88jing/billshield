// Hybrid routing decision trace: which inference path each model step took on this run, and why.
// Pure function of what the run already recorded (no I/O, no Firebase import), so it can be unit-tested
// for every branch and shown in the UI in English, Español and 日本語.
import type { Lang } from "./i18n";
import type { Source } from "./hybrid";

export type TraceStep = "scrub" | "gate" | "letter" | "check";
/** Where the step actually ran. "local" = deterministic code in this tab (no model). */
export type TracePath = "on_device" | "in_cloud" | "local" | "template" | "skipped";
export type TraceReason =
  | "nano_ready" | "prompt_api_direct" | "no_nano" | "nano_failed" | "sdk_unreachable"
  | "gate_pass" | "gate_blocked"
  | "letter_nano" | "letter_cloud" | "letter_offline" | "letter_no_firebase" | "letter_sdk_unreachable" | "letter_error" | "letter_gate_blocked"
  | "check_pass" | "check_fact_rejected" | "check_identifier_rejected" | "check_na";

export interface TraceInput {
  /** Chrome LanguageModel.availability() as reported this run ("available", "downloadable", "unavailable …"). */
  nano: string;
  firebase: boolean;
  /** false when the lazy Firebase chunk could not be loaded and hybridFallback() was used. */
  sdk: boolean;
  offline: boolean;
  device: { source: Source; error?: string };
  gate: { pass: boolean; bytes: number; leaks: number };
  /** Omitted when the gate blocked the run. `drafted` is the source before validation; `final` after. */
  letter?: { drafted: Source; final: Source; rejected?: "fact_check" | "identifier"; error?: string; model?: string };
  mode?: { scrub: string; letter: string };
}

/** `detail` is the Chrome availability string for no_nano / letter_cloud (localize it with UI.onDeviceValue), otherwise an error or count. */
export interface TraceRow { step: TraceStep; mode: string; path: TracePath; reason: TraceReason; detail?: string; model?: string; bytesOut: number }
/** Reasons whose detail is the Chrome on-device availability string. */
export const NANO_DETAIL_REASONS: readonly TraceReason[] = ["no_nano", "letter_cloud"];
export interface Trace { rows: TraceRow[]; rawBytesOut: 0; redactedBytesOut: number }

const pathOf = (s: Source): TracePath => (s === "on_device" || s === "chrome_prompt_api" ? "on_device" : s === "in_cloud" ? "in_cloud" : s === "template" ? "template" : "local");

export function routingTrace(i: TraceInput): Trace {
  const mode = i.mode ?? { scrub: "ONLY_ON_DEVICE", letter: "PREFER_ON_DEVICE" };
  const rows: TraceRow[] = [];

  // 1. Raw-text scrub. By construction it never has a cloud path: raw bytes out is always 0.
  const d = i.device.source;
  const scrubReason: TraceReason = !i.sdk && d === "rules_only" ? "sdk_unreachable"
    : d === "on_device" ? "nano_ready" : d === "chrome_prompt_api" ? "prompt_api_direct"
    : i.device.error ? "nano_failed" : "no_nano";
  rows.push({ step: "scrub", mode: mode.scrub, path: d === "rules_only" ? "local" : "on_device", reason: scrubReason, detail: scrubReason === "nano_failed" ? i.device.error : scrubReason === "no_nano" ? i.nano : undefined, bytesOut: 0 });

  // 2. Leak gate: deterministic, local.
  rows.push({ step: "gate", mode: "deterministic", path: "local", reason: i.gate.pass ? "gate_pass" : "gate_blocked", detail: i.gate.pass ? String(i.gate.bytes) : String(i.gate.leaks), bytesOut: 0 });

  // 3. Letter draft.
  let out = 0;
  if (!i.gate.pass || !i.letter) {
    rows.push({ step: "letter", mode: mode.letter, path: "skipped", reason: "letter_gate_blocked", bytesOut: 0 });
    rows.push({ step: "check", mode: "deterministic", path: "skipped", reason: "check_na", bytesOut: 0 });
    return { rows, rawBytesOut: 0, redactedBytesOut: 0 };
  }
  const L = i.letter;
  let letterReason: TraceReason;
  if (i.offline) letterReason = "letter_offline";
  else if (!i.firebase) letterReason = "letter_no_firebase";
  else if (!i.sdk) letterReason = "letter_sdk_unreachable";
  else if (L.drafted === "on_device" || L.drafted === "chrome_prompt_api") letterReason = "letter_nano";
  else if (L.drafted === "in_cloud") letterReason = "letter_cloud";
  else letterReason = "letter_error";
  // The redacted payload is sent when the cloud answered, and may have been sent when a cloud call was attempted and failed.
  if (letterReason === "letter_cloud" || letterReason === "letter_error") out = i.gate.bytes;
  rows.push({
    step: "letter", mode: mode.letter, path: pathOf(L.drafted), reason: letterReason,
    detail: letterReason === "letter_cloud" ? i.nano : letterReason === "letter_error" ? L.error : undefined,
    model: letterReason === "letter_cloud" || letterReason === "letter_nano" ? L.model : undefined,
    bytesOut: out,
  });

  // 4. Validation of the model letter (fact check + identifier guard), local and deterministic.
  const checkReason: TraceReason = L.drafted === "template" ? "check_na" : L.rejected === "fact_check" ? "check_fact_rejected" : L.rejected === "identifier" ? "check_identifier_rejected" : "check_pass";
  rows.push({ step: "check", mode: "deterministic", path: checkReason === "check_na" ? "skipped" : checkReason === "check_pass" ? "local" : "template", reason: checkReason, bytesOut: 0 });

  return { rows, rawBytesOut: 0, redactedBytesOut: out };
}

type TraceText = {
  title: string; intro: string; deterministic: string; thStep: string; thMode: string; thPath: string; thWhy: string; thBytes: string;
  step: Record<TraceStep, string>; path: Record<TracePath, string>; reason: Record<TraceReason, (detail: string, model: string) => string>;
  summary: (raw: number, redacted: number) => string;
};

export const TRACE_TEXT: Record<Lang, TraceText> = {
  en: {
    title: "Why this path? (hybrid routing trace)", deterministic: "deterministic",
    intro: "Each model step, the Firebase AI Logic inference mode it asked for, where it actually ran on this run, and why.",
    thStep: "Step", thMode: "Mode", thPath: "Ran", thWhy: "Why", thBytes: "Bytes sent",
    step: { scrub: "Raw-text scrub", gate: "Leak gate", letter: "Letter draft", check: "Letter check" },
    path: { on_device: "on-device", in_cloud: "cloud", local: "local code", template: "template", skipped: "skipped" },
    reason: {
      nano_ready: () => "Gemini Nano is available in this Chrome, so the raw bill was scrubbed on-device.",
      prompt_api_direct: () => "Firebase is not configured, so Chrome's Prompt API was called directly on-device.",
      no_nano: (d) => `No on-device model (Chrome reports: ${d}), so the ONLY_ON_DEVICE raw-text request was never built (raw text has no cloud path); the rules scan alone redacted it.`,
      nano_failed: (d) => `Gemini Nano failed (${d}); rules-only scrub used. Raw text still not sent.`,
      sdk_unreachable: () => "The AI module could not be loaded (offline?), so the rules-only scrub was used. Nothing sent.",
      gate_pass: (d) => `0 identifiers found in ${d} outbound bytes, so a cloud model may see them.`,
      gate_blocked: (d) => `${d} identifier(s) survived redaction, so every cloud call was blocked.`,
      letter_nano: () => "PREFER_ON_DEVICE found Gemini Nano, so the letter was drafted on-device.",
      letter_cloud: (d, m) => `PREFER_ON_DEVICE fell back to cloud Gemini (${m || "Gemini"}) because Chrome reports no usable on-device model (${d}). Only the redacted payload was sent.`,
      letter_offline: () => "Offline, so the cloud call was skipped and the deterministic template was used.",
      letter_no_firebase: () => "Firebase is not configured, so the deterministic template was used.",
      letter_sdk_unreachable: () => "The AI module could not be loaded, so the deterministic template was used.",
      letter_error: (d) => `The Firebase AI Logic call failed (${d}), so the deterministic template was used.`,
      letter_gate_blocked: () => "The leak gate blocked the run, so no model was called.",
      check_pass: () => "Every $ amount and billing code traces to a finding, and no identifier appears.",
      check_fact_rejected: () => "The fact checker rejected the model letter, so the template replaced it.",
      check_identifier_rejected: () => "The model letter contained an identifier, so the template replaced it.",
      check_na: () => "No model letter to check.",
    },
    summary: (raw, red) => `Raw bill bytes sent off this device: ${raw}. Redacted bytes sent to a cloud model: ${red}.`,
  },
  es: {
    title: "¿Por qué esta ruta? (traza de enrutamiento híbrido)", deterministic: "determinista",
    intro: "Cada paso con modelo, el modo de inferencia de Firebase AI Logic que pidió, dónde se ejecutó realmente en esta ejecución y por qué.",
    thStep: "Paso", thMode: "Modo", thPath: "Se ejecutó", thWhy: "Motivo", thBytes: "Bytes enviados",
    step: { scrub: "Limpieza del texto original", gate: "Filtro de fugas", letter: "Borrador de la carta", check: "Revisión de la carta" },
    path: { on_device: "en el dispositivo", in_cloud: "nube", local: "código local", template: "plantilla", skipped: "omitido" },
    reason: {
      nano_ready: () => "Gemini Nano está disponible en este Chrome, así que la factura original se limpió en el dispositivo.",
      prompt_api_direct: () => "Firebase no está configurado, así que se llamó directamente a la Prompt API de Chrome en el dispositivo.",
      no_nano: (d) => `No hay modelo en el dispositivo (Chrome indica: ${d}), así que la solicitud ONLY_ON_DEVICE con el texto original nunca se creó (el texto original no tiene ruta a la nube); solo el análisis por reglas lo anonimizó.`,
      nano_failed: (d) => `Gemini Nano falló (${d}); se usó solo la limpieza por reglas. El texto original tampoco se envió.`,
      sdk_unreachable: () => "No se pudo cargar el módulo de IA (¿sin conexión?), así que se usó solo la limpieza por reglas. No se envió nada.",
      gate_pass: (d) => `0 identificadores en ${d} bytes salientes, así que un modelo en la nube puede verlos.`,
      gate_blocked: (d) => `${d} identificador(es) sobrevivieron a la anonimización, así que se bloqueó toda llamada a la nube.`,
      letter_nano: () => "PREFER_ON_DEVICE encontró Gemini Nano, así que la carta se redactó en el dispositivo.",
      letter_cloud: (d, m) => `PREFER_ON_DEVICE recurrió a Gemini en la nube (${m || "Gemini"}) porque Chrome no indica ningún modelo utilizable en el dispositivo (${d}). Solo se envió el contenido anonimizado.`,
      letter_offline: () => "Sin conexión: se omitió la llamada a la nube y se usó la plantilla determinista.",
      letter_no_firebase: () => "Firebase no está configurado, así que se usó la plantilla determinista.",
      letter_sdk_unreachable: () => "No se pudo cargar el módulo de IA, así que se usó la plantilla determinista.",
      letter_error: (d) => `La llamada a Firebase AI Logic falló (${d}), así que se usó la plantilla determinista.`,
      letter_gate_blocked: () => "El filtro de fugas bloqueó la ejecución, así que no se llamó a ningún modelo.",
      check_pass: () => "Cada importe en $ y cada código de facturación corresponde a un hallazgo, y no aparece ningún identificador.",
      check_fact_rejected: () => "El verificador de datos rechazó la carta del modelo, así que la plantilla la reemplazó.",
      check_identifier_rejected: () => "La carta del modelo contenía un identificador, así que la plantilla la reemplazó.",
      check_na: () => "No hay carta del modelo que revisar.",
    },
    summary: (raw, red) => `Bytes de la factura original enviados fuera del dispositivo: ${raw}. Bytes anonimizados enviados a un modelo en la nube: ${red}.`,
  },
  ja: {
    title: "なぜこの経路か（ハイブリッド経路トレース）", deterministic: "決定的（モデル不使用）",
    intro: "モデルを使う各ステップについて、要求した Firebase AI Logic の推論モード、今回実際に実行された場所、その理由を示します。",
    thStep: "ステップ", thMode: "モード", thPath: "実行場所", thWhy: "理由", thBytes: "送信バイト数",
    step: { scrub: "原文のスクラブ", gate: "漏えいゲート", letter: "レターの下書き", check: "レターの検証" },
    path: { on_device: "端末上", in_cloud: "クラウド", local: "ローカルコード", template: "テンプレート", skipped: "スキップ" },
    reason: {
      nano_ready: () => "この Chrome で Gemini Nano が使えるため、請求書の原文は端末上でスクラブされました。",
      prompt_api_direct: () => "Firebase が未設定のため、Chrome の Prompt API を端末上で直接呼び出しました。",
      no_nano: (d) => `端末上のモデルがありません（Chrome の報告: ${d}）。そのため原文を含む ONLY_ON_DEVICE リクエストは作成されず（原文にクラウドへの経路はありません）、ルールスキャンのみで匿名化しました。`,
      nano_failed: (d) => `Gemini Nano が失敗しました（${d}）。ルールのみのスクラブを使用しました。原文は送信していません。`,
      sdk_unreachable: () => "AI モジュールを読み込めなかったため（オフライン？）、ルールのみのスクラブを使用しました。何も送信していません。",
      gate_pass: (d) => `送信予定の ${d} バイトに識別子は 0 件のため、クラウドモデルに渡せます。`,
      gate_blocked: (d) => `匿名化後も識別子が ${d} 件残ったため、クラウドへの呼び出しをすべてブロックしました。`,
      letter_nano: () => "PREFER_ON_DEVICE が Gemini Nano を見つけたため、レターは端末上で下書きされました。",
      letter_cloud: (d, m) => `Chrome が使用可能な端末上のモデルを報告していないため（${d}）、PREFER_ON_DEVICE はクラウドの Gemini（${m || "Gemini"}）にフォールバックしました。送信したのは匿名化済みの内容だけです。`,
      letter_offline: () => "オフラインのため、クラウド呼び出しをスキップし、決定的テンプレートを使用しました。",
      letter_no_firebase: () => "Firebase が未設定のため、決定的テンプレートを使用しました。",
      letter_sdk_unreachable: () => "AI モジュールを読み込めなかったため、決定的テンプレートを使用しました。",
      letter_error: (d) => `Firebase AI Logic の呼び出しが失敗したため（${d}）、決定的テンプレートを使用しました。`,
      letter_gate_blocked: () => "漏えいゲートが実行をブロックしたため、モデルは呼び出していません。",
      check_pass: () => "すべての $ 金額と請求コードが指摘事項にさかのぼれ、識別子も含まれていません。",
      check_fact_rejected: () => "ファクトチェッカーがモデルのレターを却下したため、テンプレートに置き換えました。",
      check_identifier_rejected: () => "モデルのレターに識別子が含まれていたため、テンプレートに置き換えました。",
      check_na: () => "検証するモデルのレターはありません。",
    },
    summary: (raw, red) => `端末外に送信した請求書原文のバイト数: ${raw}。クラウドモデルに送信した匿名化済みバイト数: ${red}。`,
  },
};
