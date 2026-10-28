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
        pg.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
        mock=open(os.path.join(HERE,'mock_supabase.js'),encoding='utf8').read()
        await pg.route('**/@supabase/supabase-js@2',lambda r:r.fulfill(body=mock,content_type='application/javascript'))
        await pg.route('**/fonts.googleapis.com/**',lambda r:r.abort())
        await pg.goto('file://'+INDEX)
        await pg.wait_for_selector('[data-e]')
        await pg.evaluate("camp=null;render()")
        await pg.click('#csys [data-sy=red]');await pg.fill('#cn','NC');await pg.click('#cc')
        await pg.wait_for_selector('[data-a=novo]');await pg.click('[data-a=novo]')
        await pg.fill('#wn','Rex');await pg.click('[data-a=next]')   # Solo, streetrat
        await pg.click('[data-a=roll1]');await pg.click('[data-a=next]');await pg.click('[data-a=next]');await pg.click('[data-a=finish]')
        await pg.wait_for_selector('[data-a=hit]')
        # Combat Awareness
        await pg.fill('[data-f="ca:ir"]','2');await pg.fill('[data-f="ca:pa"]','3')
        await pg.fill('[data-f=ip]','500')
        print('ca',await pg.evaluate('JSON.stringify(chars[0].ca)+chars[0].role'))
        await pg.click('[data-a=ini]');await pg.wait_for_timeout(300)
        print('ini:',await pg.evaluate("rolls.length?JSON.stringify(rolls[rolls.length-1].data):'none'"))
        await pg.click('[data-a=atk][data-i="0"]');await pg.wait_for_timeout(300)
        print('atk:',(await pg.inner_text('#toasts')).replace('\n',' | ')[-150:])
        # dano
        hp0=await pg.evaluate("chars[0].vidaAtual")
        await pg.click('[data-a=hit]');await pg.fill('#hd','14');await pg.check('#hc');await pg.click('.modal [data-x=ok]');await pg.wait_for_timeout(300)
        print('hp',hp0,'->',await pg.evaluate("chars[0].vidaAtual"),'sp body',await pg.evaluate("chars[0].armor.body.cur"))
        print('hit toast:',(await pg.inner_text('#toasts')).replace('\n',' | ')[-220:])
        # IP
        l0=await pg.evaluate("(chars[0].skills.find(s=>s.n==='Handgun')||{}).l")
        await pg.click('[data-a=ipup][data-n=Handgun]');await pg.wait_for_timeout(200)
        print('handgun',l0,'->',await pg.evaluate("chars[0].skills.find(s=>s.n==='Handgun').l"),'ip',await pg.evaluate("chars[0].ip"))
        await pg.click('[data-a=rankup]');print('rank',await pg.evaluate("chars[0].rank"),'ip',await pg.evaluate("chars[0].ip"))
        await pg.click('#nav a[data-v=biblioteca]')
        for t in ['Veículos','Evolução','Regras']:
            await pg.click(f'a[data-t="{t}"]')
        await pg.click('a[data-t="Veículos"]');await pg.screenshot(path=os.path.join(__import__('tempfile').gettempdir(),'v1.png'))
        print('ERRS',errs)
        await b.close()
asyncio.run(main())
