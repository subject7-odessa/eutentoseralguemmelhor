import os,sys
HERE=os.path.dirname(os.path.abspath(__file__))
INDEX=os.path.abspath(os.path.join(HERE,'..','site','index.html'))
MESTRE=os.path.abspath(os.path.join(HERE,'..','privado','mestre.json'))
MAPA=os.path.join(HERE,'mapa.png')
import asyncio
from playwright.async_api import async_playwright
async def make(pg,role,name):
    await pg.evaluate("go('agentes')")
    await pg.wait_for_selector('[data-a=novo]');await pg.click('[data-a=novo]')
    await pg.fill('#wn',name);await pg.click(f'[data-r={role}]');await pg.click('[data-a=next]')
    await pg.click('[data-a=roll1]');await pg.click('[data-a=next]')
    # esconder pontos de especializacao
    for sel in await pg.query_selector_all('[data-sp]'):
        await sel.fill('X')
    await pg.click('[data-a=next]');await pg.click('[data-a=finish]')
    await pg.wait_for_selector('[data-a=hit]')
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--no-sandbox'])
        pg=await b.new_page(viewport={'width':1280,'height':900})
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
        await pg.wait_for_selector('[data-a=novo]')
        # Medtech
        await make(pg,'Medtech','Doc')
        for sel,v in (('md:surg','2'),('md:pharm','1')):
            await pg.fill(f'[data-f="{sel}"]',v);await pg.keyboard.press('Tab');await pg.wait_for_timeout(150)
        await pg.click('[data-f="ph:Speedheal"]');await pg.wait_for_timeout(150)
        await pg.click('[data-a=surg][data-n=Clinic]');await pg.wait_for_timeout(200)
        await pg.click('[data-a=medtech]');await pg.wait_for_timeout(200)
        print('med',await pg.evaluate("JSON.stringify(chars[0].med)"))
        # drogas
        await pg.click('[data-a=drug][data-n=Boost]');await pg.wait_for_timeout(200)
        print('INT eff',await pg.evaluate("RED&&document.querySelector('.rd-sc b').textContent"),await pg.evaluate("JSON.stringify(chars[0].drogas)"))
        await pg.click('[data-a=drugend][data-n=Boost]');await pg.wait_for_timeout(300)
        print('vicios',await pg.evaluate("JSON.stringify(chars[0].vicios)"))
        await pg.click('[data-a=drug][data-n="Black Lace"]');await pg.wait_for_timeout(200)
        print('hum',await pg.evaluate("chars[0].humAtual+'/'+chars[0].blHL"))
        # trauma e terapia
        await pg.click('[data-a=trauma]');await pg.click('.modal .tile[data-i="2"]');await pg.wait_for_timeout(200)
        print('hum apos trauma',await pg.evaluate("chars[0].humAtual"))
        await pg.click('[data-a=therapy]');await pg.click('.modal .tile[data-i="1"]');await pg.wait_for_timeout(200)
        print('hum apos terapia',await pg.evaluate("chars[0].humAtual"))
        # death save mata
        await pg.evaluate("chars[0].stats.BODY=1;chars[0].vidaAtual=0");await pg.click('[data-a=death]');await pg.wait_for_timeout(300)
        print('morto',await pg.evaluate("chars[0].morto"))
        await pg.screenshot(path=os.path.join(__import__('tempfile').gettempdir(),'m1.png'),full_page=True)
        # Tech
        await make(pg,'Tech','Gizmo')
        for sel,v in (('mk:field','2'),('mk:upg','1')):
            await pg.fill(f'[data-f="{sel}"]',v);await pg.keyboard.press('Tab');await pg.wait_for_timeout(150)
        await pg.click('[data-a=maker]');await pg.click('.modal [data-x=ok]');await pg.wait_for_timeout(300)
        print('maker toast',(await pg.inner_text('#toasts')).replace('\n',' | ')[-140:])
        # Exec
        await make(pg,'Exec','Boss')
        await pg.evaluate("chars[chars.length-1].rank=5;sheet&&0")
        await pg.evaluate("go('agentes',chars[chars.length-1].id)")
        await pg.click('[data-a=tadd]');await pg.click('.modal .tile[data-i="0"]');await pg.wait_for_timeout(300)
        await pg.click('[data-a=tsave][data-i="0"]');await pg.wait_for_timeout(200)
        print('team',await pg.evaluate("JSON.stringify(chars[chars.length-1].team).slice(0,260)"))
        # Media
        await make(pg,'Media','Reporter')
        await pg.click('[data-a=rumor]');await pg.click('[data-a=publish]');await pg.wait_for_timeout(300)
        print('media',(await pg.inner_text('#toasts')).replace('\n',' | ')[-200:])
        await pg.click('#nav a[data-v=biblioteca]')
        for t in ['Habilidades','Medicina']: await pg.click(f'a[data-t="{t}"]')
        print('ERRS',errs)
        await b.close()
asyncio.run(main())
