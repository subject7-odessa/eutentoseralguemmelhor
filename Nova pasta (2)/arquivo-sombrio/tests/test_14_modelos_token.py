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
        pg.on('dialog',lambda d:asyncio.ensure_future(d.accept('Zumbi')))
        mock=open(os.path.join(HERE,'mock_supabase.js'),encoding='utf8').read()
        await pg.route('**/@supabase/supabase-js@2',lambda r:r.fulfill(body=mock,content_type='application/javascript'))
        await pg.route('**/fonts.googleapis.com/**',lambda r:r.abort())
        await pg.goto('file://'+INDEX)
        await pg.wait_for_selector('[data-e]');await pg.click('[data-e]')
        await pg.click('#nav a[data-v=tabuleiro]');await pg.wait_for_selector('#vtt:not([hidden])')
        await pg.click('[data-a=scenes]');await pg.fill('#vsn','T');await pg.set_input_files('#vsfile',MAPA);await pg.click('[data-create]');await pg.wait_for_timeout(1500)
        # token genérico com imagem
        await pg.click('[data-a=addtok]');await pg.click('#vta a[data-t=gen]');await pg.fill('#vgn','Guarda')
        await pg.click('.modal [data-k="1"]');await pg.wait_for_timeout(400)
        await pg.evaluate("VTT.state.sel=VTT.state.tokens[0].id");await pg.evaluate("document.dispatchEvent(new Event('x'))")
        # seleciona via API de clique no token
        t=await pg.evaluate("VTT.state.tokens[0]");cam=await pg.evaluate("VTT.state.cam")
        box=await pg.evaluate("(()=>{const r=document.getElementById('vc').getBoundingClientRect();return [r.left,r.top]})()")
        await pg.mouse.click(box[0]+(t['x']-cam['x'])*cam['z'],box[1]+(t['y']-cam['y'])*cam['z']);await pg.wait_for_timeout(300)
        print('botao salvar:',await pg.locator('[data-a=tsave]').count())
        await pg.click('[data-a=tsize][data-v="2"]');await pg.wait_for_timeout(200)
        await pg.click('[data-a=tsave]');await pg.wait_for_timeout(400)
        print('modelos no banco:',await pg.evaluate("window.__db.token_modelos.map(m=>m.name+':'+m.kind+':'+m.size)"))
        # personagem: adiciona token e salva 2 versões
        await pg.click('[data-a=addtok]');await pg.click('.modal [data-pc]');await pg.click('.modal [data-k="1"]');await pg.wait_for_timeout(400)
        toks=await pg.evaluate("VTT.state.tokens.map(t=>[t.id,t.kind,t.name])");print('tokens:',toks)
        ct=await pg.evaluate("VTT.state.tokens.find(t=>t.kind==='char')");
        await pg.mouse.click(box[0]+(ct['x']-cam['x'])*cam['z'],box[1]+(ct['y']-cam['y'])*cam['z']);await pg.wait_for_timeout(300)
        await pg.click('[data-a=tshape][data-v=square]');await pg.click('[data-a=tsave]');await pg.wait_for_timeout(300)
        await pg.click('[data-a=tshape][data-v=circle]');await pg.click('[data-a=tsize][data-v="3"]');await pg.click('[data-a=tsave]');await pg.wait_for_timeout(300)
        print('versoes:',await pg.evaluate("window.__db.token_modelos.filter(m=>m.kind==='char').length"),'| botões de versão:',await pg.locator('[data-a=tvar]').count())
        await pg.click('[data-a=tvar]');await pg.wait_for_timeout(300)
        print('apos aplicar versão 1:',await pg.evaluate("JSON.stringify(VTT.state.tokens.find(t=>t.kind==='char')&&[VTT.state.tokens.find(t=>t.kind==='char').shape,VTT.state.tokens.find(t=>t.kind==='char').size])"))
        # modelos no modal: +2 do genérico
        await pg.click('[data-a=addtok]');await pg.click('#vta a[data-t=mod]');await pg.wait_for_timeout(200)
        await pg.click('[data-pmp]');await pg.click('[data-pmp]');await pg.screenshot(path='md1.png')
        await pg.click('.modal [data-k="1"]');await pg.wait_for_timeout(500)
        print('tokens finais:',await pg.evaluate("VTT.state.tokens.map(t=>t.name+':'+t.size)"))
        print('ERRS',errs)
        assert len(__import__('json').loads(__import__('json').dumps(await pg.evaluate("window.__db.token_modelos"))))==3,'esperava 3 modelos'
        await b.close()
asyncio.run(main())
