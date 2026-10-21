(function(){
const uid=()=>'id'+Math.random().toString(36).slice(2,10);
const U='u1';
window.__db={campaigns:[{id:'c1',name:'Campanha Teste',master:U,code:'ABC123',created_at:'2026-10-01T00:00:00Z'}],
 members:[{campaign_id:'c1',user_id:U}],profiles:[{id:U,name:'Mestre Teste'}],threats:[],rolls:[],characters:[],session_items:[],scenes:[],scene_tokens:[],conteudo_mestre:[],scene_drawings:[]};window.__storage={};
window.__log=[];window.__cb=[];
const legacy=(name,attrs,pts,extra)=>({id:uid(),campaign_id:'c1',owner:U,name,created_at:'2026-10-11T00:00:00Z',data:{player:'Jogador',prof:'Policial',esp:'Policial',attrs,extra:extra||{},defPts:0,vidaAtual:14,pressao:0,
 skills:[['Armas de Fogo','COO'],['Corpo a Corpo','COO'],['Defesa','COO'],['Tática','RAC'],['Investigação','RAC'],['Observação','PER'],['Perícia Forense','RAC'],['Pesquisa','RAC'],['Ocultismo','RAC'],['Religião','RAC'],['Medicina','RAC'],['Mecânica','RAC'],['Eletrônica','RAC'],['Computação','RAC'],['Direção','COO'],['Sobrevivência','PER'],['Furtividade','COO'],['Persuasão','RAC'],['Intimidação','CON'],['Enganação','CON'],['Empatia','PER']].map(([n,a])=>({n,attr:a,pts:(pts[n]||0)})).concat([{n:'Idioma: Latim',attr:'RAC',pts:7}]),
 weapons:[{name:'Pistola',skill:'Armas de Fogo',dmg:'Moderado'}],notes:''}});
window.__db.characters.push(legacy('Denis Legado',{FOR:2,COO:3,RES:2,RAC:3,PER:3,CON:2},{'Armas de Fogo':12,'Investigação':9,'Intimidação':4}));
window.__db.characters.push(legacy('Padre Legado',{FOR:1,COO:2,RES:3,RAC:4,PER:3,CON:2},{'Religião':15,'Ocultismo':8},{CON:1}));
window.__orig=JSON.parse(JSON.stringify(window.__db.characters));
function qb(t){const q={t,op:'select',f:[],pl:null,one:false,sel:false};
 const run=()=>{if(t==='scene_drawings'&&window.__nodraw)return{data:null,error:{code:'42P01',message:'relation "public.scene_drawings" does not exist'}};if((t==='scenes'||t==='scene_tokens')&&window.__novtt)return{data:null,error:{code:'42P01',message:'relation "public.'+t+'" does not exist'}};if(t==='session_items'&&window.__nosess)return{data:null,error:{code:'42P01',message:'relation "public.session_items" does not exist'}};let T=window.__db[t];
  const m=r=>q.f.every(([k,v,i])=>i?v.includes(r[k]):r[k]===v);
  if(q.op==='select'){let r=T.filter(m);if(t==='session_items'&&window.__player)r=r.filter(x=>x.revealed);if(t==='scenes'&&window.__player)r=r.filter(x=>x.active);if(t==='scene_tokens'&&window.__player){const act=window.__db.scenes.filter(x=>x.active).map(x=>x.id);r=r.filter(x=>!x.hidden&&act.includes(x.scene_id))}if(q.one)return{data:r[0]||null,error:null};return{data:JSON.parse(JSON.stringify(r)),error:null}}
  const DEF={scenes:{name:'Nova cena',map_path:null,map_w:3000,map_h:2000,grid:{show:true,size:70,ox:0,oy:0,opacity:.35,color:'#ffffff',snap:true},active:false,fog:{on:false,vis:0,r:[]}},scene_tokens:{name:'Token',kind:'generic',char_id:null,combat_ref:null,image:null,x:0,y:0,size:1,shape:'circle',hidden:false,owner_id:null}};
  if(q.op==='upsert'){const rows=[].concat(q.pl);rows.forEach(r=>{const keys=(q.oc&&q.oc.onConflict||'id').split(',');const ex=T.find(x=>keys.every(k=>x[k]===r[k]));if(ex)Object.assign(ex,JSON.parse(JSON.stringify(r)));else T.push(JSON.parse(JSON.stringify(r)))});return{data:null,error:null}}
  if(q.op==='insert'){const row={id:uid(),created_at:new Date().toISOString(),updated_at:new Date().toISOString(),...(DEF[t]||{}),...q.pl};T.push(row);
    window.__cb.filter(c=>c.table===t).forEach(c=>setTimeout(()=>c.fn({eventType:'INSERT',new:JSON.parse(JSON.stringify(row))}),0));
    const cl=JSON.parse(JSON.stringify(row));return{data:q.one?cl:[cl],error:null}}
  if(q.op==='update'){const r=T.filter(m);r.forEach(x=>Object.assign(x,JSON.parse(JSON.stringify(q.pl))));if(t==='scenes'||t==='scene_tokens')r.forEach(x=>window.__cb.filter(c=>c.table===t).forEach(c=>setTimeout(()=>c.fn({eventType:'UPDATE',new:JSON.parse(JSON.stringify(x))}),0)));window.__log.push({t,upd:q.pl});return{data:r,error:null}}
  if(q.op==='delete'){const r=T.filter(m);window.__db[t]=T.filter(x=>!m(x));return{data:r,error:null}}};
 const api={select(){if(q.op==='select'||true){q.sel=true}return api},insert(p){q.op='insert';q.pl=p;return api},upsert(p,o){q.op='upsert';q.pl=p;q.oc=o;return api},update(p){q.op='update';q.pl=p;return api},delete(){q.op='delete';return api},
  eq(k,v){q.f.push([k,v]);return api},in(k,v){q.f.push([k,v,1]);return api},order(){return api},limit(){return api},single(){q.one=true;return api},
  then(res,rej){return Promise.resolve(run()).then(res,rej)}};return api}
const mock={from:qb,rpc:async(name,a)=>{const db=window.__db;
  if(name==='ativar_cena'){const sc=db.scenes.find(s=>s.id===a.p_scene);if(!sc)return{data:null,error:{message:'Cena não encontrada'}};if(window.__player)return{data:null,error:{message:'Só o mestre ativa cenas'}};db.scenes.forEach(s=>{if(s.campaign_id===sc.campaign_id)s.active=s.id===sc.id});window.__cb.filter(c=>c.table==='scenes').forEach(c=>db.scenes.filter(s=>s.campaign_id===sc.campaign_id).forEach(s=>setTimeout(()=>c.fn({eventType:'UPDATE',new:JSON.parse(JSON.stringify(s))}),0)));return{data:null,error:null}}
  if(name==='mover_token'){const t=db.scene_tokens.find(x=>x.id===a.p_token);if(!t)return{data:null,error:{message:'Token não encontrado'}};if(window.__player&&(t.hidden||t.owner_id!==(window.__uid||'u3')))return{data:null,error:{message:'Este token não é seu'}};t.x=a.p_x;t.y=a.p_y;window.__log.push({rpc:name,a});return{data:null,error:null}}
  if(name==='create_campaign'){const id=uid();db.campaigns.push({id,name:a.p_name,master:U,code:'XYZ789',system:a.p_system||'supernatural',created_at:new Date().toISOString()});db.members.push({campaign_id:id,user_id:U});return{data:id,error:null}}
  return{data:null,error:{message:'n/a'}}},
 storage:{from(b){return{
   upload:async(path,blob,o)=>{if(window.__nostorage)return{data:null,error:{message:'Bucket not found'}};const du=await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(blob)});window.__storage[path]=du;return{data:{path},error:null}},
   createSignedUrl:async p=>window.__storage[p]?{data:{signedUrl:window.__storage[p]},error:null}:{data:null,error:{message:'Object not found'}},
   remove:async ps=>{ps.forEach(p=>delete window.__storage[p]);return{data:ps,error:null}}}}},
 channel(){const ch={on(a,f,fn){window.__cb.push({table:f.table,fn});return ch},subscribe(){return ch}};return ch},removeChannel(){},
 auth:{signOut:async()=>{},signInWithPassword:async()=>({}),signUp:async()=>({}),onAuthStateChange(fn){setTimeout(()=>fn('INITIAL_SESSION',{user:{id:U}}),0)}}};
window.supabase={createClient:()=>mock};
})();
