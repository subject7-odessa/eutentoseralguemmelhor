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
        await pg.wait_for_selector('[data-e]');await pg.click('[data-e]');await pg.wait_for_selector('#nav')
        await pg.keyboard.press('Control+k');await pg.fill('#pq','cobertura');await pg.wait_for_timeout(1500)
        print((await pg.inner_text('#pl'))[:260].replace('\n',' | '))
        await pg.click('[data-lv]');await pg.wait_for_selector('#lvq',state='attached')
        print('abriu livro com busca:',await pg.evaluate("document.querySelector('#lvq').value"))
        print('ERRS',errs)
        await b.close()
asyncio.run(main())
