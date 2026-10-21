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
        pg=await b.new_page(viewport={'width':1280,'height':900},accept_downloads=True)
        errs=[]
        pg.on('pageerror',lambda e:errs.append('PE:'+str(e)))
        pg.on('dialog',lambda d:asyncio.ensure_future(d.accept('Fulano')))
        mock=open(os.path.join(HERE,'mock_supabase.js'),encoding='utf8').read()
        await pg.route('**/@supabase/supabase-js@2',lambda r:r.fulfill(body=mock,content_type='application/javascript'))
        await pg.route('**/fonts.googleapis.com/**',lambda r:r.abort())
        await pg.goto('file://'+INDEX)
        await pg.wait_for_selector('[data-e]')
        await pg.evaluate("camp=null;render()")
        await pg.click('#csys [data-sy=red]');await pg.fill('#cn','NC');await pg.click('#cc')
        await pg.wait_for_selector('[data-a=novo]');await pg.click('[data-a=novo]')
        await pg.fill('#wn','Doc');await pg.click('[data-r=Medtech]');await pg.click('[data-a=next]');await pg.click('[data-a=roll1]');await pg.click('[data-a=next]')
        for sel in await pg.query_selector_all('[data-sp]'): await sel.fill('X')
        await pg.click('[data-a=next]');await pg.click('[data-a=finish]');await pg.wait_for_selector('[data-a=hit]')
        for sel,v in (('md:pharm','2'),):
            await pg.fill(f'[data-f="{sel}"]',v);await pg.keyboard.press('Tab');await pg.wait_for_timeout(200)
        await pg.click('[data-f="ph:Speedheal"]');await pg.wait_for_timeout(200)
        await pg.evaluate("chars[0].vidaAtual=5;go('agentes',chars[0].id)");await pg.wait_for_timeout(200)
        await pg.click('[data-a=pharm][data-n=Speedheal]');await pg.click('.modal .tile');await pg.wait_for_timeout(300)
        print('speedheal HP:',await pg.evaluate("chars[0].vidaAtual"))
        # backup
        await pg.click('[data-a=back]')
        async with pg.expect_download() as d: await pg.click('#bkp')
        dl=await d.value;path=await dl.path()
        import json;j=json.load(open(path));print('backup fichas:',len(j['fichas']),j['fichas'][0]['data'].get('role'))
        # importar de volta
        j['fichas'][0]['name']='Doc Copia';open('/tmp/bk2.json','w').write(json.dumps(j));await pg.set_input_files('#impf','/tmp/bk2.json');await pg.wait_for_timeout(300);await pg.click('.modal button.pr');await pg.wait_for_timeout(1200);print('db docs:',await pg.evaluate("window.__db.characters.filter(c=>c.name.startsWith('Doc')).map(c=>c.name)"))
        print('apos importar, chars:',await pg.evaluate("chars.length"))
        # print html
        html=await pg.evaluate("RED.printHTML(chars[0]).length")
        print('print html len',html)
        print('ERRS',errs)
        await b.close()
asyncio.run(main())
