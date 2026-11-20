"use client";
// Loads the Firebase hybrid-inference module (lib/hybrid.ts) on demand instead of in the first
// bundle. The rules-only scan, redaction and audit never need it, so the page becomes interactive
// without parsing the Firebase SDK or fetching reCAPTCHA. It is loaded on the first user
// interaction (pointer, key, touch, focus) or after LAZY_FALLBACK_MS, whichever comes first,
// and always before the first cloud or on-device model call (run() awaits it).
import { firebaseConfigured } from "./caps";
export type Hybrid = typeof import("./hybrid");

export const LAZY_FALLBACK_MS = 6000;
export const LAZY_EVENTS = ["pointerdown", "keydown", "touchstart", "focusin"] as const;

let mod: Hybrid | null = null;
let pending: Promise<Hybrid> | null = null;

/** The module if it has already loaded (lets a click handler call it without an await). */
export const loadedHybrid = (): Hybrid | null => mod;

export function loadHybrid(importer: () => Promise<Hybrid> = () => import("./hybrid")): Promise<Hybrid> {
  if (mod) return Promise.resolve(mod);
  if (!pending) pending = importer().then((m) => (mod = m)).catch((e) => { pending = null; throw e; });
  return pending;
}

/** Calls `onLoad` once the module is loaded via first interaction or the fallback timer. Returns a cleanup. */
export function loadHybridWhenNeeded(target: EventTarget, onLoad: (m: Hybrid) => void, fallbackMs = LAZY_FALLBACK_MS, importer?: () => Promise<Hybrid>): () => void {
  let done = false;
  const fire = () => {
    if (done) return; done = true; cleanup();
    loadHybrid(importer).then(onLoad).catch(() => { /* surfaced again by run() */ });
  };
  const timer = setTimeout(fire, fallbackMs);
  const opts = { passive: true, capture: true } as AddEventListenerOptions;
  for (const ev of LAZY_EVENTS) target.addEventListener(ev, fire, opts);
  function cleanup() { clearTimeout(timer); for (const ev of LAZY_EVENTS) target.removeEventListener(ev, fire, opts); }
  return () => { done = true; cleanup(); };
}

export const NOTE_MODULE_UNAVAILABLE = "AI module could not be loaded (offline?), so rules-only scrub used";

/** Stand-in used only if the hybrid chunk cannot be fetched (e.g. offline before it was ever cached):
 *  rules-only scrub, built-in Remote Config defaults, deterministic template letter, nothing sent. */
export function hybridFallback(): Pick<Hybrid, "warmUpOnDevice" | "proposePiiOnDevice" | "draftLetter" | "firebaseReady" | "recordAggregate" | "status"> {
  const status: Hybrid["status"] = {
    configured: firebaseConfigured,
    appCheck: { provider: process.env.NEXT_PUBLIC_APPCHECK_PROVIDER === "v3" ? "reCAPTCHA v3" : "reCAPTCHA Enterprise", ok: false, error: "unreachable" },
    remoteConfig: { ok: false, error: "unreachable", cloudModel: process.env.NEXT_PUBLIC_CLOUD_MODEL || "gemini-3.5-flash-lite", outlierMultiple: 3 },
  };
  return {
    status,
    warmUpOnDevice: async () => false,
    proposePiiOnDevice: async () => ({ text: "", proposals: [], source: "rules_only", ms: 0, note: NOTE_MODULE_UNAVAILABLE }),
    draftLetter: async (_payload, fallback) => ({ text: fallback(), source: "template", ms: 0, note: "Firebase AI Logic call failed, so the deterministic template was used" }),
    firebaseReady: async () => status,
    recordAggregate: async () => ({ ok: false, error: "unreachable" }),
  };
}

/** test hook */
export function _resetLazyHybrid() { mod = null; pending = null; }
