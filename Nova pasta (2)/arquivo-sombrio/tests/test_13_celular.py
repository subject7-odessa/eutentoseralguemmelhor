import os,sys
HERE=os.path.dirname(os.path.abspath(__file__))
INDEX=os.path.abspath(os.path.join(HERE,'..','site','index.html'))
MAPA=os.path.join(HERE,'mapa.png')
import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
        pg=await ctx.new_page()
        errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.on('dialog',lambda d:asyncio.ensure_future(d.accept('x')))
        mock=open(os.path.join(HERE,'mock_supabase.js'),encoding='utf8').read()
        await pg.route('**/@supabase/supabase-js@2',lambda r:r.fulfill(body=mock,content_type='application/javascript'))
        await pg.route('**/fonts.googleapis.com/**',lambda r:r.abort())
        await pg.goto('file://'+INDEX)
        await pg.wait_for_selector('[data-e]')
        W=lambda: pg.evaluate("document.documentElement.scrollWidth-innerWidth")
        bad=[]
        # --- Supernatural
        await pg.tap('[data-e]');await pg.wait_for_selector('#nav')
        for v in ['agentes','ameacas','biblioteca','livro','mesa']:
            await pg.evaluate(f"go('{v}')");await pg.wait_for_timeout(500)
            d=await W()
            if d>0:bad.append(('S',v,d))
        await pg.evaluate("go('agentes',chars[0].id)");await pg.wait_for_timeout(400)
        tabs=await pg.eval_on_selector_all('.tabs a, .tabs button','e=>e.map(x=>x.textContent.trim())')
        for i in range(len(tabs)):
            await pg.evaluate(f"document.querySelectorAll('.tabs a, .tabs button')[{i}].click()");await pg.wait_for_timeout(250)
            d=await W()
            if d>0:bad.append(('S ficha aba',tabs[i],d))
        await pg.evaluate("go('livro')");await pg.wait_for_selector('#lvc',state='attached')
        for t in ['tab','nom','bld','cap']:
            await pg.evaluate(f"lvTab='{t}';render()");await pg.wait_for_timeout(300)
            d=await W()
            if d>0:bad.append(('Livro',t,d))
        # --- RED
        await pg.evaluate("camp=null;render()")
        await pg.tap('#csys [data-sy=red]');await pg.fill('#cn','NC');await pg.tap('#cc')
        await pg.wait_for_selector('[data-a=novo]')
        await pg.tap('[data-a=novo]');await pg.fill('#wn','V');await pg.tap('[data-r=Netrunner]');await pg.tap('[data-a=next]');await pg.tap('[data-a=roll1]');await pg.tap('[data-a=next]')
        for sel in await pg.query_selector_all('[data-sp]'): await sel.fill('X')
        await pg.tap('[data-a=next]');await pg.tap('[data-a=finish]');await pg.wait_for_selector('[data-a=hit]');await pg.wait_for_timeout(400)
        d=await W()
        if d>0:bad.append(('RED ficha','',d))
        for v in ['agentes','ameacas','biblioteca','mesa']:
            await pg.evaluate(f"go('{v}')");await pg.wait_for_timeout(400)
            d=await W()
            if d>0:bad.append(('RED',v,d))
        await pg.evaluate("go('biblioteca')")
        tabs=await pg.eval_on_selector_all('a[data-t]','e=>e.map(x=>x.dataset.t)')
        for t in tabs:
            await pg.evaluate(f"libTab='{t}';go('biblioteca');"); await pg.wait_for_timeout(250)
            await pg.evaluate("document.querySelector('a[data-t]')&&0")
            d=await W()
            if d>0:bad.append(('RED lib',t,d))
        print('tabs RED lib:',len(tabs))
        print('PROBLEMAS de rolagem lateral:',bad)
        print('ERRS',errs)
        assert not bad,'Rolagem lateral no celular: %s'%bad
        await b.close()
asyncio.run(main())
