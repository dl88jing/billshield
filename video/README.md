# BillShield demo video pipeline

Playwright screen recording of a simulated user on the live app (visible cursor overlay) + Kokoro TTS narration (voice `af_heart`) + HyperFrames composition. Uses only the app's built-in synthetic sample bills; no credentials.

```bash
cd video
npm install                                   # playwright-core
pip install kokoro-onnx soundfile             # + kokoro-v1.0.onnx / voices-v1.0.bin
KOKORO_MODEL=... KOKORO_VOICES=... python3 tts.py   # script.json -> assets/vo/*.wav + durations.json
node record.mjs                               # live app -> assets/screen/session.mp4 + marks.json (scenes held for VO length)
node compose.mjs                              # writes index.html, renders renders/billshield-demo.mp4 via hyperframes@0.8.60
```

Env: `DEMO_URL` (default https://billshield-kappa.vercel.app), `CHROME_PATH` (default /usr/bin/google-chrome), `OUT` (extra copy of the render).

The recording browser is headless Chrome without Gemini Nano, so the on-device step shows "skipped" and the letter is drafted by cloud Gemini via `PREFER_ON_DEVICE` fallback. The video says so.
