from playwright.sync_api import sync_playwright
import os,tempfile
HERE=os.path.dirname(os.path.abspath(__file__))
INDEX=os.environ.get('ARQUIVO_INDEX','file://'+os.path.abspath(os.path.join(HERE,'..','site','index.html')))
OUTD=os.environ.get('ARQUIVO_TEST_OUT',tempfile.gettempdir())
MOCK=open(os.path.join(HERE,'mock_supabase.js'),encoding='utf8').read()
res=[]
def ok(c,m): res.append(bool(c));print(('PASS ' if c else 'FAIL ')+m)
with sync_playwright() as p:
    b=p.chromium.launch();pg=b.new_page(viewport={'width':1280,'height':900})
    errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.route('**/@supabase/supabase-js@2',lambda r:r.fulfill(body=MOCK,content_type='application/javascript'))
    pg.route('**/fonts.googleapis.com/**',lambda r:r.fulfill(body='',content_type='text/css'))
    pg.goto(INDEX);pg.wait_for_timeout(400);pg.click('[data-e="c1"]');pg.wait_for_timeout(300)
    ok(pg.locator('button[data-h]').count()==2,'mestre vê botão Ocultar em cada ficha')
    pg.locator('.card.ag:has-text("Denis Legado") button[data-h]').click();pg.wait_for_timeout(600)
    ok(pg.locator('.card.ag.hid').count()==1 and pg.locator('.hidt').count()==1,'mestre: ficha oculta continua visível, marcada como oculta')
    ok(pg.evaluate("window.__db.characters.find(c=>c.name==='Denis Legado').data.oculto")==True,'ocultar foi salvo no banco')
    ok('oculto' in pg.inner_text('.hidt').lower(),'rótulo do mestre')
    pg.evaluate("(()=>{const s=document.querySelector('#fo');s.value='h';s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}))})()");ok(pg.locator('.card.ag').count()==1,'filtro "Só ocultos"')
    pg.evaluate("(()=>{const s=document.querySelector('#fo');s.value='';s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}))})()");
    # entra na ficha oculta pelo mestre e usa o botão da ficha
    pg.locator('.card.ag.hid [data-o]').click();pg.wait_for_timeout(300)
    ok(pg.locator('#hid.on').count()==1,'ficha: botão marcado como oculto')
    pg.click('#hid');pg.wait_for_timeout(600)
    ok(pg.evaluate("window.__db.characters.find(c=>c.name==='Denis Legado').data.oculto")==False,'reexibir pela ficha salva no banco')
    pg.click('#hid');pg.wait_for_timeout(600);hid_id=pg.evaluate("open")
    # jogador comum
    pg.evaluate("""()=>{chars.push({id:'x9',owner:'u2',name:'Do Jogador',player:'J2',esp:'Médico',oculto:true,skills:[],attrs:{FOR:1,COO:1,RES:1,RAC:1,PER:1,CON:1},extra:{},weapons:[],vidaAtual:12,pressao:0,defPts:0,fv:2});
      chars.push({id:'x8',owner:'u1',name:'Visivel Mestre',player:'M',esp:'Policial',skills:[],attrs:{FOR:1,COO:1,RES:1,RAC:1,PER:1,CON:1},extra:{},weapons:[],vidaAtual:12,pressao:0,defPts:0,fv:2});
      user={id:'u3'};go('agentes')}""");pg.wait_for_timeout(300)
    names=pg.evaluate("[...document.querySelectorAll('.card.ag h2')].map(h=>h.textContent)")
    ok('Denis Legado' not in names and 'Do Jogador' not in names and 'Visivel Mestre' in names,f'jogador comum não vê ocultos: {names}')
    ok(pg.evaluate("document.querySelector('h2.sp').textContent")=='Agentes: 2','contagem do jogador só conta visíveis')
    ok(pg.locator('button[data-h]').count()==0 and pg.locator('#fo option[value="h"]').count()==0,'jogador não tem botões de ocultar')
    pg.evaluate("open='%s';render()"%hid_id);pg.wait_for_timeout(200)
    ok(pg.evaluate("open")==None and pg.locator('#hid').count()==0,'jogador não abre ficha oculta de outro (volta à lista)')
    # dono do personagem oculto
    pg.evaluate("user={id:'u2'};go('agentes')");pg.wait_for_timeout(300)
    names=pg.evaluate("[...document.querySelectorAll('.card.ag h2')].map(h=>h.textContent)")
    ok('Do Jogador' in names and 'Denis Legado' not in names,f'dono vê o próprio oculto, não vê o dos outros: {names}')
    ok('oculto dos outros' in pg.inner_text('.card.ag.hid .hidt').lower(),'dono vê aviso "oculto dos outros jogadores"')
    pg.evaluate("go('agentes','x9')");pg.wait_for_timeout(300)
    ok(pg.locator('.dossier').count()==1 and pg.locator('#hid').count()==0,'dono abre a própria ficha oculta, sem poder reexibir')
    # realtime: mestre oculta enquanto jogador olha
    pg.evaluate("user={id:'u3'};go('agentes')");pg.wait_for_timeout(200)
    pg.evaluate("(()=>{const c=chars.find(x=>x.id==='x8');c.oculto=true;render()})()")
    ok('Visivel Mestre' not in pg.evaluate("[...document.querySelectorAll('.card.ag h2')].map(h=>h.textContent)"),'ao ocultar em tempo real, some da lista do jogador')
    b.close()
print('ERROS JS:',errs,'RESUMO',sum(res),'/',len(res))
