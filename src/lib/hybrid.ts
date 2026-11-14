"use client";
// Hybrid inference layer built on Firebase AI Logic.
//  - Raw bill text (contains PII) -> InferenceMode.ONLY_ON_DEVICE. Deliberately NOT prefer_on_device:
//    that mode may fall back to the cloud, which would send raw identity data off the device.
//  - Redacted findings -> InferenceMode.PREFER_ON_DEVICE: Gemini Nano when the browser has it,
//    otherwise the cloud Gemini model (Remote Config `cloud_model`). Safe because the payload has
//    already passed the deterministic leak gate.
// App Check: ReCaptchaV3Provider by default, ReCaptchaEnterpriseProvider when
// NEXT_PUBLIC_APPCHECK_PROVIDER=enterprise. A token failure is recorded and AI calls are still attempted.
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider, ReCaptchaEnterpriseProvider, getToken, type AppCheck } from "firebase/app-check";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, type GenerativeModel } from "firebase/ai";
import { getRemoteConfig, fetchAndActivate, getValue } from "firebase/remote-config";
import { getFirestore, addDoc, collection, serverTimestamp } from "firebase/firestore";

export type Source = "on_device" | "in_cloud" | "chrome_prompt_api" | "rules_only" | "template";
export interface ModelResult { text: string; source: Source; ms: number; note?: string; error?: string; model?: string; appCheckAttached?: boolean; firstError?: string; }

const cfg = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
export const firebaseConfigured = Boolean(cfg.apiKey && cfg.projectId && cfg.appId);
export const appCheckProviderName = process.env.NEXT_PUBLIC_APPCHECK_PROVIDER === "enterprise" ? "reCAPTCHA Enterprise" : "reCAPTCHA v3";

export interface FirebaseStatus { configured: boolean; projectId?: string; appCheck: { provider: string; ok: boolean | null; error?: string }; remoteConfig: { ok: boolean | null; error?: string; cloudModel: string; outlierMultiple: number }; }
export const status: FirebaseStatus = {
  configured: firebaseConfigured, projectId: cfg.projectId,
  appCheck: { provider: appCheckProviderName, ok: null },
  remoteConfig: { ok: null, cloudModel: process.env.NEXT_PUBLIC_CLOUD_MODEL || "gemini-3.5-flash-lite", outlierMultiple: 3 },
};

let app: FirebaseApp | null = null;
let appCheck: AppCheck | null = null;
function firebase(): FirebaseApp | null {
  if (!firebaseConfigured) return null;
  if (app) return app;
  app = getApps()[0] ?? initializeApp(cfg as Record<string, string>);
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  try {
    if (process.env.NEXT_PUBLIC_APPCHECK_DEBUG === "true") (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    if (siteKey) {
      const provider = process.env.NEXT_PUBLIC_APPCHECK_PROVIDER === "enterprise" ? new ReCaptchaEnterpriseProvider(siteKey) : new ReCaptchaV3Provider(siteKey);
      appCheck = initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
    } else { status.appCheck = { ...status.appCheck, ok: false, error: "no site key configured" }; }
  } catch (e) { status.appCheck = { ...status.appCheck, ok: false, error: (e as Error).message }; }
  return app;
}

/** Probe App Check once and load Remote Config. Never throws. */
let readyPromise: Promise<FirebaseStatus> | null = null;
export function firebaseReady(): Promise<FirebaseStatus> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const a = firebase(); if (!a) return status;
    if (appCheck) {
      try {
        const t = await Promise.race([getToken(appCheck, false), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("App Check token timed out after 8s")), 8000))]);
        status.appCheck = { ...status.appCheck, ok: Boolean(t.token) };
      } catch (e) { status.appCheck = { ...status.appCheck, ok: false, error: (e as Error).message }; }
    }
    try {
      const rc = getRemoteConfig(a);
      rc.settings.minimumFetchIntervalMillis = 10 * 60 * 1000;
      rc.defaultConfig = { cloud_model: status.remoteConfig.cloudModel, outlier_multiple: status.remoteConfig.outlierMultiple };
      await Promise.race([fetchAndActivate(rc), new Promise((_, rej) => setTimeout(() => rej(new Error("Remote Config fetch timed out")), 6000))]);
      const m = getValue(rc, "cloud_model").asString(); const o = getValue(rc, "outlier_multiple").asNumber();
      status.remoteConfig = { ok: true, cloudModel: m || status.remoteConfig.cloudModel, outlierMultiple: o > 1 ? o : status.remoteConfig.outlierMultiple };
    } catch (e) { status.remoteConfig = { ...status.remoteConfig, ok: false, error: (e as Error).message }; }
    return status;
  })();
  return readyPromise;
}

// If App Check cannot mint a token (e.g. app not yet registered), the SDK would attach an invalid
// token header and the backend rejects it even when enforcement is off. In that case AI calls go
// through a second app instance with no App Check attached, and the receipt says so.
let bareApp: FirebaseApp | null = null;
function aiApp(withAppCheck: boolean): FirebaseApp | null {
  const a = firebase(); if (!a) return null;
  if (withAppCheck) return a;
  if (!bareApp) bareApp = getApps().find((x) => x.name === "ai-no-appcheck") ?? initializeApp(cfg as Record<string, string>, "ai-no-appcheck");
  return bareApp;
}
const models: Partial<Record<string, GenerativeModel>> = {};
function model(mode: InferenceMode, withAppCheck = status.appCheck.ok !== false): GenerativeModel | null {
  const a = aiApp(withAppCheck); if (!a) return null;
  const key = `${mode}|${withAppCheck}|${status.remoteConfig.cloudModel}`;
  if (!models[key]) {
    const ai = getAI(a, { backend: new GoogleAIBackend() });
    models[key] = getGenerativeModel(ai, { mode, inCloudParams: { model: status.remoteConfig.cloudModel } });
  }
  return models[key]!;
}

type LM = { availability: () => Promise<string>; create: (o?: unknown) => Promise<{ prompt: (s: string) => Promise<string>; destroy?: () => void }> };
const chromeLM = (): LM | null => (typeof self !== "undefined" && (self as unknown as { LanguageModel?: LM }).LanguageModel) || null;

export interface Capabilities { firebase: boolean; onDevice: string; }
export async function capabilities(): Promise<Capabilities> {
  const lm = chromeLM();
  let onDevice = "unavailable (needs desktop Chrome 139+ with Gemini Nano)";
  if (lm) { try { onDevice = await lm.availability(); } catch { onDevice = "error"; } }
  return { firebase: firebaseConfigured, onDevice };
}

/** Must be called from a click handler (Chrome user-activation rule). */
export async function warmUpOnDevice(onProgress?: (p: number) => void): Promise<boolean> {
  try {
    const lm = chromeLM(); if (!lm || (await lm.availability()) === "unavailable") return false;
    const m = model(InferenceMode.ONLY_ON_DEVICE);
    if (m) { await m.initializeDeviceModel(onProgress); return true; }
    const s = await lm.create({ monitor(mon: { addEventListener: (t: string, f: (e: { loaded: number }) => void) => void }) { mon.addEventListener("downloadprogress", (e) => onProgress?.(e.loaded)); } });
    s.destroy?.(); return true;
  } catch { return false; }
}

const PII_PROMPT = (text: string) => `You are a privacy filter running locally. List every piece of personal information about the patient or their family in the document below that could identify them: names (including first names alone), phone numbers in any format, birthdays written in words, addresses, ID numbers, partial card numbers. Copy each item EXACTLY as written. Respond with only a JSON array of strings.

DOCUMENT:
${text}`;

export function parseJsonArray(s: string): string[] {
  const m = s.match(/\[[\s\S]*\]/); if (!m) return [];
  try { const v = JSON.parse(m[0]); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

/** On-device PII proposals. Raw text never goes to the network. */
export async function proposePiiOnDevice(text: string): Promise<ModelResult & { proposals: string[] }> {
  const t0 = performance.now();
  const lm = chromeLM();
  const avail = lm ? await lm.availability().catch(() => "unavailable") : "unavailable";
  if (avail !== "available") return { text: "", proposals: [], source: "rules_only", ms: performance.now() - t0, note: "No on-device model in this browser, so rules-only scrub used (raw text is never sent to the cloud)" };
  try {
    const m = model(InferenceMode.ONLY_ON_DEVICE);
    if (m) {
      const r = await m.generateContent(PII_PROMPT(text));
      if (r.response.inferenceSource && r.response.inferenceSource !== "on_device") throw new Error("refusing non-local result");
      const out = r.response.text();
      return { text: out, proposals: parseJsonArray(out), source: "on_device", ms: performance.now() - t0 };
    }
    const s = await lm!.create(); const out = await s.prompt(PII_PROMPT(text)); s.destroy?.();
    return { text: out, proposals: parseJsonArray(out), source: "chrome_prompt_api", ms: performance.now() - t0, note: "Firebase not configured: Chrome Prompt API called directly" };
  } catch (e) {
    return { text: "", proposals: [], source: "rules_only", ms: performance.now() - t0, error: (e as Error).message, note: "On-device model failed, so rules-only scrub used" };
  }
}

const LETTER_PROMPT = (payload: string) => `Write a firm, polite billing dispute letter from a patient to a hospital billing office. Use ONLY the facts below. Keep every placeholder in square brackets that appears below (for example [NAME_1], [ACCOUNT_1]) exactly as written. Do NOT create any new bracketed placeholders (no [DATE], [ADDRESS], [PHONE] etc.); simply omit a date line, addresses and contact details. Only mention dollar amounts and billing codes that appear verbatim in the findings; do not compute new amounts. Cite each finding with its code and dollar amount, request a corrected itemized bill, and ask that the account not be sent to collections while under review. Under 300 words. Plain text, no markdown.

FINDINGS (already redacted on-device):
${payload}`;

/** Letter drafting from the REDACTED payload only (caller must pass the leak gate first).
 *  Hybrid: PREFER_ON_DEVICE, so Gemini Nano if present, else cloud Gemini via Firebase AI Logic. */
export async function draftLetter(redactedPayload: string, fallback: () => string): Promise<ModelResult> {
  const t0 = performance.now();
  await firebaseReady();
  if (!firebaseConfigured) return { text: fallback(), source: "template", ms: performance.now() - t0, note: "Firebase not configured, so the deterministic template was used" };
  const attempt = async (withAppCheck: boolean): Promise<ModelResult> => {
    const m = model(InferenceMode.PREFER_ON_DEVICE, withAppCheck)!;
    const lm = chromeLM();
    if (lm && (await lm.availability().catch(() => "unavailable")) === "available") await m.initializeDeviceModel().catch(() => undefined);
    const r = await m.generateContent(LETTER_PROMPT(redactedPayload));
    const src = (r.response.inferenceSource as Source) ?? "in_cloud";
    return { text: r.response.text(), source: src, ms: performance.now() - t0, appCheckAttached: withAppCheck, model: src === "in_cloud" ? status.remoteConfig.cloudModel : "Gemini Nano (on-device)" };
  };
  const preferAppCheck = status.appCheck.ok !== false;
  const tries: boolean[] = [preferAppCheck, false]; // second try: no App Check header, after a short pause
  let first = "";
  for (let i = 0; i < tries.length; i++) {
    try { const r = await attempt(tries[i]); return first ? { ...r, firstError: first } : r; }
    catch (e) {
      const msg = (e as Error).message;
      if (!first) first = msg;
      const transient = /app ?check|401|429|503|UNAVAILABLE/i.test(msg);
      if (!transient || i === tries.length - 1) return { text: fallback(), source: "template", ms: performance.now() - t0, error: msg, firstError: first !== msg ? first : undefined, note: "Firebase AI Logic call failed, so the deterministic template was used" };
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return { text: fallback(), source: "template", ms: performance.now() - t0, note: "unreachable" };
}

/** Anonymous aggregate stats only: rule counts, dollar bucket, inference sources. No bill text, no identifiers. */
export async function recordAggregate(stat: { rules: Record<string, number>; stakeBucket: string; deviceSource: Source; letterSource: Source; gatePass: boolean }): Promise<{ ok: boolean; error?: string }> {
  const a = firebase(); if (!a) return { ok: false, error: "Firebase not configured" };
  try {
    await Promise.race([addDoc(collection(getFirestore(a), "aggregate_runs"), { ...stat, v: 1, at: serverTimestamp() }), new Promise((_, rej) => setTimeout(() => rej(new Error("Firestore write timed out")), 6000))]);
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
