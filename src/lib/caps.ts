// Lightweight capability probe with no Firebase imports, so the page can show its status pills
// before the Firebase SDK (AI Logic, App Check + reCAPTCHA, Remote Config, Firestore) is loaded.
// hybrid.ts re-exports these; the heavy SDK chunk is loaded lazily by lib/lazy-hybrid.ts.
export const firebaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
);

export type LM = { availability: () => Promise<string>; create: (o?: unknown) => Promise<{ prompt: (s: string) => Promise<string>; destroy?: () => void }> };
export const chromeLM = (): LM | null => (typeof self !== "undefined" && (self as unknown as { LanguageModel?: LM }).LanguageModel) || null;

export interface Capabilities { firebase: boolean; onDevice: string; }
export async function capabilities(): Promise<Capabilities> {
  const lm = chromeLM();
  let onDevice = "unavailable (needs desktop Chrome 139+ with Gemini Nano)";
  if (lm) { try { onDevice = await lm.availability(); } catch { onDevice = "error"; } }
  return { firebase: firebaseConfigured, onDevice };
}
