# Recorta lo que XTTS añade tras el texto (ruidos/alucinaciones): se elige el punto de corte donde la
# transcripción acumulada (Whisper, marcas por palabra) se parece más al guion. Después se re-verifica.
import json, wave, re, subprocess, difflib, sys, os, numpy as np
VD = os.environ.get("VD", "v3")
from faster_whisper import WhisperModel
from num2words import num2words
asr = WhisperModel("small", device="cpu", compute_type="int8")
def norm(s):
    s = re.sub(r"(\d)\.(\d{3})", r"\1\2", s)
    s = re.sub(r"\d+", lambda m: " " + num2words(int(m.group()), lang="es") + " ", s)
    s = s.lower().replace("j", "h").replace("v", "b").replace("ll", "y")
    s = re.sub(r"[^a-záéíóúüñ ]", " ", s); return re.sub(r"\s+", " ", s).strip()
def pcm16k(fn):
    return np.frombuffer(subprocess.run(["ffmpeg","-loglevel","error","-i",fn,"-f","f32le","-ac","1","-ar","16000","-"],capture_output=True).stdout, np.float32)
vo = json.load(open(f"{VD}/vo.json")); bad = []
for o in vo:
    w = wave.open(o["file"]); sr = w.getframerate(); a = np.frombuffer(w.readframes(w.getnframes()), np.int16).copy(); w.close()
    segs, _ = asr.transcribe(pcm16k(o["file"]), language="es", word_timestamps=True, beam_size=3)
    words = [wd for s in segs for wd in s.words]; T = norm(o["text"])
    best, bk = -1, len(words) - 1
    for k in range(len(words)):
        r = difflib.SequenceMatcher(None, norm("".join(x.word for x in words[:k + 1])), T).ratio()
        if r > best + 1e-6: best, bk = r, k
    end = words[bk].end + 0.25 if words else len(a) / sr
    nxt = words[bk + 1].start if bk + 1 < len(words) else None
    if nxt is not None: end = min(end, (words[bk].end + nxt) / 2)
    n = min(len(a), int(end * sr)); tail = "".join(x.word for x in words[bk + 1:])
    if n < len(a) - int(0.05 * sr):
        fade = min(int(0.05 * sr), n); a = a[:n]; a[-fade:] = (a[-fade:] * np.linspace(1, 0, fade)).astype(np.int16)
        ww = wave.open(o["file"], "wb"); ww.setnchannels(1); ww.setsampwidth(2); ww.setframerate(sr); ww.writeframes(a.tobytes()); ww.close()
    segs2, _ = asr.transcribe(pcm16k(o["file"]), language="es", beam_size=3)
    hyp = " ".join(s.text for s in segs2); sc = difflib.SequenceMatcher(None, norm(hyp), T).ratio()
    print(f"{o['scene']}_{o['i']}: {o['dur']:.2f}->{n/sr:.2f}s score={sc:.3f} cola='{tail.strip()}' :: {hyp.strip()}")
    o["dur"] = round(n / sr, 3); o["score"] = round(sc, 3)
    if sc < 0.95: bad.append(f"{o['scene']}_{o['i']}")
json.dump(vo, open(f"{VD}/vo.json", "w"), ensure_ascii=False, indent=1)
print("TOTAL", round(sum(o["dur"] for o in vo), 1), "BAD", bad)
