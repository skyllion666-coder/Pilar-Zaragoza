# Exporta el documental a MP4 1080p30: fotogramas renderizados uno a uno (GPU) + audio mezclado offline.
import asyncio, base64, subprocess, sys, wave, time, math
from playwright.async_api import async_playwright
FPS = 30; OUT = sys.argv[1]; LIMIT = float(sys.argv[2]) if len(sys.argv) > 2 else None
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True,
                                    args=['--headless=new', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': 1920, 'height': 1080}, device_scale_factor=1)
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file:///home/skyllion/PilarDoc/Pilar_3D_Documental.html')
        await pg.wait_for_function('typeof window.__videoPrep==="function"', polling=1000, timeout=180000)
        total = await pg.evaluate('window.__videoPrep()'); dur = min(total, LIMIT) if LIMIT else total
        info = await pg.evaluate('window.__videoAudio()'); n = info['n']; size = 1 << 20; data = bytearray()
        for i in range(math.ceil(n * 4 / size)): data += base64.b64decode(await pg.evaluate(f'window.__pcmChunk({i},{size})'))
        w = wave.open('/tmp/pilar_audio.wav', 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(info['sr']); w.writeframes(bytes(data)); w.close()
        print('audio', round(n / info['sr'], 1), 's', flush=True)
        ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', str(FPS), '-c:v', 'mjpeg', '-i', '-',
                               '-i', '/tmp/pilar_audio.wav', '-t', f'{dur:.3f}', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
                               '-af', 'alimiter=limit=0.89:level=false', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', OUT], stdin=subprocess.PIPE)
        N = math.ceil(dur * FPS); t0 = time.time()
        for i in range(N):
            await pg.evaluate(f'window.__render({i / FPS})')
            ff.stdin.write(await pg.screenshot(type='jpeg', quality=93))
            if i % 300 == 0: print(f'frame {i}/{N}  {round(time.time() - t0)} s', flush=True)
        ff.stdin.close(); ff.wait(); await b.close()
        print('OK', OUT, 'errores:', errs[:3], flush=True)
asyncio.run(main())
