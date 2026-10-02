const CACHE = 'neuli-v04-real-avatar';
const FILES = ['/', '/index.html', '/styles.css', '/app.js', '/avatar3d.js', '/manifest.webmanifest', '/assets/avatar-manifest.json', '/assets/haneul.glb'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
