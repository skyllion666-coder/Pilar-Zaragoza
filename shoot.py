import sys, json, asyncio
from playwright.async_api import async_playwright
TL=json.load(open('v4/timeline.json')); S=TL['scenes']; C=TL['cues']
def cue(s,i): return [c for c in C if c['scene']==s][i]
times = [float(x) for x in sys.argv[1:]] if len(sys.argv)>1 else [
 3, S['ebro']+4, cue('ebro',1)['s']+3, cue('rewind',1)['s']+2, cue('rewind',3)['s']+3, cue('rewind',3)['e']-1, S['capilla']-2,
 S['capilla']+6, cue('capilla',1)['s']+4, cue('capilla',3)['s']+3, S['bells']+3, cue('bells',1)['s']+3, cue('bells',2)['s']+2, S['sitios']-3, S['sitios']+3,
 cue('sitios',1)['s']+4, cue('sitios',2)['s']+2.5, S['bombs']-2, cue('bombs',1)['s']+3, cue('bombs',2)['s']+1, cue('bombs',3)['s']+1.5, S['azuara']+4, cue('azuara',1)['s']+4, S['outro']+4]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width':960,'height':540})
        logs=[]; pg.on('console', lambda m: logs.append(m.text)); pg.on('pageerror', lambda e: logs.append('ERR '+str(e)))
        await pg.goto('file:///home/skyllion/PilarDoc/Pilar_3D_Documental_v4.html')
        await pg.wait_for_function('typeof window.__render==="function"', polling=1000, timeout=120000)
        await pg.evaluate("document.getElementById('intro').classList.add('off');document.body.classList.add('playing')")
        for i,t in enumerate(times):
            await pg.evaluate(f'window.__render({t})'); await pg.wait_for_timeout(700)
            await pg.screenshot(path=f'v4/shot_{i:02d}.jpg', quality=70)
        print('\n'.join(logs[:20]))
        await b.close()
asyncio.run(main())
