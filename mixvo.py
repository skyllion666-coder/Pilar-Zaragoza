import json, wave, numpy as np, subprocess, sys
sys.path.insert(0,'.'); from script import SCENES
vo=json.load(open('build/vo.json')); SR=22050
GAP=0.45; t=0.0; track=[]; cues=[]; scenes={}
def add_sil(d):
    track.append(np.zeros(int(d*SR),np.int16))
for sc in SCENES:
    t+=sc['pre']; add_sil(sc['pre']); scenes[sc['id']]=round(t,3)
    for o in [v for v in vo if v['scene']==sc['id']]:
        w=wave.open(o['file']); a=np.frombuffer(w.readframes(w.getnframes()),np.int16)
        track.append(a); cues.append(dict(s=round(t,3),e=round(t+o['dur'],3),text=o['text'],scene=sc['id']))
        t+=o['dur']+GAP; add_sil(GAP)
OUTRO=8.0; add_sil(OUTRO); total=t+OUTRO
a=np.concatenate(track); w=wave.open('build/vo_full.wav','wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(a.tobytes()); w.close()
subprocess.run(['ffmpeg','-y','-loglevel','error','-i','build/vo_full.wav','-af','highpass=f=70,acompressor=threshold=-18dB:ratio=3,loudnorm=I=-16','-ar','24000','-ac','1','-b:a','48k','build/vo.mp3'])
json.dump(dict(scenes=scenes,cues=cues,total=round(total,2)),open('build/timeline.json','w'),ensure_ascii=False,indent=1)
print(scenes, 'TOTAL', round(total,1))
