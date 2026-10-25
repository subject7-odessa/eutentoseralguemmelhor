import os,sys,tempfile
HERE=os.path.dirname(os.path.abspath(__file__))
INDEX=os.path.abspath(os.path.join(HERE,'..','site','index.html'))
MAPA=os.path.join(HERE,'mapa.png')
A=lambda n:os.path.join(HERE,'assets',n)
TMP=tempfile.gettempdir()
import asyncio
from playwright.async_api import async_playwright
CHK="""async(src)=>{const im=new Image();im.src=src;await im.decode();const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;const x=c.getContext('2d');x.drawImage(im,0,0);const a=x.getImageData(0,0,1,1).data,m=x.getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;return {mime:src.slice(5,src.indexOf(';')),w:c.width,h:c.height,alphaCanto:a[3],alphaMeio:m[3],kb:Math.round(src.length/1024)}}"""
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
        await pg.click('[data-a=addtok]');await pg.click('#vta a[data-t=gen]');await pg.fill('#vgn','Monstro');await pg.click('.modal [data-k="1"]');await pg.wait_for_timeout(400)
        async def pick():
            t=await pg.evaluate("VTT.state.tokens[0]");cam=await pg.evaluate("VTT.state.cam")
            box=await pg.evaluate("(()=>{const r=document.getElementById('vc').getBoundingClientRect();return [r.left,r.top]})()")
            await pg.mouse.click(box[0]+(t['x']-cam['x'])*cam['z'],box[1]+(t['y']-cam['y'])*cam['z']);await pg.wait_for_timeout(300)
        await pick()
        await pg.click('[data-a=tshape][data-v=image]')
        # 1) PNG transparente
        await pg.set_input_files('#vtimg',A('t_transparente.png'));await pg.wait_for_timeout(600)
        print('PNG transparente:',await pg.evaluate(CHK,await pg.evaluate("VTT.state.tokens[0].image")))
        # 2) fundo preto -> pergunta e remove
        await pg.set_input_files('#vtimg',A('t_fundo_preto.png'));await pg.wait_for_selector('.modal button.pr',timeout=5000)
        await pg.click('.modal button.pr');await pg.wait_for_timeout(700)
        print('fundo preto (aceitou):',await pg.evaluate(CHK,await pg.evaluate("VTT.state.tokens[0].image")))
        # 3) fundo preto, recusando: mantém como está (JPEG, proporção)
        await pg.set_input_files('#vtimg',A('t_fundo_preto.png'));await pg.wait_for_selector('.modal button',timeout=5000)
        await pg.evaluate("[...document.querySelectorAll('.modal button')].find(b=>!b.classList.contains('pr')).click()");await pg.wait_for_timeout(700)
        print('fundo preto (recusou):',await pg.evaluate(CHK,await pg.evaluate("VTT.state.tokens[0].image")))
        # 4) GIF
        await pg.set_input_files('#vtimg',A('t_anim.gif'));await pg.wait_for_timeout(800)
        im=await pg.evaluate("VTT.state.tokens[0].image");print('GIF salvo:',im[:22],len(im)//1024,'KB')
        await pg.wait_for_timeout(300)
        print('overlay GIF:',await pg.evaluate("(()=>{const e=document.querySelector('#vgif img');return e?[e.src.slice(0,22),Math.round(e.getBoundingClientRect().width),getComputedStyle(e).display]:null})()"))
        await pg.screenshot(path=os.path.join(TMP,'gif1.png'))
        # circulo com gif
        await pg.click('[data-a=tshape][data-v=circle]');await pg.wait_for_timeout(300)
        print('GIF em círculo:',await pg.evaluate("(()=>{const e=document.querySelector('#vgif img');return [getComputedStyle(e).borderRadius,getComputedStyle(e).borderTopStyle]})()"))
        # GIF grande é recusado
        open(os.path.join(TMP,'grande.gif'),'wb').write(open(A('t_anim.gif'),'rb').read()+b'\0'*(600*1024))
        pg.once('dialog',lambda d:print('aviso GIF grande:',d.message[:70]))
        await pg.set_input_files('#vtimg',os.path.join(TMP,'grande.gif'));await pg.wait_for_timeout(500)
        print('ERRS',errs)
        imgok=await pg.evaluate("VTT.state.tokens[0].image.startsWith('data:image/gif')");assert imgok,'o GIF deveria ter ficado salvo no token'
        await b.close()
asyncio.run(main())
