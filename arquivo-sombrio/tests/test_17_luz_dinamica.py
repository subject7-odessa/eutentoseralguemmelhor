import os,sys,tempfile
HERE=os.path.dirname(os.path.abspath(__file__))
INDEX=os.path.abspath(os.path.join(HERE,'..','site','index.html'))
MAPA=os.path.join(HERE,'mapa.png')
TMP=tempfile.gettempdir()
import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--no-sandbox'])
        pg=await b.new_page(viewport={'width':1280,'height':800})
        errs=[];pg.on('pageerror',lambda e:errs.append('PE:'+str(e)))
        pg.on('dialog',lambda d:asyncio.ensure_future(d.accept('x')))
        mock=open(os.path.join(HERE,'mock_supabase.js'),encoding='utf8').read()
        await pg.route('**/@supabase/supabase-js@2',lambda r:r.fulfill(body=mock,content_type='application/javascript'))
        await pg.route('**/fonts.googleapis.com/**',lambda r:r.abort())
        await pg.goto('file://'+INDEX)
        await pg.wait_for_selector('[data-e]');await pg.click('[data-e]')
        await pg.click('#nav a[data-v=tabuleiro]');await pg.wait_for_selector('#vtt:not([hidden])')
        await pg.click('[data-a=scenes]');await pg.fill('#vsn','T');await pg.set_input_files('#vsfile',MAPA);await pg.click('[data-create]');await pg.wait_for_timeout(1500)
        await pg.click('[data-a=addtok]');await pg.click('.modal [data-pc]');await pg.click('.modal [data-k="1"]');await pg.wait_for_timeout(500)
        print('botoes:',await pg.eval_on_selector_all('#vtools button','e=>e.map(x=>x.dataset.a)'))
        # tema + brilho
        await pg.click('[data-a=t-luz]');await pg.wait_for_selector('[data-a=ltema]')
        await pg.click('[data-a=ltema][data-v=noite]');await pg.wait_for_timeout(300)
        print('tema:',await pg.evaluate("JSON.stringify([VTT.luz.tema,VTT.luz.cor,VTT.luz.forca])"))
        await pg.evaluate("(()=>{const i=document.querySelector('[data-lz=bri]');i.value=70;i.dispatchEvent(new Event('input',{bubbles:true}))})()");await pg.wait_for_timeout(300)
        print('brilho:',await pg.evaluate("VTT.luz.bri"));await pg.screenshot(path=os.path.join(TMP,'lz1.png'))
        # luz dinâmica: parede + luz
        t=await pg.evaluate("VTT.state.tokens[0]");cam=await pg.evaluate("VTT.state.cam")
        box=await pg.evaluate("(()=>{const r=document.getElementById('vc').getBoundingClientRect();return [r.left,r.top]})()")
        sx=lambda x:box[0]+(x-cam['x'])*cam['z'];sy=lambda y:box[1]+(y-cam['y'])*cam['z']
        await pg.click('[data-a=lon]');await pg.click('[data-a=ltema][data-v=""]')
        # parede vertical à direita do token
        await pg.click('[data-a=lmode][data-v=wall]')
        await pg.mouse.move(sx(t['x']+140),sy(t['y']-200));await pg.mouse.down();await pg.mouse.move(sx(t['x']+140),sy(t['y']+200),steps=6);await pg.mouse.up();await pg.wait_for_timeout(300)
        # luz do outro lado da parede
        await pg.click('[data-a=lmode][data-v=light]');await pg.mouse.click(sx(t['x']+260),sy(t['y']));await pg.wait_for_timeout(400)
        print('luz:',await pg.evaluate("JSON.stringify({on:VTT.luz.on,paredes:VTT.luz.walls.length,luzes:VTT.luz.lights.length})"))
        await pg.click('[data-a=lprev]');await pg.wait_for_timeout(300)
        A=lambda dx:pg.evaluate(f"VTT.lumAt({t['x']}+{dx},{t['y']})")
        print('escuridão no token:',round(await A(0),2),'| 100 px à direita (visão 6 casas, antes da parede):',round(await A(100),2))
        print('lado de lá da parede perto da luz (bloqueada):',round(await A(260),2),'| longe, à esquerda:',round(await A(-600),2))
        await pg.screenshot(path=os.path.join(TMP,'lz2.png'))
        # remover parede -> luz passa
        await pg.evaluate("document.querySelector('[data-a=lmode][data-v=erase]').click()");w0=await pg.evaluate('VTT.luz.walls[0]');await pg.mouse.click(sx(w0[0]),sy((w0[1]+w0[3])/2));await pg.wait_for_timeout(400)
        print('paredes após apagar:',await pg.evaluate("VTT.luz.walls.length"),'| escuridão na luz sem parede:',round(await A(260),2))
        await pg.screenshot(path=os.path.join(TMP,'lz3.png'))
        print('db luz:',await pg.evaluate("JSON.stringify([window.__db.scenes[0].luz.on,window.__db.scenes[0].luz.bri,window.__db.scenes[0].luz.lights.length])"))
        print('ERRS',errs)
        assert await pg.evaluate("VTT.luz.on===true&&VTT.luz.bri===70"),'luz deveria estar ligada com brilho 70'
        await b.close()
asyncio.run(main())
