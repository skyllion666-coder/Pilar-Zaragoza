import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width':640,'height':360})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type in ('error','warning') and errs.append(m.text[:200]))
        await pg.goto('file:///home/skyllion/PilarDoc/Pilar_3D_Documental.html')
        await pg.wait_for_function('!document.getElementById("start").disabled', polling=1000, timeout=120000)
        await pg.click('#start'); await pg.wait_for_timeout(12000)
        print('sub:', await pg.evaluate('document.getElementById("sub").textContent'))
        await pg.screenshot(path='build/play.jpg')
        print('errors:', errs[:10]); await b.close()
asyncio.run(main())
