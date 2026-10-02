// Service Worker: App-Shell und Daten zuerst aus dem Netz (am HTTP-Cache vorbei revalidiert), Fallback: Cache (offline)
const V = 15;
const CACHE = 'au-v15';
const SHELL = ['./', 'index.html', 'style.css?v=' + V, 'app.js?v=' + V, 'manifest.webmanifest', 'icons/icon.svg', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const key = url.pathname.includes('/data/') ? 'data/' + url.pathname.split('/data/')[1] : e.request;
  // cache: 'no-cache' → GitHub Pages liefert max-age=600; ohne Revalidierung käme bis 10 Min. lang die alte Version
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
      return res;
    }).catch(() => caches.match(key))
  );
});
