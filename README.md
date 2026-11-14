# BillShield: private medical bill audits with hybrid AI

**Find overcharges on a medical bill and get a dispute letter, without your name, DOB, MRN or insurance ID ever leaving your device.**

Built for [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/), Web (Chrome) platform.
Live: https://billshield-kappa.vercel.app · Measured results: https://billshield-kappa.vercel.app/eval

## Why
A medical bill is the most identity-dense document most people own, and it is also often wrong (duplicate lines, unbundled lab panels, math errors, charges after discharge). Pasting it into a cloud chatbot means handing over your name, DOB, MRN, member ID and diagnosis. BillShield uses **hybrid inference as a privacy firewall**: the identity-bearing text is handled on-device, and the cloud model only ever sees redacted findings.

## How it works (end-to-end pipeline, not a chatbot)
1. **Rules scan** (deterministic): labeled names, DOB, MRN, member/account IDs, SSN, phone, email, address, Luhn-valid card numbers. Every later mention of a labeled name is caught too.
2. **On-device scrub**: Firebase AI Logic `getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE })` (Gemini Nano via Chrome's Prompt API) proposes extra identifiers in free text (spouse names, spelled-out birthdays, oddly formatted phones). We use `ONLY_ON_DEVICE`, **not** `PREFER_ON_DEVICE`, because the latter may fall back to the cloud with raw PII. Responses whose `inferenceSource` is not `on_device` are rejected. Model proposals are only applied if the exact string exists in the bill, so hallucinated edits are impossible.
3. **Deterministic audit**: 7 rules (`src/lib/audit.ts`): DUPLICATE, MATH (qty × unit), TOTAL (subtotal reconciliation), UNBUNDLE (NCCI-style panel components), DOUBLE_EM, POST_DISCHARGE, PRICE_OUTLIER (advisory). The model never decides what is wrong with the bill.
4. **Leak gate** (deterministic): the outbound payload is re-scanned with every pattern plus every original identifier. A single hit **blocks the cloud call**.
5. **Dispute letter**: Firebase AI Logic `InferenceMode.PREFER_IN_CLOUD` drafts the letter from the redacted findings, using placeholders like `[NAME_1]` and `[ACCOUNT_1]`. Real values are re-inserted **locally** from an in-memory vault that never leaves the tab.
6. **Privacy receipt**: shows the exact outbound payload, its byte count and SHA-256, and which inference source handled each step.

## Measured results: see [/eval](https://billshield-kappa.vercel.app/eval)
**Rules layer** (40 seeded synthetic bills, no model):
| Metric | Result |
|---|---|
| Billing-error rules, precision / recall | 100% / 100% on planted errors (7 rules) |
| Clean bills falsely flagged | 0 / 11 |
| Labeled PII leaked | 0 / 440 |
| **Free-text PII leaked, rules-only** | **67 / 68 (miss)** |

**Cloud letter path** (live site, headless Chrome without Gemini Nano, so `PREFER_ON_DEVICE` falls back to cloud `gemini-3.5-flash-lite` via Firebase AI Logic), 12 bills:
| Run | Cloud letters accepted | Rejected by fact checker | Call failures | What we learned |
|---|---|---|---|---|
| v1 | 4 | 4 | 4 | model invented placeholders (`[DATE_1]`, `[ADDRESS_2]`); 401 App Check errors |
| v2 | 4 | 2 | 6 | prompt fixed (0 invented placeholders); the 2 rejections were a **checker bug** (whole-dollar `$15`), now fixed |
| v3 | **12** | 0 | 0 | 12/12 fact-check pass, 12/12 redaction-guard pass (some calls needed one retry) |

The free-text miss is published on purpose: it is exactly what the on-device Gemini Nano pass exists to fix. Model-on (Nano) numbers are not measured yet; they need desktop Chrome with Gemini Nano.
Reproduce: `npm run eval` and `npm test` (8 tests). Cloud eval: `scripts/e2e/cloud_eval.mjs` (Playwright against the live site).

## Firebase usage (project `billshield-d2dcb`, Spark plan)
- **Firebase AI Logic** (`firebase/ai`, Gemini Developer API backend):
  - Raw bill text → `getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE })`. We deliberately do *not* use `PREFER_ON_DEVICE` here, because it may fall back to the cloud with raw PII. Any response whose `inferenceSource` isn't `on_device` is rejected.
  - Redacted findings → `InferenceMode.PREFER_ON_DEVICE` with `inCloudParams.model` from Remote Config: Gemini Nano when present, cloud Gemini otherwise. `response.inferenceSource` is shown in the privacy receipt.
  - `initializeDeviceModel()` is called on the user's click (Chrome user-activation rule).
  - Model default: `gemini-3.5-flash-lite` rather than `gemini-2.5-flash-lite`, because the Firebase docs say 2.5 Flash requests get rerouted from Dec 1, 2026, before judging.
- **App Check** (`firebase/app-check`): `ReCaptchaV3Provider` by default; `ReCaptchaEnterpriseProvider` when `NEXT_PUBLIC_APPCHECK_PROVIDER=enterprise`. A token probe runs at startup. If it fails, the AI call is still attempted (retried once without the App Check header) and the failure is shown in the privacy receipt.
- **Remote Config**: `cloud_model` and `outlier_multiple` (audit threshold), with in-code defaults.
- **Firestore**: writes only anonymous aggregate stats (rule counts, a dollar bucket, inference sources, gate result) to `aggregate_runs`. No bill text, no identifiers. Locked-down rules are in `firestore.rules`.

## Honest status (Nov 14, 2026)
- ✅ Firebase AI Logic is live. The cloud letter path works end to end on https://billshield-kappa.vercel.app (verified in headless Chrome; the receipt shows "Firebase AI Logic · cloud (Gemini)", and the redaction guard passes).
- ⚠️ **App Check is integrated in code, but registering the web app in the Firebase console is blocked or pending.** The console refused the reCAPTCHA v3 secret field with a permissions message, and Enterprise needs a separate site key. AI Logic enforcement is therefore **off** for now. The exact token-exchange error: `400 FAILED_PRECONDITION: App not registered: 1:597645612259:web:d12f1f8d3f77e3fbdc61d6`. While enforcement was propagating, some AI calls returned `401 Firebase App Check token is invalid`; the app retries once without the header and otherwise falls back to the deterministic template letter.
- ⚠️ **Firestore aggregate writes fail with `Missing or insufficient permissions`**: the database is in production mode and `firestore.rules` has not been deployed yet. The UI says so; nothing else depends on it.
- ⚠️ On-device inference requires desktop Chrome 139+ with Gemini Nano. The demo video and evals were recorded in headless Chrome with **no** Nano, so the on-device step shows "skipped / rules-only". That is labeled in the video and the UI.
- Sample bills are synthetic. Reference prices are illustrative, not a fee schedule. Not legal or medical advice.

## Run locally
```bash
npm install
cp .env.example .env.local   # Firebase web config (public client config); .env.local is gitignored
npm run dev                  # http://localhost:3000 in desktop Chrome
npm test && npm run eval
```

## What was built during the submission period
Everything in this repo was created from scratch on Nov 14, 2026 (submission period Nov 11 – Nov 30). Standard tooling only: Next.js 15, Tailwind, Firebase JS SDK v13; code written with AI coding assistants.

## License
Apache-2.0 (see `LICENSE`).
