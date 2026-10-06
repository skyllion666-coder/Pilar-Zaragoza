import asyncio, time, sys
from playwright.async_api import async_playwright
ARGS = {
 'swiftshader': ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
 'gpu-gl': ['--use-angle=gl','--enable-gpu','--ignore-gpu-blocklist','--enable-features=Vulkan'],
 'gpu-vulkan': ['--use-angle=vulkan','--enable-gpu','--ignore-gpu-blocklist','--enable-features=Vulkan'],
}
async def run(name):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--headless=new']+ARGS[name])
        pg = await b.new_page(viewport={'width':1920,'height':1080})
        await pg.goto('file:///home/skyllion/PilarDoc/Pilar_3D_Documental.html')
        await pg.wait_for_function('typeof window.__render==="function"', polling=1000, timeout=180000)
        r = await pg.evaluate("(()=>{const c=document.createElement('canvas').getContext('webgl2'); const d=c.getExtension('WEBGL_debug_renderer_info'); return d?c.getParameter(d.UNMASKED_RENDERER_WEBGL):'?'})()")
        await pg.evaluate("document.getElementById('intro').classList.add('off');document.body.classList.add('playing')")
        t0=time.time()
        for i in range(6):
            await pg.evaluate(f'window.__render({10+i/30})'); await pg.screenshot(type='jpeg', quality=90)
        print(name, '|', r, '|', round((time.time()-t0)/6,2), 's/frame', flush=True)
        await b.close()
for n in sys.argv[1:]: asyncio.run(run(n))
