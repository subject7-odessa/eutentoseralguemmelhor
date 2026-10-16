/* tabuleiro.js — Tabuleiro virtual do Arquivo Sombrio.
   Canvas 2D nativo, sem dependências. Usa as globais do index.html
   (sb, camp, user, chars, isMaster, canEdit, esc, ini, calc, save, sK, cbData, cbAbrir, imgScale, fotoResize, go, uid, notice, ask, BEST).
   Dados: tabelas scenes e scene_tokens + bucket "mapas" (supabase/tabuleiro.sql). */
const VTT=(()=>{
const TSQL=`-- Arquivo Sombrio: tabuleiro virtual (cenas, mapas e tokens)
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run. É seguro rodar mais de uma vez.
-- Requer o schema.sql já executado (usa is_member, is_master, campaigns e characters).
-- Isto também cria o armazenamento dos mapas (bucket privado "mapas"): você não precisa criar nada no painel.

-- ---------------------------------------------------------------- armazenamento dos mapas
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mapas', 'mapas', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Os arquivos ficam em "<id da campanha>/<id da cena>/arquivo". Esta função lê o id da campanha do caminho.
create or replace function public.mapas_campanha(p_path text) returns uuid
language plpgsql immutable as $$
begin
  return split_part(p_path, '/', 1)::uuid;
exception when others then
  return null;
end $$;

drop policy if exists mapas_select on storage.objects;
create policy mapas_select on storage.objects for select to authenticated
  using (bucket_id = 'mapas' and public.is_member(public.mapas_campanha(name)));

drop policy if exists mapas_insert on storage.objects;
create policy mapas_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'mapas' and public.is_master(public.mapas_campanha(name)));

drop policy if exists mapas_update on storage.objects;
create policy mapas_update on storage.objects for update to authenticated
  using (bucket_id = 'mapas' and public.is_master(public.mapas_campanha(name)))
  with check (bucket_id = 'mapas' and public.is_master(public.mapas_campanha(name)));

drop policy if exists mapas_delete on storage.objects;
create policy mapas_delete on storage.objects for delete to authenticated
  using (bucket_id = 'mapas' and public.is_master(public.mapas_campanha(name)));

-- ---------------------------------------------------------------- cenas
create table if not exists public.scenes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null default 'Nova cena',
  map_path text,                                   -- caminho do arquivo no bucket "mapas"
  map_w integer not null default 3000,             -- largura do mapa em pixels
  map_h integer not null default 2000,             -- altura do mapa em pixels
  grid jsonb not null default '{"show":true,"size":70,"ox":0,"oy":0,"opacity":0.35,"color":"#ffffff","snap":true}'::jsonb,
  active boolean not null default false,           -- a cena que os jogadores veem
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scenes_campaign_idx on public.scenes (campaign_id);
create unique index if not exists scenes_one_active on public.scenes (campaign_id) where active;

-- ---------------------------------------------------------------- tokens
create table if not exists public.scene_tokens (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null default 'Token',
  kind text not null default 'generic' check (kind in ('char', 'threat', 'generic')),
  char_id uuid references public.characters(id) on delete set null,  -- ficha vinculada (personagens)
  combat_ref text,                                 -- id do item no combate (ameaças)
  image text,                                      -- imagem pequena (data URL); personagens usam a foto da ficha
  x double precision not null default 0,           -- centro do token, em pixels do mapa
  y double precision not null default 0,
  size real not null default 1 check (size > 0 and size <= 20),      -- em casas da grade
  shape text not null default 'circle' check (shape in ('circle', 'square')),
  hidden boolean not null default false,           -- oculto: nunca é enviado aos jogadores
  owner_id uuid references auth.users(id) on delete set null,        -- quem pode mover (dono da ficha)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scene_tokens_scene_idx on public.scene_tokens (scene_id);
create index if not exists scene_tokens_campaign_idx on public.scene_tokens (campaign_id);

create or replace function public.cena_ativa(p_scene uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.scenes s where s.id = p_scene and s.active)
$$;

alter table public.scenes enable row level security;
alter table public.scene_tokens enable row level security;

-- Cenas: o mestre vê todas; os jogadores só veem a cena ativa.
drop policy if exists scenes_select on public.scenes;
create policy scenes_select on public.scenes for select to authenticated
  using (public.is_master(campaign_id) or (public.is_member(campaign_id) and active));
drop policy if exists scenes_insert on public.scenes;
create policy scenes_insert on public.scenes for insert to authenticated
  with check (public.is_master(campaign_id));
drop policy if exists scenes_update on public.scenes;
create policy scenes_update on public.scenes for update to authenticated
  using (public.is_master(campaign_id)) with check (public.is_master(campaign_id));
drop policy if exists scenes_delete on public.scenes;
create policy scenes_delete on public.scenes for delete to authenticated
  using (public.is_master(campaign_id));

-- Tokens: o mestre vê todos; os jogadores só os não ocultos da cena ativa. Só o mestre grava direto.
drop policy if exists tokens_select on public.scene_tokens;
create policy tokens_select on public.scene_tokens for select to authenticated
  using (public.is_master(campaign_id)
         or (public.is_member(campaign_id) and not hidden and public.cena_ativa(scene_id)));
drop policy if exists tokens_insert on public.scene_tokens;
create policy tokens_insert on public.scene_tokens for insert to authenticated
  with check (public.is_master(campaign_id)
              and exists (select 1 from public.scenes s where s.id = scene_id and s.campaign_id = scene_tokens.campaign_id));
drop policy if exists tokens_update on public.scene_tokens;
create policy tokens_update on public.scene_tokens for update to authenticated
  using (public.is_master(campaign_id)) with check (public.is_master(campaign_id));
drop policy if exists tokens_delete on public.scene_tokens;
create policy tokens_delete on public.scene_tokens for delete to authenticated
  using (public.is_master(campaign_id));

-- ---------------------------------------------------------------- funções
-- O mestre escolhe a cena que os jogadores veem (só uma fica ativa por vez).
create or replace function public.ativar_cena(p_scene uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select campaign_id into cid from public.scenes where id = p_scene;
  if cid is null then raise exception 'Cena não encontrada'; end if;
  if not public.is_master(cid) then raise exception 'Só o mestre ativa cenas'; end if;
  update public.scenes set active = false, updated_at = now() where campaign_id = cid and active and id <> p_scene;
  update public.scenes set active = true, updated_at = now() where id = p_scene;
end $$;

-- O jogador move só o token do próprio personagem (o mestre move qualquer um).
create or replace function public.mover_token(p_token uuid, p_x double precision, p_y double precision) returns void
language plpgsql security definer set search_path = public as $$
declare t public.scene_tokens%rowtype;
begin
  if auth.uid() is null then raise exception 'Faça login para continuar'; end if;
  select * into t from public.scene_tokens where id = p_token;
  if not found then raise exception 'Token não encontrado'; end if;
  if not public.is_member(t.campaign_id) then raise exception 'Você não faz parte desta campanha'; end if;
  if not public.is_master(t.campaign_id) then
    if t.hidden then raise exception 'Token indisponível'; end if;
    if not public.cena_ativa(t.scene_id) then raise exception 'Esta cena não está ativa'; end if;
    if t.owner_id is distinct from auth.uid() then raise exception 'Este token não é seu'; end if;
  end if;
  if p_x not between -100000 and 100000 or p_y not between -100000 and 100000 then
    raise exception 'Posição inválida';
  end if;
  update public.scene_tokens set x = p_x, y = p_y, updated_at = now() where id = p_token;
end $$;

revoke all on function public.ativar_cena(uuid) from public;
grant execute on function public.ativar_cena(uuid) to authenticated;
revoke all on function public.mover_token(uuid, double precision, double precision) from public;
grant execute on function public.mover_token(uuid, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------- tempo real
do $$ begin
  alter publication supabase_realtime add table public.scenes;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.scene_tokens;
exception when duplicate_object then null;
end $$;
`;
const KEY='as-vtt-';
const S={ok:true,loaded:false,scenes:[],cur:null,tokens:[],sel:null,cam:{x:0,y:0,z:1},img:null,imgPath:'',imgErr:'',tool:'sel',gridEdit:false,drag:null,popup:'',camp:null};
const imgs=new Map(),ptrs=new Map();
let root=null,cv=null,cx=null,dpr=1,dirty=true,raf=0,uiKey='',gridTimer=0,poll=0,pinch=null,chan=null,loading=false;
const q=s=>root&&root.querySelector(s);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const css=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const errTab=e=>!!e&&(e.code==='42P01'||e.code==='PGRST205'||/scenes|scene_tokens|does not exist|schema cache/i.test(e.message||''));
const scene=()=>S.scenes.find(s=>s.id===S.cur)||null;
const GD={show:true,size:70,ox:0,oy:0,opacity:.35,color:'#ffffff',snap:true};
const grid=()=>({...GD,...(scene()?.grid||{})});
const gsz=()=>Math.max(10,grid().size);
const tokById=id=>S.tokens.find(t=>t.id===id);
const canMove=t=>!!t&&(isMaster()||(t.kind==='char'&&t.owner_id===user.id&&!t.hidden));
const need=()=>{dirty=true};
const rad=t=>t.size*gsz()/2;
const nowIso=()=>new Date().toISOString();

/* ---------------- dados ---------------- */
function reset(){clearInterval(poll);if(chan){try{sb.removeChannel(chan)}catch(e){}chan=null}S.scenes=[];S.tokens=[];S.cur=null;S.tokens=[];S.sel=null;S.img=null;S.imgPath='';S.imgErr='';S.popup='';S.drag=null;S.loaded=false;S.ok=true;S.camp=camp?camp.id:null}
async function load(){reset();const id=camp.id;
 const r=await sb.from('scenes').select('*').eq('campaign_id',id).order('created_at');
 if(!camp||camp.id!==id)return;
 if(errTab(r.error)){S.ok=false;S.loaded=true;return refresh()}
 S.scenes=r.data||[];pick();await loadTokens();await loadImg();S.loaded=true;fit();refresh();
 subscribe(id);
 clearInterval(poll);poll=setInterval(()=>{if(root&&!root.hidden&&S.ok)resync()},20000)}
function subscribe(id){if(chan){try{sb.removeChannel(chan)}catch(e){}chan=null}
 try{chan=sb.channel('vtt-'+id)
  .on('postgres_changes',{event:'*',schema:'public',table:'scenes',filter:'campaign_id=eq.'+id},onScene)
  .on('postgres_changes',{event:'*',schema:'public',table:'scene_tokens',filter:'campaign_id=eq.'+id},onToken)
  .subscribe()}catch(e){chan=null}}
function pick(){let id=null;
 if(isMaster()){try{id=localStorage.getItem(KEY+camp.id)}catch(e){}if(!S.scenes.some(s=>s.id===id))id=(S.scenes.find(s=>s.active)||S.scenes[0]||{}).id||null}
 else id=(S.scenes.find(s=>s.active)||{}).id||null;
 S.cur=id}
async function loadTokens(){S.tokens=[];S.sel=null;if(!S.cur)return;const r=await sb.from('scene_tokens').select('*').eq('scene_id',S.cur);if(!r.error)S.tokens=r.data||[]}
async function loadImg(){const sc=scene();S.img=null;S.imgErr='';S.imgPath=sc?.map_path||'';if(!S.imgPath)return;
 const key=S.imgPath,r=await sb.storage.from('mapas').createSignedUrl(key,21600);
 if(r.error||!r.data?.signedUrl){S.imgErr='Não foi possível carregar o mapa.';return}
 await new Promise(res=>{const im=new Image();im.crossOrigin='anonymous';im.onload=()=>{if(S.imgPath===key)S.img=im;res()};im.onerror=()=>{S.imgErr='Não foi possível carregar o mapa.';res()};im.src=r.data.signedUrl})}
async function switchTo(id){S.cur=id;if(isMaster()){try{localStorage.setItem(KEY+camp.id,id||'')}catch(e){}}
 await loadTokens();await loadImg();fit();refresh()}
async function resync(){if(!S.camp||!camp)return;const r=await sb.from('scenes').select('*').eq('campaign_id',camp.id).order('created_at');if(r.error)return;
 S.scenes=r.data||[];const was=S.cur,wasPath=S.imgPath;if(!isMaster()||!S.scenes.some(s=>s.id===S.cur))pick();
 if(S.cur!==was){await loadTokens();await loadImg();fit()}
 else{if(S.cur){const t=await sb.from('scene_tokens').select('*').eq('scene_id',S.cur);if(!t.error&&!S.drag)S.tokens=t.data||[]}if((scene()?.map_path||'')!==wasPath)await loadImg()}
 refresh()}
function onScene(p){if(!S.camp||!camp)return;
 if(p.eventType==='DELETE'){const id=p.old?.id;if(!S.scenes.some(s=>s.id===id))return;S.scenes=S.scenes.filter(s=>s.id!==id);if(S.cur===id){pick();loadTokens().then(loadImg).then(()=>{fit();refresh()})}else refresh();return}
 const n=p.new;if(!n||n.campaign_id!==camp.id)return;
 const i=S.scenes.findIndex(s=>s.id===n.id),old=i>=0?S.scenes[i]:null;
 if(old&&old.updated_at&&n.updated_at&&n.updated_at<old.updated_at)return; /* evento atrasado: já temos a versão mais nova */
 if(i<0)S.scenes.push(n);else Object.assign(old,n); /* atualiza no mesmo objeto, para não perder alterações em andamento */
 if(!isMaster()&&n.active&&S.cur!==n.id){switchTo(n.id);return}
 if(S.cur===n.id&&old&&(old.map_path||'')!==(n.map_path||'')){loadImg().then(()=>{need();refresh()})}
 refresh()}
function onToken(p){if(!S.camp||!camp)return;
 if(p.eventType==='DELETE'){const id=p.old?.id;if(S.tokens.some(t=>t.id===id)){S.tokens=S.tokens.filter(t=>t.id!==id);if(S.sel===id)S.sel=null;refresh()}return}
 const n=p.new;if(!n||n.scene_id!==S.cur||n.campaign_id!==camp.id)return;
 if(!isMaster()&&n.hidden){if(S.tokens.some(t=>t.id===n.id)){S.tokens=S.tokens.filter(t=>t.id!==n.id);refresh()}return}
 const i=S.tokens.findIndex(t=>t.id===n.id);
 if(i<0)S.tokens.push(n);else{const t=S.tokens[i];if(S.drag?.id===t.id||Date.now()-(t._ts||0)<700)return;Object.assign(t,n)}
 refresh()}

/* ---------------- câmera e geometria ---------------- */
const vp=()=>({w:cv.width/dpr,h:cv.height/dpr});
function fit(){const sc=scene();if(!sc||!cv||!root||root.hidden)return;const {w,h}=vp();if(!w||!h)return;
 const z=clamp(Math.min(w/sc.map_w,h/sc.map_h)*.96,.05,6);S.cam.z=z;S.cam.x=(sc.map_w-w/z)/2;S.cam.y=(sc.map_h-h/z)/2;need();uiZoom()}
function zoomAt(sx,sy,f){const c=S.cam,nz=clamp(c.z*f,.05,6),wx=c.x+sx/c.z,wy=c.y+sy/c.z;c.z=nz;c.x=wx-sx/nz;c.y=wy-sy/nz;need();uiZoom()}
const toWorld=p=>({x:S.cam.x+p.x/S.cam.z,y:S.cam.y+p.y/S.cam.z});
const evPt=e=>{const r=cv.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
function snapPos(x,y,t){const g=grid(),sc=scene();let p={x,y};
 if(g.snap){const s=Math.max(10,g.size);
  if(t.size<1)p={x:(Math.round((x-g.ox)/s-.5)+.5)*s+g.ox,y:(Math.round((y-g.oy)/s-.5)+.5)*s+g.oy};
  else{const half=Math.max(1,Math.round(t.size))*s/2;p={x:Math.round((x-half-g.ox)/s)*s+g.ox+half,y:Math.round((y-half-g.oy)/s)*s+g.oy+half}}}
 if(sc){p.x=clamp(p.x,0,sc.map_w);p.y=clamp(p.y,0,sc.map_h)}return p}
function tokenAt(w){for(let i=S.tokens.length-1;i>=0;i--){const t=S.tokens[i],r=rad(t);
  if(t.shape==='square'){if(Math.abs(w.x-t.x)<=r&&Math.abs(w.y-t.y)<=r)return t}else if(Math.hypot(w.x-t.x,w.y-t.y)<=r)return t}return null}
const tokSrc=t=>t.kind==='char'?(chars.find(c=>c.id===t.char_id)?.foto||t.image||''):(t.image||'');
function imgOf(src){if(!src)return null;let m=imgs.get(src);if(!m){m=new Image();m.onload=need;m.src=src;imgs.set(src,m)}return m.complete&&m.naturalWidth?m:null}
function hpOf(t){
 if(t.kind==='char'){const c=chars.find(x=>x.id===t.char_id);return c?{v:+c.vidaAtual||0,m:calc(c).vida,edit:canEdit(c),c}:null}
 if(t.kind==='threat'&&t.combat_ref&&isMaster()){const r=sK('combate')[0],it=r&&cbData(r).itens.find(x=>x.id===t.combat_ref);return it?{v:+it.vida||0,m:+it.max||0,edit:true,it,r}:null}
 return null}

/* ---------------- desenho ---------------- */
function size(){if(!root||!cv)return;dpr=Math.min(2,window.devicePixelRatio||1);const r=root.getBoundingClientRect();const W=Math.max(1,Math.round(r.width*dpr)),H=Math.max(1,Math.round(r.height*dpr));if(cv.width!==W)cv.width=W;if(cv.height!==H)cv.height=H;need()}
function pathTok(t,r){cx.beginPath();if(t.shape==='square'){const k=Math.min(r*.18,14);cx.roundRect?cx.roundRect(t.x-r,t.y-r,r*2,r*2,k):cx.rect(t.x-r,t.y-r,r*2,r*2)}else cx.arc(t.x,t.y,r,0,Math.PI*2)}
function draw(){dirty=false;if(!cv||!cx)return;const sc=scene(),z=S.cam.z;
 cx.setTransform(1,0,0,1,0,0);cx.fillStyle=css('--bg')||'#120f0d';cx.fillRect(0,0,cv.width,cv.height);if(!sc)return;
 cx.setTransform(dpr*z,0,0,dpr*z,-S.cam.x*z*dpr,-S.cam.y*z*dpr);
 if(S.img)cx.drawImage(S.img,0,0,sc.map_w,sc.map_h);else{cx.fillStyle='#1d1814';cx.fillRect(0,0,sc.map_w,sc.map_h)}
 cx.lineWidth=2/z;cx.strokeStyle='#00000099';cx.strokeRect(0,0,sc.map_w,sc.map_h);
 drawGrid(sc);
 const list=[...S.tokens].sort((a,b)=>(a.id===S.sel)-(b.id===S.sel)||(S.drag?.id===a.id)-(S.drag?.id===b.id));
 if(S.drag?.type==='tok'&&S.drag.ghost){const t=tokById(S.drag.id),r=rad(t);cx.save();cx.globalAlpha=.35;cx.fillStyle=css('--ye')||'#e0b84a';pathTok({...t,x:S.drag.ghost.x,y:S.drag.ghost.y},r);cx.fill();cx.restore()}
 list.forEach(drawTok)}
function drawGrid(sc){const g=grid();if(!g.show)return;const z=S.cam.z,{w,h}=vp(),s=Math.max(10,g.size);
 const x0=Math.max(0,S.cam.x),y0=Math.max(0,S.cam.y),x1=Math.min(sc.map_w,S.cam.x+w/z),y1=Math.min(sc.map_h,S.cam.y+h/z);
 if((x1-x0)/s>500||(y1-y0)/s>500)return;
 cx.save();cx.globalAlpha=clamp(g.opacity,0,1);cx.strokeStyle=g.color;cx.lineWidth=1/z;cx.beginPath();
 for(let x=Math.ceil((x0-g.ox)/s)*s+g.ox;x<=x1;x+=s){cx.moveTo(x,y0);cx.lineTo(x,y1)}
 for(let y=Math.ceil((y0-g.oy)/s)*s+g.oy;y<=y1;y+=s){cx.moveTo(x0,y);cx.lineTo(x1,y)}
 cx.stroke();cx.restore()}
function drawTok(t){const z=S.cam.z,r=rad(t),sel=t.id===S.sel,kc=t.kind==='char'?(css('--ye')||'#e0b84a'):t.kind==='threat'?(css('--rd')||'#b3261e'):'#9a9086';
 cx.save();if(t.hidden)cx.globalAlpha=.5;
 cx.save();cx.shadowColor='#000b';cx.shadowBlur=10/z;cx.shadowOffsetY=3/z;pathTok(t,r);cx.fillStyle='#17120f';cx.fill();cx.restore();
 const im=imgOf(tokSrc(t));
 cx.save();pathTok(t,r);cx.clip();
 if(im){const k=Math.max(r*2/im.naturalWidth,r*2/im.naturalHeight),w=im.naturalWidth*k,h=im.naturalHeight*k;cx.drawImage(im,t.x-w/2,t.y-h/2,w,h)}
 else{cx.fillStyle='#2a221c';cx.fillRect(t.x-r,t.y-r,r*2,r*2);cx.fillStyle='#d8cdbf';cx.font=`600 ${r*.9}px "Libre Baskerville",Georgia,serif`;cx.textAlign='center';cx.textBaseline='middle';cx.fillText(ini(t.name),t.x,t.y+r*.04)}
 cx.restore();
 pathTok(t,r);cx.lineWidth=Math.max(2.5/z,r*.06);cx.strokeStyle=kc;if(t.hidden)cx.setLineDash([r*.18,r*.12]);cx.stroke();cx.setLineDash([]);
 if(sel){pathTok(t,r+4/z);cx.lineWidth=2/z;cx.strokeStyle='#ffffffcc';cx.stroke()}
 cx.restore();
 if(z<.18)return;
 const hp=hpOf(t);let yy=t.y+r+3/z;
 if(hp&&hp.m>0){const bw=r*1.7,bh=Math.max(5/z,r*.1),p=clamp(hp.v/hp.m,0,1);cx.fillStyle='#000c';cx.fillRect(t.x-bw/2-1/z,yy-1/z,bw+2/z,bh+2/z);
  cx.fillStyle=p>.6?'#6b9a58':p>.3?'#d9a441':'#c0392b';cx.fillRect(t.x-bw/2,yy,bw*p,bh);yy+=bh+3/z}
 const fs=Math.max(11/z,r*.28);cx.font=`600 ${fs}px "Libre Baskerville",Georgia,serif`;cx.textAlign='center';cx.textBaseline='top';
 const label=(t.hidden?'👁‍🗨 ':'')+t.name,tw=cx.measureText(label).width;
 cx.fillStyle='#000a';cx.fillRect(t.x-tw/2-4/z,yy,tw+8/z,fs*1.25);cx.fillStyle='#f1e9df';cx.fillText(label,t.x,yy+fs*.1)}
function loop(){raf=requestAnimationFrame(loop);if(dirty&&root&&!root.hidden)draw()}

/* ---------------- ações ---------------- */
function sendPos(t){t._ts=Date.now();
 if(isMaster())sb.from('scene_tokens').update({x:t.x,y:t.y,updated_at:nowIso()}).eq('id',t.id).then(r=>{if(r&&r.error)notice('Não foi possível mover o token: '+r.error.message)});
 else sb.rpc('mover_token',{p_token:t.id,p_x:t.x,p_y:t.y}).then(r=>{if(r&&r.error){notice(r.error.message);resync()}})}
async function tokPatch(t,p){Object.assign(t,p);t._ts=Date.now();need();refresh();if(!isMaster())return;const r=await sb.from('scene_tokens').update({...p,updated_at:nowIso()}).eq('id',t.id);if(r.error)notice('Erro ao salvar: '+r.error.message)}
function row(t){const {id,scene_id,campaign_id,name,kind,char_id,combat_ref,image,x,y,size,shape,hidden,owner_id}=t;return {id,scene_id,campaign_id,name,kind,char_id,combat_ref,image,x,y,size,shape,hidden,owner_id}}
async function setHidden(t,h){
 if(h){const d=await sb.from('scene_tokens').delete().eq('id',t.id);if(d.error)return notice('Erro: '+d.error.message);t.hidden=true;const i=await sb.from('scene_tokens').insert(row(t));if(i.error)notice('Erro: '+i.error.message)}
 else{t.hidden=false;const r=await sb.from('scene_tokens').update({hidden:false,updated_at:nowIso()}).eq('id',t.id);if(r.error)notice('Erro: '+r.error.message)}
 t._ts=Date.now();need();refresh()}
async function delTok(t){const r=await sb.from('scene_tokens').delete().eq('id',t.id);if(r.error)return notice('Erro: '+r.error.message);S.tokens=S.tokens.filter(x=>x.id!==t.id);if(S.sel===t.id)S.sel=null;need();refresh()}
function hpAdj(t,dv){const h=hpOf(t);if(!h||!h.edit)return;
 if(h.c){h.c.vidaAtual=clamp((+h.c.vidaAtual||0)+dv,0,h.m);save(h.c)}
 else{h.it.vida=clamp((+h.it.vida||0)+dv,0,h.it.max||999);sSave(h.r);if(typeof twRender==='function')twRender()}
 need();refresh()}
function setGrid(p){const sc=scene();if(!sc||!isMaster())return;sc.grid={...grid(),...p};need();uiPop();clearTimeout(gridTimer);
 gridTimer=setTimeout(async()=>{const r=await sb.from('scenes').update({grid:sc.grid,updated_at:nowIso()}).eq('id',sc.id);if(r.error)notice('Erro ao salvar a grade: '+r.error.message)},400)}
function select(id){S.sel=id;need();refresh()}
function viewCenter(){const {w,h}=vp();return toWorld({x:w/2,y:h/2})}

/* ---------------- entrada (mouse, toque, roda) ---------------- */
function bind(){
 cv.addEventListener('contextmenu',e=>e.preventDefault());
 cv.addEventListener('wheel',e=>{e.preventDefault();const p=evPt(e);zoomAt(p.x,p.y,Math.exp(-e.deltaY*(e.ctrlKey?.01:.0015)))},{passive:false});
 cv.addEventListener('pointerdown',e=>{cv.setPointerCapture(e.pointerId);const p=evPt(e);ptrs.set(e.pointerId,p);
  if(ptrs.size===2){const [a,b]=[...ptrs.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y)||1,z:S.cam.z,mx:(a.x+b.x)/2,my:(a.y+b.y)/2};S.drag=null;return}
  const w=toWorld(p),sc=scene();if(!sc)return;
  if(S.gridEdit&&isMaster()){const g=grid();S.drag={type:'grid',sx:p.x,sy:p.y,ox:g.ox,oy:g.oy};return}
  const t=S.tool==='sel'?tokenAt(w):null;
  if(t){select(t.id);S.drag=canMove(t)?{type:'tok',id:t.id,dx:w.x-t.x,dy:w.y-t.y,moved:false,last:0}:null;if(S.drag)cv.style.cursor='grabbing'}
  else{if(S.sel)select(null);S.drag={type:'pan',sx:p.x,sy:p.y,cx:S.cam.x,cy:S.cam.y};cv.style.cursor='grabbing'}});
 cv.addEventListener('pointermove',e=>{const p=evPt(e);if(ptrs.has(e.pointerId))ptrs.set(e.pointerId,p);
  if(pinch&&ptrs.size>=2){const [a,b]=[...ptrs.values()],d=Math.hypot(a.x-b.x,a.y-b.y)||1,mx=(a.x+b.x)/2,my=(a.y+b.y)/2,nz=clamp(pinch.z*d/pinch.d,.05,6),wx=S.cam.x+pinch.mx/S.cam.z,wy=S.cam.y+pinch.my/S.cam.z;S.cam.z=nz;S.cam.x=wx-mx/nz;S.cam.y=wy-my/nz;pinch.mx=mx;pinch.my=my;need();uiZoom();return}
  const d=S.drag;if(!d){if(S.tool==='sel'&&e.pointerType==='mouse'){const t=tokenAt(toWorld(p));cv.style.cursor=t&&canMove(t)?'grab':'default'}return}
  if(d.type==='pan'){S.cam.x=d.cx-(p.x-d.sx)/S.cam.z;S.cam.y=d.cy-(p.y-d.sy)/S.cam.z;need()}
  else if(d.type==='grid'){const z=S.cam.z;setGrid({ox:Math.round(d.ox+(p.x-d.sx)/z),oy:Math.round(d.oy+(p.y-d.sy)/z)})}
  else if(d.type==='tok'){const t=tokById(d.id);if(!t)return;const w=toWorld(p),nx=w.x-d.dx,ny=w.y-d.dy;if(!d.moved&&Math.hypot(nx-t.x,ny-t.y)*S.cam.z<4)return;
   d.moved=true;t.x=nx;t.y=ny;d.ghost=snapPos(nx,ny,t);need();if(Date.now()-d.last>220&&!grid().snap){d.last=Date.now();sendPos(t)}}});
 const up=e=>{ptrs.delete(e.pointerId);if(ptrs.size<2)pinch=null;const d=S.drag;cv.style.cursor='default';if(!d||ptrs.size)return;S.drag=null;
  if(d.type==='tok'&&d.moved){const t=tokById(d.id);if(t){const s=snapPos(t.x,t.y,t);t.x=s.x;t.y=s.y;sendPos(t)}}need();refresh()};
 cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
 document.addEventListener('keydown',e=>{if(!root||root.hidden||/INPUT|TEXTAREA/.test(document.activeElement?.tagName||''))return;
  if(e.key==='Escape'){select(null);S.popup='';S.gridEdit=false;refresh()}
  else if((e.key==='Delete'||e.key==='Backspace')&&isMaster()&&S.sel){const t=tokById(S.sel);t&&ask(`Remover o token "${t.name}"?`).then(ok=>ok&&delTok(t))}
  else if(e.key==='+'||e.key==='=')zoomAt(vp().w/2,vp().h/2,1.2);else if(e.key==='-')zoomAt(vp().w/2,vp().h/2,1/1.2);else if(e.key==='0')fit()})}

/* ---------------- interface ---------------- */
const IC={sel:'<path d="M5 3l14 8-6 1.5L10 19z"/>',pan:'<path d="M8 12V5a1.5 1.5 0 013 0v5m0-6a1.5 1.5 0 013 0v6m0-4a1.5 1.5 0 013 0v7a6 6 0 01-6 6h-1a6 6 0 01-5-3l-3-5a1.5 1.5 0 012.5-1.5L8 14"/>',add:'<path d="M12 5v14M5 12h14"/>',grid:'<path d="M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>',map:'<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/>',fit:'<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'};
const svg=n=>`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${IC[n]}</svg>`;
function build(){
 root=document.createElement('div');root.id='vtt';root.hidden=true;
 root.innerHTML=`<canvas id="vc"></canvas><div class="vt-top" id="vtop"></div><div class="vt-tools" id="vtools"></div><div class="vt-zoom" id="vzoom"></div><div class="vt-pop" id="vpop" hidden></div><div class="vt-tok" id="vtok" hidden></div><div class="vt-msg" id="vmsg" hidden></div>`;
 document.body.append(root);cv=q('#vc');cx=cv.getContext('2d');bind();
 root.addEventListener('click',onUi);
 root.addEventListener('change',onUiChange);
 new ResizeObserver(()=>{size();if(!S.drag)uiZoom()}).observe(root);
 new MutationObserver(()=>{if(root&&!root.hidden)place()}).observe(document.body,{attributes:true,attributeFilter:['class']});
 addEventListener('resize',()=>{if(root&&!root.hidden)place()});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&root&&!root.hidden&&S.ok&&S.camp)resync()});
 q('#vzoom').addEventListener('pointerdown',e=>{const sl=e.target.closest('.vt-sl');if(!sl)return;const mv=ev=>{const r=sl.getBoundingClientRect(),f=clamp((ev.clientY-r.top)/r.height,0,1),nz=.05*Math.pow(6/.05,1-f),{w,h}=vp();zoomAt(w/2,h/2,nz/S.cam.z)};sl.setPointerCapture(e.pointerId);mv(e);sl.onpointermove=mv;sl.onpointerup=()=>{sl.onpointermove=null}})}
function place(){const hd=document.querySelector('header'),nv=document.getElementById('nav'),mob=matchMedia('(max-width:700px)').matches;
 const set=(k,v)=>{if(root.style[k]!==v)root.style[k]=v},tw=document.body.classList.contains('tw-on')?(mob?'48px':'58px'):'0px';
 set('top',Math.max(0,hd?hd.getBoundingClientRect().bottom:0)+'px');set('bottom',(mob&&nv&&nv.offsetHeight?nv.offsetHeight:0)+'px');set('right',tw);size()}
function view(app){app.innerHTML='';document.body.classList.add('vtt-on');if(!root)build();root.hidden=false;place();
 if(camp&&S.camp!==camp.id)reset();
 if(camp&&!S.loaded&&!loading){loading=true;load().catch(e=>{S.ok=false;S.loaded=true;notice('Erro ao carregar o tabuleiro: '+(e&&e.message||e));refresh()}).finally(()=>{loading=false})}if(!raf)raf=requestAnimationFrame(loop);
 if(S.loaded&&scene()&&S.cam.z===1&&S.cam.x===0&&S.cam.y===0)fit();need();ui()}
function leave(){if(root&&!root.hidden){root.hidden=true}document.body.classList.remove('vtt-on')}
function refresh(){if(!root||root.hidden)return;need();ui()}
function ui(){uiTop();uiTools();uiZoom();uiTok();uiPop();uiMsg()}
function uiTop(){const sc=scene(),M=isMaster(),el=q('#vtop');if(!el)return;
 el.innerHTML=sc?`<b>${esc(sc.name)}</b>${M?`<span class="tag ${sc.active?'':'hidt'}">${sc.active?'Ativa para os jogadores':'Rascunho: só você vê'}</span>${sc.active?'':'<button class="pr" data-a="activate">Ativar</button>'}`:''}`:'<b>Tabuleiro</b>';
 el.hidden=!S.ok&&!M}
function uiTools(){const M=isMaster(),el=q('#vtools');if(!el)return;const b=(a,ic,t,on)=>`<button class="vt-b${on?' on':''}" data-a="${a}" title="${t}" aria-label="${t}">${svg(ic)}</button>`;
 el.innerHTML=(scene()?b('t-sel','sel','Selecionar e mover tokens',S.tool==='sel')+b('t-pan','pan','Arrastar o mapa',S.tool==='pan'):'')+(M&&S.ok?'<span class="vt-sep"></span>'+(scene()?b('addtok','add','Adicionar token')+b('grid','grid','Grade',S.popup==='grid'):'')+b('scenes','map','Cenas e mapas'):'');
 el.hidden=!S.ok}
function uiZoom(){const el=q('#vzoom');if(!el)return;const sc=scene();el.hidden=!sc;if(!sc)return;const z=S.cam.z,f=1-Math.log(z/.05)/Math.log(6/.05);
 el.innerHTML=`<button class="vt-b" data-a="z+" title="Aproximar">${svg('add')}</button><div class="vt-sl" title="Zoom"><i style="top:${clamp(f,0,1)*100}%"></i></div><button class="vt-b" data-a="z-" title="Afastar"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12h14"/></svg></button><button class="vt-pc" data-a="z100" title="Zoom 100%">${Math.round(z*100)}%</button><button class="vt-b" data-a="fit" title="Ajustar à tela">${svg('fit')}</button>`}
function uiMsg(){const el=q('#vmsg');if(!el)return;let h='';const M=isMaster();
 if(!S.loaded)h='<p class="mu">Carregando o tabuleiro…</p>';
 else if(!S.ok)h=M?`<div class="box"><h3>Ativar o tabuleiro</h3><p>O tabuleiro precisa de tabelas novas e de um espaço para os mapas no Supabase. Rode o SQL abaixo <b>uma vez</b> no <b>SQL Editor</b> e recarregue a página. Ele também cria o armazenamento dos mapas, então não precisa criar nada no painel.</p><div class="row"><button class="pr" data-a="cpsql">Copiar SQL</button></div><pre class="sqlp">${esc(TSQL)}</pre></div>`:'<div class="box"><p class="mu">O mestre ainda não ativou o tabuleiro desta campanha.</p></div>';
 else if(!scene())h=M?'<div class="box"><h3>Nenhuma cena ainda</h3><p class="mu">Crie a primeira cena e envie a imagem do mapa.</p><button class="pr" data-a="scenes">Criar cena</button></div>':'<div class="box"><p class="mu">O mestre ainda não ativou uma cena.</p></div>';
 else if(S.imgErr)h=`<div class="box"><p>${esc(S.imgErr)}</p>${M?'<p class="mu">Confira se rodou o SQL do tabuleiro e se o arquivo do mapa existe.</p>':''}</div>`;
 el.hidden=!h;el.innerHTML=h}
function uiTok(){const el=q('#vtok');if(!el)return;const t=tokById(S.sel);
 if(!t){el.hidden=true;uiKey='';return}
 const M=isMaster(),h=hpOf(t),key=[t.id,t.name,t.size,t.shape,t.hidden,h?h.v+'/'+h.m:'',M,canMove(t)].join('|');
 if(key===uiKey&&!el.hidden)return;if(el.contains(document.activeElement)&&el.querySelector('input')===document.activeElement&&!el.hidden){return}
 uiKey=key;el.hidden=false;
 el.innerHTML=`<div class="vt-trow">${M?`<input data-tn="${t.id}" value="${esc(t.name)}" aria-label="Nome do token">`:`<b>${esc(t.name)}</b>`}<span class="tag${t.kind==='threat'?' hidt':''}">${t.kind==='char'?'Personagem':t.kind==='threat'?'Ameaça':'Token'}</span>${canMove(t)?'':'<span class="mu">só leitura</span>'}</div>
 ${h&&h.m>0?`<div class="vt-trow"><span class="mu">Vida</span>${h.edit?'<button class="vt-s" data-a="hp-5">−5</button><button class="vt-s" data-a="hp-1">−1</button>':''}<b class="vt-hp">${h.v} / ${h.m}</b>${h.edit?'<button class="vt-s" data-a="hp+1">+1</button><button class="vt-s" data-a="hp+5">+5</button>':''}</div>`:''}
 ${M?`<div class="vt-trow"><span class="mu">Tamanho</span><div class="seg">${[.5,1,2,3,4].map(n=>`<button class="sg${t.size==n?' on':''}" data-a="tsize" data-v="${n}">${n===.5?'½':n}</button>`).join('')}</div><span class="mu">Formato</span><div class="seg"><button class="sg${t.shape==='circle'?' on':''}" data-a="tshape" data-v="circle">Círculo</button><button class="sg${t.shape==='square'?' on':''}" data-a="tshape" data-v="square">Quadrado</button></div></div>`:''}
 <div class="vt-trow">${t.kind==='char'&&chars.some(c=>c.id===t.char_id&&vis(c))?'<button data-a="tficha">Abrir ficha</button>':''}${M&&t.kind==='threat'&&t.combat_ref&&hpOf(t)?'<button data-a="tbest">Abrir no bestiário</button>':''}${M?`<button data-a="timg">Imagem…</button><button class="eye${t.hidden?' on':''}" data-a="thide">${t.hidden?'Mostrar aos jogadores':'Ocultar dos jogadores'}</button><button class="x" data-a="tdel">Remover</button><input type="file" id="vtimg" accept="image/*" hidden>`:''}</div>`}
function uiPop(){const el=q('#vpop');if(!el)return;if(S.popup!=='grid'||!isMaster()||!scene()){el.hidden=true;return}
 const g=grid(),st=(k,label,steps)=>`<div class="vt-grow"><span>${label}</span><div class="seg">${steps.slice().reverse().map(d=>d<0?`<button class="sg" data-a="gs" data-k="${k}" data-d="${d}">${d}</button>`:'').join('')}<b class="sg vt-val">${k==='opacity'?Math.round(g.opacity*100)+'%':g[k]}</b>${steps.map(d=>d>0?`<button class="sg" data-a="gs" data-k="${k}" data-d="${d}">+${d}</button>`:'').join('')}</div></div>`;
 const tg=(a,label,on)=>`<button class="tile${on?' on':''}" data-a="${a}"><span>${label}</span><i class="mk"></i></button>`;
 if(el.contains(document.activeElement)&&document.activeElement.tagName==='INPUT')return;
 el.hidden=false;el.innerHTML=`<div class="row"><b class="sp">Grade</b><button class="x" data-a="grid">Fechar</button></div><div class="tiles1">${tg('gt-show','Mostrar grade',g.show)}${tg('gt-snap','Encaixar tokens nas casas',g.snap)}${tg('gt-edit','Alinhar arrastando o mapa',S.gridEdit)}</div>
 ${st('size','Tamanho da casa (px)',[-10,-1,1,10])}${st('ox','Deslocamento X',[-10,-1,1,10])}${st('oy','Deslocamento Y',[-10,-1,1,10])}${st('opacity','Opacidade',[-.05,.05])}
 <div class="vt-grow"><span>Cor</span><div class="seg">${[['#ffffff','Branca'],['#000000','Preta'],['#b3261e','Vermelha'],['#e0b84a','Âmbar']].map(([c,n])=>`<button class="sg${g.color===c?' on':''}" data-a="gc" data-v="${c}">${n}</button>`).join('')}</div></div>`}
function onUi(e){const b=e.target.closest('[data-a]');if(!b)return;const a=b.dataset.a,M=isMaster(),t=tokById(S.sel);
 if(a==='t-sel'||a==='t-pan'){S.tool=a==='t-sel'?'sel':'pan';return refresh()}
 if(a==='z+')return zoomAt(vp().w/2,vp().h/2,1.25);if(a==='z-')return zoomAt(vp().w/2,vp().h/2,.8);
 if(a==='z100')return zoomAt(vp().w/2,vp().h/2,1/S.cam.z);if(a==='fit')return fit();
 if(a==='cpsql')return navigator.clipboard.writeText(TSQL).then(()=>notice('SQL copiado.')).catch(()=>alert('Selecione o texto do SQL e copie manualmente.'));
 if(!M&&!['tficha'].includes(a)&&!a.startsWith('hp'))return;
 if(a==='scenes')return scenesModal();if(a==='addtok')return addTokModal();
 if(a==='grid'){S.popup=S.popup==='grid'?'':'grid';if(S.popup!=='grid')S.gridEdit=false;return refresh()}
 if(a==='activate'){const sc=scene();return activateScene(sc.id)}
 if(a==='gs'){const g=grid(),k=b.dataset.k,d=+b.dataset.d;let v=k==='opacity'?Math.round((g.opacity+d)*100)/100:g[k]+d;v=k==='size'?clamp(v,10,400):k==='opacity'?clamp(v,0,1):v;return setGrid({[k]:v})}
 if(a==='gt-show')return setGrid({show:!grid().show});if(a==='gt-snap')return setGrid({snap:!grid().snap});
 if(a==='gt-edit'){S.gridEdit=!S.gridEdit;return refresh()}
 if(a==='gc')return setGrid({color:b.dataset.v});
 if(!t)return;
 if(a.startsWith('hp'))return hpAdj(t,+a.slice(2));
 if(a==='tficha')return go('agentes',t.char_id);
 if(a==='tbest'){const r=sK('combate')[0];return r&&cbAbrir(cbData(r),t.combat_ref)}
 if(a==='tsize'){const n=+b.dataset.v,s=snapPos(t.x,t.y,{...t,size:n});return tokPatch(t,{size:n,x:s.x,y:s.y}).then(()=>sendPos(t))}
 if(a==='tshape')return tokPatch(t,{shape:b.dataset.v});
 if(a==='thide')return setHidden(t,!t.hidden);
 if(a==='tdel')return ask(`Remover o token "${t.name}"?`).then(ok=>ok&&delTok(t));
 if(a==='timg')return q('#vtimg').click()}
async function onUiChange(e){const t=tokById(S.sel);
 if(e.target.dataset.tn&&t&&isMaster()){const n=e.target.value.trim()||t.name;return tokPatch(t,{name:n})}
 if(e.target.id==='vtimg'&&t&&e.target.files[0]){try{const im=await fotoResize(e.target.files[0]);await tokPatch(t,{image:im})}catch(er){alert(er.message)}}}

/* ---------------- cenas e mapas (modal do mestre) ---------------- */
const dims=du=>new Promise((res,rej)=>{const im=new Image();im.onload=()=>res([im.naturalWidth,im.naturalHeight]);im.onerror=()=>rej(new Error('Imagem inválida.'));im.src=du});
async function uploadMap(sc,file,say){say('Preparando a imagem…');const du=await imgScale(file,4096,.85),[w,h]=await dims(du),blob=await (await fetch(du)).blob();
 const path=`${camp.id}/${sc.id}/mapa-${Date.now()}.jpg`;say('Enviando o mapa…');
 const up=await sb.storage.from('mapas').upload(path,blob,{contentType:'image/jpeg',upsert:false});
 if(up.error)throw new Error(/bucket|not found/i.test(up.error.message||'')?'O armazenamento dos mapas não existe. Rode o SQL do tabuleiro (supabase/tabuleiro.sql).':up.error.message);
 const old=sc.map_path,u=await sb.from('scenes').update({map_path:path,map_w:w,map_h:h,updated_at:nowIso()}).eq('id',sc.id);
 if(u.error)throw new Error(u.error.message);
 Object.assign(sc,{map_path:path,map_w:w,map_h:h,updated_at:nowIso()});if(old)sb.storage.from('mapas').remove([old]);return sc}
async function activateScene(id){const r=await sb.rpc('ativar_cena',{p_scene:id});if(r.error)return notice('Erro: '+r.error.message);S.scenes.forEach(s=>s.active=s.id===id);if(S.cur!==id)await switchTo(id);refresh();notice('Cena ativada para os jogadores.')}
function scenesModal(){const o=document.createElement('div');o.className='modal';let newName='',newFile=null,repId=null;
 const draw=()=>{o.innerHTML=`<div class="mbox card"><h3>Cenas</h3><p class="mu">Os jogadores só veem a cena ativa. As outras ficam como rascunho, só para você.</p>
  <div class="vt-list">${S.scenes.map(s=>`<div class="vt-sc${s.id===S.cur?' on':''}"><div class="sp"><input data-sn="${s.id}" value="${esc(s.name)}" aria-label="Nome da cena"><span class="mu">${s.active?'Ativa para os jogadores':'Rascunho'} · ${s.map_w}×${s.map_h}${s.map_path?'':' · sem mapa'}</span></div><div class="vt-sa"><button data-so="${s.id}">Abrir</button>${s.active?'':`<button class="pr" data-sa="${s.id}">Ativar</button>`}<button data-sm="${s.id}">${s.map_path?'Trocar mapa':'Enviar mapa'}</button><button class="x" data-sd="${s.id}">Excluir</button></div></div>`).join('')||'<p class="mu">Nenhuma cena ainda.</p>'}</div>
  <h3 style="margin-top:14px">Nova cena</h3><div class="row"><input id="vsn" class="sp" placeholder="Nome da cena" value="${esc(newName)}"><button data-pickmap="1">${newFile?'Mapa escolhido ✓':'Escolher mapa…'}</button></div>
  <input type="file" id="vsfile" accept="image/*" hidden><input type="file" id="vsrep" accept="image/*" hidden>
  <div class="row" style="margin-top:12px"><span class="mu sp" id="vsmsg"></span><button data-k="0">Fechar</button><button class="pr" data-create="1">Criar cena</button></div></div>`};
 const say=m=>{const el=o.querySelector('#vsmsg');if(el)el.textContent=m};
 o.addEventListener('input',e=>{if(e.target.id==='vsn')newName=e.target.value});
 o.addEventListener('change',async e=>{const t=e.target;
  if(t.id==='vsfile'){newFile=t.files[0]||null;return draw()}
  if(t.id==='vsrep'&&t.files[0]&&repId){const sc=S.scenes.find(s=>s.id===repId);try{await uploadMap(sc,t.files[0],say);if(S.cur===sc.id){await loadImg();fit()}draw();refresh()}catch(er){say(er.message)}return}
  if(t.dataset.sn){const sc=S.scenes.find(s=>s.id===t.dataset.sn),n=t.value.trim()||sc.name;sc.name=n;await sb.from('scenes').update({name:n,updated_at:nowIso()}).eq('id',sc.id);refresh()}});
 o.onclick=async e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;
  if(d.k==='0'){o.remove();return}
  if(d.pickmap)return o.querySelector('#vsfile').click();
  if(d.so){await switchTo(d.so);o.remove();return}
  if(d.sa){await activateScene(d.sa);return draw()}
  if(d.sm){repId=d.sm;return o.querySelector('#vsrep').click()}
  if(d.sd){const sc=S.scenes.find(s=>s.id===d.sd);if(!await ask(`Excluir a cena "${sc.name}" e todos os tokens dela?`))return;
   const r=await sb.from('scenes').delete().eq('id',sc.id);if(r.error)return say(r.error.message);if(sc.map_path)sb.storage.from('mapas').remove([sc.map_path]);
   S.scenes=S.scenes.filter(s=>s.id!==sc.id);if(S.cur===sc.id){pick();await loadTokens();await loadImg();fit()}draw();refresh();return}
  if(d.create){const name=(newName||'').trim()||'Cena '+(S.scenes.length+1);say('Criando…');
   const r=await sb.from('scenes').insert({campaign_id:camp.id,name}).select().single();if(r.error)return say(r.error.message);
   const sc=r.data;S.scenes.push(sc);
   try{if(newFile)await uploadMap(sc,newFile,say)}catch(er){say('Cena criada, mas o mapa não foi enviado: '+er.message);await switchTo(sc.id);newName='';newFile=null;draw();say('Cena criada, mas o mapa não foi enviado.');return}
   if(!S.scenes.some(s=>s.active)){await sb.rpc('ativar_cena',{p_scene:sc.id});S.scenes.forEach(s=>s.active=s.id===sc.id)}
   await switchTo(sc.id);o.remove()}};
 document.body.append(o);draw()}

/* ---------------- adicionar tokens (modal do mestre) ---------------- */
function addTokModal(){const sc=scene();if(!sc)return;const o=document.createElement('div');o.className='modal';
 let tab='char',pc=new Set(),pt=[],qs='',hid=false,gimg='';
 const onMap=id=>S.tokens.some(t=>t.char_id===id);
 const cbItems=()=>{const r=sK('combate')[0];return r?cbData(r).itens.filter(i=>i.tipo==='ameaca'):[]};
 const draw=()=>{const body=tab==='char'?`<p class="mu">Usa a foto da ficha. O dono do personagem poderá mover o token.</p><div class="tiles">${chars.map(c=>`<button class="tile${pc.has(c.id)?' on':''}" data-pc="${c.id}" ${onMap(c.id)?'disabled':''}><span>${esc(c.name)}${onMap(c.id)?' <small class="mu">já no mapa</small>':''}</span><i class="mk"></i></button>`).join('')||'<p class="mu">Nenhum personagem na campanha.</p>'}</div>`
  :tab==='threat'?`${cbItems().length?`<label>No combate agora</label><div class="tiles">${cbItems().map(i=>`<button class="tile${pt.some(x=>x.ref===i.id)?' on':''}" data-pci="${i.id}"><span>${esc(i.n)}</span><i class="mk"></i></button>`).join('')}</div>`:''}
   <label>Do bestiário</label><input id="vtq" placeholder="Buscar pelo nome…" value="${esc(qs)}"><div class="tiles pick">${(typeof BEST!=='undefined'?BEST:[]).filter(x=>(x.n+' '+x.fam).toLowerCase().includes(qs.toLowerCase())).slice(0,40).map(x=>`<button class="tile${pt.some(p=>!p.ref&&p.n===x.n)?' on':''}" data-pb="${esc(x.n)}"><span>${esc(x.n)}<br><small class="mu">${esc(x.fam||'')}</small></span><i class="mk"></i></button>`).join('')}</div>
   <label>Ou digite um nome</label><div class="row"><input id="vtn" class="sp" placeholder="Nome do token"><button data-pn="1">Adicionar à lista</button></div>${pt.length?`<p class="mu">Na lista: ${pt.map(x=>esc(x.n)).join(', ')}</p>`:''}`
  :`<label>Nome</label><input id="vgn" placeholder="Ex.: Cultista, Carro, Porta"><div class="row" style="margin-top:8px"><button data-gimg="1">${gimg?'Imagem escolhida ✓':'Escolher imagem (opcional)…'}</button></div><input type="file" id="vgf" accept="image/*" hidden>`;
  o.innerHTML=`<div class="mbox card"><h3>Adicionar token</h3><div class="tabs" id="vta">${[['char','Personagens'],['threat','Ameaças'],['gen','Genérico']].map(([k,t])=>`<a data-t="${k}" class="${tab===k?'on':''}">${t}</a>`).join('')}</div><div style="margin-top:10px">${body}</div>
  <div class="tiles1" style="margin-top:10px"><button class="tile${hid?' on':''}" data-hid="1"><span>Criar oculto aos jogadores</span><i class="mk"></i></button></div>
  <div class="row" style="margin-top:12px"><span class="sp"></span><button data-k="0">Cancelar</button><button class="pr" data-k="1">Adicionar</button></div></div>`};
 o.addEventListener('input',e=>{if(e.target.id==='vtq'){qs=e.target.value;const pos=e.target.selectionStart;draw();const n=o.querySelector('#vtq');n.focus();n.setSelectionRange(pos,pos)}});
 o.addEventListener('change',async e=>{if(e.target.id==='vgf'&&e.target.files[0]){try{gimg=await fotoResize(e.target.files[0]);draw()}catch(er){alert(er.message)}}});
 o.onclick=async e=>{const a=e.target.closest('a[data-t]');if(a){tab=a.dataset.t;hid=tab==='threat';return draw()}
  const b=e.target.closest('button');if(!b)return;const d=b.dataset;
  if(d.pc){pc.has(d.pc)?pc.delete(d.pc):pc.add(d.pc);return draw()}
  if(d.pci){const i=cbItems().find(x=>x.id===d.pci),k=pt.findIndex(x=>x.ref===d.pci);k>=0?pt.splice(k,1):pt.push({n:i.n,ref:i.id});return draw()}
  if(d.pb){const k=pt.findIndex(x=>!x.ref&&x.n===d.pb);k>=0?pt.splice(k,1):pt.push({n:d.pb});return draw()}
  if(d.pn){const v=o.querySelector('#vtn').value.trim();if(v){pt.push({n:v});draw()}return}
  if(d.gimg)return o.querySelector('#vgf').click();
  if(d.hid){hid=!hid;return draw()}
  if(d.k==='0'){o.remove();return}
  if(d.k==='1'){const list=[];
   if(tab==='char')chars.filter(c=>pc.has(c.id)).forEach(c=>list.push({name:c.name,kind:'char',char_id:c.id,owner_id:c.owner}));
   else if(tab==='threat')pt.forEach(x=>list.push({name:x.n,kind:'threat',combat_ref:x.ref||null}));
   else{const n=(o.querySelector('#vgn').value||'').trim();if(n)list.push({name:n,kind:'generic',image:gimg||null})}
   o.remove();if(!list.length)return;const c0=viewCenter();let k=0;
   for(const it of list){const s=snapPos(c0.x+k*gsz(),c0.y,{size:1});k++;
    const r=await sb.from('scene_tokens').insert({scene_id:sc.id,campaign_id:camp.id,size:1,shape:'circle',hidden:hid,x:s.x,y:s.y,...it}).select().single();
    if(r.error){notice('Erro ao criar o token: '+r.error.message);continue}if(!S.tokens.some(t=>t.id===r.data.id))S.tokens.push(r.data)}
   need();refresh()}};
 document.body.append(o);draw()}

return {load,reset,view,leave,onScene,onToken,resync,place,fit,get state(){return S}}
})();
