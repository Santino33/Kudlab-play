// Previous HTML policy, deliberately broken under the Pages /index.html redirect.
const CACHE = 'tg01-static-redirected-fixture';
const FILES = ['/index.html'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const path = (event.request.mode === 'navigate' && ['/', '/index.html', '/pendientes'].includes(url.pathname)) ? '/index.html' : url.pathname;
  if (!FILES.includes(path) || (url.search && path !== '/index.html')) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(path)) || fetch(new Request(path, { credentials: 'omit', cache: 'no-store' }))));
});
