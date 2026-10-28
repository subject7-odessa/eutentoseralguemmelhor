import os,sys
HERE=os.path.dirname(os.path.abspath(__file__))
INDEX=os.path.abspath(os.path.join(HERE,'..','site','index.html'))
MESTRE=os.path.abspath(os.path.join(HERE,'..','privado','mestre.json'))
MAPA=os.path.join(HERE,'mapa.png')
import asyncio,json
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--no-sandbox'])
        pg=await b.new_page(viewport={'width':1280,'height':900})
        errs=[]
        pg.on('pageerror',lambda e:errs.append('PE:'+str(e)))
        pg.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
        mock=open(os.path.join(HERE,'mock_supabase.js'),encoding='utf8').read()
        await pg.route('**/@supabase/supabase-js@2',lambda r:r.fulfill(body=mock,content_type='application/javascript'))
        await pg.route('**/fonts.googleapis.com/**',lambda r:r.abort())
        await pg.goto('file://'+INDEX)
        await pg.wait_for_selector('[data-e]');await pg.click('[data-e]')
        await pg.wait_for_selector('#nav a[data-v=livro]');await pg.click('#nav a[data-v=livro]')
        await pg.wait_for_selector('#lvc',state='attached')
        print('mestre sem import, caps:',await pg.eval_on_selector_all('#lvc option','e=>e.length'),'| banner:',(await pg.inner_text('.box h3')))
        await pg.set_input_files('#lvf',MESTRE);await pg.wait_for_timeout(3000)
        print('apos import caps:',await pg.eval_on_selector_all('#lvc option','e=>e.length'),'linhas db:',await pg.evaluate("window.__db.conteudo_mestre.length"))
        await pg.evaluate("(()=>{const s=document.querySelector('#lvc');s.value='25';s.dispatchEvent(new Event('change',{bubbles:true}))})()")
        print('cap25 secoes:',await pg.eval_on_selector_all('details.xc','e=>e.map(x=>x.querySelector("b").textContent)'))
        # jogador: não vê privados
        await pg.evaluate("window.__player=true;lvPriv=[];lvPrivOk=false;camp.master='outro';render()")
        await pg.wait_for_timeout(500)
        await pg.click('#nav a[data-v=livro]');await pg.wait_for_selector('#lvc',state='attached')
        print('jogador caps:',await pg.eval_on_selector_all('#lvc option','e=>e.length'))
        print('ERRS',errs)
        await b.close()
asyncio.run(main())
