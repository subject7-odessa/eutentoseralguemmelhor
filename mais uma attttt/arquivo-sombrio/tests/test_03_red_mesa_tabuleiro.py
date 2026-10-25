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
        pg=await b.new_page(viewport={'width':1280,'height':900})
        errs=[]
        pg.on('pageerror',lambda e:errs.append('PE:'+str(e)))
        mock=open(os.path.join(HERE,'mock_supabase.js'),encoding='utf8').read()
        await pg.route('**/@supabase/supabase-js@2',lambda r:r.fulfill(body=mock,content_type='application/javascript'))
        await pg.route('**/fonts.googleapis.com/**',lambda r:r.abort())
        await pg.goto('file://'+INDEX)
        await pg.wait_for_selector('[data-e]')
        await pg.evaluate("camp=null;render()")
        await pg.click('#csys [data-sy=red]');await pg.fill('#cn','NC');await pg.click('#cc')
        await pg.wait_for_selector('[data-a=novo]');await pg.click('[data-a=novo]')
        await pg.fill('#wn','Jackie');await pg.click('[data-m=complete]');await pg.click('[data-a=next]')
        await pg.click('[data-a=stp][data-k=REF]');await pg.click('[data-a=stp][data-k=BODY]')
        await pg.click('[data-a=next]');await pg.click('[data-a=next]');await pg.click('[data-a=finish]')
        await pg.wait_for_selector('.rd-st')
        await pg.click('[data-a=back]')
        await pg.click('#nav a[data-v=mesa]');await pg.wait_for_timeout(300)
        tabs=await pg.eval_on_selector_all('#app .tabs a, #app .seg button','e=>e.map(x=>x.textContent)')
        print(tabs)
        for i in range(len(tabs)):
            await pg.evaluate(f"document.querySelectorAll('#app .tabs a, #app .seg button')[{i}].click()")
            await pg.wait_for_timeout(200)
        await pg.evaluate("go('mesa')")
        await pg.click('#nav a[data-v=tabuleiro]');await pg.wait_for_timeout(300)
        print('state ok',await pg.evaluate("VTT.state.ok"))
        print('ERRS',errs)
        await b.close()
asyncio.run(main())
