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
const files = ['/index.html', '/favicon.svg', ...['nunito', 'zod', 'canonicalize'].map(n => `/licenses/${n}.txt`), ...(await readdir('dist/assets')).map(f => `/assets/${f}`)];
const digest = createHash('sha256');
for (const file of files) digest.update(await readFile(`dist${file}`));
const version = digest.digest('hex').slice(0, 20);
const worker = `/* Static resources only. No skipWaiting, API caching, evidence or cache deletion. */
const CACHE = 'tg01-static-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const path = (event.request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')) ? '/index.html' : url.pathname;
  if (!FILES.includes(path) || (url.search && path !== '/index.html')) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(path)) || fetch(new Request(path, { credentials: 'omit', cache: 'no-store' }))));
});
`;
await writeFile('dist/sw.js', worker);
await writeFile('dist/_headers', `/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' ${api}; worker-src 'self'; manifest-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors ${teacher}
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
