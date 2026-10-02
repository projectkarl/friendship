const CACHE='neuli-live-v03';
const ASSETS=['/','/index.html','/styles.css','/app.js','/manifest.webmanifest','/assets/haneul_base_no_features.png','/assets/eye_left.png','/assets/eye_right.png','/assets/eye_left_closed.png','/assets/eye_right_closed.png','/assets/mouth.png','/assets/hair_front.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));});
