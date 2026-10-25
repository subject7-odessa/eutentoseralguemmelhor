import os,sys
HERE=os.path.dirname(os.path.abspath(__file__))
INDEX=os.path.abspath(os.path.join(HERE,'..','site','index.html'))
MESTRE=os.path.abspath(os.path.join(HERE,'..','privado','mestre.json'))
MAPA=os.path.join(HERE,'mapa.png')
import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--no-sandbox'])
        pg=await b.new_page(viewport={'width':1280,'height':800})
        errs=[]
        pg.on('pageerror',lambda e:errs.append('PE:'+str(e)))
        pg.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
        mock=open(os.path.join(HERE,'mock_supabase.js'),encoding='utf8').read()
        await pg.route('**/@supabase/supabase-js@2',lambda r:r.fulfill(body=mock,content_type='application/javascript'))
        await pg.route('**/fonts.googleapis.com/**',lambda r:r.abort())
        await pg.goto('file://'+INDEX)
        await pg.wait_for_selector('[data-e]');await pg.click('[data-e]')
        await pg.wait_for_selector('#nav a[data-v=tabuleiro]');await pg.click('#nav a[data-v=tabuleiro]')
        await pg.wait_for_selector('#vtt:not([hidden])')
        await pg.click('[data-a=scenes]');await pg.fill('#vsn','Teste');await pg.set_input_files('#vsfile',MAPA);await pg.click('[data-create]');await pg.wait_for_timeout(1500)
        print('tools:',await pg.eval_on_selector_all('#vtools button','e=>e.map(x=>x.dataset.a)'))
        box=await pg.evaluate("(()=>{const r=document.getElementById('vc').getBoundingClientRect();return [r.left,r.top]})()")
        x0,y0=box[0]+300,box[1]+250
        # régua
        await pg.click('[data-a=t-ruler]');await pg.mouse.move(x0,y0);await pg.mouse.down();await pg.mouse.move(x0+150,y0+0,steps=5);
        print('ruler:',await pg.evaluate("JSON.stringify(VTT.state.ruler&&[Math.round(VTT.state.ruler.b.x-VTT.state.ruler.a.x)])"))
        await pg.mouse.up()
        # desenho
        await pg.click('[data-a=t-rect]');await pg.mouse.move(x0,y0+100);await pg.mouse.down();await pg.mouse.move(x0+120,y0+180,steps=5);await pg.mouse.up();await pg.wait_for_timeout(300)
        await pg.click('[data-a=t-pen]');await pg.mouse.move(x0,y0+220);await pg.mouse.down();await pg.mouse.move(x0+80,y0+260,steps=8);await pg.mouse.up();await pg.wait_for_timeout(300)
        print('desenhos:',await pg.evaluate("window.__db.scene_drawings.map(d=>d.kind+':'+d.pts.length)"))
        await pg.click('[data-a=undo]');await pg.wait_for_timeout(200)
        print('apos undo:',await pg.evaluate("window.__db.scene_drawings.length"))
        # névoa
        await pg.click('[data-a=t-fog]');await pg.click('[data-a=fog-on]');await pg.wait_for_timeout(100)
        await pg.mouse.move(x0+200,y0+100);await pg.mouse.down();await pg.mouse.move(x0+300,y0+120,steps=6);await pg.mouse.up();await pg.wait_for_timeout(700)
        print('fog db:',await pg.evaluate("JSON.stringify({on:window.__db.scenes[0].fog.on,n:window.__db.scenes[0].fog.r.length})"))
        await pg.screenshot(path=os.path.join(__import__('tempfile').gettempdir(),'tb1.png'))
        # token imagem formato
        await pg.click('[data-a=t-sel]');await pg.click('[data-a=addtok]');await pg.wait_for_timeout(200)
        print('ERRS',errs)
        await b.close()
asyncio.run(main())
