# Recorte v5: NO corta voz. Solo elimina (a) palabras inventadas por XTTS tras el texto y (b) silencio final,
# dejando 0,45 s de margen. Después verifica con Whisper que la última palabra del guion está completa.
import json, wave, re, subprocess, difflib, os, numpy as np
from faster_whisper import WhisperModel
from num2words import num2words
VD = os.environ.get("VD", "v5")
asr = WhisperModel("small", device="cpu", compute_type="int8")
import unicodedata
def norm(s):
    s = re.sub(r"(\d)\.(\d{3})", r"\1\2", s)
    s = re.sub(r"\d+", lambda m: " " + num2words(int(m.group()), lang="es") + " ", s)
    s = s.lower().replace("j", "h").replace("v", "b").replace("ll", "y")
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-zñ ]", " ", s); return re.sub(r"\s+", " ", s).strip()
def pcm16k(a, sr):
    return np.interp(np.arange(0, len(a) / sr, 1 / 16000), np.arange(len(a)) / sr, a.astype(np.float32) / 32768).astype(np.float32)
vo = json.load(open(f"{VD}/vo.json")); bad = []
for o in vo:
    w = wave.open(o["file"]); sr = w.getframerate(); a = np.frombuffer(w.readframes(w.getnframes()), np.int16).copy(); w.close()
    segs, _ = asr.transcribe(pcm16k(a, sr), language="es", word_timestamps=True, beam_size=3)
    words = [x for s in segs for x in s.words]; T = norm(o["text"])
    best, bk = -1, len(words) - 1
    for k in range(len(words)):
        r = difflib.SequenceMatcher(None, norm("".join(x.word for x in words[:k + 1])), T).ratio()
        if r > best + 1e-6: best, bk = r, k
    limit = len(a) / sr
    full = difflib.SequenceMatcher(None, norm("".join(x.word for x in words)), T).ratio()
    tail_dur = (words[-1].end - words[bk + 1].start) if bk + 1 < len(words) else 0
    if bk + 1 < len(words) and best - full > 0.03 and tail_dur > 0.3:
        limit = words[bk + 1].start - 0.04          # cola claramente ajena al guion (alucinación): se corta antes
    else:
        bk = len(words) - 1                         # en caso de duda se conserva todo el audio hablado
    hop = int(0.01 * sr); rms = np.sqrt(np.convolve((a.astype(np.float32) / 32768) ** 2, np.ones(hop) / hop, "same"))
    thr = max(0.004, 0.03 * np.percentile(rms, 99)); t = words[bk].end if words else 0; quiet = 0
    while t < limit:                                                     # avanzar hasta 150 ms seguidos de silencio real
        if rms[min(int(t * sr), len(rms) - 1)] < thr: quiet += 0.01
        else: quiet = 0
        if quiet >= 0.15: break
        t += 0.01
    end = min(limit, t - quiet + 0.45, len(a) / sr); n = int(end * sr)
    if n < len(a):
        fade = int(0.12 * sr); a = a[:n].copy(); a[-fade:] = (a[-fade:] * np.linspace(1, 0, fade) ** 2).astype(np.int16)
        ww = wave.open(o["file"], "wb"); ww.setnchannels(1); ww.setsampwidth(2); ww.setframerate(sr); ww.writeframes(a.tobytes()); ww.close()
    segs2, _ = asr.transcribe(pcm16k(a, sr), language="es", beam_size=3)
    hyp = norm(" ".join(s.text for s in segs2)); sc = difflib.SequenceMatcher(None, hyp, T).ratio()
    lastw = T.split()[-1]; ok_end = any(difflib.SequenceMatcher(None, lastw, h).ratio() >= 0.6 for h in hyp.split()[-2:])
    print(f"{o['scene']}_{o['i']}: {o['dur']:.2f}->{end:.2f}s score={sc:.3f} final_ok={ok_end} :: ...{hyp[-60:]}", flush=True)
    o["dur"] = round(end, 3); o["score"] = round(sc, 3)
    if sc < 0.95 or not ok_end: bad.append(f"{o['scene']}_{o['i']}")
json.dump(vo, open(f"{VD}/vo.json", "w"), ensure_ascii=False, indent=1)
print("TOTAL", round(sum(o["dur"] for o in vo), 1), "BAD", ",".join(bad))
