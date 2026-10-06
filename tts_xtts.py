# Narración v3 con XTTS v2 (Coqui, licencia CPML no comercial) + verificación automática con Whisper.
# Uso: COQUI_TOS_AGREED=1 venv_xtts/bin/python tts_xtts.py [speaker] [solo_prueba]
import os, sys, json, re, difflib, wave
os.environ.setdefault("COQUI_TOS_AGREED", "1")
import torch
torch.set_num_threads(os.cpu_count())
from TTS.api import TTS
from faster_whisper import WhisperModel
sys.path.insert(0, '.'); import importlib; SCENES = importlib.import_module(os.environ.get('SCRIPT', 'script')).SCENES
VD = os.environ.get('VD', 'v3')

SPK = sys.argv[1] if len(sys.argv) > 1 else "Luis Moray"
TEST = len(sys.argv) > 2
OUT = f"{VD}/vo"; os.makedirs(OUT, exist_ok=True)
tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cpu")
asr = WhisperModel("small", device="cpu", compute_type="int8")

from num2words import num2words
PRON = {"Bayeu": "Bayéu", "Regina Martyrum": "Regina Mártirum", "Herrera el Mozo": "Herrera, el Mozo", "Juan de la Huerta": "Juan de la Huerta,", "Pellicer": "Pellicér"}
def norm(s):
    s = re.sub(r"(\d)\.(\d{3})", r"\1\2", s)
    s = re.sub(r"\d+", lambda m: " " + num2words(int(m.group()), lang="es") + " ", s)
    s = s.lower().replace("j", "h").replace("v", "b").replace("ll", "y")   # equivalencias fonéticas del español
    s = re.sub(r"[^a-záéíóúüñ ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()

import subprocess, numpy as np
def load16k(fn):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", fn, "-f", "f32le", "-ac", "1", "-ar", "16000", "-"], capture_output=True).stdout
    return np.frombuffer(raw, np.float32)

def check(fn, text):
    segs, _ = asr.transcribe(load16k(fn), language="es", beam_size=3)
    hyp = " ".join(s.text for s in segs)
    return difflib.SequenceMatcher(None, norm(hyp), norm(text)).ratio(), hyp

lines = [(sc["id"], i, l) for sc in SCENES for i, l in enumerate(sc["lines"])]
ONLY = os.environ.get("ONLY"); REQ = os.environ.get("REQUIRE")
if ONLY:
    prev = {f"{r['scene']}_{r['i']}": r for r in json.load(open(f"{VD}/vo.json"))}
if TEST: lines = lines[:2]
res = []
for sid, i, text in lines:
    if ONLY and f"{sid}_{i}" not in ONLY.split(","):
        res.append(prev[f"{sid}_{i}"]); continue
    if ONLY and os.path.exists(f"{OUT}/{sid}_{i}.wav"): os.remove(f"{OUT}/{sid}_{i}.wav")
    fn = f"{OUT}/{sid}_{i}.wav"; best = None
    say = text
    for a, b in PRON.items(): say = say.replace(a, b)
    if os.path.exists(fn):
        sc0, hyp0 = check(fn, text)
        with wave.open(fn) as w: d0 = w.getnframes() / w.getframerate()
        print(f"{sid}_{i} existing score={sc0:.3f} :: {hyp0[:90]}", flush=True)
        best = (sc0, d0)
    for attempt in range(5 if best is None or best[0] < 0.95 else 0):
        torch.manual_seed(1234 + attempt * 77)
        tts.tts_to_file(text=say, speaker=SPK, language="es", file_path=fn + ".tmp.wav", speed=float(os.environ.get("SPEED","1.0")),
                        temperature=0.6, repetition_penalty=5.0, enable_text_splitting=True)
        score, hyp = check(fn + ".tmp.wav", text)
        if REQ and not re.search(REQ, hyp.lower()): score -= 0.2
        if os.environ.get("FORBID") and re.search(os.environ["FORBID"], hyp.lower()): score -= 0.3
        with wave.open(fn + ".tmp.wav") as w: dur = w.getnframes() / w.getframerate()
        print(f"{sid}_{i} try{attempt} score={score:.3f} dur={dur:.1f}s :: {hyp[:90]}", flush=True)
        if best is None or score > best[0]:
            best = (score, dur); os.replace(fn + ".tmp.wav", fn)
        if score >= 0.95: break
    res.append(dict(scene=sid, i=i, text=text, dur=round(best[1], 3), file=fn, score=round(best[0], 3)))
json.dump(res, open(f"{VD}/vo{'_test' if TEST else ''}.json", "w"), ensure_ascii=False, indent=1)
print("TOTAL", round(sum(r["dur"] for r in res), 1), "MIN_SCORE", min(r["score"] for r in res))
