import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadEnv } from 'vite';
const env = loadEnv('production', process.cwd(), 'VITE_');
const api = env.VITE_API_ORIGIN || 'https://api.invalid';
const teacher = env.VITE_TEACHER_ORIGIN || 'https://docente.invalid';
for (const value of [api, teacher]) {
  const u = new URL(value);
  if (u.origin !== value || (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname))) throw new Error('Invalid deployment origin');
}
await mkdir('dist/licenses', { recursive: true });
await writeFile('dist/licenses/nunito.txt', await readFile('node_modules/@fontsource/nunito/LICENSE'));
for (const name of ['zod', 'canonicalize']) await writeFile(`dist/licenses/${name}.txt`, await readFile(`node_modules/${name}/LICENSE`));
const files = ['/', '/favicon.svg', ...['nunito', 'zod', 'canonicalize'].map(n => `/licenses/${n}.txt`), ...(await readdir('dist/assets')).map(f => `/assets/${f}`)];
// Videos are optional and never block installation. Essential scene files are available offline.
files.push(...['escenario-matematico-sin-globo.webp', 'kud-quieto.png', 'nave-frente.png', 'poster-transicion-inicio.webp'].map(name => `/mentalista/v1/${name}`));
// TG07's pinned scene includes its original video/audio and local font files.
files.push(...(await readdir('dist/kud-dice/v1')).filter(name => !name.endsWith('.json')).map(name => `/kud-dice/v1/${name}`));
const digest = createHash('sha256');
for (const file of files) digest.update(await readFile(file === '/' ? 'dist/index.html' : `dist${file}`));
const version = digest.digest('hex').slice(0, 20);
const worker = `/* Static resources only. No skipWaiting, API caching, evidence or cache deletion. */
// New policy must not reuse HTML cached through the Pages /index.html redirect.
const CACHE = 'tg01-static-v2-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const path = (event.request.mode === 'navigate' && ['/', '/index.html', '/pendientes'].includes(url.pathname)) ? '/' : url.pathname;
  if (!FILES.includes(path) || (url.search && path !== '/')) return;
  event.respondWith((async () => {
    try {
      const cached = await (await caches.open(CACHE)).match(path);
       if (cached) {
         const range = event.request.headers.get('range');
         if (!range) return cached;
         const match = /^bytes=(\\d*)-(\\d*)$/.exec(range);
         if (!match || !match[1] && !match[2]) return fetch(event.request, { credentials: 'omit', cache: 'no-store' });
         const bytes = await cached.arrayBuffer(), size = bytes.byteLength;
         const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
         const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
         if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
         const headers = new Headers(cached.headers);
         headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
         headers.set('Content-Length', String(end - start + 1)); headers.set('Accept-Ranges', 'bytes');
         return new Response(bytes.slice(start, end + 1), { status: 206, headers });
       }
    } catch { /* A local cache failure must not block an available network. */ }
    return fetch(event.request, { credentials: 'omit', cache: 'no-store' });
  })());
});
`;
await writeFile('dist/sw.js', worker);
await writeFile('dist/_headers', `/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'self' ${api}; worker-src 'self'; manifest-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors ${teacher}
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Cache-Control: no-cache
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/sw.js
  Cache-Control: no-cache
`);
console.log(`SW estático: ${files.length} recursos propios, build ${version}`);
