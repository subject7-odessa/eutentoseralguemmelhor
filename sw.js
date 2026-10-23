/* Arquivo Sombrio: cache simples para abrir mais rápido e funcionar mesmo com sinal ruim.
   Estratégia: tenta a rede primeiro (você sempre recebe a versão nova) e, se a rede falhar ou demorar, usa a cópia guardada.
   Chamadas ao Supabase e a outros sites nunca passam por aqui. */
const VERSAO='arquivo-sombrio-v1';
const BASE=['./','index.html','catalogo.js','red.js','tabuleiro.js','manifest.webmanifest','icon-192.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSAO).then(c=>Promise.allSettled(BASE.map(u=>c.add(u)))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSAO).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;
  const u=new URL(r.url);if(u.origin!==self.location.origin)return;
  e.respondWith((async()=>{
    const c=await caches.open(VERSAO);
    try{
      const rede=await Promise.race([fetch(r),new Promise((_,rej)=>setTimeout(()=>rej(new Error('lento')),6000))]);
      if(rede&&rede.ok)c.put(r,rede.clone());
      return rede;
    }catch(err){
      const guardado=await c.match(r,{ignoreSearch:true});
      if(guardado)return guardado;
      if(r.mode==='navigate'){const i=await c.match('index.html')||await c.match('./');if(i)return i}
      throw err;
    }
  })());
});
