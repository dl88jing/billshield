"""Kokoro TTS (voice af_heart) for each line of script.json -> assets/vo/*.wav + durations.json.
Model files: set KOKORO_MODEL / KOKORO_VOICES (kokoro-v1.0.onnx, voices-v1.0.bin)."""
import json, os, soundfile as sf
from kokoro_onnx import Kokoro
k = Kokoro(os.environ.get("KOKORO_MODEL", "kokoro-v1.0.onnx"), os.environ.get("KOKORO_VOICES", "voices-v1.0.bin"))
os.makedirs("assets/vo", exist_ok=True)
out = {}
for sid, text in json.load(open("script.json")):
    s, sr = k.create(text, voice="af_heart", speed=float(os.environ.get("KOKORO_SPEED", "1.05")), lang="en-us")
    sf.write(f"assets/vo/{sid}.wav", s, sr)
    out[sid] = round(len(s) / sr, 3)
    print(sid, out[sid], flush=True)
json.dump(out, open("assets/vo/durations.json", "w"), indent=1)
print("total", round(sum(out.values()), 2))
