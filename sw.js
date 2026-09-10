const CACHE_NAME='liudao-v14';
const URLS=['./index.html','./manifest.json'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(URLS)));
  self.skipWaiting();
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch',e=>{
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{
    if(res.ok){const c=res.clone();caches.open(CACHE_NAME).then(cache=>cache.put(e.request,c));}
    return res;
  }).catch(()=>caches.match('./index.html'))));
});