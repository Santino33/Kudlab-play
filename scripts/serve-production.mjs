import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const headerText = await readFile('dist/_headers', 'utf8');
const globalHeaders = Object.fromEntries(headerText.split('/assets/*')[0].trim().split('\n').slice(1).map(line => {
  const i = line.indexOf(':'); return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
}));
const mime = { html: 'text/html', txt: 'text/plain', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', woff: 'font/woff', woff2: 'font/woff2' };
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/' ? '/index.html' : path;
  for (const [key, value] of Object.entries(globalHeaders)) res.setHeader(key, value);
  // Fixture of a previous static worker, served only by this development verification server.
  if (file === '/legacy-sw.js') {
    res.setHeader('Content-Type', 'text/javascript'); res.setHeader('Service-Worker-Allowed', '/');
    res.end("self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));"); return;
  }
  if (!/^\/(index\.html|favicon\.svg|sw\.js|licenses\/(nunito|zod|canonicalize)\.txt|assets\/[A-Za-z0-9_.-]+)$/.test(file)) { res.writeHead(404); res.end(); return; }
  try {
    const data = await readFile(`dist${file}`);
    res.setHeader('Content-Type', mime[file.split('.').at(-1)] || 'application/octet-stream');
    if (file.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
}).listen(4174, '127.0.0.1', () => console.log('Build con CSP: http://127.0.0.1:4174'));
