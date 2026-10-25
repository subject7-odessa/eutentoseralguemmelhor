import os,sys
HERE=os.path.dirname(os.path.abspath(__file__))
INDEX=os.path.abspath(os.path.join(HERE,'..','site','index.html'))
MAPA=os.path.join(HERE,'mapa.png')
import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--no-sandbox'])
        pg=await b.new_page(viewport={'width':1280,'height':800})
        errs=[];pg.on('pageerror',lambda e:errs.append('PE:'+str(e)))
        resp=[]
        pg.on('dialog',lambda d:asyncio.ensure_future(d.accept(resp.pop(0) if resp else 'x')))
        mock=open(os.path.join(HERE,'mock_supabase.js'),encoding='utf8').read()
        await pg.route('**/@supabase/supabase-js@2',lambda r:r.fulfill(body=mock,content_type='application/javascript'))
        await pg.route('**/fonts.googleapis.com/**',lambda r:r.abort())
        await pg.goto('file://'+INDEX)
        await pg.wait_for_selector('[data-e]');await pg.click('[data-e]')
        await pg.click('#nav a[data-v=tabuleiro]');await pg.wait_for_selector('#vtt:not([hidden])')
        await pg.click('[data-a=scenes]');await pg.fill('#vsn','T');await pg.set_input_files('#vsfile',MAPA);await pg.click('[data-create]');await pg.wait_for_timeout(1500)
        async def pick(kind):
            t=await pg.evaluate(f"VTT.state.tokens.find(t=>{kind})");cam=await pg.evaluate("VTT.state.cam")
            box=await pg.evaluate("(()=>{const r=document.getElementById('vc').getBoundingClientRect();return [r.left,r.top]})()")
            await pg.mouse.click(box[0]+(t['x']-cam['x'])*cam['z'],box[1]+(t['y']-cam['y'])*cam['z']);await pg.wait_for_timeout(250)
        # ameaça manual
        await pg.click('[data-a=addtok]');await pg.click('#vta a[data-t=threat]');await pg.fill('#vtn','Lobisomem 1');await pg.click('[data-pn]');await pg.click('.modal [data-k="1"]');await pg.wait_for_timeout(400)
        await pick("t.kind==='threat'")
        # cor da borda
        await pg.click('[data-a=tcor][data-v="#e0352b"]');await pg.wait_for_timeout(200)
        print('cor token:',await pg.evaluate("VTT.state.tokens[0].cor"))
        # versão humana (vermelho) e versão lobo (azul, tam 2)
        resp+=['Lobisomem','forma humana'];await pg.click('[data-a=tsave]');await pg.wait_for_timeout(300)
        await pg.click('[data-a=tcor][data-v="#5aa9ff"]');await pg.click('[data-a=tsize][data-v="2"]')
        resp+=['Lobisomem','forma de lobo'];await pg.click('[data-a=tsave]');await pg.wait_for_timeout(300)
        print('modelos:',await pg.evaluate("window.__db.token_modelos.map(m=>[m.grupo,m.name,m.kind,m.cor,m.size].join('|'))"))
        print('chips de versão:',await pg.eval_on_selector_all('[data-a=tvar]','e=>e.map(x=>x.textContent)'))
        await pg.click('[data-a=tvar]');await pg.wait_for_timeout(250)
        print('apos versao humana:',await pg.evaluate("[VTT.state.tokens[0].cor,VTT.state.tokens[0].size]"))
        # cor personalizada
        await pg.evaluate("(()=>{const i=document.getElementById('vtcor');i.value='#12ab34';i.dispatchEvent(new Event('change',{bubbles:true}))})()");await pg.wait_for_timeout(250)
        print('cor custom:',await pg.evaluate("VTT.state.tokens[0].cor"),'| db:',await pg.evaluate("window.__db.scene_tokens[0].cor"))
        await pg.click('[data-a=tcor][data-v=""]');print('padrao:',await pg.evaluate("VTT.state.tokens[0].cor"))
        # adicionar 2 cópias do modelo lobo
        await pg.click('[data-a=addtok]');await pg.click('#vta a[data-t=mod]');await pg.wait_for_timeout(200)
        await pg.locator('[data-pmp]').nth(1).click();await pg.locator('[data-pmp]').nth(1).click();await pg.wait_for_timeout(100)
        await pg.screenshot(path=os.path.join(__import__('tempfile').gettempdir(),'md2.png'))
        await pg.click('.modal [data-k="1"]');await pg.wait_for_timeout(500)
        toks=await pg.evaluate("VTT.state.tokens.map(t=>[t.name,t.kind,t.size,t.cor].join('|'))");print('tokens:',toks)
        await pick("t.name==='Lobisomem 1'&&t.size===2&&t.cor")
        print('chips no novo token:',await pg.eval_on_selector_all('[data-a=tvar]','e=>e.length'))
        await pg.screenshot(path=os.path.join(__import__('tempfile').gettempdir(),'md3.png'))
        print('ERRS',errs)
        assert await pg.evaluate("window.__db.token_modelos.filter(m=>m.kind==='threat').length")==2,'esperava 2 versões de ameaça'
        await b.close()
asyncio.run(main())
