import base64, subprocess, json
subprocess.run(['npx','esbuild','src/main.js','--bundle','--minify','--format=iife','--outfile=v5/bundle.js','--log-level=warning'],check=True)
t=open('src/template_v5.html').read()
r={'__TL__':open('v5/timeline.json').read(),
   '__GLB__':base64.b64encode(open('v2/pilar.glb','rb').read()).decode(),
   '__VO__':base64.b64encode(open('v5/vo.mp3','rb').read()).decode(),
   '__FRESCO__':base64.b64encode(open('build/fresco.jpg','rb').read()).decode()}
import glob, os as _os
r['__TEX__']=json.dumps({_os.path.basename(f)[:-4]:'data:image/jpeg;base64,'+base64.b64encode(open(f,'rb').read()).decode() for f in sorted(glob.glob('v2/tex/*.jpg'))})
r['__CITY__']=open('v4/city.json').read()
r['__PUENTE__']=base64.b64encode(open('v5/puente.glb','rb').read()).decode()
r['__LION__']='data:image/png;base64,'+base64.b64encode(open('v5/lion.png','rb').read()).decode()
from PIL import Image
CR=json.load(open('v5/ref/credits.json')); PH={}
DEPTH={'virgen_cerca':2.0,'virgen_manto':2.2,'nave':3.0,'retablo_2':1.6,'coreto':1.4,'regina':1.6,'timpano':1.2,'bomba_cartel':0.6,'bomba_marca':0.8,'bomba_agujero':1.6,'torre_nueva':2.2,'santa_capilla':2.2,'santa_capilla_2':2.6,'ofrenda':2.6,'ofrenda_2':2.4,'puente_1':2.2}
for k,D in DEPTH.items():
    im=Image.open(f'v5/photos/{k}.jpg'); w,h=im.size
    PH[k]=dict(img='data:image/jpeg;base64,'+base64.b64encode(open(f'v5/photos/{k}.jpg','rb').read()).decode(), depth='data:image/png;base64,'+base64.b64encode(open(f'v5/photos/{k}_d.png','rb').read()).decode(), w=w, h=h, D=D,
               credit='Fotografía real · '+CR[k]['artist']+' · '+CR[k]['license']+' · Wikimedia Commons')
r['__PHOTOS__']=json.dumps(PH)
for k,v in r.items(): t=t.replace(k,v)
t=t.replace('__BUNDLE__',open('v5/bundle.js').read().replace('</script>','<\\/script>'))
open('Pilar_3D_Documental.html','w').write(t)
import os; print(os.path.getsize('Pilar_3D_Documental.html')/1e6,'MB')
