import subprocess, json, wave, os, sys
sys.path.insert(0,'.')
from script import SCENES
os.makedirs('build/vo',exist_ok=True)
out=[]
for sc in SCENES:
    for i,l in enumerate(sc['lines']):
        fn=f"build/vo/{sc['id']}_{i}.wav"
        subprocess.run(['./venv/bin/piper','-m','tts/es_ES-davefx-medium.onnx','--length_scale','1.0','--sentence_silence','0.25','-f',fn],input=l.encode(),capture_output=True)
        with wave.open(fn) as w: d=w.getnframes()/w.getframerate()
        out.append(dict(scene=sc['id'],i=i,text=l,dur=round(d,3),file=fn))
json.dump(out,open('build/vo.json','w'),ensure_ascii=False,indent=1)
print(sum(o['dur'] for o in out)); 
for sc in SCENES: print(sc['id'], round(sum(o['dur'] for o in out if o['scene']==sc['id']),1))
