import os,sys
HERE=os.path.dirname(os.path.abspath(__file__))
INDEX=os.path.abspath(os.path.join(HERE,'..','site','index.html'))
MESTRE=os.path.abspath(os.path.join(HERE,'..','privado','mestre.json'))
MAPA=os.path.join(HERE,'mapa.png')
import asyncio,sys
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--no-sandbox'])
        pg=await b.new_page(viewport={'width':1280,'height':800})
        errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.on('console',lambda m:errs.append('C:'+m.text) if m.type=='error' else None)
        mock=open(os.path.join(HERE,'mock_supabase.js'),encoding='utf8').read()
        await pg.route('**/@supabase/supabase-js@2',lambda r:r.fulfill(body=mock,content_type='application/javascript'))
        await pg.route('**/fonts.googleapis.com/**',lambda r:r.abort())
        await pg.goto('file://'+INDEX)
        await pg.wait_for_selector('[data-e]',timeout=8000)
        await pg.click('[data-e]')
        await pg.wait_for_selector('#nav a[data-v=tabuleiro]')
        await pg.click('#nav a[data-v=tabuleiro]')
        await pg.wait_for_selector('#vtt:not([hidden])')
        await pg.wait_for_timeout(500)
        print('msg:',(await pg.inner_text('#vmsg'))[:80])
        await pg.screenshot(path=os.path.join(__import__('tempfile').gettempdir(),'s1.png'))
        # criar cena com mapa
        await pg.click('[data-a=scenes]')
        await pg.fill('#vsn','Mansão')
        await pg.set_input_files('#vsfile',MAPA)
        await pg.click('[data-create]')
        await pg.wait_for_timeout(1500)
        print('top:',await pg.inner_text('#vtop'))
        # adicionar tokens
        await pg.click('[data-a=addtok]')
        await pg.click('.modal [data-pc]:not([disabled])')
        await pg.click('.modal [data-k="1"]')
        await pg.wait_for_timeout(500)
        print('tokens:',await pg.evaluate('VTT.state.tokens.map(t=>[t.name,t.x,t.y])'))
        # mover token por arrasto
        t=await pg.evaluate('VTT.state.tokens[0]');cam=await pg.evaluate('VTT.state.cam')
        box=await pg.evaluate("(()=>{const r=document.getElementById('vc').getBoundingClientRect();return [r.left,r.top]})()")
        sx=box[0]+(t['x']-cam['x'])*cam['z'];sy=box[1]+(t['y']-cam['y'])*cam['z']
        await pg.mouse.move(sx,sy);await pg.mouse.down();await pg.mouse.move(sx+150,sy+90,steps=8);await pg.mouse.up()
        await pg.wait_for_timeout(400)
        print('after drag:',await pg.evaluate('VTT.state.tokens.map(t=>[t.name,Math.round(t.x),Math.round(t.y)])'))
        await pg.screenshot(path=os.path.join(__import__('tempfile').gettempdir(),'s2.png'))
        # voltar para Agentes e conferir que o tabuleiro some
        await pg.click('#nav a[data-v=agentes]')
        await pg.wait_for_timeout(300)
        print('vtt hidden:',await pg.evaluate("document.getElementById('vtt').hidden"),'app display:',await pg.evaluate("getComputedStyle(document.getElementById('app')).display"))
        await pg.click('#nav a[data-v=tabuleiro]');await pg.wait_for_timeout(400)
        print('back, tokens:',await pg.evaluate('VTT.state.tokens.length'))
        print('ERRS',errs)
        await b.close()
asyncio.run(main())
