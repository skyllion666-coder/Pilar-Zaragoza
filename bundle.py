import base64, subprocess, json
subprocess.run(['npx','esbuild','src/main.js','--bundle','--minify','--format=iife','--outfile=build/bundle.js','--log-level=warning'],check=True)
t=open('src/template.html').read()
r={'__TL__':open('build/timeline.json').read(),
   '__GLB__':base64.b64encode(open('build/pilar.glb','rb').read()).decode(),
   '__VO__':base64.b64encode(open('build/vo.mp3','rb').read()).decode(),
   '__FRESCO__':base64.b64encode(open('build/fresco.jpg','rb').read()).decode()}
for k,v in r.items(): t=t.replace(k,v)
t=t.replace('__BUNDLE__',open('build/bundle.js').read().replace('</script>','<\\/script>'))
open('Pilar_3D_Documental.html','w').write(t)
import os; print(os.path.getsize('Pilar_3D_Documental.html')/1e6,'MB')
