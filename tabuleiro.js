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
const S={ok:true,loaded:false,scenes:[],cur:null,tokens:[],sel:null,cam:{x:0,y:0,z:1},img:null,imgPath:'',imgErr:'',tool:'sel',gridEdit:false,drag:null,popup:'',camp:null,draws:[],models:[],mok:false,lmode:'wall',lr:6,lcolor:'#ffd9a0',lprev:false,wnew:null,lcKey:'',lc:null,lcDone:false,dok:false,dcolor:'#e0b84a',dw:4,dnew:null,ruler:null,fbrush:3,fmode:'rev'};
const imgs=new Map(),ptrs=new Map();
let root=null,cv=null,cx=null,dpr=1,dirty=true,raf=0,uiKey='',gridTimer=0,poll=0,pinch=null,chan=null,loading=false,fogCv=null;
const q=s=>root&&root.querySelector(s);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const css=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const errTab=e=>!!e&&(e.code==='42P01'||e.code==='PGRST205'||/scenes|scene_tokens|does not exist|schema cache/i.test(e.message||''));
const scene=()=>S.scenes.find(s=>s.id===S.cur)||null;
const GD={show:true,size:70,ox:0,oy:0,opacity:.35,color:'#ffffff',snap:true,m:1.5};
const DRAWT=['pen','line','rect','circ'];
const fogAv=()=>{const sc=scene();return !!sc&&sc.fog!==undefined};
const fogOf=()=>({on:false,r:[],vis:0,...(scene()?.fog||{})});
let dchan=null,fogTimer=0;
const grid=()=>({...GD,...(scene()?.grid||{})});
const gsz=()=>Math.max(10,grid().size);
const tokById=id=>S.tokens.find(t=>t.id===id);
const canMove=t=>!!t&&(isMaster()||(t.kind==='char'&&t.owner_id===user.id&&!t.hidden));
const need=()=>{dirty=true};
const rad=t=>t.size*gsz()/2;
const nowIso=()=>new Date().toISOString();

/* ---------------- dados ---------------- */
function reset(){clearInterval(poll);if(chan){try{sb.removeChannel(chan)}catch(e){}chan=null}if(dchan){try{sb.removeChannel(dchan)}catch(e){}dchan=null}S.draws=[];S.models=[];S.mok=false;S.dok=false;S.dnew=null;S.ruler=null;S.scenes=[];S.tokens=[];S.cur=null;S.tokens=[];S.sel=null;S.img=null;S.imgPath='';S.imgErr='';S.popup='';S.drag=null;S.loaded=false;S.ok=true;S.camp=camp?camp.id:null}
async function load(){reset();const id=camp.id;
 const r=await sb.from('scenes').select('*').eq('campaign_id',id).order('created_at');
 if(!camp||camp.id!==id)return;
 if(errTab(r.error)){S.ok=false;S.loaded=true;return refresh()}
 S.scenes=r.data||[];pick();await loadTokens();await loadDraws();await loadModels();await loadImg();S.loaded=true;fit();refresh();
 subscribe(id);subscribeD(id);
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
const isGif=src=>typeof src==='string'&&(src.startsWith('data:image/gif')||(src.startsWith('storage:')&&/\.gif$/i.test(src)));
const GIF_MAX=20*1024*1024;
const uidx=()=>(window.crypto&&crypto.randomUUID)?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2);
const sgn=new Map();
function srcUrl(src){if(!src)return '';if(!src.startsWith('storage:'))return src;const path=src.slice(8),c=sgn.get(path),now=Date.now();
 if(c&&c.url&&c.exp>now+600000)return c.url;
 if(!c||!c.busy){const e=c||{url:'',exp:0};e.busy=true;sgn.set(path,e);sb.storage.from('mapas').createSignedUrl(path,43200).then(r=>{e.busy=false;if(r.data?.signedUrl){e.url=r.data.signedUrl;e.exp=Date.now()+43200000;uiKey='';need();refresh()}}).catch(()=>{e.busy=false})}
 return c?c.url:''}
function bgRemove(cv,rgb,tol){const w=cv.width,h=cv.height,x=cv.getContext('2d'),im=x.getImageData(0,0,w,h),d=im.data,N=w*h,seen=new Uint8Array(N),st=[];
 const dist=i=>Math.hypot(d[i*4]-rgb[0],d[i*4+1]-rgb[1],d[i*4+2]-rgb[2]);
 const push=i=>{if(!seen[i]&&dist(i)<tol){seen[i]=1;st.push(i)}};
 for(let i=0;i<w;i++){push(i);push((h-1)*w+i)}for(let j=0;j<h;j++){push(j*w);push(j*w+w-1)}
 while(st.length){const i=st.pop(),cx0=i%w,cy0=(i/w)|0;d[i*4+3]=0;if(cx0>0)push(i-1);if(cx0<w-1)push(i+1);if(cy0>0)push(i-w);if(cy0<h-1)push(i+w)}
 for(let i=0;i<N;i++){if(seen[i])continue;const cx0=i%w,cy0=(i/w)|0;if((cx0>0&&seen[i-1])||(cx0<w-1&&seen[i+1])||(cy0>0&&seen[i-w])||(cy0<h-1&&seen[i+w])){const k=dist(i);if(k<tol*1.9)d[i*4+3]=Math.round(255*Math.max(0,Math.min(1,(k-tol)/(tol*.9))))}}
 x.putImageData(im,0,0)}
function tokImg(f){return new Promise((res,rej)=>{
 if(!/^image\//.test(f.type))return rej(new Error('Escolha um arquivo de imagem.'));
 if(f.type==='image/gif'){if(f.size>GIF_MAX)return rej(new Error('GIF muito grande ('+Math.round(f.size/1048576)+' MB). O limite é 20 MB.'));
  (async()=>{const path=camp.id+'/tokens/'+uidx()+'.gif',r=await sb.storage.from('mapas').upload(path,f,{contentType:'image/gif',upsert:false});
   if(r.error)throw new Error('Não foi possível enviar o GIF ('+r.error.message+'). Confira se você rodou o arquivo 10_tabuleiro_v5.sql no Supabase.');res('storage:'+path)})().catch(rej);return}
 const im=new Image(),u=URL.createObjectURL(f);
 im.onload=async()=>{try{const M=384,k=Math.min(1,M/Math.max(im.width,im.height)),w=Math.max(1,Math.round(im.width*k)),h=Math.max(1,Math.round(im.height*k)),cv=document.createElement('canvas');cv.width=w;cv.height=h;const x=cv.getContext('2d',{willReadFrequently:true});x.drawImage(im,0,0,w,h);URL.revokeObjectURL(u);
  let alpha=false,d=null;try{d=x.getImageData(0,0,w,h).data;for(let i=3;i<d.length;i+=4)if(d[i]<250){alpha=true;break}}catch(e){}
  if(!alpha&&d){const px=(a,b)=>{const i=(b*w+a)*4;return [d[i],d[i+1],d[i+2]]},C=[px(0,0),px(w-1,0),px(0,h-1),px(w-1,h-1)],m=C[0],same=C.every(c=>Math.hypot(c[0]-m[0],c[1]-m[1],c[2]-m[2])<28),lum=(m[0]+m[1]+m[2])/3;
   if(same&&(lum<40||lum>225)){const nome=lum<40?'preto':'branco';if(await ask('Esta imagem tem fundo '+nome+'. Deixar o fundo transparente? (só o que está ligado às bordas some)')){bgRemove(cv,m,lum<40?48:42);alpha=true}}}
  let out;if(alpha){out=cv.toDataURL('image/webp',.9);if(!out.startsWith('data:image/webp'))out=cv.toDataURL('image/png')}else out=cv.toDataURL('image/jpeg',.88);
  res(out)}catch(e){rej(e)}};
 im.onerror=()=>{URL.revokeObjectURL(u);rej(new Error('Não foi possível ler a imagem.'))};im.src=u})}
const tokKc=t=>t.cor||(t.kind==='char'?(css('--ye')||'#e0b84a'):t.kind==='threat'?(css('--rd')||'#b3261e'):'#9a9086');
const gifEls=new Map();
function syncGifs(){const L=q('#vgif');if(!L)return;const sc=scene(),z=S.cam.z,f=fogOf(),M=isMaster(),fc=sc&&f.on&&!M&&!(luzAv()&&luzOf().on)?fogCircles():null,live=new Set();
 if(sc)S.tokens.forEach(t=>{const src=tokSrc(t);if(!isGif(src))return;live.add(t.id);
  let el=gifEls.get(t.id);if(!el){el=new Image();el.draggable=false;el.onload=need;L.append(el);gifEls.set(t.id,el)}
  const url=srcUrl(src);if(!url){el.style.display='none';return}
  if(el._src!==url){el.src=url;el._src=url}
  const r=rad(t),sx=(t.x-S.cam.x)*z,sy=(t.y-S.cam.y)*z,D=r*2*z,vis=!(fc&&!fc.some(([x,y,rr])=>Math.hypot(x-t.x,y-t.y)<rr+r));
  const vv=vis&&!(!M&&luzAv()&&luzOf().on&&lumAlpha(t.x,t.y)>.9);el.style.display=vv?'block':'none';el.style.opacity=t.hidden?'.5':'1';
  if(t.shape==='image'){const nw=el.naturalWidth||1,nh=el.naturalHeight||1,k=Math.min(D/nw,D/nh),w=nw*k,h=nh*k;
   Object.assign(el.style,{left:(sx-w/2)+'px',top:(sy-h/2)+'px',width:w+'px',height:h+'px',objectFit:'contain',borderRadius:'0',border:'0',background:'none',boxSizing:'content-box',filter:t.cor?'drop-shadow(0 0 5px '+t.cor+') drop-shadow(0 0 2px '+t.cor+')':'drop-shadow(0 3px 5px #000a)',outline:t.id===S.sel?'2px solid #ffffffcc':'none',outlineOffset:'2px'})}
  else{const bw=Math.max(2.5,r*.06*z);Object.assign(el.style,{left:(sx-D/2)+'px',top:(sy-D/2)+'px',width:D+'px',height:D+'px',boxSizing:'border-box',objectFit:'cover',borderRadius:t.shape==='square'?(D*.12)+'px':'50%',border:bw+'px '+(t.hidden?'dashed':'solid')+' '+tokKc(t),background:'#17120f',filter:'none',outline:t.id===S.sel?'2px solid #ffffffcc':'none',outlineOffset:'3px'})}});
 gifEls.forEach((el,id)=>{if(!live.has(id)){el.remove();gifEls.delete(id)}})}

/* ---------------- iluminação: ambiente (brilho e tema de cor) e luz dinâmica (paredes, portas, luzes, visão) ---------------- */
const LZ0={on:false,amb:.85,vis:6,walls:[],lights:[],bri:100,cor:'#ffffff',forca:0,tema:''};
const TEMAS=[['','Nenhum','#ffffff',0],['dia','Dia claro','#fff1c9',22],['tarde','Entardecer','#ff9a52',55],['noite','Noite','#3550c8',68],['luar','Luar','#8fb4ff',45],['vela','Luz de vela','#ff7a2a',52],['alarme','Alarme','#ff2a2a',55],['pantano','Pântano','#4fb36a',52],['neon','Neon','#b24bff',52]];
const luzAv=()=>{const sc=scene();return !!sc&&sc.luz!==undefined};
const luzOf=()=>({...LZ0,...(scene()?.luz||{})});
const hex2=c=>{const m=/^#?([0-9a-f]{6})$/i.exec(c||'');const n=m?parseInt(m[1],16):0xffffff;return [(n>>16)&255,(n>>8)&255,n&255]};
const mixW=(c,f)=>{const [r,g,b]=hex2(c),k=v=>Math.round(255+(v-255)*f);return 'rgb('+k(r)+','+k(g)+','+k(b)+')'};
let luzTimer=0;const oc={};
function setLuz(p){const sc=scene();if(!sc||!isMaster()||!luzAv())return;sc.luz={...luzOf(),...p};S.lcKey='';need();uiPop();clearTimeout(luzTimer);luzTimer=setTimeout(async()=>{const l=scene()?.luz;if(!l)return;const r=await sb.from('scenes').update({luz:l,updated_at:nowIso()}).eq('id',sc.id);if(r.error)notice(r.error.message)},450)}
function offc(k){let c=oc[k];if(!c){c=oc[k]=document.createElement('canvas');c.ctx=c.getContext('2d',{willReadFrequently:k==='dark'})}if(c.width!==cv.width||c.height!==cv.height){c.width=cv.width;c.height=cv.height}return c}
const poly=(c,p)=>{c.beginPath();p.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath()};
const lg=(c,x,y,r)=>{const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,'rgba(0,0,0,1)');g.addColorStop(.55,'rgba(0,0,0,.92)');g.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=g;c.beginPath();c.arc(x,y,r,0,7);c.fill()};
function raySeg(ox,oy,dx,dy,s){const sx=s[2]-s[0],sy=s[3]-s[1],den=dx*sy-dy*sx;if(Math.abs(den)<1e-9)return Infinity;const qx=s[0]-ox,qy=s[1]-oy,t=(qx*sy-qy*sx)/den,u=(qx*dy-qy*dx)/den;return(t>=0&&u>=-1e-7&&u<=1+1e-7)?t:Infinity}
function visPoly(ox,oy,R,segs){const b=[[ox-R,oy-R,ox+R,oy-R],[ox+R,oy-R,ox+R,oy+R],[ox+R,oy+R,ox-R,oy+R],[ox-R,oy+R,ox-R,oy-R]],all=[];
 for(const s of segs){if(Math.max(s[0],s[2])<ox-R||Math.min(s[0],s[2])>ox+R||Math.max(s[1],s[3])<oy-R||Math.min(s[1],s[3])>oy+R)continue;all.push(s)}
 for(const s of b)all.push(s);const an=[];
 for(const s of all)for(let k=0;k<4;k+=2){const a=Math.atan2(s[k+1]-oy,s[k]-ox);an.push(a-1e-4,a,a+1e-4)}
 an.sort((p,q)=>p-q);const pts=[];
 for(const a of an){const dx=Math.cos(a),dy=Math.sin(a);let best=Infinity;for(const s of all){const t=raySeg(ox,oy,dx,dy,s);if(t<best)best=t}if(best<Infinity)pts.push([ox+dx*best,oy+dy*best])}
 return pts}
function lumData(){const sc=scene(),L=luzOf(),M=isMaster(),G=gsz(),segs=L.walls.filter(w=>w[4]!==2).map(w=>[w[0],w[1],w[2],w[3]]),R=Math.max(sc.map_w,sc.map_h)*1.5;
 const viewers=S.tokens.filter(t=>t.kind==='char'&&!t.hidden&&(M||t.owner_id===user.id)),lights=[];
 L.lights.forEach(l=>lights.push({x:l[0],y:l[1],r:l[2]*G,cor:l[3]||'#ffd9a0'}));
 S.tokens.forEach(t=>{if(!t.hidden&&+t.luz>0)lights.push({x:t.x,y:t.y,r:t.luz*G,cor:'#ffd9a0'})});
 const key=JSON.stringify([segs,viewers.map(v=>[v.x,v.y,v.visao]),lights.map(l=>[l.x,l.y,l.r,l.cor]),R,L.vis,G]);
 if(S.lcKey!==key){S.lcKey=key;S.lc={vs:viewers.map(v=>({x:v.x,y:v.y,rv:(v.visao!=null&&v.visao!==''?+v.visao:L.vis)*G,poly:visPoly(v.x,v.y,R,segs)})),ls:lights.map(l=>({...l,poly:visPoly(l.x,l.y,l.r,segs)}))}}
 return S.lc}
function drawTint(sc){if(!luzAv())return;const L=luzOf(),fr=clamp((+L.forca||0)/100,0,1),bri=+L.bri||100,z=S.cam.z,W=cv.width,H=cv.height,wt=()=>cx.setTransform(dpr*z,0,0,dpr*z,-S.cam.x*z*dpr,-S.cam.y*z*dpr);
 if(fr>0){const t=offc('tint'),c=t.ctx;c.setTransform(1,0,0,1,0,0);c.globalCompositeOperation='source-over';c.clearRect(0,0,W,H);c.fillStyle=mixW(L.cor,fr);c.fillRect(0,0,W,H);
  if(L.on){const D=lumData();c.globalCompositeOperation='destination-out';c.setTransform(dpr*z,0,0,dpr*z,-S.cam.x*z*dpr,-S.cam.y*z*dpr);D.ls.forEach(li=>{c.save();poly(c,li.poly);c.clip();lg(c,li.x,li.y,li.r);c.restore()})}
  cx.save();cx.setTransform(1,0,0,1,0,0);cx.globalCompositeOperation='multiply';cx.drawImage(t,0,0);cx.restore()}
 if(L.on){const D=lumData();cx.save();wt();cx.globalCompositeOperation='screen';D.ls.forEach(li=>{if(/^#?f{2}d9a0$/i.test(li.cor)&&false)return;cx.save();poly(cx,li.poly);cx.clip();const g=cx.createRadialGradient(li.x,li.y,0,li.x,li.y,li.r),[r,gg,b]=hex2(li.cor);g.addColorStop(0,'rgba('+r+','+gg+','+b+',.30)');g.addColorStop(1,'rgba('+r+','+gg+','+b+',0)');cx.fillStyle=g;cx.beginPath();cx.arc(li.x,li.y,li.r,0,7);cx.fill();cx.restore()});cx.restore()}
 if(bri<100){cx.save();cx.setTransform(1,0,0,1,0,0);cx.fillStyle='rgba(0,0,0,'+((100-bri)/100*.85)+')';cx.fillRect(0,0,W,H);cx.restore()}
 else if(bri>100){cx.save();cx.setTransform(1,0,0,1,0,0);cx.globalCompositeOperation='screen';cx.fillStyle='rgba(255,255,255,'+((bri-100)/100*.5)+')';cx.fillRect(0,0,W,H);cx.restore()}}
function drawLum(sc){const L=luzOf();if(!L.on)return;const M=isMaster(),D=lumData(),z=S.cam.z,W=cv.width,H=cv.height,wt=c=>c.setTransform(dpr*z,0,0,dpr*z,-S.cam.x*z*dpr,-S.cam.y*z*dpr);
 const V=offc('vis'),v=V.ctx;v.setTransform(1,0,0,1,0,0);v.clearRect(0,0,W,H);wt(v);v.fillStyle='#fff';D.vs.forEach(vw=>{poly(v,vw.poly);v.fill()});
 const Lc=offc('lit'),l=Lc.ctx;l.setTransform(1,0,0,1,0,0);l.clearRect(0,0,W,H);wt(l);
 D.vs.forEach(vw=>{l.save();poly(l,vw.poly);l.clip();if(vw.rv>0)lg(l,vw.x,vw.y,vw.rv);D.ls.forEach(li=>{l.save();poly(l,li.poly);l.clip();lg(l,li.x,li.y,li.r);l.restore()});l.restore()});
 const Dk=offc('dark'),d=Dk.ctx;d.setTransform(1,0,0,1,0,0);d.globalCompositeOperation='source-over';d.globalAlpha=1;d.clearRect(0,0,W,H);d.fillStyle='#000';d.fillRect(0,0,W,H);
 d.globalCompositeOperation='destination-out';d.globalAlpha=1-clamp(+L.amb,0,1);d.drawImage(V,0,0);d.globalAlpha=1;d.drawImage(Lc,0,0);d.globalCompositeOperation='source-over';
 S.lcDone=true;cx.save();cx.setTransform(1,0,0,1,0,0);cx.globalAlpha=(M&&!S.lprev)?.55:1;cx.drawImage(Dk,0,0);cx.restore()}
function lumAlpha(x,y){const c=oc.dark;if(!c||!S.lcDone)return 0;const z=S.cam.z,px=Math.round((x-S.cam.x)*z*dpr),py=Math.round((y-S.cam.y)*z*dpr);if(px<0||py<0||px>=c.width||py>=c.height)return 1;try{return c.ctx.getImageData(px,py,1,1).data[3]/255}catch(e){return 0}}
const dSeg=(px,py,s)=>{const dx=s[2]-s[0],dy=s[3]-s[1],l2=dx*dx+dy*dy||1,t=clamp(((px-s[0])*dx+(py-s[1])*dy)/l2,0,1);return Math.hypot(px-(s[0]+t*dx),py-(s[1]+t*dy))};
function doorAt(w){const z=S.cam.z;let b=-1,bd=14/z;luzOf().walls.forEach((s,i)=>{if(s[4]!==1&&s[4]!==2)return;const d=dSeg(w.x,w.y,s);if(d<bd){bd=d;b=i}});return b}
function toggleDoor(i){const L=luzOf(),w=L.walls.map(x=>x.slice());w[i][4]=w[i][4]===1?2:1;setLuz({walls:w})}
function snapWall(w){const z=S.cam.z,g=grid(),sc=scene();let p={x:w.x,y:w.y},bd=14/z;
 luzOf().walls.forEach(s=>{[[s[0],s[1]],[s[2],s[3]]].forEach(([x,y])=>{const d=Math.hypot(x-w.x,y-w.y);if(d<bd){bd=d;p={x,y}}})});
 if(bd===14/z&&g.snap){const sz=Math.max(10,g.size);p={x:Math.round((w.x-g.ox)/sz)*sz+g.ox,y:Math.round((w.y-g.oy)/sz)*sz+g.oy}}
 if(sc){p.x=clamp(p.x,0,sc.map_w);p.y=clamp(p.y,0,sc.map_h)}return p}
function luzDown(w){const L=luzOf(),z=S.cam.z;
 if(S.lmode==='wall'||S.lmode==='door'){S.wnew={a:snapWall(w),b:snapWall(w),door:S.lmode==='door'};S.drag={type:'wall'};return need()}
 if(S.lmode==='light'){return setLuz({lights:[...L.lights,[Math.round(w.x),Math.round(w.y),S.lr,S.lcolor]]})}
 if(S.lmode==='erase'){let li=-1,bd=20/z;L.lights.forEach((l,i)=>{const d=Math.hypot(l[0]-w.x,l[1]-w.y);if(d<bd){bd=d;li=i}});
  if(li>=0)return setLuz({lights:L.lights.filter((_,i)=>i!==li)});
  let wi=-1;bd=14/z;L.walls.forEach((s,i)=>{const d=dSeg(w.x,w.y,s);if(d<bd){bd=d;wi=i}});if(wi>=0)return setLuz({walls:L.walls.filter((_,i)=>i!==wi)})}}
function drawLumEdit(sc){if(!isMaster()||S.tool!=='luz'||!luzAv())return;const L=luzOf(),z=S.cam.z;cx.save();cx.lineCap='round';
 L.walls.forEach(s=>{cx.beginPath();cx.moveTo(s[0],s[1]);cx.lineTo(s[2],s[3]);cx.lineWidth=(s[4]?4:3)/z;cx.setLineDash(s[4]===2?[8/z,6/z]:[]);cx.strokeStyle=s[4]?(s[4]===2?'#4fd1ff88':'#4fd1ff'):'#ff9f40';cx.stroke()});
 cx.setLineDash([]);if(S.wnew){cx.beginPath();cx.moveTo(S.wnew.a.x,S.wnew.a.y);cx.lineTo(S.wnew.b.x,S.wnew.b.y);cx.lineWidth=3/z;cx.strokeStyle=S.wnew.door?'#4fd1ff':'#ffd27a';cx.stroke()}
 L.lights.forEach(l=>{const r=l[2]*gsz();cx.beginPath();cx.arc(l[0],l[1],r,0,7);cx.lineWidth=1.5/z;cx.setLineDash([6/z,5/z]);cx.strokeStyle=(l[3]||'#ffd9a0')+'aa';cx.stroke();cx.setLineDash([]);cx.beginPath();cx.arc(l[0],l[1],8/z,0,7);cx.fillStyle=l[3]||'#ffd9a0';cx.fill();cx.lineWidth=2/z;cx.strokeStyle='#000';cx.stroke()});
 cx.restore()}
const PAL=['#e0b84a','#e0352b','#ff9f40','#5bd17a','#5aa9ff','#b07cff','#ffffff','#111111'];
const baseName=n=>String(n||'').replace(/\s+\d+$/,'').trim().toLowerCase();
const versOf=t=>t.kind==='char'?S.models.filter(m=>m.kind==='char'&&m.char_id===t.char_id):S.models.filter(m=>m.kind!=='char'&&baseName(m.grupo||m.name)===baseName(t.name));
async function loadModels(){S.models=[];S.mok=false;if(!isMaster()||!camp)return;const r=await sb.from('token_modelos').select('*').eq('campaign_id',camp.id).order('created_at');
 if(r.error)return;S.mok=true;S.models=r.data||[]}
async function loadDraws(){S.draws=[];if(!S.cur){return}const r=await sb.from('scene_drawings').select('*').eq('scene_id',S.cur).order('created_at');
 if(r.error){S.dok=false;return}S.dok=true;S.draws=r.data||[]}
function subscribeD(id){if(dchan){try{sb.removeChannel(dchan)}catch(e){}dchan=null}if(!S.dok)return;
 try{dchan=sb.channel('vttd-'+id).on('postgres_changes',{event:'*',schema:'public',table:'scene_drawings',filter:'campaign_id=eq.'+id},onDraw).subscribe()}catch(e){dchan=null}}
function onDraw(p){if(!S.camp||!camp)return;
 if(p.eventType==='DELETE'){const id=p.old?.id;if(S.draws.some(d=>d.id===id)){S.draws=S.draws.filter(d=>d.id!==id);need()}return}
 const n=p.new;if(!n||n.scene_id!==S.cur||n.campaign_id!==camp.id)return;if(!S.draws.some(d=>d.id===n.id)){S.draws.push(n);need()}}
async function loadTokens(){S.tokens=[];S.sel=null;if(!S.cur)return;const r=await sb.from('scene_tokens').select('*').eq('scene_id',S.cur);if(!r.error)S.tokens=r.data||[]}
async function loadImg(){const sc=scene();S.img=null;S.imgErr='';S.imgPath=sc?.map_path||'';if(!S.imgPath)return;
 const key=S.imgPath,r=await sb.storage.from('mapas').createSignedUrl(key,21600);
 if(r.error||!r.data?.signedUrl){S.imgErr='Não foi possível carregar o mapa.';return}
 await new Promise(res=>{const im=new Image();im.crossOrigin='anonymous';im.onload=()=>{if(S.imgPath===key)S.img=im;res()};im.onerror=()=>{S.imgErr='Não foi possível carregar o mapa.';res()};im.src=r.data.signedUrl})}
async function switchTo(id){S.cur=id;S.ruler=null;S.dnew=null;if(isMaster()){try{localStorage.setItem(KEY+camp.id,id||'')}catch(e){}}
 await loadTokens();await loadDraws();await loadImg();fit();refresh()}
async function resync(){if(!S.camp||!camp)return;const r=await sb.from('scenes').select('*').eq('campaign_id',camp.id).order('created_at');if(r.error)return;
 S.scenes=r.data||[];const was=S.cur,wasPath=S.imgPath;if(!isMaster()||!S.scenes.some(s=>s.id===S.cur))pick();
 if(S.cur!==was){await loadTokens();await loadDraws();await loadImg();fit()}
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
const tokSrc=t=>t.kind==='char'?(t.image||chars.find(c=>c.id===t.char_id)?.foto||''):(t.image||'');
function imgOf(src){if(!src)return null;const u=srcUrl(src);if(!u)return null;let m=imgs.get(u);if(!m){m=new Image();m.crossOrigin='anonymous';m.onload=need;m.src=u;imgs.set(u,m)}return m.complete&&m.naturalWidth?m:null}
function hpOf(t){
 if(t.kind==='char'){const c=chars.find(x=>x.id===t.char_id);return c?{v:+c.vidaAtual||0,m:calc(c).vida,edit:canEdit(c),c}:null}
 if(t.kind==='threat'&&t.combat_ref&&isMaster()){const r=sK('combate')[0],it=r&&cbData(r).itens.find(x=>x.id===t.combat_ref);return it?{v:+it.vida||0,m:+it.max||0,edit:true,it,r}:null}
 return null}

/* ---------------- desenho ---------------- */
function size(){if(!root||!cv)return;dpr=Math.min(2,window.devicePixelRatio||1);const r=root.getBoundingClientRect();const W=Math.max(1,Math.round(r.width*dpr)),H=Math.max(1,Math.round(r.height*dpr));if(cv.width!==W)cv.width=W;if(cv.height!==H)cv.height=H;need()}
function pathTok(t,r){cx.beginPath();if(t.shape==='square'){const k=Math.min(r*.18,14);cx.roundRect?cx.roundRect(t.x-r,t.y-r,r*2,r*2,k):cx.rect(t.x-r,t.y-r,r*2,r*2)}else cx.arc(t.x,t.y,r,0,Math.PI*2)}
function draw(){dirty=false;if(!cv||!cx)return;const sc=scene(),z=S.cam.z;
 cx.setTransform(1,0,0,1,0,0);cx.fillStyle=css('--bg')||'#120f0d';cx.fillRect(0,0,cv.width,cv.height);if(!sc){syncGifs();return}
 cx.setTransform(dpr*z,0,0,dpr*z,-S.cam.x*z*dpr,-S.cam.y*z*dpr);
 if(S.img)cx.drawImage(S.img,0,0,sc.map_w,sc.map_h);else{cx.fillStyle='#1d1814';cx.fillRect(0,0,sc.map_w,sc.map_h)}
 cx.lineWidth=2/z;cx.strokeStyle='#00000099';cx.strokeRect(0,0,sc.map_w,sc.map_h);
 drawGrid(sc);
if(S.dok||S.dnew)drawDraws(sc);
 const list=[...S.tokens].sort((a,b)=>(a.id===S.sel)-(b.id===S.sel)||(S.drag?.id===a.id)-(S.drag?.id===b.id));
 if(S.drag?.type==='tok'&&S.drag.ghost){const t=tokById(S.drag.id),r=rad(t);cx.save();cx.globalAlpha=.35;cx.fillStyle=css('--ye')||'#e0b84a';pathTok({...t,x:S.drag.ghost.x,y:S.drag.ghost.y},r);cx.fill();cx.restore()}
list.forEach(drawTok);
 drawTint(sc);if(luzAv()&&luzOf().on)drawLum(sc);else drawFog(sc);drawLumEdit(sc);drawRuler(sc);syncGifs()}
function strokeShape(d,z){const c=d.color||'#e0b84a',w=(d.width||4),p=d.pts||[];if(!p.length)return;cx.save();cx.strokeStyle=c;cx.lineWidth=w;cx.lineCap='round';cx.lineJoin='round';cx.beginPath();
 if(d.kind==='pen'){cx.moveTo(p[0][0],p[0][1]);for(let i=1;i<p.length;i++)cx.lineTo(p[i][0],p[i][1]);if(p.length===1)cx.lineTo(p[0][0]+.1,p[0][1])}
 else if(p.length>1){const [a,b]=[p[0],p[p.length-1]];if(d.kind==='line'){cx.moveTo(a[0],a[1]);cx.lineTo(b[0],b[1])}else if(d.kind==='rect')cx.rect(Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]));else cx.arc(a[0],a[1],Math.hypot(b[0]-a[0],b[1]-a[1]),0,Math.PI*2)}
 cx.stroke();cx.restore()}
function drawDraws(sc){const z=S.cam.z;S.draws.forEach(d=>strokeShape(d,z));if(S.dnew)strokeShape(S.dnew,z)}
function fogCircles(){const f=fogOf(),L=(f.r||[]).slice();if(+f.vis>0){const rr=+f.vis*gsz();S.tokens.forEach(t=>{if(t.kind==='char'&&!t.hidden)L.push([t.x,t.y,rr])})}return L}
function drawFog(sc){const f=fogOf();if(!f.on)return;const M=isMaster(),{w,h}=vp();
 if(!fogCv)fogCv=document.createElement('canvas');if(fogCv.width!==cv.width||fogCv.height!==cv.height){fogCv.width=cv.width;fogCv.height=cv.height}
 const g=fogCv.getContext('2d'),z=S.cam.z;g.setTransform(1,0,0,1,0,0);g.globalCompositeOperation='source-over';g.clearRect(0,0,fogCv.width,fogCv.height);
 g.fillStyle='#000';g.fillRect(0,0,fogCv.width,fogCv.height);g.globalCompositeOperation='destination-out';g.setTransform(dpr*z,0,0,dpr*z,-S.cam.x*z*dpr,-S.cam.y*z*dpr);
 fogCircles().forEach(([x,y,r])=>{const gr=g.createRadialGradient(x,y,r*.82,x,y,r);gr.addColorStop(0,'#000f');gr.addColorStop(1,'#0000');g.fillStyle=gr;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill()});
 cx.save();cx.setTransform(1,0,0,1,0,0);cx.globalAlpha=M?.55:1;cx.drawImage(fogCv,0,0);cx.restore();
 if(M&&S.tool==='fog'&&S.fcur){const r=S.fbrush*gsz();cx.save();cx.lineWidth=2/z;cx.strokeStyle=S.fmode==='rev'?'#7fe37f':'#e37f7f';cx.setLineDash([6/z,4/z]);cx.beginPath();cx.arc(S.fcur.x,S.fcur.y,r,0,Math.PI*2);cx.stroke();cx.restore()}}
function drawRuler(sc){const r=S.ruler;if(!r||!r.b)return;const z=S.cam.z,g=grid(),d=Math.hypot(r.b.x-r.a.x,r.b.y-r.a.y),casas=d/gsz(),m=casas*(g.m||0);
 cx.save();cx.strokeStyle='#ffe28a';cx.fillStyle='#ffe28a';cx.lineWidth=3/z;cx.setLineDash([10/z,6/z]);cx.beginPath();cx.moveTo(r.a.x,r.a.y);cx.lineTo(r.b.x,r.b.y);cx.stroke();cx.setLineDash([]);
 [r.a,r.b].forEach(p=>{cx.beginPath();cx.arc(p.x,p.y,5/z,0,Math.PI*2);cx.fill()});
 const txt=(Math.round(casas*10)/10)+' casa'+(Math.abs(casas-1)<.05?'':'s')+(g.m?' · '+(Math.round(m*10)/10)+' m':''),fs=15/z;cx.font=`600 ${fs}px "Libre Baskerville",Georgia,serif`;cx.textAlign='center';cx.textBaseline='bottom';
 const mx=(r.a.x+r.b.x)/2,my=(r.a.y+r.b.y)/2-8/z,tw=cx.measureText(txt).width;cx.fillStyle='#000c';cx.fillRect(mx-tw/2-6/z,my-fs*1.3,tw+12/z,fs*1.4);cx.fillStyle='#ffe28a';cx.fillText(txt,mx,my);cx.restore()}
function pushDraw(d){return sb.from('scene_drawings').insert({scene_id:d.scene_id,campaign_id:d.campaign_id,author:user.id,kind:d.kind,color:d.color,width:d.width,pts:d.pts}).select().single()}
async function undoDraw(){const mine=S.draws.filter(d=>d.author===user.id);const d=mine[mine.length-1];if(!d)return notice('Você não tem desenhos nesta cena.');
 S.draws=S.draws.filter(x=>x.id!==d.id);need();const r=await sb.from('scene_drawings').delete().eq('id',d.id);if(r.error)notice(r.error.message)}
async function clearDraws(){const M=isMaster(),ids=S.draws.filter(d=>M||d.author===user.id).map(d=>d.id);if(!ids.length)return;if(!(await ask(M?'Apagar TODOS os desenhos desta cena?':'Apagar os seus desenhos desta cena?')))return;
 S.draws=S.draws.filter(d=>!ids.includes(d.id));need();const r=await sb.from('scene_drawings').delete().in('id',ids);if(r.error)notice(r.error.message)}
function setFog(p){const sc=scene();if(!sc||!isMaster()||!fogAv())return;sc.fog={...fogOf(),...p};need();uiPop();clearTimeout(fogTimer);fogTimer=setTimeout(async()=>{const f=scene()?.fog;if(!f)return;const r=await sb.from('scenes').update({fog:f,updated_at:nowIso()}).eq('id',sc.id);if(r.error)notice(r.error.message)},450)}
function fogPaint(w){const f=fogOf(),R=S.fbrush*gsz();let r=(f.r||[]).slice();
 if(S.fmode==='rev'){const l=r[r.length-1];if(!l||Math.hypot(l[0]-w.x,l[1]-w.y)>R*.35)r.push([Math.round(w.x),Math.round(w.y),Math.round(R)])}
 else r=r.filter(c=>Math.hypot(c[0]-w.x,c[1]-w.y)>R*.9);
 if(r.length>1800)r=r.slice(-1800);setFog({r})}
function drawGrid(sc){const g=grid();if(!g.show)return;const z=S.cam.z,{w,h}=vp(),s=Math.max(10,g.size);
 const x0=Math.max(0,S.cam.x),y0=Math.max(0,S.cam.y),x1=Math.min(sc.map_w,S.cam.x+w/z),y1=Math.min(sc.map_h,S.cam.y+h/z);
 if((x1-x0)/s>500||(y1-y0)/s>500)return;
 cx.save();cx.globalAlpha=clamp(g.opacity,0,1);cx.strokeStyle=g.color;cx.lineWidth=1/z;cx.beginPath();
 for(let x=Math.ceil((x0-g.ox)/s)*s+g.ox;x<=x1;x+=s){cx.moveTo(x,y0);cx.lineTo(x,y1)}
 for(let y=Math.ceil((y0-g.oy)/s)*s+g.oy;y<=y1;y+=s){cx.moveTo(x0,y);cx.lineTo(x1,y)}
 cx.stroke();cx.restore()}
function drawTokImg(t,r,sel,kc,z){const im=imgOf(tokSrc(t));cx.save();if(t.hidden)cx.globalAlpha=.5;
 if(im&&!isGif(tokSrc(t))){const k=Math.min(r*2/im.naturalWidth,r*2/im.naturalHeight),w=im.naturalWidth*k,h=im.naturalHeight*k;cx.save();cx.shadowColor=t.cor||'#000c';cx.shadowBlur=(t.cor?16:10)/z;cx.shadowOffsetY=t.cor?0:3/z;cx.drawImage(im,t.x-w/2,t.y-h/2,w,h);if(t.cor)cx.drawImage(im,t.x-w/2,t.y-h/2,w,h);cx.restore();if(sel){cx.lineWidth=2/z;cx.strokeStyle='#ffffffcc';cx.strokeRect(t.x-w/2,t.y-h/2,w,h)}}
 cx.restore()}
function drawTok(t){const z=S.cam.z,r=rad(t),sel=t.id===S.sel,kc=t.cor||(t.kind==='char'?(css('--ye')||'#e0b84a'):t.kind==='threat'?(css('--rd')||'#b3261e'):'#9a9086');
 if(t.shape==='image'&&imgOf(tokSrc(t)))drawTokImg(t,r,sel,kc,z);else{
 cx.save();if(t.hidden)cx.globalAlpha=.5;
 cx.save();cx.shadowColor='#000b';cx.shadowBlur=10/z;cx.shadowOffsetY=3/z;pathTok(t,r);cx.fillStyle='#17120f';cx.fill();cx.restore();
 const im=imgOf(tokSrc(t));
 cx.save();pathTok(t,r);cx.clip();
 if(im&&!isGif(tokSrc(t))){const k=Math.max(r*2/im.naturalWidth,r*2/im.naturalHeight),w=im.naturalWidth*k,h=im.naturalHeight*k;cx.drawImage(im,t.x-w/2,t.y-h/2,w,h)}
 else{cx.fillStyle='#2a221c';cx.fillRect(t.x-r,t.y-r,r*2,r*2);cx.fillStyle='#d8cdbf';cx.font=`600 ${r*.9}px "Libre Baskerville",Georgia,serif`;cx.textAlign='center';cx.textBaseline='middle';cx.fillText(ini(t.name),t.x,t.y+r*.04)}
 cx.restore();
 pathTok(t,r);cx.lineWidth=Math.max(2.5/z,r*.06);cx.strokeStyle=kc;if(t.hidden)cx.setLineDash([r*.18,r*.12]);cx.stroke();cx.setLineDash([]);
 if(sel){pathTok(t,r+4/z);cx.lineWidth=2/z;cx.strokeStyle='#ffffffcc';cx.stroke()}
 cx.restore()}
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
function row(t){const {id,scene_id,campaign_id,name,kind,char_id,combat_ref,image,x,y,size,shape,hidden,owner_id,cor,luz,visao}=t;return {id,scene_id,campaign_id,name,kind,char_id,combat_ref,image,x,y,size,shape,hidden,owner_id,cor:cor||null,luz:luz||null,visao:visao??null}}
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
  if(S.tool==='ruler'){S.ruler={a:w,b:w};S.drag={type:'ruler'};return need()}
  if(DRAWT.includes(S.tool)&&S.dok){S.dnew={scene_id:sc.id,campaign_id:camp.id,kind:S.tool,color:S.dcolor,width:S.dw/ S.cam.z*1.0,pts:[[w.x,w.y]]};S.drag={type:'draw'};return need()}
  if(S.tool==='luz'&&isMaster()&&luzAv()){return luzDown(w)}
  if(S.tool==='fog'&&isMaster()&&fogAv()){S.drag={type:'fog'};fogPaint(w);return}
  if(isMaster()&&luzAv()&&S.tool==='sel'&&!tokenAt(w)){const di=doorAt(w);if(di>=0){toggleDoor(di);return}}
  const t=S.tool==='sel'?tokenAt(w):null;
  if(t){select(t.id);S.drag=canMove(t)?{type:'tok',id:t.id,dx:w.x-t.x,dy:w.y-t.y,moved:false,last:0}:null;if(S.drag)cv.style.cursor='grabbing'}
  else{if(S.sel)select(null);S.drag={type:'pan',sx:p.x,sy:p.y,cx:S.cam.x,cy:S.cam.y};cv.style.cursor='grabbing'}});
 cv.addEventListener('pointermove',e=>{const p=evPt(e);if(ptrs.has(e.pointerId))ptrs.set(e.pointerId,p);
  if(pinch&&ptrs.size>=2){const [a,b]=[...ptrs.values()],d=Math.hypot(a.x-b.x,a.y-b.y)||1,mx=(a.x+b.x)/2,my=(a.y+b.y)/2,nz=clamp(pinch.z*d/pinch.d,.05,6),wx=S.cam.x+pinch.mx/S.cam.z,wy=S.cam.y+pinch.my/S.cam.z;S.cam.z=nz;S.cam.x=wx-mx/nz;S.cam.y=wy-my/nz;pinch.mx=mx;pinch.my=my;need();uiZoom();return}
  if(S.tool==='fog'&&isMaster()){S.fcur=toWorld(p);need()}
  const d=S.drag;if(!d){if(S.tool==='sel'&&e.pointerType==='mouse'){const t=tokenAt(toWorld(p));cv.style.cursor=t&&canMove(t)?'grab':'default'}return}
  if(d.type==='wall'&&S.wnew){S.wnew.b=snapWall(toWorld(p));need()}
  else if(d.type==='ruler'){S.ruler.b=toWorld(p);need()}
  else if(d.type==='draw'&&S.dnew){const w=toWorld(p),pts=S.dnew.pts;if(S.dnew.kind==='pen'){const l=pts[pts.length-1];if(Math.hypot(w.x-l[0],w.y-l[1])*S.cam.z>3)pts.push([Math.round(w.x),Math.round(w.y)])}else{pts[1]=[w.x,w.y]}need()}
  else if(d.type==='fog'){fogPaint(toWorld(p))}
  else if(d.type==='pan'){S.cam.x=d.cx-(p.x-d.sx)/S.cam.z;S.cam.y=d.cy-(p.y-d.sy)/S.cam.z;need()}
  else if(d.type==='grid'){const z=S.cam.z;setGrid({ox:Math.round(d.ox+(p.x-d.sx)/z),oy:Math.round(d.oy+(p.y-d.sy)/z)})}
  else if(d.type==='tok'){const t=tokById(d.id);if(!t)return;const w=toWorld(p),nx=w.x-d.dx,ny=w.y-d.dy;if(!d.moved&&Math.hypot(nx-t.x,ny-t.y)*S.cam.z<4)return;
   d.moved=true;t.x=nx;t.y=ny;d.ghost=snapPos(nx,ny,t);need();if(Date.now()-d.last>220&&!grid().snap){d.last=Date.now();sendPos(t)}}});
 const up=e=>{ptrs.delete(e.pointerId);if(ptrs.size<2)pinch=null;const d=S.drag;cv.style.cursor='default';if(!d||ptrs.size)return;S.drag=null;
  if(d.type==='wall'&&S.wnew){const n=S.wnew;S.wnew=null;if(Math.hypot(n.b.x-n.a.x,n.b.y-n.a.y)>6)setLuz({walls:[...luzOf().walls,[Math.round(n.a.x),Math.round(n.a.y),Math.round(n.b.x),Math.round(n.b.y),n.door?1:0]]});need()}
  if(d.type==='draw'&&S.dnew){const nd=S.dnew;S.dnew=null;nd.pts=nd.pts.map(q=>[Math.round(q[0]),Math.round(q[1])]);nd.width=Math.round(nd.width*10)/10;
   if(nd.pts.length>1||nd.kind==='pen'){const tmp={...nd,id:'tmp'+Date.now(),author:user.id};S.draws.push(tmp);need();pushDraw(nd).then(r=>{S.draws=S.draws.filter(x=>x.id!==tmp.id);if(r.error)notice(r.error.message);else if(!S.draws.some(x=>x.id===r.data.id))S.draws.push(r.data);need()})}}
  if(d.type==='tok'&&d.moved){const t=tokById(d.id);if(t){const s=snapPos(t.x,t.y,t);t.x=s.x;t.y=s.y;sendPos(t)}}need();refresh()};
 cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
 document.addEventListener('keydown',e=>{if(!root||root.hidden||/INPUT|TEXTAREA/.test(document.activeElement?.tagName||''))return;
  if(e.key==='Escape'){select(null);S.popup='';S.gridEdit=false;S.ruler=null;S.dnew=null;S.tool='sel';refresh()}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&S.dok){e.preventDefault();undoDraw()}
  else if((e.key==='Delete'||e.key==='Backspace')&&isMaster()&&S.sel){const t=tokById(S.sel);t&&ask(`Remover o token "${t.name}"?`).then(ok=>ok&&delTok(t))}
  else if(e.key==='+'||e.key==='=')zoomAt(vp().w/2,vp().h/2,1.2);else if(e.key==='-')zoomAt(vp().w/2,vp().h/2,1/1.2);else if(e.key==='0')fit()})}

/* ---------------- interface ---------------- */
const IC={sel:'<path d="M5 3l14 8-6 1.5L10 19z"/>',pan:'<path d="M8 12V5a1.5 1.5 0 013 0v5m0-6a1.5 1.5 0 013 0v6m0-4a1.5 1.5 0 013 0v7a6 6 0 01-6 6h-1a6 6 0 01-5-3l-3-5a1.5 1.5 0 012.5-1.5L8 14"/>',add:'<path d="M12 5v14M5 12h14"/>',grid:'<path d="M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>',map:'<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/>',fit:'<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',ruler:'<path d="M3 17L17 3l4 4L7 21zM8 12l2 2M11 9l2 2M14 6l2 2"/>',pen:'<path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3"/>',line:'<path d="M5 19L19 5"/>',rect:'<path d="M5 6h14v12H5z"/>',circ:'<circle cx="12" cy="12" r="7"/>',undo:'<path d="M9 8H5V4M5 8a8 8 0 11-1 6"/>',trash:'<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>',fog:'<path d="M3 15h14M5 11h14M7 7h10M3 19h12"/>',luz:'<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>'};
const svg=n=>`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${IC[n]}</svg>`;
function build(){
 root=document.createElement('div');root.id='vtt';root.hidden=true;
 root.innerHTML=`<canvas id="vc"></canvas><div id="vgif"></div><div class="vt-top" id="vtop"></div><div class="vt-tools" id="vtools"></div><div class="vt-zoom" id="vzoom"></div><div class="vt-pop" id="vpop" hidden></div><div class="vt-tok" id="vtok" hidden></div><div class="vt-msg" id="vmsg" hidden></div>`;
 document.body.append(root);cv=q('#vc');cx=cv.getContext('2d');bind();
 root.addEventListener('click',onUi);
 root.addEventListener('change',onUiChange);
 new ResizeObserver(()=>{size();if(!S.drag)uiZoom()}).observe(root);
 new MutationObserver(()=>{if(root&&!root.hidden)place()}).observe(document.body,{attributes:true,attributeFilter:['class']});
 root.addEventListener('input',e=>{const k=e.target.dataset&&e.target.dataset.lz;if(!k||!isMaster())return;const v=+e.target.value;setLuz(k==='amb'?{amb:v/100}:{[k]:v});const lab=e.target.parentElement.querySelector('.vt-val');if(lab)lab.textContent=v+'%'});
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
 el.innerHTML=(scene()?b('t-sel','sel','Selecionar e mover tokens',S.tool==='sel')+b('t-pan','pan','Arrastar o mapa',S.tool==='pan')+b('t-ruler','ruler','Régua: arraste para medir',S.tool==='ruler'):'')+(scene()&&S.dok?'<span class="vt-sep"></span>'+b('t-pen','pen','Lápis',S.tool==='pen')+b('t-line','line','Linha',S.tool==='line')+b('t-rect','rect','Retângulo',S.tool==='rect')+b('t-circ','circ','Círculo',S.tool==='circ')+b('undo','undo','Desfazer o último desenho (Ctrl+Z)')+b('dclear','trash','Apagar desenhos'):'')+(M&&S.ok&&scene()&&fogAv()?'<span class="vt-sep"></span>'+b('t-fog','fog','Névoa de guerra',S.tool==='fog'):'')+(M&&S.ok&&scene()&&luzAv()?b('t-luz','luz','Iluminação: brilho, tema de cor, paredes e luzes',S.tool==='luz'):'')+(M&&S.ok?'<span class="vt-sep"></span>'+(scene()?b('addtok','add','Adicionar token')+b('grid','grid','Grade',S.popup==='grid'):'')+b('scenes','map','Cenas e mapas'):'');
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
 const M=isMaster(),h=hpOf(t),key=[t.id,t.name,t.size,t.shape,t.hidden,h?h.v+'/'+h.m:'',M,canMove(t),S.mok,S.models.length,t.image?1:0,t.cor||'',t.luz||0,t.visao??''].join('|');
 if(key===uiKey&&!el.hidden)return;if(el.contains(document.activeElement)&&el.querySelector('input')===document.activeElement&&!el.hidden){return}
 uiKey=key;el.hidden=false;
 el.innerHTML=`<div class="vt-trow">${M?`<input data-tn="${t.id}" value="${esc(t.name)}" aria-label="Nome do token">`:`<b>${esc(t.name)}</b>`}<span class="tag${t.kind==='threat'?' hidt':''}">${t.kind==='char'?'Personagem':t.kind==='threat'?'Ameaça':'Token'}</span>${canMove(t)?'':'<span class="mu">só leitura</span>'}</div>
 ${h&&h.m>0?`<div class="vt-trow"><span class="mu">Vida</span>${h.edit?'<button class="vt-s" data-a="hp-5">−5</button><button class="vt-s" data-a="hp-1">−1</button>':''}<b class="vt-hp">${h.v} / ${h.m}</b>${h.edit?'<button class="vt-s" data-a="hp+1">+1</button><button class="vt-s" data-a="hp+5">+5</button>':''}</div>`:''}
 ${M?`<div class="vt-trow"><span class="mu">Tamanho</span><div class="seg">${[.5,1,2,3,4].map(n=>`<button class="sg${t.size==n?' on':''}" data-a="tsize" data-v="${n}">${n===.5?'½':n}</button>`).join('')}</div><span class="mu">Formato</span><div class="seg"><button class="sg${t.shape==='circle'?' on':''}" data-a="tshape" data-v="circle">Círculo</button><button class="sg${t.shape==='square'?' on':''}" data-a="tshape" data-v="square">Quadrado</button><button class="sg${t.shape==='image'?' on':''}" data-a="tshape" data-v="image" title="Usa a silhueta da própria imagem: PNG com fundo transparente ou GIF animado">Imagem</button></div></div><div class="vt-trow"><span class="mu">Borda</span>${PAL.map(c=>`<button class="vt-sw${t.cor===c?' on':''}" data-a="tcor" data-v="${c}" style="background:${c}" aria-label="Cor ${c}"></button>`).join('')}<input type="color" id="vtcor" value="${t.cor||'#9a9086'}" aria-label="Outra cor"><button class="vt-s" data-a="tcor" data-v="">Padrão</button></div>${luzAv()?`<div class="vt-trow"><span class="mu">Luz</span><div class="seg">${[0,2,4,6,8].map(n=>`<button class="sg${(+t.luz||0)===n?' on':''}" data-a="tluz" data-v="${n}">${n||'Nenhuma'}</button>`).join('')}</div><span class="mu">Visão</span><div class="seg">${[['','Padrão'],['0','0'],['3','3'],['6','6'],['9','9']].map(([v,n])=>`<button class="sg${String(t.visao??'')===v?' on':''}" data-a="tvis" data-v="${v}">${n}</button>`).join('')}</div></div>`:''}`:''}
 <div class="vt-trow">${t.kind==='char'&&chars.some(c=>c.id===t.char_id&&vis(c))?'<button data-a="tficha">Abrir ficha</button>':''}${M&&t.kind==='threat'&&t.combat_ref&&hpOf(t)?'<button data-a="tbest">Abrir no bestiário</button>':''}${M?`<button data-a="timg">Imagem…</button><button class="eye${t.hidden?' on':''}" data-a="thide">${t.hidden?'Mostrar aos jogadores':'Ocultar dos jogadores'}</button><button class="x" data-a="tdel">Remover</button><input type="file" id="vtimg" accept="image/*" hidden>`:''}</div>
 ${M&&S.mok?`<div class="vt-trow"><button data-a="tsave" title="Guarda imagem, formato e tamanho deste token para reutilizar">Salvar como modelo</button>${t.kind==='char'&&t.image?'<button data-a="tclr" title="Volta a usar a foto da ficha">Usar foto da ficha</button>':''}${(vers=>vers.length?'<span class="mu">Versões</span>'+vers.map(m=>`<button class="vt-s" data-a="tvar" data-id="${m.id}">${esc(m.name)}</button>`).join(''):'')(versOf(t))}</div>`:''}`}
function luzPop(){const L=luzOf(),sw=['#ffd9a0','#ffffff','#ff9f40','#ff5a4d','#5aa9ff','#b07cff','#5bd17a'];
 return `<div class="row"><b class="sp">Iluminação</b></div>
 <h4>Ambiente do tabuleiro</h4>
 <div class="vt-grow"><span>Brilho <b class="vt-val">${Math.round(L.bri)}%</b></span><input type="range" min="20" max="160" step="5" value="${L.bri}" data-lz="bri"></div>
 <div class="vt-chips">${TEMAS.map(t=>`<button class="vt-ch${L.tema===t[0]?' on':''}" data-a="ltema" data-v="${t[0]}" style="--c:${t[2]}"><i></i>${t[1]}</button>`).join('')}</div>
 <div class="vt-grow"><span>Cor própria</span><input type="color" id="lzcor" value="${/^#[0-9a-f]{6}$/i.test(L.cor)?L.cor:'#ffffff'}"></div>
 <div class="vt-grow"><span>Intensidade da cor <b class="vt-val">${Math.round(L.forca)}%</b></span><input type="range" min="0" max="100" step="5" value="${L.forca}" data-lz="forca"></div>
 <h4>Luz dinâmica</h4>
 <div class="tiles1"><button class="tile${L.on?' on':''}" data-a="lon"><span>Ligada: jogadores só veem o que está à vista e iluminado</span><i class="mk"></i></button></div>
 <div class="vt-grow"><span>Escuridão <b class="vt-val">${Math.round(L.amb*100)}%</b></span><input type="range" min="0" max="100" step="5" value="${Math.round(L.amb*100)}" data-lz="amb"></div>
 <div class="vt-grow"><span>Visão padrão (casas)</span><div class="seg"><button class="sg" data-a="lvis" data-d="-1">−</button><b class="sg vt-val">${L.vis}</b><button class="sg" data-a="lvis" data-d="1">+</button></div></div>
 <div class="vt-grow"><span>Ferramenta</span><div class="seg">${[['wall','Parede'],['door','Porta'],['light','Luz'],['erase','Apagar']].map(([k,n])=>`<button class="sg${S.lmode===k?' on':''}" data-a="lmode" data-v="${k}">${n}</button>`).join('')}</div></div>
 <div class="vt-grow"><span>Luz nova: raio (casas)</span><div class="seg"><button class="sg" data-a="lr" data-d="-1">−</button><b class="sg vt-val">${S.lr}</b><button class="sg" data-a="lr" data-d="1">+</button></div></div>
 <div class="vt-grow"><span>Cor da luz</span><div class="vt-chips">${sw.map(c=>`<button class="vt-sw${S.lcolor===c?' on':''}" data-a="lcor" data-v="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div></div>
 <div class="vt-grow"><button data-a="lprev" class="${S.lprev?'on':''}">${S.lprev?'Voltar à minha visão':'Ver como os jogadores'}</button><button data-a="lclear">Apagar paredes e luzes</button></div>
 <p class="mu">Parede e Porta: arraste no mapa. Porta fechada é a linha azul; com a seleção, toque numa porta para abrir ou fechar. Cada token pode ter Luz (tocha) e Visão no painel dele.</p>`}
function uiPop(){const el=q('#vpop');if(!el)return;
 if(el.contains(document.activeElement)&&document.activeElement.tagName==='INPUT')return;
 if(scene()&&DRAWT.includes(S.tool)&&S.dok){el.hidden=false;el.innerHTML=`<div class="row"><b class="sp">Desenho</b></div><div class="vt-grow"><span>Cor</span><div class="seg">${[['#e0b84a','Âmbar'],['#ff5a4d','Vermelho'],['#5bd17a','Verde'],['#5aa9ff','Azul'],['#ffffff','Branco']].map(([c,n])=>`<button class="sg${S.dcolor===c?' on':''}" data-a="dc" data-v="${c}" style="color:${c}">${n}</button>`).join('')}</div></div><div class="vt-grow"><span>Espessura</span><div class="seg">${[[2,'Fina'],[4,'Média'],[8,'Grossa']].map(([w,n])=>`<button class="sg${S.dw===w?' on':''}" data-a="dw" data-v="${w}">${n}</button>`).join('')}</div></div><p class="mu">Todos da mesa veem o que você desenha. Desfazer apaga o seu último desenho.</p>`;return}
 if(S.tool==='luz'&&S.popup==='luz'&&isMaster()&&scene()&&luzAv()){el.hidden=false;el.innerHTML=luzPop();return}
 if(S.tool==='fog'&&S.popup==='fog'&&isMaster()&&scene()&&fogAv()){const f=fogOf();el.hidden=false;el.innerHTML=`<div class="row"><b class="sp">Névoa de guerra</b></div><div class="tiles1"><button class="tile${f.on?' on':''}" data-a="fog-on"><span>Névoa ativa (os jogadores veem só o revelado)</span><i class="mk"></i></button></div><div class="vt-grow"><span>Pincel</span><div class="seg"><button class="sg${S.fmode==='rev'?' on':''}" data-a="fog-mode" data-v="rev">Revelar</button><button class="sg${S.fmode==='cov'?' on':''}" data-a="fog-mode" data-v="cov">Cobrir</button></div></div><div class="vt-grow"><span>Tamanho do pincel (casas)</span><div class="seg"><button class="sg" data-a="fog-br" data-d="-0.5">−</button><b class="sg vt-val">${S.fbrush}</b><button class="sg" data-a="fog-br" data-d="0.5">+</button></div></div><div class="vt-grow"><span>Visão dos personagens (casas, 0 = off)</span><div class="seg"><button class="sg" data-a="fog-vis" data-d="-0.5">−</button><b class="sg vt-val">${+f.vis||0}</b><button class="sg" data-a="fog-vis" data-d="0.5">+</button></div></div><div class="vt-grow"><button data-a="fog-all">Cobrir tudo de novo</button><button data-a="fog-none">Revelar tudo (desligar)</button></div><p class="mu">Arraste no mapa para revelar ou cobrir. A névoa é visual: quem abrir o arquivo do mapa vê a imagem inteira.</p>`;return}
 if(S.popup!=='grid'||!isMaster()||!scene()){el.hidden=true;return}
 const g=grid(),st=(k,label,steps)=>`<div class="vt-grow"><span>${label}</span><div class="seg">${steps.slice().reverse().map(d=>d<0?`<button class="sg" data-a="gs" data-k="${k}" data-d="${d}">${d}</button>`:'').join('')}<b class="sg vt-val">${k==='opacity'?Math.round(g.opacity*100)+'%':g[k]}</b>${steps.map(d=>d>0?`<button class="sg" data-a="gs" data-k="${k}" data-d="${d}">+${d}</button>`:'').join('')}</div></div>`;
 const tg=(a,label,on)=>`<button class="tile${on?' on':''}" data-a="${a}"><span>${label}</span><i class="mk"></i></button>`;
 if(el.contains(document.activeElement)&&document.activeElement.tagName==='INPUT')return;
 el.hidden=false;el.innerHTML=`<div class="row"><b class="sp">Grade</b><button class="x" data-a="grid">Fechar</button></div><div class="tiles1">${tg('gt-show','Mostrar grade',g.show)}${tg('gt-snap','Encaixar tokens nas casas',g.snap)}${tg('gt-edit','Alinhar arrastando o mapa',S.gridEdit)}</div>
 ${st('size','Tamanho da casa (px)',[-10,-1,1,10])}${st('ox','Deslocamento X',[-10,-1,1,10])}${st('oy','Deslocamento Y',[-10,-1,1,10])}${st('opacity','Opacidade',[-.05,.05])}${st('m','Metros por casa',[-.5,.5])}
 <div class="vt-grow"><span>Cor</span><div class="seg">${[['#ffffff','Branca'],['#000000','Preta'],['#b3261e','Vermelha'],['#e0b84a','Âmbar']].map(([c,n])=>`<button class="sg${g.color===c?' on':''}" data-a="gc" data-v="${c}">${n}</button>`).join('')}</div></div>`}
async function onUi(e){const b=e.target.closest('[data-a]');if(!b)return;const a=b.dataset.a,M=isMaster(),t=tokById(S.sel);
 if(a.startsWith('t-')){const k=a.slice(2);S.tool=k;S.ruler=null;S.dnew=null;S.popup=k==='fog'?'fog':k==='luz'?'luz':(['fog','luz'].includes(S.popup)?'':S.popup);if(k!=='fog')S.fcur=null;return refresh()}
 if(a==='undo')return undoDraw();if(a==='dclear')return clearDraws();
 if(a==='dc'){S.dcolor=b.dataset.v;return refresh()}if(a==='dw'){S.dw=+b.dataset.v;return refresh()}
 if(a==='z+')return zoomAt(vp().w/2,vp().h/2,1.25);if(a==='z-')return zoomAt(vp().w/2,vp().h/2,.8);
 if(a==='z100')return zoomAt(vp().w/2,vp().h/2,1/S.cam.z);if(a==='fit')return fit();
 if(a==='cpsql')return navigator.clipboard.writeText(TSQL).then(()=>notice('SQL copiado.')).catch(()=>alert('Selecione o texto do SQL e copie manualmente.'));
 if(!M&&!['tficha'].includes(a)&&!a.startsWith('hp'))return;
 if(a==='ltema'){const t=TEMAS.find(x=>x[0]===b.dataset.v)||TEMAS[0];return setLuz({tema:t[0],cor:t[2],forca:t[3]})}
 if(a==='lon')return setLuz({on:!luzOf().on});
 if(a==='lvis')return setLuz({vis:clamp((+luzOf().vis||0)+(+b.dataset.d),0,30)});
 if(a==='lmode'){S.lmode=b.dataset.v;return refresh()}
 if(a==='lr'){S.lr=clamp(S.lr+(+b.dataset.d),1,30);return refresh()}
 if(a==='lcor'){S.lcolor=b.dataset.v;return refresh()}
 if(a==='lprev'){S.lprev=!S.lprev;need();return refresh()}
 if(a==='lclear'){if(await ask('Apagar todas as paredes, portas e luzes desta cena?'))setLuz({walls:[],lights:[]});return}
 if(a==='fog-on')return setFog({on:!fogOf().on});if(a==='fog-all')return setFog({r:[],on:true});if(a==='fog-none')return setFog({on:false});
 if(a==='fog-mode'){S.fmode=b.dataset.v;return refresh()}if(a==='fog-br'){S.fbrush=clamp(Math.round((S.fbrush+(+b.dataset.d))*2)/2,.5,15);return refresh()}
 if(a==='fog-vis')return setFog({vis:clamp(Math.round(((+fogOf().vis||0)+(+b.dataset.d))*2)/2,0,15)});
 if(a==='scenes')return scenesModal();if(a==='addtok')return addTokModal();
 if(a==='grid'){S.popup=S.popup==='grid'?'':'grid';if(S.popup!=='grid')S.gridEdit=false;return refresh()}
 if(a==='activate'){const sc=scene();return activateScene(sc.id)}
 if(a==='gs'){const g=grid(),k=b.dataset.k,d=+b.dataset.d;let v=k==='opacity'?Math.round((g.opacity+d)*100)/100:g[k]+d;v=k==='size'?clamp(v,10,400):k==='opacity'?clamp(v,0,1):k==='m'?clamp(Math.round(v*10)/10,.5,50):v;return setGrid({[k]:v})}
 if(a==='gt-show')return setGrid({show:!grid().show});if(a==='gt-snap')return setGrid({snap:!grid().snap});
 if(a==='gt-edit'){S.gridEdit=!S.gridEdit;return refresh()}
 if(a==='gc')return setGrid({color:b.dataset.v});
 if(!t)return;
 if(a.startsWith('hp'))return hpAdj(t,+a.slice(2));
 if(a==='tficha')return go('agentes',t.char_id);
 if(a==='tbest'){const r=sK('combate')[0];return r&&cbAbrir(cbData(r),t.combat_ref)}
 if(a==='tsize'){const n=+b.dataset.v,s=snapPos(t.x,t.y,{...t,size:n});return tokPatch(t,{size:n,x:s.x,y:s.y}).then(()=>sendPos(t))}
if(a==='tsave'){const isC=t.kind==='char';let grupo=null,nm;
  if(isC){const n=S.models.filter(m=>m.kind==='char'&&m.char_id===t.char_id).length;nm=prompt('Nome desta versão de '+t.name+' (ex.: com capa, ferido)','versão '+(n+1))}
  else{grupo=prompt('Nome da criatura ou token (versões do mesmo ser usam o mesmo nome. Ex.: Lobisomem)',t.name.replace(/\s+\d+$/,'').trim());if(!grupo||!grupo.trim())return;grupo=grupo.trim();
   const n=S.models.filter(m=>m.kind!=='char'&&baseName(m.grupo||m.name)===baseName(grupo)).length;nm=prompt('Nome desta versão de '+grupo+' (ex.: forma humana, forma de lobo)',n?'versão '+(n+1):'padrão')}
  if(!nm||!nm.trim())return;
  const r=await sb.from('token_modelos').insert({campaign_id:camp.id,name:nm.trim(),grupo,kind:isC?'char':t.kind==='threat'?'threat':'generic',char_id:isC?t.char_id:null,image:tokSrc(t)||null,shape:t.shape,size:t.size,cor:t.cor||null,luz:t.luz||null,visao:t.visao??null}).select().single();
  if(r.error)return notice('Erro ao salvar o modelo: '+r.error.message);S.models.push(r.data);uiKey='';refresh();return notice('Modelo salvo: '+(grupo?grupo+' · ':'')+nm.trim())}
 if(a==='tvar'){const m=S.models.find(x=>x.id===b.dataset.id);if(m)return tokPatch(t,{image:m.image,shape:m.shape,size:m.size,cor:m.cor||null,luz:m.luz||null,visao:m.visao??null});return}
 if(a==='tcor')return tokPatch(t,{cor:b.dataset.v||null});
 if(a==='tclr')return tokPatch(t,{image:null});
 if(a==='tluz')return tokPatch(t,{luz:+b.dataset.v||null});
 if(a==='tvis')return tokPatch(t,{visao:b.dataset.v===''?null:+b.dataset.v});
 if(a==='tshape')return tokPatch(t,{shape:b.dataset.v});
 if(a==='thide')return setHidden(t,!t.hidden);
 if(a==='tdel')return ask(`Remover o token "${t.name}"?`).then(ok=>ok&&delTok(t));
 if(a==='timg')return q('#vtimg').click()}
async function onUiChange(e){const t=tokById(S.sel);
 if(e.target.id==='lzcor'&&isMaster())return setLuz({cor:e.target.value,tema:'custom'});
 if(e.target.id==='vtcor'&&t&&isMaster())return tokPatch(t,{cor:e.target.value});
 if(e.target.dataset.tn&&t&&isMaster()){const n=e.target.value.trim()||t.name;return tokPatch(t,{name:n})}
 if(e.target.id==='vtimg'&&t&&e.target.files[0]){const f=e.target.files[0];e.target.value='';try{const im=await tokImg(f);await tokPatch(t,{image:im})}catch(er){alert(er.message)}}}

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
 let tab='char',pc=new Set(),pt=[],qs='',hid=false,gimg='',mq={};const MS=isMaster();
 const onMap=id=>S.tokens.some(t=>t.char_id===id);
 const cbItems=()=>{const r=sK('combate')[0];return r?cbData(r).itens.filter(i=>i.tipo==='ameaca'):[]};
 const draw=()=>{const body=tab==='char'?`<p class="mu">Usa a foto da ficha. O dono do personagem poderá mover o token.</p><div class="tiles">${chars.map(c=>`<button class="tile${pc.has(c.id)?' on':''}" data-pc="${c.id}" ${onMap(c.id)?'disabled':''}><span>${esc(c.name)}${onMap(c.id)?' <small class="mu">já no mapa</small>':''}</span><i class="mk"></i></button>`).join('')||'<p class="mu">Nenhum personagem na campanha.</p>'}</div>`
  :tab==='threat'?`${cbItems().length?`<label>No combate agora</label><div class="tiles">${cbItems().map(i=>`<button class="tile${pt.some(x=>x.ref===i.id)?' on':''}" data-pci="${i.id}"><span>${esc(i.n)}</span><i class="mk"></i></button>`).join('')}</div>`:''}
   <label>Do bestiário</label><input id="vtq" placeholder="Buscar pelo nome…" value="${esc(qs)}"><div class="tiles pick">${(typeof BEST!=='undefined'?BEST:[]).filter(x=>(x.n+' '+x.fam).toLowerCase().includes(qs.toLowerCase())).slice(0,40).map(x=>`<button class="tile${pt.some(p=>!p.ref&&p.n===x.n)?' on':''}" data-pb="${esc(x.n)}"><span>${esc(x.n)}<br><small class="mu">${esc(x.fam||'')}</small></span><i class="mk"></i></button>`).join('')}</div>
   <label>Ou digite um nome</label><div class="row"><input id="vtn" class="sp" placeholder="Nome do token"><button data-pn="1">Adicionar à lista</button></div>${pt.length?`<p class="mu">Na lista: ${pt.map(x=>esc(x.n)).join(', ')}</p>`:''}`
  :tab==='mod'?(!S.mok?'<p class="mu">Para usar modelos, rode o arquivo <b>08_tabuleiro_v3.sql</b> no Supabase (SQL Editor) uma vez e recarregue o site.</p>':!S.models.length?'<p class="mu">Nenhum modelo salvo ainda. Selecione um token no mapa e use <b>Salvar como modelo</b>. Serve para tokens genéricos (Zumbi, Guarda) e para versões de um personagem (com capa, ferido, transformado).</p>':`<p class="mu">Use + para adicionar cópias. Versões de personagem só entram se o personagem ainda não estiver no mapa.</p><div class="vt-list">${S.models.map(m=>{const ch=m.kind==='char'?chars.find(c=>c.id===m.char_id):null;return `<div class="vt-sc"><span class="vt-th" style="${m.image?`background-image:url('${srcUrl(m.image)}')`:''};border-radius:${m.shape==='square'?'4px':'50%'}">${m.image?'':esc((m.name||'?')[0])}</span><span class="sp"><b>${esc(ch?ch.name:(m.grupo||m.name))}</b> <span class="mu">${esc(ch||m.grupo?m.name:'')}</span><br><small class="mu">${ch?'Personagem':m.kind==='threat'?'Ameaça':'Genérico'} · tamanho ${m.size==.5?'½':m.size}${m.cor?' · borda colorida':''}</small></span><button data-pmm="${m.id}">−</button><b>${mq[m.id]||0}</b><button data-pmp="${m.id}">+</button><button class="x" data-pmd="${m.id}" title="Apagar o modelo">✕</button></div>`}).join('')}</div>`)
  :`<label>Nome</label><input id="vgn" placeholder="Ex.: Cultista, Carro, Porta"><div class="row" style="margin-top:8px"><button data-gimg="1">${gimg?'Imagem escolhida ✓':'Escolher imagem (opcional)…'}</button></div><input type="file" id="vgf" accept="image/*" hidden>`;
  o.innerHTML=`<div class="mbox card"><h3>Adicionar token</h3><div class="tabs" id="vta">${[['char','Personagens'],['threat','Ameaças'],['gen','Genérico'],...(MS?[['mod','Modelos']]:[])].map(([k,t])=>`<a data-t="${k}" class="${tab===k?'on':''}">${t}</a>`).join('')}</div><div style="margin-top:10px">${body}</div>
  <div class="tiles1" style="margin-top:10px"><button class="tile${hid?' on':''}" data-hid="1"><span>Criar oculto aos jogadores</span><i class="mk"></i></button></div>
  <div class="row" style="margin-top:12px"><span class="sp"></span><button data-k="0">Cancelar</button><button class="pr" data-k="1">Adicionar</button></div></div>`};
 o.addEventListener('input',e=>{if(e.target.id==='vtq'){qs=e.target.value;const pos=e.target.selectionStart;draw();const n=o.querySelector('#vtq');n.focus();n.setSelectionRange(pos,pos)}});
 o.addEventListener('change',async e=>{if(e.target.id==='vgf'&&e.target.files[0]){const f=e.target.files[0];e.target.value='';try{gimg=await tokImg(f);draw()}catch(er){alert(er.message)}}});
 o.onclick=async e=>{const a=e.target.closest('a[data-t]');if(a){tab=a.dataset.t;hid=tab==='threat';return draw()}
  const b=e.target.closest('button');if(!b)return;const d=b.dataset;
  if(d.pmp){mq[d.pmp]=(mq[d.pmp]||0)+1;return draw()}
  if(d.pmm){mq[d.pmm]=Math.max(0,(mq[d.pmm]||0)-1);return draw()}
  if(d.pmd){const m=S.models.find(x=>x.id===d.pmd);if(m&&await ask('Apagar o modelo "'+m.name+'"?')){const r=await sb.from('token_modelos').delete().eq('id',m.id);if(r.error)notice(r.error.message);else{S.models=S.models.filter(x=>x.id!==m.id);delete mq[m.id];uiKey='';draw()}}return}
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
   else if(tab==='mod'){S.models.forEach(m=>{const q=mq[m.id]||0;if(!q)return;
     if(m.kind==='char'){const c=chars.find(x=>x.id===m.char_id);if(!c)return;if(onMap(c.id)){notice(c.name+' já está no mapa.');return}list.push({name:c.name,kind:'char',char_id:c.id,owner_id:c.owner,image:m.image,shape:m.shape,size:m.size,cor:m.cor||null,luz:m.luz||null,visao:m.visao??null})}
     else{const nome=m.grupo||m.name;for(let i=1;i<=q;i++)list.push({name:q>1?nome+' '+i:nome,kind:m.kind==='threat'?'threat':'generic',image:m.image,shape:m.shape,size:m.size,cor:m.cor||null,luz:m.luz||null,visao:m.visao??null})}})}
   else{const n=(o.querySelector('#vgn').value||'').trim();if(n)list.push({name:n,kind:'generic',image:gimg||null})}
   o.remove();if(!list.length)return;const c0=viewCenter();let off=0;
   for(const it of list){const sz=it.size||1,s=snapPos(c0.x+off,c0.y,{size:sz});off+=gsz()*Math.max(1,sz);
    const r=await sb.from('scene_tokens').insert({scene_id:sc.id,campaign_id:camp.id,size:1,shape:'circle',hidden:hid,x:s.x,y:s.y,...it}).select().single();
    if(r.error){notice('Erro ao criar o token: '+r.error.message);continue}if(!S.tokens.some(t=>t.id===r.data.id))S.tokens.push(r.data)}
   need();refresh()}};
 document.body.append(o);draw()}

return {load,reset,view,leave,onScene,onToken,resync,place,fit,lumAt:lumAlpha,get luz(){return luzOf()},get state(){return S}}
})();
