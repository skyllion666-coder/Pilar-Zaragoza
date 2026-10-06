import base64, subprocess, json
subprocess.run(['npx','esbuild','src/main.js','--bundle','--minify','--format=iife','--outfile=v3/bundle.js','--log-level=warning'],check=True)
t=open('src/template_v3.html').read()
r={'__TL__':open('v3/timeline.json').read(),
   '__GLB__':base64.b64encode(open('v2/pilar.glb','rb').read()).decode(),
   '__VO__':base64.b64encode(open('v3/vo.mp3','rb').read()).decode(),
   '__FRESCO__':base64.b64encode(open('build/fresco.jpg','rb').read()).decode()}
import glob, os as _os
r['__TEX__']=json.dumps({_os.path.basename(f)[:-4]:'data:image/jpeg;base64,'+base64.b64encode(open(f,'rb').read()).decode() for f in sorted(glob.glob('v2/tex/*.jpg'))})
for k,v in r.items(): t=t.replace(k,v)
t=t.replace('__BUNDLE__',open('v3/bundle.js').read().replace('</script>','<\\/script>'))
open('Pilar_3D_Documental_v3.html','w').write(t)
import os; print(os.path.getsize('Pilar_3D_Documental_v3.html')/1e6,'MB')
