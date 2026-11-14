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

## Measured results (rules-only, 40 seeded synthetic bills): see [/eval](https://billshield-kappa.vercel.app/eval)
| Metric | Result |
|---|---|
| Billing-error rules, precision / recall | 100% / 100% on planted errors (7 rules) |
| Clean bills falsely flagged | 0 / 11 |
| Labeled PII leaked | 0 / 440 |
| **Free-text PII leaked, rules-only** | **67 / 68 (miss)** |

The free-text miss is published on purpose: it is exactly what the on-device Gemini Nano pass exists to fix. Model-on numbers will be added once measured in desktop Chrome with Nano. The first eval run also exposed 10 false positives (a generator bug and a DOUBLE_EM engine bug); both are documented on /eval and fixed.
Reproduce: `npm run eval` (writes `public/eval/results.json`) and `npm test`.

## Firebase usage
- `firebase/ai`: `getAI` + `GoogleAIBackend` + `getGenerativeModel` with `InferenceMode.ONLY_ON_DEVICE` (PII) and `InferenceMode.PREFER_IN_CLOUD` (letter); `initializeDeviceModel()` on the click (user activation); `response.inferenceSource` checked and shown. See `src/lib/hybrid.ts`.
- `firebase/app-check`: `ReCaptchaV3Provider` in production, debug token for local dev.
- Planned: Remote Config for rule thresholds; Firestore for anonymous aggregate stats only (no bill content).

## Honest status (Nov 14, 2026)
- **The live deployment does not have Firebase config yet.** Creating the Firebase project (AI Logic + App Check) needs the owner's Google login, which is pending. Until it is set, the app degrades transparently, and the UI badge says which path ran:
  - on-device: calls Chrome's `LanguageModel` (Prompt API) directly if available, otherwise **rules-only**;
  - letter: a **deterministic template** (or Nano on-device if available).
- The Firebase AI Logic code path is implemented and called at runtime as soon as `NEXT_PUBLIC_FIREBASE_*` is set (see `.env.example`).
- On-device inference requires desktop Chrome 139+ with Gemini Nano. Headless/CI browsers fall back to rules-only.
- Sample bills are synthetic. Reference prices are illustrative, not a fee schedule. Not legal or medical advice.

## Run locally
```bash
npm install
cp .env.example .env.local   # fill Firebase web config; never commit .env.local
npm run dev                  # http://localhost:3000 in desktop Chrome
npm test && npm run eval
```

## What was built during the submission period
Everything in this repo was created from scratch on Nov 14, 2026 (submission period Nov 11 – Nov 30). Standard tooling only: Next.js 15, Tailwind, Firebase JS SDK v13; code written with AI coding assistants.

## License
Apache-2.0 (see `LICENSE`).
