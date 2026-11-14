"use client";
// Hybrid inference layer built on Firebase AI Logic.
//  - Raw bill text (contains PII) -> InferenceMode.ONLY_ON_DEVICE. Never PREFER_ON_DEVICE: that mode
//    may silently fall back to the cloud, which would defeat the privacy guarantee.
//  - Redacted findings -> InferenceMode.PREFER_IN_CLOUD for the long-form dispute letter.
// When the Firebase web config is not set (see README), the app degrades honestly:
// Chrome's Prompt API directly for on-device, and a deterministic template for the letter.
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, type GenerativeModel } from "firebase/ai";

export type Source = "on_device" | "in_cloud" | "chrome_prompt_api" | "rules_only" | "template";
export interface ModelResult { text: string; source: Source; ms: number; note?: string; }

const cfg = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
export const firebaseConfigured = Boolean(cfg.apiKey && cfg.projectId && cfg.appId);

let app: FirebaseApp | null = null;
function firebase(): FirebaseApp | null {
  if (!firebaseConfigured) return null;
  if (app) return app;
  app = getApps()[0] ?? initializeApp(cfg as Record<string, string>);
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  if (process.env.NEXT_PUBLIC_APPCHECK_DEBUG === "true") (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  if (siteKey) initializeAppCheck(app, { provider: new ReCaptchaV3Provider(siteKey), isTokenAutoRefreshEnabled: true });
  return app;
}

const models: Partial<Record<string, GenerativeModel>> = {};
function model(mode: InferenceMode): GenerativeModel | null {
  const a = firebase(); if (!a) return null;
  if (!models[mode]) {
    const ai = getAI(a, { backend: new GoogleAIBackend() });
    models[mode] = getGenerativeModel(ai, { mode, inCloudParams: { model: process.env.NEXT_PUBLIC_CLOUD_MODEL || "gemini-3.5-flash-lite" } });
  }
  return models[mode]!;
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
    const m = model(InferenceMode.ONLY_ON_DEVICE);
    if (m) { await m.initializeDeviceModel(onProgress); return true; }
    const lm = chromeLM(); if (!lm) return false;
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

/** On-device PII proposals. Never touches the network with raw text. */
export async function proposePiiOnDevice(text: string): Promise<ModelResult & { proposals: string[] }> {
  const t0 = performance.now();
  const m = model(InferenceMode.ONLY_ON_DEVICE);
  try {
    if (m) {
      const r = await m.generateContent(PII_PROMPT(text));
      const out = r.response.text();
      if (r.response.inferenceSource && r.response.inferenceSource !== "on_device") throw new Error("refusing non-local result");
      return { text: out, proposals: parseJsonArray(out), source: "on_device", ms: performance.now() - t0 };
    }
    const lm = chromeLM();
    if (lm && (await lm.availability()) === "available") {
      const s = await lm.create(); const out = await s.prompt(PII_PROMPT(text)); s.destroy?.();
      return { text: out, proposals: parseJsonArray(out), source: "chrome_prompt_api", ms: performance.now() - t0, note: "Firebase not configured: Chrome Prompt API called directly" };
    }
  } catch (e) {
    return { text: "", proposals: [], source: "rules_only", ms: performance.now() - t0, note: `On-device model failed (${(e as Error).message}); rules-only scrub used` };
  }
  return { text: "", proposals: [], source: "rules_only", ms: performance.now() - t0, note: "No on-device model in this browser; rules-only scrub used" };
}

const LETTER_PROMPT = (payload: string) => `Write a firm, polite billing dispute letter from a patient to a hospital billing office. Use ONLY the facts below. Keep every placeholder in square brackets (like [NAME_1] or [ACCOUNT_1]) exactly as written; do not invent names, numbers or dates. Cite each finding with its code and dollar amount, request a corrected itemized bill, and ask that the account not be sent to collections while under review. Under 300 words. Plain text.

FINDINGS (already redacted on-device):
${payload}`;

/** Cloud letter drafting from the REDACTED payload only (caller must pass the leak gate first). */
export async function draftLetter(redactedPayload: string, fallback: () => string): Promise<ModelResult> {
  const t0 = performance.now();
  const m = model(InferenceMode.PREFER_IN_CLOUD);
  try {
    if (m) {
      const r = await m.generateContent(LETTER_PROMPT(redactedPayload));
      return { text: r.response.text(), source: (r.response.inferenceSource as Source) ?? "in_cloud", ms: performance.now() - t0 };
    }
    const lm = chromeLM();
    if (lm && (await lm.availability()) === "available") {
      const s = await lm.create(); const out = await s.prompt(LETTER_PROMPT(redactedPayload)); s.destroy?.();
      return { text: out, source: "chrome_prompt_api", ms: performance.now() - t0, note: "Firebase not configured: drafted on-device via Chrome Prompt API" };
    }
  } catch (e) {
    return { text: fallback(), source: "template", ms: performance.now() - t0, note: `Model call failed (${(e as Error).message}); deterministic template used` };
  }
  return { text: fallback(), source: "template", ms: performance.now() - t0, note: "No model configured; deterministic template used" };
}
